from sqlalchemy import Column, String, Float, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
from app.db.base_class import Base

class Preference(Base):
    __tablename__ = "preferences"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    preference = Column(String, nullable=False)   # e.g. "prefers_morning_deep_work"
    value = Column(String, nullable=False)
    confidence = Column(Float, default=0.5)         # 0–1, grows as signal repeats
    source = Column(String, nullable=False)          # "feedback" / "onboarding" / "disruption"
    created_at = Column(DateTime(timezone=True), server_default=func.now())