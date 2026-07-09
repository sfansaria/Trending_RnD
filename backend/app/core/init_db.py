# =============================================================================
# FILE: backend/app/core/init_db.py
# PURPOSE: Sets up the database connection and creates the tables.
#          This is the very first thing that runs when the backend starts.
#
# RUN ORDER: This file runs automatically when you start the backend server.
#            You can also run it manually once to create the DB file:
#            > python -m app.core.init_db
# =============================================================================

from sqlmodel import SQLModel, create_engine, Session
from pathlib import Path  # Path is Python's cross-platform way to handle file paths
import os
# -----------------------------------------------------------------------------
# DATABASE FILE LOCATION
# __file__ = the path to THIS file (init_db.py)
# .parent   = the folder containing this file (core/)
# .parent   = go up again (app/)
# .parent   = go up again (backend/)
# So DB_PATH = backend/arxiv_trends.db
# -----------------------------------------------------------------------------
#DB_PATH = Path(__file__).parent.parent.parent / "arxiv_trends.db"

# SQLite connection string format: "sqlite:///path/to/file.db"
# Three slashes = relative path. The file is created if it doesn't exist.
#DATABASE_URL = f"sqlite:///{DB_PATH}"

# -----------------------------------------------------------------------------
#New addition for deployment 
# Reads DATABASE_URL from environment variable (set on Render).
# Falls back to local SQLite file for development on your Mac.

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{Path(__file__).parent.parent.parent / 'arxiv_trends.db'}")

# Supabase gives "postgres://" but SQLAlchemy needs "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# CREATE THE ENGINE
# The "engine" is the actual connection to the database.
# All database operations go through this engine.
# -----------------------------------------------------------------------------
'''
engine = create_engine(DATABASE_URL,
    # SQLite doesn't allow the same connection to be used across threads by default.
    # check_same_thread=False disables that restriction so FastAPI (which uses
    # threads) can share one connection safely.
    connect_args={"check_same_thread": False},
    # echo=True would print every SQL query to the terminal — useful for debugging
    # but noisy in production, so we keep it False
    echo=False,
)
'''
engine = create_engine(DATABASE_URL, echo=False) #echo = False to avoid printing SQL queries in production



# -----------------------------------------------------------------------------
# CREATE ALL TABLES
# SQLModel.metadata knows about every class with table=True (Paper, TopicSummary).
# create_all() reads those classes and creates the corresponding SQL tables.
# If the tables already exist, it does nothing (safe to call multiple times).
# -----------------------------------------------------------------------------
def create_db():
    SQLModel.metadata.create_all(engine)
    print(f"Database ready")


# -----------------------------------------------------------------------------
# SESSION FACTORY
# A "session" is a temporary workspace for database operations.
# Think of it like opening a notebook, writing changes, then closing it.
# The "yield" makes this a generator — FastAPI calls it, gets the session,
# uses it, then the "with" block closes/cleans up automatically.
# Used by the API routes via FastAPI's Depends() system.
# -----------------------------------------------------------------------------
def get_session():
    with Session(engine) as session:
        yield session  # FastAPI injects this into route functions


# -----------------------------------------------------------------------------
# MANUAL RUN
# If you run this file directly (python -m app.core.init_db),
# Python sets __name__ to "__main__" and calls create_db().
# When imported by other files, this block is skipped.
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    create_db()