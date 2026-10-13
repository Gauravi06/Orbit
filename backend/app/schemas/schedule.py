import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict


class BlockIn(BaseModel):
    start: datetime
    end: datetime
    label: str = "Disruption"


class CapIn(BaseModel):
    day: date
    max_minutes: int


class DisruptionIn(BaseModel):
    blocks: List[BlockIn] = []
    caps: List[CapIn] = []


class TextIn(BaseModel):
    text: str


class ProposalCreateIn(BaseModel):
    text: Optional[str] = None
    blocks: List[BlockIn] = []
    caps: List[CapIn] = []


class ScheduleItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: Optional[uuid.UUID] = None
    task_id: Optional[uuid.UUID] = None
    title: Optional[str] = None
    start_time: datetime
    end_time: datetime
    status: Optional[str] = "scheduled"
    displaced_by_task_id: Optional[uuid.UUID] = None
    displaced_by_title: Optional[str] = None
    displacement_reason: Optional[str] = None
    original_start_time: Optional[datetime] = None


class ScheduleDayRead(BaseModel):
    schedule_id: Optional[uuid.UUID] = None
    date: date
    version: Optional[int] = 1
    fixed: List[Dict[str, Any]] = []
    items: List[ScheduleItemRead] = []


class ScheduleResponse(BaseModel):
    days: List[ScheduleDayRead]
    at_risk: List[Dict[str, Any]] = []
    violations: List[str] = []
    interpreted: Optional[Dict[str, Any]] = None


class ScheduleProposalResponse(BaseModel):
    proposal_id: uuid.UUID
    status: str
    created_at: datetime
    expires_at: Optional[datetime] = None
    summary: str
    days: List[ScheduleDayRead]
    at_risk: List[Dict[str, Any]] = []
    violations: List[str] = []


class ScheduleProposalBrief(BaseModel):
    proposal_id: uuid.UUID
    status: str
    created_at: datetime
    expires_at: Optional[datetime] = None
    summary: str


class ScheduleApprovalResponse(BaseModel):
    message: str
    proposal_id: uuid.UUID
    status: str
    schedule: ScheduleResponse


class ScheduleRejectionResponse(BaseModel):
    message: str
    proposal_id: uuid.UUID
    status: str
