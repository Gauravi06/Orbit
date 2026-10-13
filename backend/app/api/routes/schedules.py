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
from app.api.routes.preferences import load_user_rule_prefs

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
                        "start_time": _aware(i.start_time),
                        "end_time": _aware(i.end_time),
                        "status": i.status,
                        "displaced_by_task_id": i.displaced_by_task_id,
                        "displaced_by_title": titles.get(i.displaced_by_task_id),
                        "displacement_reason": i.displacement_reason,
                        "original_start_time": _aware(i.original_start_time),
                    }
                    for i in items
                ],
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
    _save(db, user, result, now, displaced)
    return _response(db, user, now, _at_risk(result, tasks), problems)


# ---------------------------------------------------------------- routes
@router.get("", response_model=ScheduleResponse)
def get_schedule(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _response(db, current_user, _now())


@router.post("/generate", response_model=ScheduleResponse)
def generate(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = _now()
    prefs = load_user_rule_prefs(db, current_user)
    fixed, tasks = _load(db, current_user)
    result = generate_plan(tasks, fixed, prefs, now, HORIZON)
    problems = validate_plan(result.placements, {t.id: t for t in tasks}, fixed, prefs, now)
    _save(db, current_user, result, now, {})
    return _response(db, current_user, now, _at_risk(result, tasks), problems)


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
        if payload.text:
            text = payload.text
            try:
                parsed_blocks, parsed_caps = parse_disruption(payload.text, now)
                blocks.extend([FixedBlock(b["label"], _naive(b["start"]), _naive(b["end"]), 0) for b in parsed_blocks])
                for c in parsed_caps:
                    caps[c["day"]] = c["max_minutes"]
            except GeminiError:
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
    if text and displaced:
        keys = list(displaced)
        phrased = phrase_reasons([displaced[k][1] for k in keys], text)
        for k, r in zip(keys, phrased):
            by, _, old_s = displaced[k]
            displaced[k] = (by, r, old_s)

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

    return {
        "proposal_id": proposal.id,
        "status": proposal.status,
        "created_at": proposal.created_at,
        "expires_at": proposal.expires_at,
        "summary": proposal.summary or "",
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