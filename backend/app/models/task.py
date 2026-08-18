from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
from app.db.base_class import Base

class Task(Base):
    __tablename__ = "tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    category = Column(String, nullable=True)          # e.g. academics, gym, personal
    deadline = Column(DateTime(timezone=True), nullable=True)
    estimated_duration = Column(Integer, nullable=False)  # minutes
    priority = Column(String, default="medium")        # low / medium / high
    status = Column(String, default="pending")          # pending / in_progress / done
    created_at = Column(DateTime(timezone=True), server_default=func.now())