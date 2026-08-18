from sqlalchemy import Column, Date, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
from app.db.base_class import Base

class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    date = Column(Date, nullable=False)
    version = Column(Integer, default=1)   # bumps each time it's regenerated/adapted
    created_at = Column(DateTime(timezone=True), server_default=func.now())