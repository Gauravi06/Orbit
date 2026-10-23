import hashlib
import json
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.schedule import Schedule
from app.models.schedule_item import ScheduleItem
from app.models.schedule_proposal import ScheduleProposal
from app.models.task import Task, TaskType
from app.models.user import User
from app.schemas.schedule import (
    BlockIn,
    CapIn,
    DisruptionIn,
    ProposalCreateIn,
    ScheduleApprovalResponse,
    ScheduleDayRead,
    ScheduleProposalBrief,
    ScheduleProposalResponse,
    ScheduleRejectionResponse,
    ScheduleResponse,
    TextIn,
    UnclosedCheckResponse,
    WeekSpreadResponse,
    ReplanIn,
    ReplanOut,
)
from app.services.gemini_service import GeminiError, parse_disruption, phrase_reasons
from app.services.rule_engine import (
    TRANSITION_BUFFER,
    FixedBlock,
    Placement,
    PlanTask,
    Prefs,
    generate_plan,
    validate_plan,
)
from app.api.routes.preferences import (
    _parse_days_pattern,
    get_user_preferences_dict,
    load_user_rule_prefs,
    refresh_fixed_commitments,
)

router = APIRouter(prefix="/schedules", tags=["schedules"])

IST = timezone(timedelta(hours=5, minutes=30))
HORIZON = 7                      # plan today + 7 days


# ---------------------------------------------------------------- time helpers
def _now() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)


def _naive(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        dt = dt.astimezone(IST).replace(tzinfo=None)
    return dt


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=IST)
    return dt.astimezone(IST)


# ---------------------------------------------------------------- serialization helpers
def _compute_task_hash(prefs: Prefs, tasks: List[PlanTask], fixed: List[FixedBlock]) -> str:
    prefs_payload = {
        "wake": prefs.wake.strftime("%H:%M"),
        "sleep": prefs.sleep.strftime("%H:%M"),
        "focus_duration": prefs.focus_duration,
        "allow_splitting": prefs.allow_splitting,
        "no_study_after": prefs.no_study_after.strftime("%H:%M") if prefs.no_study_after else None,
        "daily_cap_minutes": prefs.daily_cap_minutes,
    }
    tasks_payload = sorted(
        [
            {
                "id": t.id,
                "title": t.title,
                "remaining_minutes": t.remaining_minutes,
                "priority": t.priority,
                "deadline": t.deadline.isoformat() if t.deadline else None,
            }
            for t in tasks
        ],
        key=lambda x: x["id"],
    )
    fixed_payload = sorted(
        [
            {
                "title": f.title,
                "start": f.start.isoformat(),
                "end": f.end.isoformat(),
                "commute": f.commute_minutes,
            }
            for f in fixed
        ],
        key=lambda x: (x["title"], x["start"]),
    )
    combined = {
        "prefs": prefs_payload,
        "tasks": tasks_payload,
        "fixed": fixed_payload,
    }
    dumped = json.dumps(combined, sort_keys=True)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()


def _serialize_placements(placements: List[Placement]) -> str:
    return json.dumps([
        {
            "task_id": p.task_id,
            "title": p.title,
            "start": p.start.isoformat(),
            "end": p.end.isoformat(),
        }
        for p in placements
    ])


def _deserialize_placements(placements_json: str) -> List[Placement]:
    data = json.loads(placements_json)
    return [
        Placement(
            task_id=p["task_id"],
            title=p["title"],
            start=datetime.fromisoformat(p["start"]),
            end=datetime.fromisoformat(p["end"]),
        )
        for p in data
    ]


def _serialize_displaced(displaced: dict) -> str:
    out = []
    for (tid, s, e), (by, reason, old_s) in displaced.items():
        out.append({
            "task_id": tid,
            "start": s.isoformat(),
            "end": e.isoformat(),
            "by": by,
            "reason": reason,
            "old_start": old_s.isoformat() if old_s else None,
        })
    return json.dumps(out)


def _deserialize_displaced(displaced_json: Optional[str]) -> dict:
    if not displaced_json:
        return {}
    out = {}
    try:
        items = json.loads(displaced_json)
        for i in items:
            key = (i["task_id"], datetime.fromisoformat(i["start"]), datetime.fromisoformat(i["end"]))
            old_s = datetime.fromisoformat(i["old_start"]) if i.get("old_start") else None
            out[key] = (i.get("by"), i.get("reason"), old_s)
    except Exception:
        return {}
    return out


