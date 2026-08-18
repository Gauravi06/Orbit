from datetime import datetime, timedelta, timezone
from jose import jwt
from passlib.context import CryptContext
import hashlib
import secrets
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": user_id, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

def create_refresh_token() -> tuple[str, str]:
    """Returns (raw_token_for_client, hash_for_db)."""
    raw = secrets.token_urlsafe(48)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed

def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()

def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])