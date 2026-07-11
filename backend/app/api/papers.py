# =============================================================================
# FILE: backend/app/api/papers.py
# PURPOSE: Defines all the URL endpoints (routes) the frontend can call.
#          This is the "interface" between the frontend and the backend.
#
# ENDPOINTS (URLs the frontend uses):
#   GET  /api/papers   → list papers for a month
#   GET  /api/topics   → list topic clusters for a month
#   GET  /api/months   → list all months that have data
#   GET  /api/search   → keyword search across papers
#   POST /api/ingest   → start fetching papers for a month
#   GET  /api/stats    → overall database statistics
# =============================================================================

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlmodel import Session, select
from typing import List, Optional
import json
from datetime import datetime

# get_session: function that provides a DB connection (from init_db.py)
from app.core.init_db import get_session
from app.models.paper import Paper, TopicSummary, SavedPaper

# The three pipeline steps
from app.services.fetcher import fetch_papers_for_month
from app.services.scorer import score_papers_for_month
from app.services.topics import extract_topics_for_month

# APIRouter groups related endpoints together.
# prefix="/api" means all routes here start with /api
# tags=["papers"] groups them in the API documentation at /docs
router = APIRouter(prefix="/api", tags=["papers"])


# -----------------------------------------------------------------------------
# HELPER: Convert a Paper database row → Python dict → JSON
# We do this instead of returning the Paper object directly because:
# 1. We need to decode JSON strings back to lists (authors, categories)
# 2. We want to truncate long abstracts before sending to the frontend
# 3. We control exactly what data goes to the frontend
# -----------------------------------------------------------------------------
def _paper_to_dict(p: Paper) -> dict:
    return {
        "id": p.id,
        "arxiv_id": p.arxiv_id,
        "title": p.title,
        # Truncate abstracts longer than 400 chars — the frontend shows a preview
        # The user can expand to see the full abstract
        "abstract": p.abstract[:400] + "..." if len(p.abstract) > 400 else p.abstract,
        # Decode the JSON string back to a Python list
        # e.g. '["Yann LeCun", "Geoffrey Hinton"]' → ["Yann LeCun", "Geoffrey Hinton"]
        "authors": json.loads(p.authors),
        "categories": json.loads(p.categories),
        # .isoformat() converts datetime → string like "2024-06-15T09:30:00"
        # JSON can't store Python datetime objects, only strings
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
# ENDPOINT 1: GET /api/papers
# Returns ranked papers for a given month, with optional topic filter.
# Example call: /api/papers?month=2024-06&topic=Diffusion+Image&limit=20
# =============================================================================
@router.get("/papers")
def get_papers(
    # Query() means: read this value from the URL query string (?month=...)
    # ... means the field is required (no default)
    month: str = Query(..., description="Month in YYYY-MM format, e.g. 2024-06"),
    # Optional means the topic filter can be omitted — returns all topics
    topic: Optional[str] = Query(None),
    # Pagination: limit = how many results, offset = skip first N
    limit: int = Query(20, le=100),   # le=100 means max allowed value is 100
    offset: int = Query(0),

    #########################################################################
    # NEW: sort parameter — controls which column we ORDER BY
    # "score"     = trend_score descending (default, same as before)
    # "citations" = citation_count descending (most cited first)
    # "date"      = published descending (newest paper first)
    sort: str = Query("score", regex="^(score|citations|date)$"),
    #########################################################################
    # Depends(get_session) tells FastAPI: "call get_session() and pass the result here"
    # This is how FastAPI injects the database connection into the route function
    session: Session = Depends(get_session),):
    """Return top trending papers for a given month."""
    """after new addition"""
    """Return papers for a month, with optional topic filter and sort order."""

    # Build a SQL SELECT query
    # select(Paper) = SELECT * FROM paper
    # .where(Paper.month_key == month) = WHERE month_key = '2024-06'
    query = select(Paper).where(Paper.month_key == month)

    # Add topic filter if provided
    if topic:
        query = query.where(Paper.topic_label == topic)

   
    # .offset() and .limit() handle pagination
    #apply the correct ORDER BY based on what the user picked
    if sort == "citations":
       #most cited papers first
       query = query.order_by(Paper.citation_count.desc()) #.offset(offset).limit(limit)
    elif sort == "date":
        #mOst recently published papers first
        query = query.order_by(Paper.published.desc())
    else:
        #Default: highest trend score first
        query = query.order_by(Paper.trend_score.desc())

    #  .offset() and .limit() handle pagination
    query = query.offset(offset).limit(limit)

    # Execute the query and get results
    papers = session.exec(query).all()

    # Also get total count (without pagination limit) so the UI can show "X papers"
    total = session.exec(select(Paper).where(Paper.month_key == month)).all()

    return {
        "month": month,
        "total": len(total),
        "sort": sort,  #echo back what sort was used
        "papers": [_paper_to_dict(p) for p in papers],  # list comprehension = convert all
    }


# =============================================================================
# ENDPOINT 2: GET /api/topics
# Returns topic clusters for a given month.
# Example call: /api/topics?month=2024-06
# Powers the topic filter pills in the UI.
# =============================================================================
@router.get("/topics")
def get_topics(
    month: str = Query(..., description="Month in YYYY-MM format"),
    session: Session = Depends(get_session),
):
    """Return topic clusters for a month, sorted by average score."""
    topics = session.exec(
        select(TopicSummary)
        .where(TopicSummary.month_key == month)
        .order_by(TopicSummary.avg_score.desc())  # hottest topics first
    ).all()

    return {
        "month": month,
        "topics": [
            {
                "id": t.topic_id,
                "label": t.topic_label,
                "paper_count": t.paper_count,
                "avg_score": t.avg_score,
                "top_paper_ids": json.loads(t.top_paper_ids),
            }
            for t in topics  # convert each TopicSummary row to a dict
        ],
    }


# =============================================================================
# ENDPOINT 3: GET /api/months
# Returns all months that have data in the database.
# The frontend uses this to show only valid month buttons.
# Example call: /api/months
# =============================================================================
@router.get("/months")
def get_available_months(session: Session = Depends(get_session)):
    """Return all months that have papers in the database."""
    # select(Paper.month_key) = SELECT DISTINCT month_key FROM paper
    papers = session.exec(select(Paper.month_key).distinct()).all()
    # Sort newest first so the UI shows the most recent month selected by default
    months = sorted(set(papers), reverse=True)
    return {"months": months}


# =============================================================================
# ENDPOINT 4: GET /api/search
# Keyword search across paper titles and abstracts.
# Example call: /api/search?q=attention+mechanism&month=2024-06
# =============================================================================
@router.get("/search")
def search_papers(
    q: str = Query(..., min_length=2),   # min_length=2: reject single-char queries
    month: Optional[str] = Query(None),  # optional: search within a month
    limit: int = Query(20, le=50),
    session: Session = Depends(get_session),
):
    """Keyword search across titles and abstracts."""
    # .contains(q) generates a SQL LIKE '%q%' which checks if q is a substring
    # | is the OR operator in SQLModel queries
    query = select(Paper).where(
        Paper.title.contains(q) | Paper.abstract.contains(q)
    )
    # Optionally restrict to one month
    if month:
        query = query.where(Paper.month_key == month)

    # Sort matching papers by trend score — most relevant first
    query = query.order_by(Paper.trend_score.desc()).limit(limit)
    papers = session.exec(query).all()

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
router.get("/heatmap")
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
# PIPELINE HELPER
# Runs all three steps in sequence for a given month.
# Pulled out as a separate function so it can be passed to BackgroundTasks.
# =============================================================================
def _run_pipeline(month_key: str, session: Session):
    """Run the full ingest pipeline: fetch → score → extract topics."""
    fetch_papers_for_month(month_key, session)   # Step 1: get papers from arXiv
    score_papers_for_month(month_key, session)   # Step 2: compute trend scores
    extract_topics_for_month(month_key, session) # Step 3: cluster into topics


# =============================================================================
# ENDPOINT 5: POST /api/ingest
# Triggers paper ingestion for a month. Runs in the background so the
# HTTP response returns immediately (within 1 second) even though the
# actual work takes 2-5 minutes.
# Example call: POST /api/ingest?month=2024-06
# =============================================================================
@router.post("/ingest")
def ingest_month(
    month: str = Query(..., description="Month in YYYY-MM format"),
    # BackgroundTasks lets us run a function after the HTTP response is sent
    background_tasks: BackgroundTasks = BackgroundTasks(),
    session: Session = Depends(get_session),
):
    """Start ingesting papers for a month. Returns immediately; work runs in background."""

    # Validate the month format before starting the pipeline
    try:
        datetime.strptime(month, "%Y-%m")  # raises ValueError if format is wrong
    except ValueError:
        # HTTPException sends an error response to the frontend
        raise HTTPException(status_code=400, detail="month must be YYYY-MM format")

    # add_task schedules _run_pipeline to run AFTER this function returns.
    # The user gets the JSON response immediately, then the work starts.
    background_tasks.add_task(_run_pipeline, month, session)

    return {"status": "ingestion started", "month": month}


# =============================================================================
# ENDPOINT 6: GET /api/stats
# Returns overall statistics about the database.
# Shown in the header of the UI: "X papers indexed"
# =============================================================================
@router.get("/stats")
def get_stats(session: Session = Depends(get_session)):
    """Return overall database statistics."""
    all_papers = session.exec(select(Paper)).all()
    months = list(set(p.month_key for p in all_papers))
    return {
        "total_papers": len(all_papers),
        "months_indexed": sorted(months, reverse=True),
        "top_topics": list(set(p.topic_label for p in all_papers if p.topic_label))[:10],
    }


######################################
#new endpoint for bookmarking feature
######################################

@router.post("/saved/{arxiv_id}")
def save_paper(arxiv_id: str, session: Session = Depends(get_session)):
    """
    POST /api/saved/2401.12345v1 — bookmark a paper.
    If it's already saved, does nothing (no duplicate, no error).
    """
    # Check if it's already saved
    existing = session.exec(
        select(SavedPaper).where(SavedPaper.arxiv_id == arxiv_id)
    ).first()
 
    if existing:
        # Already saved — nothing to do, just confirm it's saved
        return {"status": "already saved", "arxiv_id": arxiv_id}
 
    # Make sure the paper actually exists before saving a reference to it
    paper = session.exec(
        select(Paper).where(Paper.arxiv_id == arxiv_id)
    ).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
 
    session.add(SavedPaper(arxiv_id=arxiv_id))
    session.commit()
    return {"status": "saved", "arxiv_id": arxiv_id}
 
 
@router.delete("/saved/{arxiv_id}")
def unsave_paper(arxiv_id: str, session: Session = Depends(get_session)):
    """
    DELETE /api/saved/2401.12345v1 — remove a bookmark.
    """
    existing = session.exec(
        select(SavedPaper).where(SavedPaper.arxiv_id == arxiv_id)
    ).first()
 
    if not existing:
        raise HTTPException(status_code=404, detail="Not currently saved")
 
    session.delete(existing)
    session.commit()
    return {"status": "removed", "arxiv_id": arxiv_id}
 
 
@router.get("/saved")
def get_saved_papers(session: Session = Depends(get_session)):
    """
    GET /api/saved — return all bookmarked papers, newest-saved first.
    Joins SavedPaper (the bookmark) with Paper (the actual paper data).
    """
    # Get all bookmarks, newest first
    saved = session.exec(
        select(SavedPaper).order_by(SavedPaper.saved_at.desc())
    ).all()
 
    # For each bookmark, look up the full paper details
    papers = []
    for s in saved:
        paper = session.exec(
            select(Paper).where(Paper.arxiv_id == s.arxiv_id)
        ).first()
        if paper:  # skip silently if the paper was somehow deleted
            papers.append(_paper_to_dict(paper))
 
    return {"total": len(papers), "papers": papers}
 
