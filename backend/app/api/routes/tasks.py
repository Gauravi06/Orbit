import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models.schedule_item import ScheduleItem
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.task import Task
from app.models.user import User
from app.schemas.task import TaskCreate, TaskRead, TaskStatus, TaskType, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])

# Columns that are NOT NULL in the database. A PATCH that sends null for
# one of these would crash at commit time, so we reject it up front.
NON_NULLABLE_FIELDS = (
    "title",
    "estimated_duration",
    "priority",
    "is_fixed",
    "must_daily",
    "commute_minutes",
    "status",
)


def _get_owned_task(db: Session, task_id: uuid.UUID, user: User) -> Task:
    """Fetch a task only if it belongs to this user.

    Returns 404 (not 403) for someone else's task, so a student cannot
    even find out whether a given task ID exists.
    """
    task = (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == user.id)
        .first()
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = payload.model_dump()

    # The schema uses enums; the database stores plain strings for these.
    if data["task_type"] is not None:
        data["task_type"] = data["task_type"].value

    # If the client did not send a status, leave it out so the database
    # default ("pending") applies.
    if data["status"] is None:
        del data["status"]
    else:
        data["status"] = data["status"].value

    task = Task(**data, user_id=current_user.id)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("", response_model=List[TaskRead])
def list_tasks(
    status_filter: Optional[TaskStatus] = Query(default=None, alias="status"),
    task_type: Optional[TaskType] = None,
    is_fixed: Optional[bool] = None,
    deadline_from: Optional[datetime] = None,
    deadline_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Task).filter(Task.user_id == current_user.id)

    if status_filter is not None:
        query = query.filter(Task.status == status_filter.value)
    if task_type is not None:
        query = query.filter(Task.task_type == task_type.value)
    if is_fixed is not None:
        query = query.filter(Task.is_fixed == is_fixed)
    if deadline_from is not None:
        query = query.filter(Task.deadline >= deadline_from)
    if deadline_to is not None:
        query = query.filter(Task.deadline <= deadline_to)

    return query.order_by(Task.created_at.desc()).all()


@router.get("/{task_id}", response_model=TaskRead)
def get_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_owned_task(db, task_id, current_user)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = _get_owned_task(db, task_id, current_user)

    # exclude_unset: only fields the client actually sent
    changes = payload.model_dump(exclude_unset=True)

    for field in NON_NULLABLE_FIELDS:
        if field in changes and changes[field] is None:
            raise HTTPException(status_code=422, detail=f"{field} cannot be null")

    # Re-check the cross-field rules against the final state (existing
    # values plus the changes), since TaskUpdate has no validators for these.
    new_is_fixed = changes.get("is_fixed", task.is_fixed)
    new_commute = changes.get("commute_minutes", task.commute_minutes)
    new_deadline = changes["deadline"] if "deadline" in changes else task.deadline

    if new_commute > 0 and not new_is_fixed:
        raise HTTPException(
            status_code=422,
            detail="commute_minutes can only be set when is_fixed is True",
        )
    if (
        task.task_type is not None
        and task.task_type.value == "deadline"
        and new_deadline is None
    ):
        raise HTTPException(
            status_code=422,
            detail="deadline cannot be removed from a deadline task",
        )

    if "status" in changes:
        changes["status"] = changes["status"].value

    for field, value in changes.items():
        setattr(task, field, value)

    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = _get_owned_task(db, task_id, current_user)
    db.query(ScheduleItem).filter(ScheduleItem.task_id == task.id).delete(synchronize_session=False)
    db.query(ScheduleItem).filter(ScheduleItem.displaced_by_task_id == task.id).update(
        {"displaced_by_task_id": None}, synchronize_session=False
    )
    db.delete(task)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)