# =============================================================================
# FILE: backend/app/api/papers.py
# PURPOSE: All REST endpoints the frontend calls.
#
# CHANGE FROM PREVIOUS VERSION:
#   Added GET /api/heatmap endpoint that returns topic data across all months
#   in a format the frontend can use to draw the heatmap grid.
# =============================================================================

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlmodel import Session, select
from typing import Optional
import json
from datetime import datetime

from app.core.init_db import get_session
from app.models.paper import Paper, TopicSummary, SavedPaper
from app.services.fetcher import fetch_papers_for_month
from app.services.scorer import score_papers_for_month
from app.services.topics import extract_topics_for_month

router = APIRouter(prefix="/api", tags=["papers"])


def _paper_to_dict(p: Paper) -> dict:
    """Convert a Paper DB row to a JSON-serialisable dict."""
    return {
        "id": p.id,
        "arxiv_id": p.arxiv_id,
        "title": p.title,
        "abstract": p.abstract[:400] + "..." if len(p.abstract) > 400 else p.abstract,
        "authors": json.loads(p.authors),
        "categories": json.loads(p.categories),
        "published": p.published.isoformat(),
        "month_key": p.month_key,
        "url": p.url,
        "pdf_url": p.pdf_url,
        "trend_score": p.trend_score,
        "citation_count": p.citation_count,
        "topic_label": p.topic_label,
        "topic_id": p.topic_id,
    }


# =============================================================================
# ENDPOINT: GET /api/papers
# Returns ranked papers for a month with optional topic filter and sort order.
# sort options: "score" (default), "citations", "date"
# =============================================================================
@router.get("/papers")
def get_papers(
    month: str = Query(...),
    topic: Optional[str] = Query(None),
    limit: int = Query(20, le=100),
    offset: int = Query(0),
    sort: str = Query("score", regex="^(score|citations|date)$"),
    session: Session = Depends(get_session),
):
    query = select(Paper).where(Paper.month_key == month)
    if topic:
        query = query.where(Paper.topic_label == topic)
    if sort == "citations":
        query = query.order_by(Paper.citation_count.desc())
    elif sort == "date":
        query = query.order_by(Paper.published.desc())
    else:
        query = query.order_by(Paper.trend_score.desc())
    query = query.offset(offset).limit(limit)
    papers = session.exec(query).all()
    total = session.exec(select(Paper).where(Paper.month_key == month)).all()
    return {"month": month, "total": len(total), "sort": sort, "papers": [_paper_to_dict(p) for p in papers]}


# =============================================================================
# ENDPOINT: GET /api/topics
# Returns topic clusters for a month sorted by average score.
# =============================================================================
@router.get("/topics")
def get_topics(month: str = Query(...), session: Session = Depends(get_session)):
    topics = session.exec(
        select(TopicSummary)
        .where(TopicSummary.month_key == month)
        .order_by(TopicSummary.avg_score.desc())
    ).all()
    return {"month": month, "topics": [
        {"id": t.topic_id, "label": t.topic_label, "paper_count": t.paper_count,
         "avg_score": t.avg_score, "top_paper_ids": json.loads(t.top_paper_ids)}
        for t in topics
    ]}


# =============================================================================
# ENDPOINT: GET /api/months
# Returns all months that have data in the database.
# =============================================================================
@router.get("/months")
def get_available_months(session: Session = Depends(get_session)):
    papers = session.exec(select(Paper.month_key).distinct()).all()
    return {"months": sorted(set(papers), reverse=True)}


# =============================================================================
# ENDPOINT: GET /api/search
# Keyword search across paper titles and abstracts.
# =============================================================================
@router.get("/search")
def search_papers(
    q: str = Query(..., min_length=2),
    month: Optional[str] = Query(None),
    limit: int = Query(20, le=50),
    session: Session = Depends(get_session),
):
    query = select(Paper).where(Paper.title.contains(q) | Paper.abstract.contains(q))
    if month:
        query = query.where(Paper.month_key == month)
    papers = session.exec(query.order_by(Paper.trend_score.desc()).limit(limit)).all()
    return {"query": q, "papers": [_paper_to_dict(p) for p in papers]}


