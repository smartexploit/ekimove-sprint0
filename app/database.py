from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """Base class for all EkiMove ORM models."""


_connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args=_connect_args,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def check_database_connection() -> dict[str, str]:
    """Run a minimal query and return non-sensitive connection identity."""
    with engine.connect() as connection:
        database_name, database_user = connection.execute(
            text("SELECT current_database(), current_user")
            if not settings.database_url.startswith("sqlite")
            else text("SELECT 'sqlite' AS current_database, 'local' AS current_user")
        ).one()
    return {"database": str(database_name), "user": str(database_user)}


def get_db():
    """Yield a SQLAlchemy session for FastAPI dependencies."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
