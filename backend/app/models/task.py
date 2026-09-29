import enum
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Boolean, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
from app.db.base_class import Base


class TaskType(str, enum.Enum):
    deadline = "deadline"
    growth = "growth"
    wellbeing_moderate = "wellbeing_moderate"


class Task(Base):
    __tablename__ = "tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    category = Column(String, nullable=True)
    deadline = Column(DateTime(timezone=True), nullable=True)
    estimated_duration = Column(Integer, nullable=False)
    priority = Column(Integer, nullable=False, default=3)   # 1-5 scale, matches rule engine spec
    status = Column(String, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # --- rule engine fields ---
    task_type = Column(SAEnum(TaskType), nullable=True)   # null for is_fixed items — they're not scored
    is_fixed = Column(Boolean, default=False, nullable=False)     # classes, gym, etc. — untouchable blocks
    must_daily = Column(Boolean, default=False, nullable=False)   # growth tasks only, protected placement
    commute_minutes = Column(Integer, default=0, nullable=False)  # only relevant when is_fixed=True