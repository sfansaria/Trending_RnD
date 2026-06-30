# =============================================================================
# FILE: backend/app/services/fetcher.py
# PURPOSE: Talks to the arXiv API and saves papers to our database.
#          This is STEP 1 of the pipeline:
#          arXiv API → fetcher.py → database (Fetches ML papers from arXiv and saves to database.
# Called when you click "Fetch" in the UI.)
#
# HOW IT WORKS:
#   1. You give it a month like "2024-06"
#   2. It builds a search query for 5 ML categories
#   3. It calls arXiv's API and gets up to 300 paper results
#   4. For each paper, it checks if we already have it (no duplicates)
#   5. If new, it saves the paper to the database
# =============================================================================

import arxiv      # the official arXiv Python library (pip installs this)
import json       # for converting Python lists → JSON strings for storage
import logging    # for printing info/warning messages to the terminal
from datetime import datetime, timedelta  # for date arithmetic
from typing import List
from sqlmodel import Session, select      # Session = DB connection, select = SQL SELECT

from app.models.paper import Paper        # our Paper table definition

# Set up a logger for this file. Messages will show in the terminal when running.
logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# WHICH ARXIV CATEGORIES TO SEARCH
# arXiv organises papers into categories. These are the main ML ones:
# cs.LG  = Computer Science - Machine Learning (the biggest one)
# cs.AI  = Computer Science - Artificial Intelligence
# cs.CL  = Computation and Language (NLP, chatbots, translation)
# cs.CV  = Computer Vision (image recognition, object detection)
# stat.ML = Statistics - Machine Learning
# -----------------------------------------------------------------------------
ML_CATEGORIES = [
    "cs.LG",
    "cs.AI",
    "cs.CL",
    "cs.CV",
    "stat.ML",
]

# Build the arXiv query string: "cat:cs.LG OR cat:cs.AI OR cat:cs.CL OR ..."
# This searches ANY paper that belongs to at least one of these categories
CATEGORY_QUERY = " OR ".join(f"cat:{c}" for c in ML_CATEGORIES)


# -----------------------------------------------------------------------------
# MAIN FUNCTION: fetch_papers_for_month
# Called by the pipeline in papers.py when you click "Fetch" in the UI
# -----------------------------------------------------------------------------
def fetch_papers_for_month(month_key: str, session: Session, max_results: int = 300) -> int:
    """
    Fetch arXiv ML papers for a specific month and save them to the database.

    Args:
        month_key: Month string like "2024-06"
        session:   Database session (connection) passed in from the API
        max_results: Maximum number of papers to fetch (default 300)

    Returns:
        Number of NEW papers stored (skips duplicates)
    """

    # ── STEP 1: Work out the date range for this month ──────────────────────
    year, month = map(int, month_key.split("-"))  # "2024-06" → year=2024, month=6

    # First day of the month at midnight
    start = datetime(year, month, 1)

    # Last day of the month at 23:59:59
    # Special case: December → next year January
    if month == 12:
        end = datetime(year + 1, 1, 1) - timedelta(seconds=1)
    else:
        end = datetime(year, month + 1, 1) - timedelta(seconds=1)

    # arXiv API requires dates in this exact format: YYYYMMDDHHMMSS
    date_from = start.strftime("%Y%m%d000000")   # e.g. "20240601000000"
    date_to   = end.strftime("%Y%m%d235959")     # e.g. "20240630235959"

    # ── STEP 2: Build the full arXiv search query ───────────────────────────
    # Combine category filter AND date range filter
    # Example: "(cat:cs.LG OR cat:cs.AI OR ...) AND submittedDate:[20240601000000 TO 20240630235959]"
    query = f"({CATEGORY_QUERY}) AND submittedDate:[{date_from} TO {date_to}]"
    logger.info(f"Fetching papers for {month_key}: {query}")

    # ── STEP 3: Configure the arXiv API client ──────────────────────────────
    client = arxiv.Client(
        page_size=100,      # fetch 100 papers per API request (arXiv's max per page)
        delay_seconds=3,    # wait 3 seconds between pages — be polite to arXiv's servers
    )

    # Define what we're searching for
    search = arxiv.Search(
        query=query,
        max_results=max_results,            # stop after 300 total
        sort_by=arxiv.SortCriterion.SubmittedDate,   # newest first
        sort_order=arxiv.SortOrder.Descending,
    )

    # ── STEP 4: Iterate through results and save to DB ──────────────────────
    new_count = 0

    for result in client.results(search):
        # result.entry_id looks like "http://arxiv.org/abs/2401.12345v1"
        # We split by "/" and take the last part: "2401.12345v1"
        arxiv_id = result.entry_id.split("/")[-1]

        # CHECK FOR DUPLICATES: query the DB for a paper with this arxiv_id
        # If it already exists, skip it — don't store duplicates
        existing = session.exec(
            select(Paper).where(Paper.arxiv_id == arxiv_id)
        ).first()
        if existing:
            continue  # skip to the next paper

        # BUILD a Paper object with data from the arXiv result
        paper = Paper(
            arxiv_id=arxiv_id,

            # Clean up whitespace/newlines from the title
            title=result.title.replace("\n", " ").strip(),

            # The abstract — often has newlines in it, we clean those up
            abstract=result.summary.replace("\n", " ").strip(),

            # Store authors as a JSON string (max 10 to avoid very long strings)
            # result.authors is a list of Author objects; .name gets the string
            authors=json.dumps([a.name for a in result.authors[:10]]),

            # Store categories as a JSON string, e.g. '["cs.LG", "cs.AI"]'
            categories=json.dumps([c for c in result.categories]),

            # When the paper was first submitted to arXiv
            published=result.published,

            # The month key we were asked to fetch, e.g. "2024-06"
            month_key=month_key,

            # URL to the abstract page on arXiv
            url=result.entry_id,

            # URL to the PDF. Can be None for some papers, so we default to ""
            pdf_url=result.pdf_url or "",
        )

        # ADD to the database session (not committed yet — batched for efficiency)
        session.add(paper)
        new_count += 1

    # COMMIT: write all the new papers to disk in one transaction
    session.commit()
    logger.info(f"Stored {new_count} new papers for {month_key}")

    return new_count
