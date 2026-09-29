from sqlalchemy import Column, DateTime, String, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.db.base_class import Base


class ScheduleItem(Base):
    __tablename__ = "schedule_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("schedules.id"), nullable=False)
    task_id = Column(UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=True)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=False)
    status = Column(String, default="scheduled")  # scheduled / completed / skipped

    # --- displacement ("recovery, not failure") ---
    displaced_by_task_id = Column(UUID(as_uuid=True), ForeignKey("tasks.id"), nullable=True)
    displacement_reason = Column(String, nullable=True)
    original_start_time = Column(DateTime(timezone=True), nullable=True)