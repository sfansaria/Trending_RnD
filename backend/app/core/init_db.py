import os
from sqlmodel import SQLModel, create_engine, Session
from pathlib import Path

# Reads DATABASE_URL from environment variable (set on Render).
# Falls back to local SQLite file for development on your Mac.
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"sqlite:///{Path(__file__).parent.parent.parent / 'arxiv_trends.db'}"
)

# Supabase gives "postgres://" but SQLAlchemy needs "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, echo=False)


def create_db():
    SQLModel.metadata.create_all(engine)
    print("Database ready")


def get_session():
    with Session(engine) as session:
        yield session


if __name__ == "__main__":
    create_db()