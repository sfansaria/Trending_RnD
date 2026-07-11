from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class Paper(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    arxiv_id: str = Field(index=True, unique=True)
    title: str
    abstract: str
    authors: str
    categories: str
    published: datetime
    month_key: str
    url: str
    pdf_url: str
    citation_count: int = Field(default=0)
    citation_velocity: float = Field(default=0.0)
    pwc_stars: int = Field(default=0)
    hf_mentions: int = Field(default=0)
    trend_score: float = Field(default=0.0)
    topic_label: Optional[str] = Field(default=None, index=True)
    topic_id: Optional[int] = Field(default=None)
    fetched_at: datetime = Field(default_factory=datetime.utcnow)


class TopicSummary(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    month_key: str = Field(index=True)
    topic_label: str
    topic_id: int
    paper_count: int
    avg_score: float
    top_paper_ids: str


class SavedPaper(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    arxiv_id: str = Field(index=True, unique=True)
    saved_at: datetime = Field(default_factory=datetime.utcnow)
