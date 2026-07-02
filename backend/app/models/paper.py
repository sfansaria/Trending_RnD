# =============================================================================
# FILE: backend/app/models/paper.py
# PURPOSE: Defines the shape of data stored in the database.
#          Think of these as "blueprints" for database tables.
#          Every column in the table = one field in the class.
# =============================================================================

# Optional means the field can be None (empty)
from typing import Optional

# datetime is Python's built-in type for dates and times
from datetime import datetime, timezone

# SQLModel combines SQLAlchemy (database tool) + Pydantic (data validation).
# SQLModel = Field lets us set default values, indexes, constraints.
from sqlmodel import SQLModel, Field


# -----------------------------------------------------------------------------
# TABLE 1: Paper
# This becomes a real table called "paper" in our SQLite database.
# Each row = one research paper from arXiv.
# -----------------------------------------------------------------------------
class Paper(SQLModel, table=True):  # table=True tells SQLModel: make this a real DB table

    # PRIMARY KEY — auto-incrementing number. SQLite assigns this automatically.
    # None default means: "let the database fill this in"
    id: Optional[int] = Field(default=None, primary_key=True)

    # arXiv's own ID for the paper, e.g. "2401.12345v1"
    # index=True means: create a DB index so lookups by arxiv_id are fast
    # unique=True means: no two rows can have the same arxiv_id (no duplicates)
    arxiv_id: str = Field(index=True, unique=True)

    # Plain text fields — stored directly as strings in the database
    title: str       # e.g. "Attention Is All You Need"
    abstract: str    # the full paper abstract (can be very long)

    # Lists can't be stored directly in SQLite, so we JSON-encode them first.
    # e.g. authors = '["Yann LeCun", "Geoffrey Hinton"]'
    # We decode back to a Python list when we send it to the frontend.
    authors: str     # JSON-encoded list of author names (max 10 authors stored)
    categories: str  # JSON-encoded list e.g. '["cs.LG", "cs.AI"]'

    # When the paper was published on arXiv
    published: datetime

    # A string like "2024-06" — used to group papers by month.
    # This is how we answer "show me June 2024 papers"
    month_key: str

    # Direct links to the paper
    url: str      # arXiv abstract page, e.g. "https://arxiv.org/abs/2401.12345"
    pdf_url: str  # direct PDF link, e.g. "https://arxiv.org/pdf/2401.12345"

    # ── TREND SIGNALS ────────────────────────────────────────────────────────
    # These are filled in later by scorer.py after fetching from Semantic Scholar

    # Total number of times other papers have cited this paper
    citation_count: int = Field(default=0)

    # "Influential" citations = citations in highly-regarded papers.
    # This is a proxy for "citation velocity" — quality over quantity.
    citation_velocity: float = Field(default=0.0)

    # Stars on the GitHub repo linked to this paper (from Papers With Code)
    # Currently not fully implemented — reserved for future use
    pwc_stars: int = Field(default=0)

    # Number of times this paper was mentioned on Hugging Face
    # Currently not fully implemented — reserved for future use
    hf_mentions: int = Field(default=0)

    # Final computed score 0–100. Higher = more trending.
    # Calculated by scorer.py using the signals above.
    trend_score: float = Field(default=0.0)

    # ── TOPIC EXTRACTION ─────────────────────────────────────────────────────
    # These are filled in later by topics.py after clustering

    # Human-readable topic name, e.g. "Diffusion · Image · Generation"
    # Optional because it's empty until topics.py runs
    topic_label: Optional[str] = Field(default=None, index=True)

    # The cluster number (0, 1, 2 ... 11) assigned by KMeans
    topic_id: Optional[int] = Field(default=None)

    # Timestamp of when we pulled this paper from arXiv
    # default_factory=datetime.utcnow means: call utcnow() at insert time
    fetched_at: datetime = Field(default_factory=datetime.utcnow)


# -----------------------------------------------------------------------------
# TABLE 2: TopicSummary
# One row per topic cluster per month.
# e.g. "June 2024 had a cluster called 'Diffusion · Image · Generation'
#        with 23 papers and an average score of 67.4"
# This powers the topic filter pills in the UI.
# -----------------------------------------------------------------------------
class TopicSummary(SQLModel, table=True):

    id: Optional[int] = Field(default=None, primary_key=True)

    # Which month this topic belongs to, e.g. "2024-06"
    month_key: str = Field(index=True)

    # Human-readable label built from top TF-IDF terms
    topic_label: str

    # The KMeans cluster number this topic corresponds to
    topic_id: int

    # How many papers are in this topic cluster
    paper_count: int

    # Average trend score of papers in this cluster
    avg_score: float

    # JSON list of the top 5 arxiv_ids in this cluster by trend score
    # e.g. '["2401.12345", "2401.67890"]'
    top_paper_ids: str


################################################################
#new part appended to add the Bookmarking feature to the database
###########################################################
class SavedPaper(SQLModel, table=True):
    # One row = one bookmarked paper.
    # We don't store the full paper here — just a reference to its arxiv_id.
    # The actual paper data still lives in the Paper table; we join on arxiv_id
    # when the frontend asks for the list of saved papers.
    id: Optional[int] = Field(default=None, primary_key=True)
 
    # The arxiv_id of the paper being saved, e.g. "2401.12345v1"
    # index=True makes lookups fast. unique=True means you can't save the
    # same paper twice — saving it again just won't insert a duplicate.
    arxiv_id: str = Field(index=True, unique=True)
 
    # When the user saved it — used to sort the Saved tab "most recently saved first"
    saved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
