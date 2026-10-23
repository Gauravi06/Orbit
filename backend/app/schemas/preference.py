from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, field_validator


class PreferencesBase(BaseModel):
    model_config = ConfigDict(extra="allow")

    wake_time: Optional[str] = None
    sleep_time: Optional[str] = None
    focus_duration: Optional[int] = None
    focus_length: Optional[int] = None
    prefer_long_sessions: Optional[bool] = None
    allow_splitting: Optional[bool] = None
    no_study_after: Optional[str] = None
    daily_load_cap_mins: Optional[int] = None
    daily_cap_minutes: Optional[int] = None
    protected_hobby_mins_week: Optional[int] = None
    best_time_of_day: Optional[str] = None
    weekend_mode: Optional[str] = None
    juggles: Optional[List[str]] = None

    @field_validator("wake_time", "sleep_time", "no_study_after")
    @classmethod
    def validate_time_format(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v_str = str(v).strip()
            if v_str.lower() in ("no_pref", "none", "", "no preference"):
                return "no_pref"
            parts = v_str.split(":")
            if len(parts) != 2:
                raise ValueError("Time must be in HH:MM format")
            try:
                h, m = int(parts[0]), int(parts[1])
                if not (0 <= h <= 23 and 0 <= m <= 59):
                    raise ValueError("Time must be between 00:00 and 23:59")
            except ValueError:
                raise ValueError("Time must be in HH:MM format with valid numbers")
            return f"{h:02d}:{m:02d}"
        return v

    @field_validator("focus_duration", "focus_length", "daily_load_cap_mins", "daily_cap_minutes", "protected_hobby_mins_week")
    @classmethod
    def validate_positive_int(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError("Duration/minutes must be greater than 0")
        return v


class PreferencesUpdate(PreferencesBase):
    pass


class OnboardingPayload(PreferencesBase):
    pass
