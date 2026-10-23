import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.intervention import Intervention
from app.models.user import User
from app.schemas.intervention import InterventionRead, InterventionSnoozeIn
from app.services.intervention_service import _aware, run_detection_cycle

router = APIRouter(prefix="/interventions", tags=["interventions"])


@router.get("", response_model=List[InterventionRead])
def list_interventions(
    status_filter: Optional[str] = Query(default="active", alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)

    # Wake up any snoozed interventions whose time has arrived
    snoozed = (
        db.query(Intervention)
        .filter(
            Intervention.user_id == current_user.id,
            Intervention.status == "snoozed",
        )
        .all()
    )
    for inv in snoozed:
        if inv.snoozed_until and now >= _aware(inv.snoozed_until):
            inv.status = "active"
            inv.snoozed_until = None
            inv.updated_at = now
    if snoozed:
        db.commit()

    query = db.query(Intervention).filter(Intervention.user_id == current_user.id)

    if status_filter and status_filter.lower() != "all":
        query = query.filter(Intervention.status == status_filter.lower())

    return query.order_by(Intervention.created_at.desc()).all()


@router.post("/{intervention_id}/dismiss", response_model=InterventionRead)
def dismiss_intervention(
    intervention_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = (
        db.query(Intervention)
        .filter(
            Intervention.id == intervention_id,
            Intervention.user_id == current_user.id,
        )
        .first()
    )
    if inv is None:
        raise HTTPException(status_code=404, detail="Intervention not found")

    now = datetime.now(timezone.utc)
    inv.status = "dismissed"
    inv.dismissed_at = now
    inv.updated_at = now
    db.commit()
    db.refresh(inv)
    return inv


@router.post("/{intervention_id}/snooze", response_model=InterventionRead)
def snooze_intervention(
    intervention_id: uuid.UUID,
    payload: InterventionSnoozeIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    inv = (
        db.query(Intervention)
        .filter(
            Intervention.id == intervention_id,
            Intervention.user_id == current_user.id,
        )
        .first()
    )
    if inv is None:
        raise HTTPException(status_code=404, detail="Intervention not found")

    now = datetime.now(timezone.utc)
    snooze_dt = _aware(payload.snooze_until)

    if snooze_dt is None or snooze_dt <= now:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="snooze_until must be in the future",
        )

    inv.status = "snoozed"
    inv.snoozed_until = snooze_dt
    inv.updated_at = now
    db.commit()
    db.refresh(inv)
    return inv


@router.post("/check", response_model=List[InterventionRead])
def check_interventions_now(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    On-demand detection cycle for the current user. Useful for test suites
    and active frontend synchronization.
    """
    active = run_detection_cycle(db, user_id=current_user.id)
    return active
