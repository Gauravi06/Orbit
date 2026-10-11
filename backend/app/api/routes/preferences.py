import json
from datetime import time
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.preference import Preference
from app.models.user import User
from app.schemas.preference import OnboardingPayload, PreferencesUpdate
from app.services.rule_engine import Prefs

router = APIRouter(tags=["preferences"])

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
        if key == "wake_time" and isinstance(val, str):
            try:
                h, m = map(int, val.split(":"))
                user.wake_time = time(h, m)
            except Exception:
                pass
        elif key == "sleep_time" and isinstance(val, str):
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

    db.commit()
    return get_user_preferences_dict(db, user)


def load_user_rule_prefs(db: Session, user: User) -> Prefs:
    """Build pure Prefs dataclass for the rule engine strictly isolated per user."""
    p = get_user_preferences_dict(db, user)

    wake = time(7, 0)
    if "wake_time" in p and isinstance(p["wake_time"], str):
        try:
            h, m = map(int, p["wake_time"].split(":"))
            wake = time(h, m)
        except Exception:
            pass

    sleep = time(23, 0)
    if "sleep_time" in p and isinstance(p["sleep_time"], str):
        try:
            h, m = map(int, p["sleep_time"].split(":"))
            sleep = time(h, m)
        except Exception:
            pass

    focus_duration = int(p.get("focus_duration", p.get("focus_length", 120)))
    allow_splitting = bool(p.get("allow_splitting", True))

    no_study_after = None
    if p.get("no_study_after") and isinstance(p["no_study_after"], str):
        try:
            h, m = map(int, p["no_study_after"].split(":"))
            no_study_after = time(h, m)
        except Exception:
            pass

    daily_cap_minutes = int(p.get("daily_cap_minutes", p.get("daily_load_cap_mins", 480)))

    return Prefs(
        wake=wake,
        sleep=sleep,
        focus_duration=focus_duration,
        allow_splitting=allow_splitting,
        no_study_after=no_study_after,
        daily_cap_minutes=daily_cap_minutes,
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
    return save_user_preferences_dict(db, current_user, data, source="preferences")


@router.post("/onboarding", response_model=Dict[str, Any], status_code=status.HTTP_200_OK)
def save_onboarding(
    payload: OnboardingPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = payload.model_dump(exclude_unset=True)
    return save_user_preferences_dict(db, current_user, data, source="onboarding")