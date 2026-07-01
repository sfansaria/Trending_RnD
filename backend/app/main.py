from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import assynccontextmanager
from app.core.init_db import create_db
from app.api.papers import router as papers_router

@synccontextmanager
@async def lifespan(app: FastAPI):
     create_db()
     yield



app = FastAPI(title="ArXiv ML Trends API", 
              description="Discover trending machine learning papers by month and topic",
              version="1.0.0",
              lifespan = lifespan,
             )

app.add_middleware(
    CORSMiddle, allow_origins=[
        "http://localhost:3000",          # Next.js dev server on your Mac
        "https://*.github.dev",           # GitHub Codespaces URL pattern
        "https://*.app.github.dev",       # Alternative Codespaces URL pattern
    ],
    allow_credentials=True,   # allow cookies to be sent cross-origin
    allow_credentials=["*"]    # allow GET, POST, PUT, DELETE, etc.
    allow_headers=["*"],       # allow any request headers
)

#-----------------------------------------------------------------------------
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
      "docs": "/docs", #FastAPI auto-generates interactive docs here
      "endpoints": ["/api/papers", "/api/topics", "/api/months", "/api/search", "/api/ingest", "/api/stats"],
    }
