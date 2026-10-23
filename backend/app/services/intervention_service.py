import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.intervention import Intervention
from app.models.schedule import Schedule
from app.models.schedule_item import ScheduleItem
from app.models.task import Task
from app.models.user import User

logger = logging.getLogger(__name__)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _format_time_remaining(deadline: datetime, now: datetime) -> str:
    delta = deadline - now
    total_seconds = max(0, int(delta.total_seconds()))
    mins = total_seconds // 60
    if mins < 60:
        return f"{mins} min{'s' if mins != 1 else ''}"
    hours = round(mins / 60, 1)
    if hours.is_integer():
        hours = int(hours)
    return f"{hours} hour{'s' if hours != 1 else ''}"


def run_detection_cycle(
    db: Session,
    now: Optional[datetime] = None,
    user_id: Optional[uuid.UUID] = None,
    approaching_hours: Optional[int] = None,
) -> List[Intervention]:
    """
    Deterministic detection rule engine for proactive interventions.
    Evaluates approaching deadlines, overdue tasks, status transitions,
    and snooze awakenings without mutating active schedules.
    """
    now = _aware(now) or datetime.now(timezone.utc)
    approaching_hours = approaching_hours or settings.intervention_approaching_hours

    users_query = db.query(User)
    if user_id:
        users_query = users_query.filter(User.id == user_id)
    users = users_query.all()

    for user in users:
        # 1. Awaken expired snoozes
        snoozed_list = (
            db.query(Intervention)
            .filter(Intervention.user_id == user.id, Intervention.status == "snoozed")
            .all()
        )
        for inv in snoozed_list:
            if inv.snoozed_until and now >= _aware(inv.snoozed_until):
                inv.status = "active"
                inv.snoozed_until = None
                inv.updated_at = now

        # 2. Evaluate tasks for user
        tasks = (
            db.query(Task)
            .filter(Task.user_id == user.id, Task.is_fixed == False)  # noqa: E712
            .all()
        )

        for task in tasks:
            # If task is completed or cancelled, resolve all related active/snoozed interventions
            if task.status in ("completed", "done", "cancelled", "deleted"):
                db.query(Intervention).filter(
                    Intervention.user_id == user.id,
                    Intervention.task_id == task.id,
                    Intervention.status.in_(["active", "snoozed"]),
                ).update(
                    {"status": "resolved", "resolved_at": now, "updated_at": now},
                    synchronize_session=False,
                )
                continue

            d_aware = _aware(task.deadline) if task.deadline else None

            target_types_to_create = []

            if d_aware is None:
                # If task has no deadline, resolve any leftover deadline interventions
                db.query(Intervention).filter(
                    Intervention.user_id == user.id,
                    Intervention.task_id == task.id,
                    Intervention.intervention_type.in_(["approaching_deadline", "overdue"]),
                    Intervention.status.in_(["active", "snoozed"]),
                ).update(
                    {"status": "resolved", "resolved_at": now, "updated_at": now},
                    synchronize_session=False,
                )
            else:
                if d_aware < now:
                    target_type = "overdue"
                    target_dedup_key = f"{user.id}:{task.id}:overdue"
                    title = f"Overdue: {task.title}"
                    message = f"'{task.title}' was due on {d_aware.strftime('%b %d, %H:%M')}. Review your plan to reschedule or finish it."

                    # Resolve any prior approaching_deadline intervention for this task
                    db.query(Intervention).filter(
                        Intervention.user_id == user.id,
                        Intervention.task_id == task.id,
                        Intervention.intervention_type == "approaching_deadline",
                        Intervention.status.in_(["active", "snoozed"]),
                    ).update(
                        {"status": "resolved", "resolved_at": now, "updated_at": now},
                        synchronize_session=False,
                    )
                    target_types_to_create.append((target_type, target_dedup_key, title, message))

                elif now <= d_aware <= now + timedelta(hours=approaching_hours):
                    target_type = "approaching_deadline"
                    target_dedup_key = f"{user.id}:{task.id}:approaching_deadline"
                    title = f"Approaching deadline: {task.title}"
                    message = f"'{task.title}' is due in {_format_time_remaining(d_aware, now)} ({d_aware.strftime('%a %H:%M')})."

                    # Resolve any prior overdue intervention for this task if deadline was moved
                    db.query(Intervention).filter(
                        Intervention.user_id == user.id,
                        Intervention.task_id == task.id,
                        Intervention.intervention_type == "overdue",
                        Intervention.status.in_(["active", "snoozed"]),
                    ).update(
                        {"status": "resolved", "resolved_at": now, "updated_at": now},
                        synchronize_session=False,
                    )
                    target_types_to_create.append((target_type, target_dedup_key, title, message))

                else:
                    # Deadline is comfortably in the future: resolve approaching/overdue interventions
                    db.query(Intervention).filter(
                        Intervention.user_id == user.id,
                        Intervention.task_id == task.id,
                        Intervention.intervention_type.in_(["approaching_deadline", "overdue"]),
                        Intervention.status.in_(["active", "snoozed"]),
                    ).update(
                        {"status": "resolved", "resolved_at": now, "updated_at": now},
                        synchronize_session=False,
                    )

            # 3. Check for repeated unfinished planned days
            # Count distinct past calendar days where this task had a planned schedule block that ended before now
            past_items = (
                db.query(ScheduleItem, Schedule.date)
                .join(Schedule, ScheduleItem.schedule_id == Schedule.id)
                .filter(
                    Schedule.user_id == user.id,
                    ScheduleItem.task_id == task.id,
                    ScheduleItem.end_time < now,
                    ~ScheduleItem.status.in_(["completed", "done", "cancelled"]),
                )
                .all()
            )
            # Distinct calendar days where the planned schedule block ended before now
            # and consistently belongs to that schedule day
            past_dates = {
                sched_date
                for item, sched_date in past_items
                if item.start_time and item.start_time.date() == sched_date
            }

            if len(past_dates) >= 2:
                rep_type = "repeated_unfinished"
                rep_dedup_key = f"{user.id}:{task.id}:repeated_unfinished"
                rep_title = f"Plan check: {task.title}"
                rep_message = f"'{task.title}' has remained unfinished across {len(past_dates)} past planned days. Is the current plan not working?"
                target_types_to_create.append((rep_type, rep_dedup_key, rep_title, rep_message))
            else:
                # If conditions are no longer met (e.g. past blocks cleaned or reorganized), resolve
                db.query(Intervention).filter(
                    Intervention.user_id == user.id,
                    Intervention.task_id == task.id,
                    Intervention.intervention_type == "repeated_unfinished",
                    Intervention.status.in_(["active", "snoozed"]),
                ).update(
                    {"status": "resolved", "resolved_at": now, "updated_at": now},
                    synchronize_session=False,
                )

            for target_type, target_dedup_key, title, message in target_types_to_create:
                existing = (
                    db.query(Intervention)
                    .filter(Intervention.dedup_key == target_dedup_key)
                    .first()
                )

                if existing:
                    if existing.status == "active":
                        existing.title = title
                        existing.message = message
                        existing.updated_at = now
                    elif existing.status == "snoozed":
                        if existing.snoozed_until and now >= _aware(existing.snoozed_until):
                            existing.status = "active"
                            existing.snoozed_until = None
                            existing.title = title
                            existing.message = message
                            existing.updated_at = now
                    elif existing.status == "resolved":
                        # Re-open if condition resurfaced
                        existing.status = "active"
                        existing.resolved_at = None
                        existing.title = title
                        existing.message = message
                        existing.updated_at = now
                    # Note: if dismissed, do not disturb user again for this exact condition
                else:
                    # Concurrency-safe insert using savepoint
                    new_inv = Intervention(
                        user_id=user.id,
                        task_id=task.id,
                        intervention_type=target_type,
                        title=title,
                        message=message,
                        status="active",
                        dedup_key=target_dedup_key,
                        created_at=now,
                        updated_at=now,
                    )
                    savepoint = db.begin_nested()
                    try:
                        db.add(new_inv)
                        db.flush()
                    except IntegrityError:
                        savepoint.rollback()

    db.commit()

    active_query = db.query(Intervention).filter(Intervention.status == "active")
    if user_id:
        active_query = active_query.filter(Intervention.user_id == user_id)
    return active_query.order_by(Intervention.created_at.desc()).all()