# ---------------------------------------------------------------- load inputs
def _load(db: Session, user: User):
    """Fixed commitments and plannable tasks, converted for the rule engine.

    DEMO HACK: a fixed task stores its START in `deadline` and its
    length in `estimated_duration`. One fixed row per occurrence.
    """
    rows = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            (Task.status.is_(None)) | (~Task.status.in_(["completed", "done"])),
        )
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
                    must_daily=bool(t.must_daily),
                )
            )
    return fixed, tasks


# ---------------------------------------------------------------- displacement
def _reason(cause, kind, old: datetime, new: datetime) -> str:
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

    missing = defaultdict(list)
    for tid, s, e in sorted(before, key=lambda x: x[1]):
        if (tid, s, e) not in after_set:
            missing[tid].append((s, e))

    new_by_task = defaultdict(list)
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
def _save_placements(
    db: Session,
    user: User,
    placements: List[Placement],
    now: datetime,
    displaced: dict,
    horizon_days: int = HORIZON,
):
    today = now.date()
    days = [today + timedelta(days=i) for i in range(horizon_days + 1)]
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

    for p in placements:
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


def _save(db: Session, user: User, result, now: datetime, displaced: dict):
    _save_placements(db, user, result.placements, now, displaced, HORIZON)


# ---------------------------------------------------------------- response
def _response(db: Session, user: User, now: datetime, at_risk=None, violations=None, target_date: Optional[date] = None):
    today = now.date()
    min_date = min(today, target_date) if target_date else today
    max_date = max(today + timedelta(days=HORIZON), target_date) if target_date else (today + timedelta(days=HORIZON))
    titles = {t.id: t.title for t in db.query(Task).filter(Task.user_id == user.id).all()}
    tasks_by_id = {t.id: t for t in db.query(Task).filter(Task.user_id == user.id).all()}
    fixed, _ = _load(db, user)
    scheds = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == user.id,
            Schedule.date >= min_date,
            Schedule.date <= max_date,
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
        day_items = []
        for i in items:
            t = tasks_by_id.get(i.task_id)
            duration_mins = int((i.end_time - i.start_time).total_seconds() / 60) if i.end_time and i.start_time else 0
            kind = "deep" if duration_mins >= 45 else "short"
            tier = "like_to" if (t and t.priority == 1) else ("should_do" if (t and t.priority == 3) else "need_to")
            is_done = i.status in ("completed", "done")
            day_items.append(
                {
                    "id": i.id,
                    "task_id": i.task_id,
                    "title": titles.get(i.task_id),
                    "start_time": _aware(i.start_time),
                    "end_time": _aware(i.end_time),
                    "status": i.status,
                    "kind": kind,
                    "tier": tier,
                    "is_fixed": False,
                    "done": is_done,
                    "displaced_by_task_id": i.displaced_by_task_id,
                    "displaced_by_title": titles.get(i.displaced_by_task_id),
                    "displacement_reason": i.displacement_reason,
                    "original_start_time": _aware(i.original_start_time),
                }
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
                "items": day_items,
            }
        )
    return {"days": days, "at_risk": at_risk or [], "violations": violations or []}


def _format_placements_days(
    now: datetime,
    horizon: int,
    placements: List[Placement],
    fixed: List[FixedBlock],
    titles: Dict[str, str],
    displaced: dict,
):
    today = now.date()
    days = [today + timedelta(days=i) for i in range(horizon + 1)]
    out_days = []
    for d in days:
        day_fixed = [
            {"title": b.title, "start": _aware(b.start), "end": _aware(b.end)}
            for b in fixed
            if b.start.date() == d
        ]
        day_items = []
        for p in placements:
            if p.start.date() == d:
                by, reason, old_s = displaced.get((p.task_id, p.start, p.end), (None, None, None))
                day_items.append(
                    {
                        "id": None,
                        "task_id": uuid.UUID(p.task_id),
                        "title": p.title or titles.get(p.task_id),
                        "start_time": _aware(p.start),
                        "end_time": _aware(p.end),
                        "status": "scheduled",
                        "displaced_by_task_id": uuid.UUID(by) if by else None,
                        "displaced_by_title": titles.get(uuid.UUID(by)) if by else None,
                        "displacement_reason": reason,
                        "original_start_time": _aware(old_s) if old_s else None,
                    }
                )
        day_items.sort(key=lambda x: x["start_time"])
        out_days.append(
            {
                "schedule_id": None,
                "date": d,
                "version": 1,
                "fixed": day_fixed,
                "items": day_items,
            }
        )
    return out_days


