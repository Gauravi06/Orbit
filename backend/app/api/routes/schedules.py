import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.schedule import Schedule
from app.models.schedule_item import ScheduleItem
from app.models.task import Task, TaskType
from app.models.user import User
from app.services.gemini_service import GeminiError, parse_disruption, phrase_reasons
from app.services.rule_engine import (
    TRANSITION_BUFFER,
    FixedBlock,
    PlanTask,
    Prefs,
    generate_plan,
    validate_plan,
)

router = APIRouter(prefix="/schedules", tags=["schedules"])

IST = timezone(timedelta(hours=5, minutes=30))
HORIZON = 7                      # plan today + 7 days
PREFS = Prefs(sleep=time(23, 0)) # hardcoded for the demo (no onboarding yet)


# ---------------------------------------------------------------- request models
class BlockIn(BaseModel):
    start: datetime
    end: datetime
    label: str = "Disruption"


class CapIn(BaseModel):
    day: date
    max_minutes: int


class DisruptionIn(BaseModel):
    blocks: List[BlockIn] = []   # "lab ran late", "I'm sick this afternoon"
    caps: List[CapIn] = []       # "rough day, go lighter"


class TextIn(BaseModel):
    text: str


# ---------------------------------------------------------------- time helpers
def _now() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)


def _naive(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        dt = dt.astimezone(IST).replace(tzinfo=None)
    return dt


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=IST)


# ---------------------------------------------------------------- load inputs
def _load(db: Session, user: User):
    """Fixed commitments and plannable tasks, converted for the rule engine.

    DEMO HACK: a fixed task stores its START in `deadline` and its
    length in `estimated_duration`. One fixed row per occurrence.
    """
    rows = (
        db.query(Task)
        .filter(Task.user_id == user.id, Task.status != "done")
        .all()
    )
    fixed: List[FixedBlock] = []
    tasks: List[PlanTask] = []
    for t in rows:
        if t.is_fixed:
            if t.deadline is None:
                continue
            s = _naive(t.deadline)
            fixed.append(
                FixedBlock(t.title, s, s + timedelta(minutes=t.estimated_duration), t.commute_minutes)
            )
        elif t.task_type in (TaskType.deadline, TaskType.growth):
            tasks.append(
                PlanTask(
                    id=str(t.id),
                    title=t.title,
                    remaining_minutes=t.estimated_duration,
                    priority=t.priority,
                    deadline=_naive(t.deadline) if t.deadline else None,
                )
            )
    return fixed, tasks


# ---------------------------------------------------------------- displacement
def _reason(cause, kind, old: datetime, new: datetime) -> str:
    # Template fallback; Gemini rephrases this when available.
    when = f"Moved from {old:%a %H:%M} to {new:%a %H:%M}"
    if kind == "block":
        return f"{when} because '{cause}' now blocks that time."
    if kind == "task":
        return f"{when} because '{cause}' took that slot."
    return f"{when} to keep the day balanced."


def _diff(before, after, blocks):
    """Compare old vs new plan. Returns
    {(task_id, new_start, new_end): (displacer_task_id | None, reason, old_start)}"""
    before_set = set(before)
    after_set = {(p.task_id, p.start, p.end) for p in after}

    missing = defaultdict(list)  # slots that no longer exist, per task
    for tid, s, e in sorted(before, key=lambda x: x[1]):
        if (tid, s, e) not in after_set:
            missing[tid].append((s, e))

    new_by_task = defaultdict(list)  # slots that are new, per task
    for p in sorted(after, key=lambda p: p.start):
        if (p.task_id, p.start, p.end) not in before_set:
            new_by_task[p.task_id].append(p)

    out = {}
    for tid, slots in missing.items():
        for (old_s, old_e), p in zip(slots, new_by_task.get(tid, [])):
            by, cause, kind = None, None, None
            for b in blocks:
                if old_s < b.end + TRANSITION_BUFFER and old_e > b.start - TRANSITION_BUFFER:
                    cause, kind = b.title, "block"
                    break
            if cause is None:
                for q in after:
                    if q.task_id != tid and q.start < old_e and q.end > old_s:
                        by, cause, kind = q.task_id, q.title, "task"
                        break
            out[(tid, p.start, p.end)] = (by, _reason(cause, kind, old_s, p.start), old_s)
    return out


# ---------------------------------------------------------------- persistence
def _save(db: Session, user: User, result, now: datetime, displaced: dict):
    today = now.date()
    days = [today + timedelta(days=i) for i in range(HORIZON + 1)]
    cutoff = _aware(now)

    existing: Dict[date, Schedule] = {}
    for s in (
        db.query(Schedule)
        .filter(Schedule.user_id == user.id, Schedule.date >= days[0], Schedule.date <= days[-1])
        .all()
    ):
        existing.setdefault(s.date, s)

    by_day: Dict[date, Schedule] = {}
    for d in days:
        s = existing.get(d)
        if s is None:
            s = Schedule(user_id=user.id, date=d, version=1)
            db.add(s)
        else:
            s.version = (s.version or 1) + 1
            # keep the past, replace only what is still ahead
            db.query(ScheduleItem).filter(
                ScheduleItem.schedule_id == s.id, ScheduleItem.start_time >= cutoff
            ).delete(synchronize_session=False)
        by_day[d] = s
    db.flush()

    for p in result.placements:
        sched = by_day.get(p.start.date())
        if sched is None:
            continue
        by, reason, old_s = displaced.get((p.task_id, p.start, p.end), (None, None, None))
        db.add(
            ScheduleItem(
                schedule_id=sched.id,
                task_id=uuid.UUID(p.task_id),
                start_time=_aware(p.start),
                end_time=_aware(p.end),
                displaced_by_task_id=uuid.UUID(by) if by else None,
                displacement_reason=reason,
                original_start_time=_aware(old_s) if old_s else None,
            )
        )
    db.commit()


