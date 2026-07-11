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

from app.core.init_db import create_db          # creates DB tables
from app.api.papers import router as papers_router  # all our /api/* routes


# -----------------------------------------------------------------------------
# LIFESPAN: Code that runs when the server starts and when it shuts down
# @asynccontextmanager turns this into a context manager FastAPI can use
# Everything before "yield" runs on startup
# Everything after "yield" runs on shutdown (nothing here, but you could add cleanup)
# -----------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ON STARTUP: make sure all database tables exist
    # If the .db file doesn't exist yet, SQLModel creates it here
    create_db()
    yield  # server runs while paused here
    # ON SHUTDOWN: nothing to do


# -----------------------------------------------------------------------------
# CREATE THE FASTAPI APP
# This is the central object that holds everything together
# -----------------------------------------------------------------------------
app = FastAPI(
    title="ArXiv ML Trends API",
    description="Discover trending machine learning papers by month and topic",
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
        #"https://*.github.dev",           # GitHub Codespaces URL pattern
        #"https://*.app.github.dev",       # Alternative Codespaces URL pattern
    ],
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
    return {
        "message": "ArXiv ML Trends API",
        "docs": "/docs",  # FastAPI auto-generates interactive docs here
        "endpoints": ["/api/papers", "/api/topics", "/api/months", "/api/search", "/api/ingest", "/api/stats"],
<<<<<<< HEAD
    }
=======
    }
>>>>>>> dc3743cf2912bb497a84286063f1b324b8b79b74
