from sqlalchemy import Column, String, Integer, Time
from sqlalchemy.dialects.postgresql import UUID
import uuid
from app.db.base_class import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    sleep_time = Column(Time, nullable=True)
    wake_time = Column(Time, nullable=True)
    preferred_focus_time = Column(String, nullable=True)
    focus_duration = Column(Integer, nullable=True)
    break_preference = Column(String, nullable=True)