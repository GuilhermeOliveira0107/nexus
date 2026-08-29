import re

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.auth import (
    avatar_color_for,
    create_session,
    get_current_user,
    hash_password,
    verify_password,
)
from app.database import get_db
from app.models import Session as AuthSession
from app.models import User
from app.realtime import user_public
from app.config import AVATAR_COLORS
from app.schemas import LoginIn, PasswordChangeIn, ProfileIn, RegisterIn
from app.services import create_server_with_channels

router = APIRouter(prefix="/api/auth", tags=["auth"])
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,24}$")


def normalize_username(raw: str) -> str:
    cleaned = re.sub(r"[\s\-]+", "_", (raw or "").strip())
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "", cleaned)
    return cleaned[:24]


@router.post("/register")
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    username = normalize_username(payload.username)
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "No usuário não pode ter espaço. Use letras, números ou _ (ex: joao_guilherme).")
    if db.query(User).filter(User.username.ilike(username)).first():
        raise HTTPException(409, "Esse usuário já existe.")

    display = (payload.display_name or username).strip() or username
    user = User(
        username=username,
        display_name=display,
        password_hash=hash_password(payload.password),
        avatar_color=avatar_color_for(username),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    create_server_with_channels(db, user, f"Sala do {display}")
    token = create_session(db, user)
    return {"token": token, "user": user_public(user)}


@router.post("/login")
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username.ilike(normalize_username(payload.username) or payload.username.strip())).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Usuário ou senha inválidos.")
    token = create_session(db, user)
    return {"token": token, "user": user_public(user)}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_public(user)


@router.patch("/me")
def update_me(payload: ProfileIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.avatar_color is not None:
        allowed = {c.lower() for c in AVATAR_COLORS}
        if payload.avatar_color.lower() not in allowed:
            raise HTTPException(400, "Cor de avatar inválida.")
        user.avatar_color = payload.avatar_color.lower()
    db.commit()
    db.refresh(user)
    return user_public(user)


@router.post("/password")
def change_password(payload: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(400, "Senha atual incorreta.")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}


@router.post("/logout")
def logout(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        session = db.get(AuthSession, token)
        if session:
            db.delete(session)
            db.commit()
    return {"ok": True}
