from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
from app.db.base_class import Base


class ScheduleProposal(Base):
    __tablename__ = "schedule_proposals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String, default="pending", nullable=False)  # pending, approved, rejected, stale
    summary = Column(String, nullable=True)
    task_hash = Column(String, nullable=False)
    planning_now = Column(DateTime(timezone=True), nullable=False)
    placements_json = Column(Text, nullable=False)
    at_risk_json = Column(Text, nullable=False)
    violations_json = Column(Text, nullable=False)
    displaced_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)
