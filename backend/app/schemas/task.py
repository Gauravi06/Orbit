"""
Pydantic schemas for Task create/update/read.
Mirrors the Task model in backend/app/models/task.py
"""

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict


class TaskType(str, Enum):
    deadline = "deadline"
    growth = "growth"
    wellbeing_moderate = "wellbeing_moderate"


class TaskStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    at_risk = "at_risk"  # set by the rule engine, not directly by the client


# ---------------------------------------------------------------------------
# Shared base — fields common to create and read
# ---------------------------------------------------------------------------

class TaskBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    category: Optional[str] = None

    # task_type is nullable in the DB: null is valid for is_fixed=True blocks
    # (classes, gym, etc.) which aren't urgency-scored at all.
    task_type: Optional[TaskType] = None

    deadline: Optional[datetime] = None
    estimated_duration: int = Field(..., gt=0, description="Minutes")

    priority: int = Field(default=3, ge=1, le=5)

    is_fixed: bool = False
    must_daily: bool = False
    commute_minutes: int = Field(default=0, ge=0)

    @field_validator("priority")
    @classmethod
    def validate_priority(cls, v: int) -> int:
        # Redundant with ge/le above, but kept explicit per our decision:
        # reject out-of-range input rather than clamp it silently.
        if not (1 <= v <= 5):
            raise ValueError("priority must be between 1 and 5")
        return v

    @model_validator(mode="after")
    def validate_commute_minutes(self):
        if self.commute_minutes > 0 and not self.is_fixed:
            raise ValueError("commute_minutes can only be set when is_fixed is True")
        return self

    @model_validator(mode="after")
    def validate_task_type_required(self):
        # task_type is only allowed to be null for fixed, unscored blocks.
        if not self.is_fixed and self.task_type is None:
            raise ValueError("task_type is required unless is_fixed is True")
        return self

    @model_validator(mode="after")
    def validate_deadline_required(self):
        if self.task_type == TaskType.deadline and self.deadline is None:
            raise ValueError("deadline is required for task_type='deadline'")
        return self


# ---------------------------------------------------------------------------
# Create — what a client can send to POST /tasks
# ---------------------------------------------------------------------------

class TaskCreate(TaskBase):
    # status is NOT in TaskBase — deliberately opt-in here, and only
    # meaningful for growth tasks (the "brush teeth vs DSA practice"
    # distinction: only growth tasks have a legitimate "already did this
    # today" creation moment).
    status: Optional[TaskStatus] = None

    @model_validator(mode="after")
    def validate_status_on_create(self):
        if self.status is not None and self.task_type != TaskType.growth:
            raise ValueError(
                "status can only be set on creation for task_type='growth'"
            )
        return self


# ---------------------------------------------------------------------------
# Update — what a client can send to PATCH /tasks/{id}
# All fields optional; only provided fields get changed.
# ---------------------------------------------------------------------------

class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = None
    deadline: Optional[datetime] = None
    estimated_duration: Optional[int] = Field(default=None, gt=0)
    priority: Optional[int] = Field(default=None, ge=1, le=5)
    is_fixed: Optional[bool] = None
    must_daily: Optional[bool] = None
    commute_minutes: Optional[int] = Field(default=None, ge=0)
    status: Optional[TaskStatus] = None
    # task_type intentionally NOT updatable — changing a task's type after
    # creation would sidestep the validators above (e.g. deadline
    # requirement). Flag if you want this to be changeable later.


# ---------------------------------------------------------------------------
# Read — what the API returns back to the client
# ---------------------------------------------------------------------------

class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    category: Optional[str] = None
    task_type: Optional[TaskType] = None
    deadline: Optional[datetime] = None
    estimated_duration: int
    priority: int
    status: TaskStatus
    is_fixed: bool
    must_daily: bool
    commute_minutes: int
    created_at: datetime