from datetime import date, datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.feedback import Feedback
from app.models.task import Task, TaskType
from app.models.user import User

router = APIRouter(tags=["notes"])

IST = timezone(timedelta(hours=5, minutes=30))


class NoteUnderstandIn(BaseModel):
    text: str


class NoteUnderstandOut(BaseModel):
    kind: str
    understood: str
    message: str


class NoteSaveIn(BaseModel):
    text: str
    kind: str
    rating: Optional[int] = None


class FeedbackIn(BaseModel):
    text: str


@router.post("/notes/understand", response_model=NoteUnderstandOut)
def understand_note(
    payload: NoteUnderstandIn,
    current_user: User = Depends(get_current_user),
):
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note text cannot be empty")

    lower = text.lower()

    # Exhaustion / Overwhelmed / Illness
    if any(k in lower for k in ["exhaust", "tired", "drained", "burnout", "sick"]):
        return NoteUnderstandOut(
            kind="feedback",
            understood="You are feeling exhausted and need a lighter evening with work shifted to your next deep-work block.",
            message="That's completely okay. Everyone has days like that. I'll lighten your evening and move non-urgent work to your next deep-work block so you can rest.",
        )

    # Preferences
    if any(k in lower for k in ["prefer", "like to study", "morning", "evening", "always", "never"]):
        return NoteUnderstandOut(
            kind="preference",
            understood=f'You want Orbit to remember this working preference: "{text}".',
            message="Got it. I'll remember this preference for how you work best and keep it in mind when planning future days.",
        )

    # Tasks / Deadlines
    if any(k in lower for k in ["need to", "have to", "finish", "assignment", "homework", "submit", "due"]):
        return NoteUnderstandOut(
            kind="task",
            understood=f'You have an upcoming commitment or task: "{text}".',
            message="Understood. I will add this to your tasks and carve out dedicated focus time for it in your schedule.",
        )

    # General Rhythm / Pacing Feedback
    if any(k in lower for k in ["felt", "today", "paced", "too heavy", "good", "great", "hard"]):
        return NoteUnderstandOut(
            kind="feedback",
            understood=f'You are sharing a reflection on today\'s pace and rhythm: "{text}".',
            message="Thank you for the reflection. Orbit adapts future rhythms based on how sustainable your days feel.",
        )

    # Default Note
    return NoteUnderstandOut(
        kind="note",
        understood=f'You shared a note: "{text}".',
        message="Noted. I'll keep this in mind as we organise your upcoming weeks.",
    )


@router.post("/notes", status_code=status.HTTP_200_OK)
def save_note(
    payload: NoteSaveIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note text cannot be empty")

    now_ist = datetime.now(IST)
    today_date = now_ist.date()

    # Persist as Feedback entry
    fb = Feedback(
        id=uuid.uuid4(),
        user_id=current_user.id,
        date=today_date,
        text=f"[{payload.kind.upper()}] {text}",
        created_at=now_ist,
    )
    db.add(fb)

    # If it's a new task, also create a pending Task row
    if payload.kind == "task":
        db.add(
            Task(
                id=uuid.uuid4(),
                user_id=current_user.id,
                title=text,
                task_type=TaskType.growth,
                priority=3,
                estimated_duration=60,
                status="pending",
            )
        )

    db.commit()
    db.refresh(fb)

    return {
        "success": True,
        "entry": {
            "id": str(fb.id),
            "text": text,
            "kind": payload.kind,
            "rating": payload.rating,
            "created_at": fb.created_at.isoformat() if fb.created_at else now_ist.isoformat(),
        },
    }


@router.post("/feedback", status_code=status.HTTP_200_OK)
def submit_feedback(
    payload: FeedbackIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Feedback text cannot be empty")

    now_ist = datetime.now(IST)
    fb = Feedback(
        id=uuid.uuid4(),
        user_id=current_user.id,
        date=now_ist.date(),
        text=text,
        created_at=now_ist,
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)

    return {"success": True, "id": str(fb.id)}
