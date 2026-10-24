import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func as sa_func

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.preference import Preference
from app.models.task import Task, TaskType
from app.models.user import User
from app.schemas.preference import OnboardingPayload, PreferencesUpdate
from app.services.rule_engine import Prefs

router = APIRouter(tags=["preferences"])

IST = timezone(timedelta(hours=5, minutes=30))


def _naive(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        dt = dt.astimezone(IST).replace(tzinfo=None)
    return dt

DEFAULT_PREFERENCES: Dict[str, Any] = {
    "wake_time": "07:00",
    "sleep_time": "23:00",
    "focus_length": 120,
    "focus_duration": 120,
    "prefer_long_sessions": True,
    "allow_splitting": True,
    "juggles": ["classes", "gym", "assignments"],
    "daily_load_cap_mins": 480,
    "daily_cap_minutes": 480,
    "protected_hobby_mins_week": 120,
    "best_time_of_day": "morning",
    "weekend_mode": "light",
}


def _deserialize_value(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception:
        return raw


def _serialize_value(val: Any) -> str:
    if isinstance(val, (dict, list)):
        return json.dumps(val)
    if isinstance(val, bool):
        return "true" if val else "false"
    return str(val)


def get_user_preferences_dict(db: Session, user: User) -> Dict[str, Any]:
    prefs = DEFAULT_PREFERENCES.copy()

    # Apply any values on User table if set
    if user.wake_time:
        prefs["wake_time"] = user.wake_time.strftime("%H:%M")
    if user.sleep_time:
        prefs["sleep_time"] = user.sleep_time.strftime("%H:%M")
    if user.focus_duration:
        prefs["focus_duration"] = user.focus_duration
        prefs["focus_length"] = user.focus_duration
    if user.preferred_focus_time:
        prefs["best_time_of_day"] = user.preferred_focus_time
    if user.break_preference:
        prefs["break_preference"] = user.break_preference

    # Apply all values from preferences table
    rows = db.query(Preference).filter(Preference.user_id == user.id).all()
    saved: Dict[str, Any] = {}
    for row in rows:
        value = _deserialize_value(row.value)
        saved[row.preference] = value
        prefs[row.preference] = value

    # Reconcile focus aliases: an explicitly saved value (either alias) wins
    # over defaults; focus_duration is preferred because the scheduler reads it.
    focus = saved.get("focus_duration")
    if focus is None:
        focus = saved.get("focus_length")
    if focus is None:
        focus = user.focus_duration or DEFAULT_PREFERENCES["focus_duration"]
    prefs["focus_duration"] = focus
    prefs["focus_length"] = focus

    if "daily_load_cap_mins" in prefs and "daily_cap_minutes" not in prefs:
        prefs["daily_cap_minutes"] = prefs["daily_load_cap_mins"]
    elif "daily_cap_minutes" in prefs and "daily_load_cap_mins" not in prefs:
        prefs["daily_load_cap_mins"] = prefs["daily_cap_minutes"]

    return prefs


def save_user_preferences_dict(
    db: Session,
    user: User,
    data: Dict[str, Any],
    source: str = "preferences",
    commit: bool = True,
) -> Dict[str, Any]:
    # Synchronize alias pairs in incoming data
    if "focus_length" in data and "focus_duration" not in data:
        data["focus_duration"] = data["focus_length"]
    elif "focus_duration" in data and "focus_length" not in data:
        data["focus_length"] = data["focus_duration"]

    if "daily_load_cap_mins" in data and "daily_cap_minutes" not in data:
        data["daily_cap_minutes"] = data["daily_load_cap_mins"]
    elif "daily_cap_minutes" in data and "daily_load_cap_mins" not in data:
        data["daily_load_cap_mins"] = data["daily_cap_minutes"]

    for key, val in data.items():
        if val is None:
            continue
        serialized = _serialize_value(val)

        row = (
            db.query(Preference)
            .filter(Preference.user_id == user.id, Preference.preference == key)
            .first()
        )
        if row:
            row.value = serialized
            row.source = source
            row.confidence = 1.0
        else:
            row = Preference(
                user_id=user.id,
                preference=key,
                value=serialized,
                source=source,
                confidence=1.0,
            )
            db.add(row)

        # Sync to user columns if matching
        if key == "wake_time":
            if val == "no_pref":
                user.wake_time = None
            elif isinstance(val, str):
                try:
                    h, m = map(int, val.split(":"))
                    user.wake_time = time(h, m)
                except Exception:
                    pass
        elif key == "sleep_time":
            if val == "no_pref":
                user.sleep_time = None
            elif isinstance(val, str):
                try:
                    h, m = map(int, val.split(":"))
                    user.sleep_time = time(h, m)
                except Exception:
                    pass
        elif key in ("focus_duration", "focus_length"):
            try:
                user.focus_duration = int(val)
            except Exception:
                pass
        elif key in ("best_time_of_day", "energy_preference"):
            user.preferred_focus_time = str(val)
        elif key == "break_preference":
            user.break_preference = str(val)

    if commit:
        db.commit()
    return get_user_preferences_dict(db, user)


def load_user_rule_prefs(db: Session, user: User) -> Prefs:
    """Build pure Prefs dataclass for the rule engine strictly isolated per user."""
    p = get_user_preferences_dict(db, user)

    wake = time(7, 0)
    if "wake_time" in p and isinstance(p["wake_time"], str) and p["wake_time"] != "no_pref":
        try:
            h, m = map(int, p["wake_time"].split(":"))
            wake = time(h, m)
        except Exception:
            pass

    sleep = time(23, 0)
    if "sleep_time" in p and isinstance(p["sleep_time"], str) and p["sleep_time"] != "no_pref":
        try:
            h, m = map(int, p["sleep_time"].split(":"))
            sleep = time(h, m)
        except Exception:
            pass

    focus_duration = int(p.get("focus_duration", p.get("focus_length", 120)))
    allow_splitting = bool(p.get("allow_splitting", True))

    no_study_after = None
    if p.get("no_study_after") and isinstance(p["no_study_after"], str) and p["no_study_after"] != "no_pref":
        try:
            h, m = map(int, p["no_study_after"].split(":"))
            no_study_after = time(h, m)
        except Exception:
            pass

    daily_cap_minutes = int(p.get("daily_cap_minutes", p.get("daily_load_cap_mins", 480)))
    morning_routine_minutes = int(p.get("morning_routine_minutes", 0) or 0)
    wind_down_minutes = int(p.get("wind_down_minutes", 0) or 0)

    return Prefs(
        wake=wake,
        sleep=sleep,
        focus_duration=focus_duration,
        allow_splitting=allow_splitting,
        no_study_after=no_study_after,
        daily_cap_minutes=daily_cap_minutes,
        morning_routine_minutes=morning_routine_minutes,
        wind_down_minutes=wind_down_minutes,
    )


@router.get("/preferences", response_model=Dict[str, Any])
def get_preferences(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_user_preferences_dict(db, current_user)


@router.put("/preferences", response_model=Dict[str, Any])
def update_preferences(
    payload: PreferencesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = payload.model_dump(exclude_unset=True)
    res = save_user_preferences_dict(db, current_user, data, source="preferences")
    if "fixed_commitments" in data:
        refresh_fixed_commitments(db, current_user)
        db.commit()
    return res


@router.post("/onboarding", response_model=Dict[str, Any], status_code=status.HTTP_200_OK)
def save_onboarding(
    payload: OnboardingPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = payload.model_dump(exclude_unset=True)

    # Save preferences without committing — we commit once at the end to keep
    # the preference upserts and task creation in a single atomic transaction.
    save_user_preferences_dict(db, current_user, data, source="onboarding", commit=False)

    # ---------------------------------------------------------------------------
    # Create Task rows for priority-tiered items so the scheduler can see them.
    # Fixed commitments are NOT converted to Tasks here because is_fixed Tasks
    # require a concrete start datetime (stored in the deadline column per the
    # DEMO HACK in schedules._load()), but onboarding stores only HH:MM strings
    # with a vague 'days' descriptor. This gap is documented in ORBIT_HANDOFF.md.
    # ---------------------------------------------------------------------------
    _create_onboarding_tasks(db, current_user, data)

    # Upsert fixed-commitment Task rows so the scheduler can treat them as
    # untouchable blocks. Must come after _create_onboarding_tasks so the
    # single db.commit() below covers everything atomically.
    _upsert_fixed_commitments(db, current_user, data)

    # Single commit — rolls back both preferences and tasks if anything above fails.
    db.commit()

    return get_user_preferences_dict(db, current_user)


def _create_onboarding_tasks(db: Session, user: User, data: Dict[str, Any]) -> None:
    """
    Persist need_to_items, should_do_items, and like_to_items as Task rows.
    Idempotent: skips any item whose title (case-insensitive) already exists
    as a non-fixed Task for this user.
    """
    need_to = data.get("need_to_items") or []
    should_do = data.get("should_do_items") or []
    like_to = data.get("like_to_items") or []

    def _title_exists(title: str) -> bool:
        """Return True if a task with this title already exists for this user."""
        return (
            db.query(Task)
            .filter(
                Task.user_id == user.id,
                sa_func.lower(Task.title) == title.lower(),
            )
            .first()
        ) is not None

    def _add(
        title: str,
        task_type: TaskType,
        priority: int,
        duration: int,
        deadline: datetime | None,
        must_daily: bool = False,
    ) -> None:
        if not title or _title_exists(title):
            return
        task = Task(
            user_id=user.id,
            title=title,
            task_type=task_type,
            priority=priority,
            estimated_duration=duration,
            deadline=deadline,
            is_fixed=False,
            must_daily=must_daily,
        )
        db.add(task)

    # need_to_items → priority 5; use task_type=deadline when deadline provided,
    # else task_type=growth (deadline field is required for task_type=deadline).
    for item in need_to:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or item.get("title") or "").strip()
        if not name:
            continue
        duration = int(item.get("duration") or 60)
        raw_deadline = item.get("deadline")
        dl = None
        if raw_deadline:
            try:
                # Expect YYYY-MM-DD; store as end-of-day datetime
                d = datetime.strptime(str(raw_deadline), "%Y-%m-%d")
                dl = d.replace(hour=23, minute=59, second=0)
            except ValueError:
                pass
        task_type = TaskType.deadline if dl is not None else TaskType.growth
        _add(name, task_type, 5, duration, dl)

    # should_do_items → task_type=growth, priority 3
    for item in should_do:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or item.get("title") or "").strip()
        if not name:
            continue
        duration = int(item.get("duration") or 60)
        freq = str(item.get("frequency") or "").strip().lower()
        must_daily = freq in ("daily", "every day", "everyday")
        _add(name, TaskType.growth, 3, duration, None, must_daily=must_daily)

    # like_to_items → task_type=growth, priority 1
    for item in like_to:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or item.get("title") or "").strip()
        if not name:
            continue
        duration = int(item.get("duration") or 60)
        freq = str(item.get("frequency") or "").strip().lower()
        must_daily = freq in ("daily", "every day", "everyday")
        _add(name, TaskType.growth, 1, duration, None, must_daily=must_daily)


# ---------------------------------------------------------------------------
# Fixed-commitment weekday helpers
# ---------------------------------------------------------------------------

_WEEKDAY_NAMES: List[str] = [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
]

_WEEKDAY_MAP: Dict[str, int] = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}

_MON_FRI_NAMES: frozenset = frozenset(["monday", "tuesday", "wednesday", "thursday", "friday"])

def _parse_days_pattern(days_raw: str) -> List[int]:
    """
    Return a list of weekday integers (0=Mon … 6=Sun) from the onboarding
    `days` field.

    Recognised patterns
    -------------------
    "Daily" / "Every day" / "Everyday"  →  [0, 1, 2, 3, 4, 5, 6]
    "Weekdays"                          →  [0, 1, 2, 3, 4]
    "Weekends"                          →  [5, 6]
    "Monday–Friday" or "Monday-Friday"  →  [0, 1, 2, 3, 4]
    "Mon-Fri"                           →  [0, 1, 2, 3, 4]
    "Mon, Wed, Fri"                     →  [0, 2, 4]
    Any single weekday name/abbr        →  [weekday_index]
    Anything else                       →  [] (caller skips the commitment)
    """
    if not days_raw:
        return []

    s = days_raw.strip().replace("\u2013", "-").replace("\u2014", "-")
    lower = s.lower()

    if lower in ("daily", "everyday", "every day", "all week", "all days", "every_day"):
        return [0, 1, 2, 3, 4, 5, 6]

    if lower in ("weekdays", "weekday", "mon-fri", "same_weekdays"):
        return [0, 1, 2, 3, 4]

    if lower in ("weekends", "weekend", "sat-sun"):
        return [5, 6]

    # Comma-separated list like "Mon, Wed, Fri" or "Monday, Wednesday"
    if "," in s:
        found = set()
        for part in s.split(","):
            p = part.strip().lower()
            if p in _WEEKDAY_MAP:
                found.add(_WEEKDAY_MAP[p])
        if found:
            return sorted(list(found))

    # Range like "Monday-Friday" or "Mon-Fri"
    if "-" in s:
        parts = [p.strip().lower() for p in s.split("-", 1)]
        if len(parts) == 2:
            start_idx = _WEEKDAY_MAP.get(parts[0])
            end_idx = _WEEKDAY_MAP.get(parts[1])
            if start_idx is not None and end_idx is not None and start_idx <= end_idx:
                return list(range(start_idx, end_idx + 1))
        return []

    # Single weekday name or abbreviation
    if lower in _WEEKDAY_MAP:
        return [_WEEKDAY_MAP[lower]]

    return []


def _occurrences_in_window(weekdays: List[int], today: date, horizon_days: int = 7) -> List[date]:
    """
    Return all dates from today through today+horizon_days (inclusive) whose
    weekday is in `weekdays`.
    """
    out: List[date] = []
    for offset in range(horizon_days + 1):
        d = today + timedelta(days=offset)
        if d.weekday() in weekdays:
            out.append(d)
    return out



def refresh_fixed_commitments(
    db: Session, user: User, now: datetime | None = None
) -> None:
    """Remove expired fixed occurrences, reconcile obsolete future occurrences, and refresh."""
    if now is None:
        now = datetime.combine(date.today(), time.min)

    today = now.date()

    # 1. Purge expired fixed occurrences
    fixed_rows = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.is_fixed.is_(True),
            Task.deadline.isnot(None),
        )
        .all()
    )

    expired_ids = []
    for row in fixed_rows:
        start = _naive(row.deadline)
        end = start + timedelta(minutes=row.estimated_duration)
        if end <= now:
            expired_ids.append(row.id)

    if expired_ids:
        db.query(Task).filter(
            Task.user_id == user.id,
            Task.is_fixed.is_(True),
            Task.id.in_(expired_ids),
        ).delete(synchronize_session=False)

    # 2. Reconcile obsolete future occurrences when user updates or deletes commitments
    stored = get_user_preferences_dict(db, user)
    if "fixed_commitments" in stored:
        commitments: List[Dict[str, Any]] = stored.get("fixed_commitments") or []

        canonical_future_keys = set()
        for item in commitments:
            if not isinstance(item, dict):
                continue
            name = (item.get("name") or item.get("title") or "").strip().lower()
            if not name:
                continue
            start_str = (item.get("start_time") or "").strip()
            try:
                sh, sm = map(int, start_str.split(":"))
            except Exception:
                continue
            weekdays = _parse_days_pattern(str(item.get("days") or ""))
            if not weekdays:
                continue
            for occ_date in _occurrences_in_window(weekdays, today, horizon_days=7):
                canonical_future_keys.add((name, occ_date, sh, sm))

        future_rows = (
            db.query(Task)
            .filter(
                Task.user_id == user.id,
                Task.is_fixed.is_(True),
                Task.deadline.isnot(None),
            )
            .all()
        )
        obsolete_ids = []
        for row in future_rows:
            if row.id in expired_ids:
                continue
            s_naive = _naive(row.deadline)
            if s_naive.date() >= today:
                key = (row.title.lower(), s_naive.date(), s_naive.hour, s_naive.minute)
                if key not in canonical_future_keys:
                    obsolete_ids.append(row.id)

        if obsolete_ids:
            db.query(Task).filter(
                Task.user_id == user.id,
                Task.is_fixed.is_(True),
                Task.id.in_(obsolete_ids),
            ).delete(synchronize_session=False)

    # 3. Upsert configured fixed commitments
    if stored.get("fixed_commitments"):
        _upsert_fixed_commitments(db, user, stored, now=now)
    db.flush()


