import uuid
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, field_validator


class InterventionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    task_id: Optional[uuid.UUID] = None
    intervention_type: str
    title: str
    message: str
    status: str
    dedup_key: str
    snoozed_until: Optional[datetime] = None
    dismissed_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class InterventionSnoozeIn(BaseModel):
    snooze_until: datetime


class InterventionListResponse(BaseModel):
    interventions: List[InterventionRead]
    count: int