# =============================================================================
# ENDPOINT: GET /api/heatmap
# NEW ENDPOINT — powers the topic heatmap view.
#
# Returns a 2D grid of data:
#   - rows = unique topic labels across all months
#   - columns = all months that have data
#   - each cell = { paper_count, avg_score } for that topic+month combination
#
# The frontend uses this to draw the coloured grid.
# Empty cells (topic didn't exist that month) return null.
#
# Example response:
# {
#   "months": ["2025-01", "2025-02"],
#   "topics": ["Diffusion · Image", "LLM · Reasoning"],
#   "grid": {
#     "Diffusion · Image": {
#       "2025-01": {"paper_count": 23, "avg_score": 67.4},
#       "2025-02": null
#     }
#   }
# }
# =============================================================================
@router.get("/heatmap")
def get_heatmap(session: Session = Depends(get_session)):
    """
    Returns topic x month data for the heatmap grid.
    Queries the TopicSummary table which has one row per topic per month.
    """
    # Get all topic summaries across all months
    all_summaries = session.exec(select(TopicSummary)).all()

    if not all_summaries:
        return {"months": [], "topics": [], "grid": {}}

    # Collect all unique months and topic labels
    # sorted months = columns of the heatmap (oldest to newest = left to right)
    all_months = sorted(set(s.month_key for s in all_summaries))

    # Collect unique topic labels — sorted by how often they appear across months
    # (more frequent topics shown at the top)
    topic_counts: dict = {}
    for s in all_summaries:
        topic_counts[s.topic_label] = topic_counts.get(s.topic_label, 0) + s.paper_count
    all_topics = sorted(topic_counts.keys(), key=lambda t: topic_counts[t], reverse=True)

    # Build the grid: topic_label → month_key → cell data
    # Start with all cells as None (empty)
    grid: dict = {topic: {month: None for month in all_months} for topic in all_topics}

    # Fill in cells where we have data
    for s in all_summaries:
        grid[s.topic_label][s.month_key] = {
            "paper_count": s.paper_count,
            "avg_score": s.avg_score,
            # top_paper_ids lets the frontend link to papers when cell is clicked
            "top_paper_ids": json.loads(s.top_paper_ids),
        }

    return {
        "months": all_months,
        "topics": all_topics[:20],  # show top 20 topics max to keep grid readable
        "grid": {t: grid[t] for t in all_topics[:20]},
    }


# =============================================================================
# ENDPOINT: GET /api/saved
# Returns all bookmarked papers newest-saved first.
# =============================================================================
@router.get("/saved")
def get_saved_papers(session: Session = Depends(get_session)):
    saved = session.exec(select(SavedPaper).order_by(SavedPaper.saved_at.desc())).all()
    papers = []
    for s in saved:
        paper = session.exec(select(Paper).where(Paper.arxiv_id == s.arxiv_id)).first()
        if paper:
            papers.append(_paper_to_dict(paper))
    return {"total": len(papers), "papers": papers}


# =============================================================================
# ENDPOINT: POST /api/saved/{arxiv_id}
# Bookmark a paper.
# =============================================================================
@router.post("/saved/{arxiv_id}")
def save_paper(arxiv_id: str, session: Session = Depends(get_session)):
    existing = session.exec(select(SavedPaper).where(SavedPaper.arxiv_id == arxiv_id)).first()
    if existing:
        return {"status": "already saved", "arxiv_id": arxiv_id}
    paper = session.exec(select(Paper).where(Paper.arxiv_id == arxiv_id)).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    session.add(SavedPaper(arxiv_id=arxiv_id))
    session.commit()
    return {"status": "saved", "arxiv_id": arxiv_id}


# =============================================================================
# ENDPOINT: DELETE /api/saved/{arxiv_id}
# Remove a bookmark.
# =============================================================================
@router.delete("/saved/{arxiv_id}")
def unsave_paper(arxiv_id: str, session: Session = Depends(get_session)):
    existing = session.exec(select(SavedPaper).where(SavedPaper.arxiv_id == arxiv_id)).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Not currently saved")
    session.delete(existing)
    session.commit()
    return {"status": "removed", "arxiv_id": arxiv_id}


# =============================================================================
# PIPELINE HELPER
# Runs all three steps: fetch → score → topics
# =============================================================================
def _run_pipeline(month_key: str, session: Session):
    fetch_papers_for_month(month_key, session)
    score_papers_for_month(month_key, session)
    extract_topics_for_month(month_key, session)


# =============================================================================
# ENDPOINT: POST /api/ingest
# Triggers paper ingestion in the background.
# Returns immediately — work runs in background.
# =============================================================================
@router.post("/ingest")
def ingest_month(
    month: str = Query(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    session: Session = Depends(get_session),
):
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM format")
    background_tasks.add_task(_run_pipeline, month, session)
    return {"status": "ingestion started", "month": month}


# =============================================================================
# ENDPOINT: GET /api/stats
# Overall database statistics shown in the header.
# =============================================================================
@router.get("/stats")
def get_stats(session: Session = Depends(get_session)):
    all_papers = session.exec(select(Paper)).all()
    months = list(set(p.month_key for p in all_papers))
    return {
        "total_papers": len(all_papers),
        "months_indexed": sorted(months, reverse=True),
        "top_topics": list(set(p.topic_label for p in all_papers if p.topic_label))[:10],
    }