def _upsert_fixed_commitments(
    db: Session, user: User, data: Dict[str, Any], now: datetime | None = None
) -> None:
    """
    Convert onboarding fixed_commitments into is_fixed=True Task rows that the
    scheduler treats as untouchable blocks.

    Upsert key: (user_id, lower(title), date, time)
    — same occurrence → UPDATE duration, commute, and start time in place
    — new → INSERT

    Caller is responsible for db.commit().
    """
    commitments: List[Dict[str, Any]] = data.get("fixed_commitments") or []
    if not commitments:
        return

    today = now.date() if now is not None else date.today()

    for item in commitments:
        if not isinstance(item, dict):
            continue

        name = (item.get("name") or item.get("title") or "").strip()
        if not name:
            continue

        # Parse HH:MM strings
        start_str = (item.get("start_time") or "").strip()
        end_str = (item.get("end_time") or "").strip()
        try:
            sh, sm = map(int, start_str.split(":"))
            eh, em = map(int, end_str.split(":"))
        except (ValueError, AttributeError):
            continue  # malformed time — skip

        start_minutes = sh * 60 + sm
        end_minutes = eh * 60 + em
        # Handle overnight wrap
        if end_minutes <= start_minutes:
            duration_minutes = (24 * 60 - start_minutes) + end_minutes
        else:
            duration_minutes = end_minutes - start_minutes

        commute = max(
            int(item.get("commute_before") or 0),
            int(item.get("commute_after") or 0),
        )

        # Expand `days` to concrete weekday indices
        weekdays = _parse_days_pattern(str(item.get("days") or ""))
        if not weekdays:
            continue  # unrecognised days pattern — skip

        occurrence_dates = _occurrences_in_window(weekdays, today, horizon_days=7)
        if not occurrence_dates:
            continue  # no matching dates in window — skip

        existing_for_user = (
            db.query(Task)
            .filter(
                Task.user_id == user.id,
                Task.is_fixed.is_(True),
                sa_func.lower(Task.title) == name.lower(),
            )
            .all()
        )

        for occ_date in occurrence_dates:
            # Timezone-aware datetime in IST so PostgreSQL and SQLite remain consistent
            start_dt = datetime(occ_date.year, occ_date.month, occ_date.day, sh, sm, 0, tzinfo=IST)
            target_naive = datetime(occ_date.year, occ_date.month, occ_date.day, sh, sm, 0)

            # Match on user + lower(title) + occurrence start
            existing = next(
                (r for r in existing_for_user if r.deadline and _naive(r.deadline) == target_naive),
                None,
            )
            if existing:
                if existing.status == "cancelled":
                    continue
                existing.estimated_duration = duration_minutes
                existing.commute_minutes = commute
                existing.deadline = start_dt
            else:
                db.add(Task(
                    user_id=user.id,
                    title=name,
                    task_type=None,      # schema requires task_type=None for is_fixed=True
                    priority=3,          # default; valid in 1–5 range
                    estimated_duration=duration_minutes,
                    deadline=start_dt,   # stores start datetime
                    is_fixed=True,
                    must_daily=False,
                    commute_minutes=commute,
                    status="pending",
                ))