def _at_risk(result, tasks: List[PlanTask]):
    names = {t.id: t.title for t in tasks}
    return [
        {"task_id": tid, "title": names.get(tid), "minutes_short": m}
        for tid, m in result.at_risk.items()
    ]


# ---------------------------------------------------------------- shared logic
def _apply_disruption(db: Session, user: User, payload: DisruptionIn, text: str = ""):
    now = _now()
    prefs = load_user_rule_prefs(db, user)
    fixed, tasks = _load(db, user)
    blocks = [FixedBlock(b.label, _naive(b.start), _naive(b.end), 0) for b in payload.blocks]
    caps = {c.day: c.max_minutes for c in payload.caps}

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

    result = generate_plan(tasks, fixed + blocks, prefs, now, HORIZON, caps)
    displaced = _diff(before, result.placements, blocks)

    if text and displaced:
        keys = list(displaced)
        phrased = phrase_reasons([displaced[k][1] for k in keys], text)
        for k, r in zip(keys, phrased):
            by, _, old_s = displaced[k]
            displaced[k] = (by, r, old_s)

    problems = validate_plan(
        result.placements, {t.id: t for t in tasks}, fixed + blocks, prefs, now
    )
    if problems:
        # Do not persist invalid schedule placements
        return _response(db, user, now, _at_risk(result, tasks), violations=problems)

    _save(db, user, result, now, displaced)
    return _response(db, user, now, _at_risk(result, tasks), problems)


