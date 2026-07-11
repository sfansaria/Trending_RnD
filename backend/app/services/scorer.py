# =============================================================================
# FILE: backend/app/services/scorer.py
# PURPOSE: Calculates a "trend score" for every paper.
#          This is STEP 2 of the pipeline:
#          database (papers) → scorer.py → database (trend_score updated)
#
# SCORING FORMULA:
#   trend_score = 40% citation velocity
#               + 30% recency (how new the paper is)
#               + 20% citation count
#               + 10% keyword boost (does the abstract mention hot topics?)
#
# Scores are normalised to 0–100 within each month so you can compare
# papers from the same period fairly.
# =============================================================================

import httpx      # async HTTP client for calling external APIs (like Semantic Scholar)
import json
import logging
from datetime import datetime, timezone
from typing import List
from sqlmodel import Session, select

from app.models.paper import Paper

logger = logging.getLogger(__name__)

# Base URL for the Semantic Scholar Graph API (free, no key needed for low volume)
SEMANTIC_SCHOLAR_URL = "https://api.semanticscholar.org/graph/v1/paper"


# -----------------------------------------------------------------------------
# OPTIONAL: Enrich papers with citation data from Semantic Scholar
# This function is async (uses "await") because it makes many HTTP calls.
# It updates each Paper object IN PLACE (modifies the objects directly).
# NOTE: This isn't always called in the basic pipeline because it's slow
#       (one HTTP request per paper). The scoring still works without it.
# -----------------------------------------------------------------------------
async def enrich_with_citations(papers: List[Paper]) -> None:
    """
    For each paper, fetch its citation count from Semantic Scholar.
    Updates paper.citation_count and paper.citation_velocity in place.
    """
    # asynccontextmanager: creates one HTTP client and reuses it for all requests
    # This is faster than creating a new client for every single paper
    async with httpx.AsyncClient(timeout=10) as client:
        for paper in papers:
            try:
                # Strip version suffix: "2401.12345v2" → "2401.12345"
                # Semantic Scholar doesn't want the version number
                arxiv_id = paper.arxiv_id.split("v")[0]

                # Build the Semantic Scholar API URL for this paper
                # arXiv: prefix tells S2 we're giving it an arXiv ID
                url = f"{SEMANTIC_SCHOLAR_URL}/arXiv:{arxiv_id}"

                # Ask for only the fields we need (saves bandwidth)
                params = {"fields": "citationCount,influentialCitationCount"}

                # Make the HTTP GET request
                r = await client.get(url, params=params)

                if r.status_code == 200:  # 200 = success
                    data = r.json()
                    # Total citations to this paper
                    paper.citation_count = data.get("citationCount", 0) or 0
                    # "Influential" citations = cited in important papers
                    # We use this as a proxy for citation velocity
                    paper.citation_velocity = float(data.get("influentialCitationCount", 0) or 0)

            except Exception as e:
                # Don't crash if one paper fails — just skip it
                # This handles network errors, rate limits, papers not found, etc.
                logger.debug(f"Could not enrich {paper.arxiv_id}: {e}")


# -----------------------------------------------------------------------------
# COMPUTE RAW SCORE FOR ONE PAPER
# Returns a raw float — not yet normalised to 0-100
# -----------------------------------------------------------------------------
def compute_trend_score(paper: Paper) -> float:
    """
    Calculate a raw trend score for a single paper.
    This is called for every paper, then scores are normalised across the month.
    """

    # ── COMPONENT 1: Recency (weight: 30%) ──────────────────────────────────
    # Newer papers score higher. A paper published today = 1.0, one year old = 0.0
    now = datetime.now(timezone.utc)
    published = paper.published

    # Make sure published has timezone info (SQLite sometimes strips it)
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)

    days_old = max((now - published).days, 1)  # at least 1 to avoid division by zero
    # Linear decay: 0 days old = 1.0, 365 days old = 0.0, older = 0.0 (capped)
    recency = max(0.0, 1.0 - (days_old / 365.0))

    # ── COMPONENT 2: Keyword boost (weight: 10%) ─────────────────────────────
    # Papers mentioning currently hot topics get a bonus.
    # These keywords represent the most-cited research areas in ML right now.
    hot_keywords = [
        "large language model", "llm", "transformer", "diffusion",
        "reinforcement learning from human feedback", "rlhf", "lora",
        "chain-of-thought", "in-context learning", "foundation model",
        "instruction tuning", "vision language", "multimodal", "alignment",
        "agent", "reasoning", "neural scaling", "mixture of experts",
    ]
    abstract_lower = paper.abstract.lower()  # case-insensitive matching

    # Count how many hot keywords appear in the abstract
    keyword_hits = sum(1 for kw in hot_keywords if kw in abstract_lower)

    # Cap at 5 hits = max boost of 1.0
    # (a paper mentioning 10 keywords isn't 2x better than one with 5)
    keyword_boost = min(keyword_hits / 5.0, 1.0)

    # ── COMBINE ALL COMPONENTS ───────────────────────────────────────────────
    # We multiply recency and keyword_boost by 10 to bring them to the same
    # numeric range as citation_count and citation_velocity (which can be 0-100+)
    raw_score = (
        0.4 * paper.citation_velocity +  # 40%: quality citations
        0.3 * recency * 10 +             # 30%: how new the paper is (scaled to 0-10)
        0.2 * paper.citation_count +     # 20%: total citations
        0.1 * keyword_boost * 10         # 10%: hot topic keywords (scaled to 0-10)
    )
    return round(raw_score, 4)


# -----------------------------------------------------------------------------
# SCORE ALL PAPERS FOR A MONTH
# Called by the pipeline after fetching papers.
# Computes scores for all papers, then normalises them to 0-100.
# -----------------------------------------------------------------------------
def score_papers_for_month(month_key: str, session: Session) -> None:
    """
    Recompute and normalise trend scores for all papers in a given month.
    Updates paper.trend_score in the database.
    """
    # Load all papers for this month from the database
    papers = session.exec(
        select(Paper).where(Paper.month_key == month_key)
    ).all()

    if not papers:
        logger.warning(f"No papers found for {month_key}")
        return

    # Compute the raw score for every paper
    raw_scores = [compute_trend_score(p) for p in papers]

    # ── NORMALISE TO 0–100 ───────────────────────────────────────────────────
    # Min-max normalisation: (value - min) / (max - min) * 100
    # This means the best paper in the month = 100, worst = 0
    # It's fair because you're only comparing papers within the same month
    min_s = min(raw_scores)
    max_s = max(raw_scores)
    span  = max(max_s - min_s, 1e-9)  # 1e-9 avoids division by zero if all scores equal

    for paper, raw in zip(papers, raw_scores):
        paper.trend_score = round((raw - min_s) / span * 100, 2)
        session.add(paper)  # mark as modified

    # Write all changes to the database in one transaction
    session.commit()
<<<<<<< HEAD
    logger.info(f"Scored {len(papers)} papers for {month_key}")
=======
    logger.info(f"Scored {len(papers)} papers for {month_key}")
>>>>>>> dc3743cf2912bb497a84286063f1b324b8b79b74
