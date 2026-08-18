from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.user import User
from app.models.refresh_token import RefreshToken
from app.schemas.user import UserCreate, UserOut
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    hash_token,
)
from app.core.config import settings
from app.core.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def signup(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=payload.name,
        email=payload.email,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    access_token = create_access_token(str(user.id))
    raw_refresh, hashed_refresh = create_refresh_token()

    refresh_row = RefreshToken(
        user_id=user.id,
        token_hash=hashed_refresh,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(refresh_row)
    db.commit()

    return {"access_token": access_token, "refresh_token_raw": raw_refresh, "token_type": "bearer"}


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    hashed = hash_token(payload.refresh_token)
    token_row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == hashed, RefreshToken.revoked == False)
        .first()
    )

    if not token_row or token_row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # Rotate: revoke old, issue new
    token_row.revoked = True
    new_raw, new_hashed = create_refresh_token()
    new_row = RefreshToken(
        user_id=token_row.user_id,
        token_hash=new_hashed,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(new_row)
    db.commit()

    access_token = create_access_token(str(token_row.user_id))
    return {"access_token": access_token, "refresh_token_raw": new_raw, "token_type": "bearer"}


@router.post("/logout")
def logout(payload: RefreshRequest, db: Session = Depends(get_db)):
    hashed = hash_token(payload.refresh_token)
    token_row = db.query(RefreshToken).filter(RefreshToken.token_hash == hashed).first()
    if token_row:
        token_row.revoked = True
        db.commit()
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user