# ---------------------------------------------------------------- response
def _response(db: Session, user: User, now: datetime, at_risk=None, violations=None):
    today = now.date()
    titles = {t.id: t.title for t in db.query(Task).filter(Task.user_id == user.id).all()}
    fixed, _ = _load(db, user)
    scheds = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == user.id,
            Schedule.date >= today,
            Schedule.date <= today + timedelta(days=HORIZON),
        )
        .order_by(Schedule.date)
        .all()
    )
    days = []
    for s in scheds:
        items = (
            db.query(ScheduleItem)
            .filter(ScheduleItem.schedule_id == s.id)
            .order_by(ScheduleItem.start_time)
            .all()
        )
        days.append(
            {
                "schedule_id": s.id,
                "date": s.date,
                "version": s.version,
                "fixed": [
                    {"title": b.title, "start": _aware(b.start), "end": _aware(b.end)}
                    for b in fixed
                    if b.start.date() == s.date
                ],
                "items": [
                    {
                        "id": i.id,
                        "task_id": i.task_id,
                        "title": titles.get(i.task_id),
                        "start_time": i.start_time,
                        "end_time": i.end_time,
                        "status": i.status,
                        "displaced_by_task_id": i.displaced_by_task_id,
                        "displaced_by_title": titles.get(i.displaced_by_task_id),
                        "displacement_reason": i.displacement_reason,
                        "original_start_time": i.original_start_time,
                    }
                    for i in items
                ],
            }
        )
    return {"days": days, "at_risk": at_risk or [], "violations": violations or []}


def _at_risk(result, tasks: List[PlanTask]):
    names = {t.id: t.title for t in tasks}
    return [
        {"task_id": tid, "title": names.get(tid), "minutes_short": m}
        for tid, m in result.at_risk.items()
    ]


# ---------------------------------------------------------------- shared logic
def _apply_disruption(db: Session, user: User, payload: DisruptionIn, text: str = ""):
    now = _now()
    fixed, tasks = _load(db, user)
    blocks = [FixedBlock(b.label, _naive(b.start), _naive(b.end), 0) for b in payload.blocks]
    caps = {c.day: c.max_minutes for c in payload.caps}

    # the plan the user is currently looking at (future items only)
    before = [
        (str(i.task_id), _naive(i.start_time), _naive(i.end_time))
        for i in db.query(ScheduleItem)
        .join(Schedule, ScheduleItem.schedule_id == Schedule.id)
        .filter(
            Schedule.user_id == user.id,
            ScheduleItem.start_time >= _aware(now),
            ScheduleItem.task_id.isnot(None),
        )
        .all()
    ]

    result = generate_plan(tasks, fixed + blocks, PREFS, now, HORIZON, caps)
    displaced = _diff(before, result.placements, blocks)

    if text and displaced:  # one batched Gemini call; falls back to templates
        keys = list(displaced)
        phrased = phrase_reasons([displaced[k][1] for k in keys], text)
        for k, r in zip(keys, phrased):
            by, _, old_s = displaced[k]
            displaced[k] = (by, r, old_s)

    problems = validate_plan(
        result.placements, {t.id: t for t in tasks}, fixed + blocks, PREFS, now
    )
    _save(db, user, result, now, displaced)
    return _response(db, user, now, _at_risk(result, tasks), problems)


# ---------------------------------------------------------------- routes
@router.get("")
def get_schedule(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _response(db, current_user, _now())


@router.post("/generate")
def generate(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = _now()
    fixed, tasks = _load(db, current_user)
    result = generate_plan(tasks, fixed, PREFS, now, HORIZON)
    problems = validate_plan(result.placements, {t.id: t for t in tasks}, fixed, PREFS, now)
    _save(db, current_user, result, now, {})
    return _response(db, current_user, now, _at_risk(result, tasks), problems)


@router.post("/disrupt")
def disrupt(
    payload: DisruptionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _apply_disruption(db, current_user, payload)


@router.post("/disrupt-text")
def disrupt_text(
    payload: TextIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        blocks, caps = parse_disruption(payload.text, _now())
    except GeminiError as e:
        raise HTTPException(status_code=503, detail=f"Couldn't interpret that right now: {e}")
    if not blocks and not caps:
        raise HTTPException(
            status_code=422,
            detail="I couldn't find a time window in that. Try: 'I'm sick this afternoon'.",
        )
    dis = DisruptionIn(
        blocks=[BlockIn(**b) for b in blocks],
        caps=[CapIn(**c) for c in caps],
    )
    res = _apply_disruption(db, current_user, dis, payload.text)
    res["interpreted"] = {"blocks": blocks, "caps": caps}  # shown in the UI for transparency
    return res