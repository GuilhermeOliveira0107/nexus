import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session as DbSession

from app.config import AVATAR_COLORS, SESSION_DAYS
from app.database import get_db
from app.models import Session, User


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return secrets.compare_digest(check.hex(), digest)


def avatar_color_for(username: str) -> str:
    return AVATAR_COLORS[sum(ord(c) for c in username) % len(AVATAR_COLORS)]


def create_session(db: DbSession, user: User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        Session(
            token=token,
            user_id=user.id,
            expires_at=datetime.utcnow() + timedelta(days=SESSION_DAYS),
        )
    )
    db.commit()
    return token


def user_from_token(db: DbSession, token: str | None) -> User | None:
    if not token:
        return None
    session = db.get(Session, token)
    if not session or session.expires_at < datetime.utcnow():
        return None
    return db.get(User, session.user_id)


def get_current_user(
    authorization: str | None = Header(default=None),
    db: DbSession = Depends(get_db),
) -> User:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    user = user_from_token(db, token)
    if not user:
        raise HTTPException(status_code=401, detail="Faça login novamente.")
    return user
