# =============================================================================
# FILE: backend/app/main.py
# PURPOSE: The entry point for the entire backend server.
#          This is the file you point uvicorn at when starting the server:
#          > uvicorn app.main:app --reload
#                    ^^^  ^^^
#                    file app (= app/main.py)
#                         the FastAPI instance called "app"
#
# WHAT THIS FILE DOES:
#   1. Creates the FastAPI app instance
#   2. Sets up CORS (allows the frontend to call the backend)
#   3. Registers all the API routes from papers.py
#   4. Creates the database tables on startup
# =============================================================================

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager  # for code that runs on startup/shutdown

from app.core.init_db import create_db, get_session          # creates DB tables
from app.api.papers import router as papers_router  # all our /api/* routes
from app.services.fetcher import fetch_papers_for_month #fetches papers for a given month
from app.services.scorer import score_papers_for_month #scores papers for a given month
from app.services.topics import extract_topics_for_month #extracts topics for a given month

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timedelta
import logging

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# SCHEDULER
# AsyncIOScheduler runs jobs inside the same async event loop as FastAPI.
# This means it shares the same process and doesn't need a separate worker.
# -----------------------------------------------------------------------------
scheduler = AsyncIOScheduler()

def run_nightly_pipeline():
    """
    Runs every night at 2am.
    Fetches papers for the current month, scores them, extracts topics.
    Uses a fresh database session for each run.
    """
    # Get current month key e.g. "2025-07"
    month_key = datetime.now().strftime("%Y-%m")
    logger.info(f"Nightly pipeline starting for {month_key}")

    # Get a database session
    # We call next() because get_session is a generator (uses yield)
    session = next(get_session())
    
    try:
        fetch_papers_for_month(month_key, session)
        score_papers_for_month(month_key, session)
        extract_topics_for_month(month_key, session)
        logger.info(f"Nightly pipeline completed for {month_key}")
    except Exception as e:
        logger.error(f"Nightly pipeline failed: {e}")
    finally:
        session.close()

# -----------------------------------------------------------------------------
# LIFESPAN: Code that runs when the server starts and when it shuts down
# Starts the scheduler on startup, shuts it down cleanly on exit.
# @asynccontextmanager turns this into a context manager FastAPI can use
# Everything before "yield" runs on startup
# Everything after "yield" runs on shutdown (nothing here, but you could add cleanup)
# -----------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ON STARTUP: make sure all database tables exist
    # If the .db file doesn't exist yet, SQLModel creates it here
    create_db()

    # Schedule the nightly job
    # CronTrigger(hour=2, minute=0) = run at 2:00am every day
    scheduler.add_job(
        run_nightly_pipeline,
        CronTrigger(hour=2, minute=0),
        id="nightly_pipeline",
        name="Nightly arXiv fetch",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started — nightly fetch at 2:00am")

    yield  # server runs while paused here
    # ON SHUTDOWN: nothing to do
    
    # Clean shutdown
    scheduler.shutdown()
    logger.info("Scheduler stopped")

# -----------------------------------------------------------------------------
# CREATE THE FASTAPI APP
# This is the central object that holds everything together
# -----------------------------------------------------------------------------
app = FastAPI(
    title="Trending RnD API",
    description="Discover trending machine learning research papers by month and topic",
    version="1.0.0",
    lifespan=lifespan,  # use our startup/shutdown logic above
)


# -----------------------------------------------------------------------------
# CORS MIDDLEWARE
# CORS = Cross-Origin Resource Sharing
# Browsers block JavaScript from calling APIs on different URLs by default.
# Our frontend runs on localhost:3000 but calls the API on localhost:8000.
# That's a different "origin" (different port), so we need CORS headers.
# This middleware adds the right headers to every response.
# -----------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",          # Next.js dev server on your Mac
        "https://*.vercel.app", #Vercel deployment URL pattern
        "https://trending-r-n-d.vercel.app",
        #"https://*.github.dev",           # GitHub Codespaces URL pattern
        #"https://*.app.github.dev",       # Alternative Codespaces URL pattern
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",

    allow_credentials=True,   # allow cookies to be sent cross-origin
    allow_methods=["*"],      # allow GET, POST, PUT, DELETE, etc.
    allow_headers=["*"],      # allow any request headers
)


# -----------------------------------------------------------------------------
# REGISTER ROUTES
# include_router attaches all the routes from papers.py to this app.
# After this, /api/papers, /api/topics, etc. all become live endpoints.
# -----------------------------------------------------------------------------
app.include_router(papers_router)


# -----------------------------------------------------------------------------
# ROOT ENDPOINT
# GET / — shows basic info about the API
# Visit http://localhost:8000/ in your browser to see this
# Visit http://localhost:8000/docs for interactive API documentation
# -----------------------------------------------------------------------------

@app.get("/")
def root():
    #Show next scheduled run time in the root response
    job = scheduler.get_job("nightly_pipeline")
    next_run = str(job.next_run_time) if job else "unknown"
    return {
        "message": "Trending RnD API",
        "docs": "/docs",
        "endpoints": [
            "/api/papers", "/api/topics", "/api/months",
            "/api/search", "/api/ingest", "/api/stats",
            "/api/heatmap", "/api/saved"
        ],
    }
    