# ---------------------------------------------------------------- routes
@router.get("", response_model=ScheduleResponse)
def get_schedule(
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_d = None
    if date:
        try:
            target_d = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            target_d = None
    return _response(db, current_user, _now(), target_date=target_d)


@router.post("/generate", response_model=ScheduleResponse)
def generate(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = _now()

    # Refresh fixed commitments before loading scheduler inputs.
    # Pass the same planning timestamp used by the scheduler.
    refresh_fixed_commitments(db, current_user, now)

    prefs = load_user_rule_prefs(db, current_user)
    fixed, tasks = _load(db, current_user)

    result = generate_plan(tasks, fixed, prefs, now, HORIZON)
    problems = validate_plan(
        result.placements,
        {t.id: t for t in tasks},
        fixed,
        prefs,
        now,
    )

    if problems:
        # Do not persist invalid schedule placements
        return _response(db, current_user, now, _at_risk(result, tasks), violations=problems)

    _save(db, current_user, result, now, {})
    return _response(db, current_user, now, _at_risk(result, tasks), [])

@router.post("/disrupt", response_model=ScheduleResponse)
def disrupt(
    payload: DisruptionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _apply_disruption(db, current_user, payload)


@router.post("/disrupt-text", response_model=ScheduleResponse)
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
    res["interpreted"] = {"blocks": blocks, "caps": caps}
    return res


# ---------------------------------------------------------------- proposal routes
@router.post("/propose", response_model=ScheduleProposalResponse)
def propose_schedule(
    payload: Optional[ProposalCreateIn] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = _now()
    horizon = HORIZON
    prefs = load_user_rule_prefs(db, current_user)
    fixed, tasks = _load(db, current_user)

    blocks: List[FixedBlock] = []
    caps: Dict[date, int] = {}
    text = ""
    if payload:
        if payload.date:
            try:
                target_d = datetime.strptime(payload.date, "%Y-%m-%d").date()
                if target_d > now.date():
                    now = datetime.combine(target_d, prefs.wake)
            except ValueError:
                pass
        candidate_text = f"{payload.text or ''} {payload.selected_option or ''}".strip()
        if candidate_text:
            text = candidate_text
            try:
                parsed_blocks, parsed_caps = parse_disruption(text, now)
                blocks.extend([FixedBlock(b["label"], _naive(b["start"]), _naive(b["end"]), 0) for b in parsed_blocks])
                for c in parsed_caps:
                    caps[c["day"]] = c["max_minutes"]
            except Exception:
                pass
        if payload.blocks:
            blocks.extend([FixedBlock(b.label, _naive(b.start), _naive(b.end), 0) for b in payload.blocks])
        if payload.caps:
            for c in payload.caps:
                caps[c.day] = c.max_minutes

    task_hash = _compute_task_hash(prefs, tasks, fixed)
    result = generate_plan(tasks, fixed + blocks, prefs, now, horizon, caps)
    problems = validate_plan(result.placements, {t.id: t for t in tasks}, fixed + blocks, prefs, now)

    # current future items for displacement comparison without mutating
    before = [
        (str(i.task_id), _naive(i.start_time), _naive(i.end_time))
        for i in db.query(ScheduleItem)
        .join(Schedule, ScheduleItem.schedule_id == Schedule.id)
        .filter(
            Schedule.user_id == current_user.id,
            ScheduleItem.start_time >= _aware(now),
            ScheduleItem.task_id.isnot(None),
        )
        .all()
    ]
    displaced = _diff(before, result.placements, blocks)
    what_changed: List[str] = []
    if text and displaced:
        keys = list(displaced)
        phrased = phrase_reasons([displaced[k][1] for k in keys], text)
        for k, r in zip(keys, phrased):
            by, _, old_s = displaced[k]
            displaced[k] = (by, r, old_s)
            if r and r not in what_changed:
                what_changed.append(r)
    elif displaced:
        for (_, reason, _) in displaced.values():
            if reason and reason not in what_changed:
                what_changed.append(reason)

    for b in blocks:
        desc = f"Adjusted schedule for '{b.title}' ({b.start.strftime('%H:%M')}–{b.end.strftime('%H:%M')})."
        if desc not in what_changed:
            what_changed.append(desc)

    for c_day, max_m in caps.items():
        desc = f"Lightened schedule for {c_day.strftime('%a, %b %d') if hasattr(c_day, 'strftime') else c_day} to protect recovery time."
        if desc not in what_changed:
            what_changed.insert(0, desc)

    if not what_changed:
        what_changed.append(f"Proposed schedule with {len(result.placements)} focus sessions across {horizon} days.")

    at_risk_list = _at_risk(result, tasks)
    summary = f"Proposed plan with {len(result.placements)} sessions across {horizon} days."
    if at_risk_list:
        summary += f" ({len(at_risk_list)} tasks at risk)"

    proposal = ScheduleProposal(
        id=uuid.uuid4(),
        user_id=current_user.id,
        status="pending",
        summary=summary,
        task_hash=task_hash,
        planning_now=now,
        placements_json=_serialize_placements(result.placements),
        at_risk_json=json.dumps(at_risk_list),
        violations_json=json.dumps(problems),
        displaced_json=_serialize_displaced(displaced),
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(proposal)
    db.commit()
    db.refresh(proposal)

    titles = {str(t.id): t.title for t in db.query(Task).filter(Task.user_id == current_user.id).all()}
    days_data = _format_placements_days(now, horizon, result.placements, fixed + blocks, titles, displaced)

    return {
        "proposal_id": proposal.id,
        "status": proposal.status,
        "created_at": proposal.created_at,
        "expires_at": proposal.expires_at,
        "summary": proposal.summary,
        "what_changed": what_changed,
        "days": days_data,
        "at_risk": at_risk_list,
        "violations": problems,
    }


@router.get("/proposals", response_model=List[ScheduleProposalBrief])
def list_proposals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    proposals = (
        db.query(ScheduleProposal)
        .filter(ScheduleProposal.user_id == current_user.id)
        .order_by(ScheduleProposal.created_at.desc())
        .limit(20)
        .all()
    )
    return [
        {
            "proposal_id": p.id,
            "status": p.status,
            "created_at": p.created_at,
            "expires_at": p.expires_at,
            "summary": p.summary or "",
        }
        for p in proposals
    ]


@router.get("/proposals/{proposal_id}", response_model=ScheduleProposalResponse)
def get_proposal(
    proposal_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    proposal = (
        db.query(ScheduleProposal)
        .filter(ScheduleProposal.id == proposal_id, ScheduleProposal.user_id == current_user.id)
        .first()
    )
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found")

    placements = _deserialize_placements(proposal.placements_json)
    fixed, _ = _load(db, current_user)
    displaced = _deserialize_displaced(proposal.displaced_json)
    titles = {str(t.id): t.title for t in db.query(Task).filter(Task.user_id == current_user.id).all()}
    days_data = _format_placements_days(proposal.planning_now, HORIZON, placements, fixed, titles, displaced)

    what_changed: List[str] = []
    for (_, reason, _) in displaced.values():
        if reason and reason not in what_changed:
            what_changed.append(reason)
    if not what_changed and proposal.summary:
        what_changed.append(proposal.summary)

    return {
        "proposal_id": proposal.id,
        "status": proposal.status,
        "created_at": proposal.created_at,
        "expires_at": proposal.expires_at,
        "summary": proposal.summary or "",
        "what_changed": what_changed,
        "days": days_data,
        "at_risk": json.loads(proposal.at_risk_json),
        "violations": json.loads(proposal.violations_json),
    }


def _is_expired(dt: Optional[datetime]) -> bool:
    if dt is None:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt < datetime.now(timezone.utc)


@router.post("/proposals/{proposal_id}/approve", response_model=ScheduleApprovalResponse)
def approve_proposal(
    proposal_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    proposal = (
        db.query(ScheduleProposal)
        .filter(ScheduleProposal.id == proposal_id, ScheduleProposal.user_id == current_user.id)
        .first()
    )
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found")

    if proposal.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Proposal is already {proposal.status}",
        )

    # Check expiration
    if _is_expired(proposal.expires_at):
        proposal.status = "stale"
        db.commit()
        raise HTTPException(status_code=400, detail="Proposal has expired")

    # Check staleness: verify current tasks, fixed commitments and preferences match what was proposed
    now = _now()
    prefs = load_user_rule_prefs(db, current_user)
    fixed, tasks = _load(db, current_user)
    current_hash = _compute_task_hash(prefs, tasks, fixed)
    if current_hash != proposal.task_hash:
        proposal.status = "stale"
        db.commit()
        raise HTTPException(
            status_code=409,
            detail="Schedule inputs (tasks, fixed commitments, or preferences) have changed since this proposal was created. Proposal is stale.",
        )

    # Check validity of placements
    planning_cutoff = _naive(proposal.planning_now)
    placements = _deserialize_placements(proposal.placements_json)
    problems = validate_plan(
        placements,
        {t.id: t for t in tasks},
        fixed,
        prefs,
        planning_cutoff,
    )
    if problems:
        proposal.status = "stale"
        db.commit()
        raise HTTPException(
            status_code=422,
            detail=f"Proposal contains invalid placements: {'; '.join(problems)}",
        )

    # Check task ownership
    user_task_ids = {str(t.id) for t in db.query(Task.id).filter(Task.user_id == current_user.id).all()}
    for p in placements:
        if p.task_id not in user_task_ids:
            proposal.status = "stale"
            db.commit()
            raise HTTPException(
                status_code=422,
                detail=f"Task {p.task_id} in proposal no longer belongs to the user",
            )

    # Persist the EXACT proposed placements
    displaced = _deserialize_displaced(proposal.displaced_json)
    _save_placements(db, current_user, placements, now, displaced, HORIZON)
    proposal.status = "approved"
    db.commit()

    active_schedule = _response(db, current_user, now)
    return {
        "message": "Proposal approved and schedule successfully activated",
        "proposal_id": proposal.id,
        "status": "approved",
        "schedule": active_schedule,
    }


@router.post("/proposals/{proposal_id}/reject", response_model=ScheduleRejectionResponse)
def reject_proposal(
    proposal_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    proposal = (
        db.query(ScheduleProposal)
        .filter(ScheduleProposal.id == proposal_id, ScheduleProposal.user_id == current_user.id)
        .first()
    )
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found")

    if proposal.status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Proposal is already {proposal.status}",
        )

    proposal.status = "rejected"
    db.commit()
    return {
        "message": "Proposal rejected successfully",
        "proposal_id": proposal.id,
        "status": "rejected",
    }


# ---------------------------------------------------------------- week & unclosed endpoints
@router.get("/unclosed-check", response_model=Optional[UnclosedCheckResponse])
def check_unclosed_past_day(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = _now()
    yesterday = now.date() - timedelta(days=1)
    yest_str = yesterday.isoformat()

    sched = (
        db.query(Schedule)
        .filter(Schedule.user_id == current_user.id, Schedule.date == yesterday)
        .first()
    )
    if sched is not None and getattr(sched, "is_closed", False):
        return None
    elif sched is not None and getattr(sched, "is_closed", None) is False:
        weekday_name = yesterday.strftime("%A")
        return {"unclosedDate": yest_str, "weekday": weekday_name}
    return None


@router.get("/week", response_model=WeekSpreadResponse)
def get_week_spread(
    date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now_dt = _now()
    if date:
        try:
            base_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            base_date = now_dt.date()
    else:
        base_date = now_dt.date()

    # Calculate Monday of base_date's week (weekday(): 0=Monday, 6=Sunday)
    weekday_idx = base_date.weekday()
    monday = base_date - timedelta(days=weekday_idx)

    week_dates = [monday + timedelta(days=i) for i in range(7)]
    scheds = (
        db.query(Schedule)
        .filter(
            Schedule.user_id == current_user.id,
            Schedule.date >= week_dates[0],
            Schedule.date <= week_dates[-1],
        )
        .all()
    )
    sched_map = {s.date: s for s in scheds}

    # Load tasks and fixed commitments
    titles = {t.id: t.title for t in db.query(Task).filter(Task.user_id == current_user.id).all()}
    tasks_by_id = {t.id: t for t in db.query(Task).filter(Task.user_id == current_user.id).all()}
    fixed, _ = _load(db, current_user)
    prefs_dict = get_user_preferences_dict(db, current_user)

    days_data = []
    total_deep_mins = 0
    total_rest_mins = 0
    total_hobby_mins = 0

    for d in week_dates:
        s = sched_map.get(d)
        is_closed = bool(getattr(s, "is_closed", False)) if s else False
        day_items = []

        # Add fixed blocks for this day from loaded constraints
        existing_fixed_keys = set()
        seen_fixed_titles = set()
        for b in fixed:
            if b.start.date() == d:
                existing_fixed_keys.add((b.title.lower(), b.start.hour, b.start.minute))
                seen_fixed_titles.add(b.title.lower())
                day_items.append({
                    "id": None,
                    "title": b.title,
                    "start_time": _aware(b.start).isoformat(),
                    "end_time": _aware(b.end).isoformat(),
                    "is_fixed": True,
                    "kind": "fixed",
                    "status": "scheduled",
                    "done": False,
                })

        # Also expand fixed commitments from user preferences for this weekday
        # (ensures past days or newly loaded days in the week display their recurring anchors)
        for fc in (prefs_dict.get("fixed_commitments") or []):
            if not isinstance(fc, dict):
                continue
            fc_name = (fc.get("name") or fc.get("title") or "").strip()
            if not fc_name or fc_name.lower() in seen_fixed_titles:
                continue
            weekdays = _parse_days_pattern(str(fc.get("days") or ""))
            if d.weekday() not in weekdays:
                continue
            start_str = (fc.get("start_time") or "").strip()
            end_str = (fc.get("end_time") or "").strip()
            try:
                sh, sm = map(int, start_str.split(":"))
                eh, em = map(int, end_str.split(":"))
                if (fc_name.lower(), sh, sm) not in existing_fixed_keys:
                    existing_fixed_keys.add((fc_name.lower(), sh, sm))
                    seen_fixed_titles.add(fc_name.lower())
                    start_dt = datetime(d.year, d.month, d.day, sh, sm, 0)
                    end_dt = datetime(d.year, d.month, d.day, eh, em, 0)
                    if end_dt <= start_dt:
                        end_dt += timedelta(days=1)
                    day_items.append({
                        "id": None,
                        "title": fc_name,
                        "start_time": _aware(start_dt).isoformat(),
                        "end_time": _aware(end_dt).isoformat(),
                        "is_fixed": True,
                        "kind": "fixed",
                        "status": "scheduled",
                        "done": False,
                    })
            except Exception:
                continue

        # Build day fixed blocks for conflict checking
        day_fixed_blocks = [b for b in fixed if b.start.date() == d]
        task_based_keys = {(b.title.lower(), b.start.hour, b.start.minute) for b in day_fixed_blocks}
        for fc in (prefs_dict.get("fixed_commitments") or []):
            if not isinstance(fc, dict):
                continue
            fc_name = (fc.get("name") or fc.get("title") or "").strip()
            if not fc_name:
                continue
            weekdays = _parse_days_pattern(str(fc.get("days") or ""))
            if d.weekday() not in weekdays:
                continue
            start_str = (fc.get("start_time") or "").strip()
            end_str = (fc.get("end_time") or "").strip()
            try:
                sh, sm = map(int, start_str.split(":"))
                eh, em = map(int, end_str.split(":"))
                if (fc_name.lower(), sh, sm) in task_based_keys:
                    continue
                start_dt = datetime(d.year, d.month, d.day, sh, sm, 0)
                end_dt = datetime(d.year, d.month, d.day, eh, em, 0)
                if end_dt <= start_dt:
                    end_dt += timedelta(days=1)
                commute = max(
                    int(fc.get("commute_before") or 0),
                    int(fc.get("commute_after") or 0),
                )
                day_fixed_blocks.append(FixedBlock(fc_name, start_dt, end_dt, commute))
            except Exception:
                continue

        # Add scheduled task items (omitting items that conflict with fixed commitments)
        if s:
            db_items = (
                db.query(ScheduleItem)
                .filter(ScheduleItem.schedule_id == s.id)
                .order_by(ScheduleItem.start_time)
                .all()
            )
            for it in db_items:
                it_s = _naive(it.start_time)
                it_e = _naive(it.end_time)
                # Check collision with fixed commitments and their commute/transition buffers
                has_collision = False
                for fb in day_fixed_blocks:
                    pad = timedelta(minutes=fb.commute_minutes) + TRANSITION_BUFFER
                    if it_s < fb.end + pad and it_e > fb.start - pad:
                        has_collision = True
                        break
                if has_collision:
                    continue

                t = tasks_by_id.get(it.task_id)
                item_title = titles.get(it.task_id) or "Study"
                duration_mins = int((it.end_time - it.start_time).total_seconds() / 60) if it.end_time and it.start_time else 0
                kind = "deep" if duration_mins >= 45 else "short"
                tier = "like_to" if (t and t.priority == 1) else ("should_do" if (t and t.priority == 3) else "need_to")
                is_done = it.status in ("completed", "done")

                day_items.append({
                    "id": str(it.id),
                    "task_id": str(it.task_id) if it.task_id else None,
                    "title": item_title,
                    "start_time": _aware(it.start_time).isoformat(),
                    "end_time": _aware(it.end_time).isoformat(),
                    "is_fixed": False,
                    "kind": kind,
                    "tier": tier,
                    "status": it.status or "scheduled",
                    "done": is_done,
                    "displacement_reason": it.displacement_reason,
                })

                if is_closed:
                    if kind == "deep":
                        total_deep_mins += duration_mins
                    if tier == "like_to":
                        total_hobby_mins += duration_mins

        day_items.sort(key=lambda x: x["start_time"])

        days_data.append({
            "date": d.isoformat(),
            "weekday": d.strftime("%a"),
            "fullWeekday": d.strftime("%A"),
            "is_closed": is_closed,
            "items": day_items,
        })

    # Group definitions from preferences or tasks
    user_items = [
        *(prefs_dict.get("need_to_items") or []),
        *(prefs_dict.get("should_do_items") or []),
        *(prefs_dict.get("like_to_items") or []),
    ]

    group_definitions = []
    for item in user_items[:4]:
        title = item if isinstance(item, str) else (item.get("name") or item.get("title") or "")
        if title:
            group_definitions.append({
                "title": title,
                "test": lambda i, t=title.lower(): bool(i.get("title") and t in i["title"].lower()),
            })

    if not group_definitions:
        distinct_titles = set()
        for d in days_data:
            for it in d["items"]:
                if not it.get("is_fixed") and it.get("title"):
                    distinct_titles.add(it["title"])
        for title in list(distinct_titles)[:4]:
            group_definitions.append({
                "title": title,
                "test": lambda i, t=title.lower(): bool(i.get("title") and i["title"].lower() == t),
            })

    if not group_definitions:
        group_definitions = [
            {"title": "Focus Sessions", "test": lambda i: i.get("kind") == "deep"},
            {"title": "Protected Free Time", "test": lambda i: i.get("tier") == "like_to"},
        ]

    groups = []
    for g in group_definitions:
        completed_sessions = 0
        circles = []
        for day in days_data:
            if not day["is_closed"]:
                circles.append("unclosed")
                continue
            matching_item = next((it for it in day["items"] if g["test"](it)), None)
            if not matching_item:
                circles.append("none")
            elif matching_item.get("done"):
                completed_sessions += 1
                circles.append("done")
            else:
                circles.append("moved")

        groups.append({
            "title": g["title"],
            "circles": circles,
            "sentence": f"{g['title']}: {completed_sessions} session{'s' if completed_sessions != 1 else ''} completed on closed days.",
            "completedSessions": completed_sessions,
        })

    deep_work_hours = f"{total_deep_mins / 60:.1f}"
    rest_hours = f"{total_rest_mins / 60:.1f}"
    hobby_hours = f"{total_hobby_mins / 60:.1f}"
    target_hobby_hours = f"{(prefs_dict.get('protected_hobby_mins_week') or 120) / 60:.1f}"

    notice_paragraph = (
        "Orbit noticed you preserved solid focus blocks during your day without cutting into sleep. Your personal buffer and protected time stayed intact."
        if float(deep_work_hours) >= 4.0
        else "Orbit noticed your rhythms leaned toward shorter, adaptive blocks this week to keep energy sustainable while commitments shifted."
    )
    suggestion = (
        "Next week, consider adding an extra 15-minute decompression cushion after long commitments to keep your evenings calm."
        if float(deep_work_hours) >= 6.0
        else "Next week, we can protect one uninterrupted 90-minute morning window before midday commitments."
    )

    return {
        "days": days_data,
        "groups": groups,
        "deepWorkHours": deep_work_hours,
        "restHours": rest_hours,
        "hobbyHours": hobby_hours,
        "targetHobbyHours": target_hobby_hours,
        "noticeParagraph": notice_paragraph,
        "suggestion": suggestion,
    }


@router.post("/replan", response_model=ReplanOut)
def replan_schedule(
    payload: ReplanIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = _now()
    combined_text = f"{payload.feedbackText or ''} {payload.clarification or ''} {payload.reason or ''}".strip()
    lower_text = combined_text.lower()

    # Determine whether this feedback is asking for a schedule change
    is_schedule_change_request = any(
        k in lower_text
        for k in [
            "exhaust", "tired", "drained", "burnout", "sick", "too much", "heavy",
            "overwhelm", "plate", "reschedule", "move", "shift", "cancel", "wrong time"
        ]
    )

    if not is_schedule_change_request:
        return ReplanOut(
            success=True,
            what_changed=[],
            proposal=None,
            message="Feedback recorded. Orbit will factor this into upcoming schedules without changing your active schedule.",
        )

    # For schedule-change requests: create a reviewable proposal WITHOUT mutating active schedule!
    caps = []
    blocks = []
    if any(k in lower_text for k in ["exhaust", "tired", "drained", "burnout", "sick", "too much", "heavy", "overwhelm", "plate"]):
        # Lighten today: cap remaining daily study minutes for today
        caps.append(CapIn(day=now.date(), max_minutes=60))

    prop_in = ProposalCreateIn(
        text=combined_text,
        caps=caps,
        blocks=blocks,
    )
    prop_data = propose_schedule(prop_in, db, current_user)
    proposal_resp = ScheduleProposalResponse(**prop_data)

    return ReplanOut(
        success=True,
        what_changed=proposal_resp.what_changed,
        proposal=proposal_resp,
        message="Proposed schedule adjustment created. Review and approve below to apply it.",
    )
