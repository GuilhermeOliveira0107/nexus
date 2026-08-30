import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import DATA_DIR, DB_PATH


class Base(DeclarativeBase):
    pass


def _database_url() -> tuple[str, dict]:
    raw = (os.getenv("DATABASE_URL") or "").strip()
    if not raw:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{DB_PATH}", {"check_same_thread": False}
    if raw.startswith("postgres://"):
        raw = raw.replace("postgres://", "postgresql+psycopg://", 1)
    elif raw.startswith("postgresql://") and "+psycopg" not in raw:
        raw = raw.replace("postgresql://", "postgresql+psycopg://", 1)
    return raw, {}


DB_URL, ENGINE_ARGS = _database_url()
_engine_opts = {"connect_args": ENGINE_ARGS, "pool_pre_ping": True}
if "postgresql" in DB_URL:
    _engine_opts.update(pool_size=5, max_overflow=5, pool_recycle=280)
engine = create_engine(DB_URL, **_engine_opts)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
