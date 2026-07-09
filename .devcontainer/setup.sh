#!/bin/bash
# Run this from inside your Trending_RnD folder:
# bash setup_project.sh

set -e
echo "Creating project structure..."

# ── Create all folders ──────────────────────────────────────────────────────
mkdir -p backend/app/api
mkdir -p backend/app/core
mkdir -p backend/app/models
mkdir -p backend/app/services
mkdir -p frontend/src/app
mkdir -p frontend/src/lib
mkdir -p .devcontainer

# ── Empty __init__.py files (tell Python these are packages) ────────────────
touch backend/app/__init__.py
touch backend/app/api/__init__.py
touch backend/app/core/__init__.py
touch backend/app/models/__init__.py
touch backend/app/services/__init__.py

echo "Creating backend files..."

# ── requirements.txt ────────────────────────────────────────────────────────
cat > backend/requirements.txt << 'EOF'
fastapi==0.111.0
uvicorn[standard]==0.29.0
arxiv==2.1.0
httpx==0.27.0
sqlmodel==0.0.19
aiosqlite==0.20.0
apscheduler==3.10.4
scikit-learn==1.4.2
numpy==1.26.4
python-dateutil==2.9.0
pydantic-settings==2.2.1
EOF

# ── backend/app/models/paper.py ─────────────────────────────────────────────
cat > backend/app/models/paper.py << 'EOF'
# Defines the database tables as Python classes.
# Paper = one row per arXiv paper.
# TopicSummary = one row per topic cluster per month.

from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field


class Paper(SQLModel, table=True):
    # Auto-incrementing primary key assigned by the database
    id: Optional[int] = Field(default=None, primary_key=True)

    # arXiv's own ID e.g. "2401.12345v1" — must be unique, indexed for fast lookup
    arxiv_id: str = Field(index=True, unique=True)

    title: str
    abstract: str

    # Lists stored as JSON strings because SQLite can't store Python lists directly
    # e.g. '["Yann LeCun", "Geoffrey Hinton"]'
    authors: str
    categories: str  # e.g. '["cs.LG", "cs.AI"]'

    published: datetime
    month_key: str   # e.g. "2024-06" — used to filter papers by month
    url: str         # arXiv abstract page
    pdf_url: str     # direct PDF download link

    # Trend signals — filled in by scorer.py
    citation_count: int = Field(default=0)
    citation_velocity: float = Field(default=0.0)
    pwc_stars: int = Field(default=0)
    hf_mentions: int = Field(default=0)
    trend_score: float = Field(default=0.0)  # final 0-100 score

    # Topic cluster — filled in by topics.py
    topic_label: Optional[str] = Field(default=None, index=True)
    topic_id: Optional[int] = Field(default=None)

    fetched_at: datetime = Field(default_factory=datetime.utcnow)


class TopicSummary(SQLModel, table=True):
    # One row per topic cluster per month
    # Powers the topic filter pills in the UI
    id: Optional[int] = Field(default=None, primary_key=True)
    month_key: str = Field(index=True)
    topic_label: str   # e.g. "Diffusion · Image · Generation"
    topic_id: int      # KMeans cluster number
    paper_count: int
    avg_score: float
    top_paper_ids: str  # JSON list of top 5 arxiv_ids by trend score
EOF

# ── backend/app/core/init_db.py ─────────────────────────────────────────────
cat > backend/app/core/init_db.py << 'EOF'
# Sets up the database connection and creates tables.
# Runs automatically when the backend starts.
# Can also be run manually: python -m app.core.init_db

from sqlmodel import SQLModel, create_engine, Session
from pathlib import Path

# Put the database file in the backend/ folder
DB_PATH = Path(__file__).parent.parent.parent / "arxiv_trends.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

# The engine is the actual connection to SQLite
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # needed for FastAPI's threading model
    echo=False,  # set True to see every SQL query in the terminal
)


def create_db():
    # Reads all SQLModel classes with table=True and creates their tables
    # Safe to call multiple times — won't recreate existing tables
    SQLModel.metadata.create_all(engine)
    print(f"Database ready at {DB_PATH}")


def get_session():
    # Provides a database session to FastAPI route functions via Depends()
    # The "with" block closes the session automatically when done
    with Session(engine) as session:
        yield session


if __name__ == "__main__":
    create_db()
EOF

# ── backend/app/services/fetcher.py ─────────────────────────────────────────
cat > backend/app/services/fetcher.py << 'EOF'
# STEP 1 OF PIPELINE: Fetches ML papers from arXiv and saves to database.
# Called when you click "Fetch" in the UI.

import arxiv
import json
import logging
from datetime import datetime, timedelta
from sqlmodel import Session, select
from app.models.paper import Paper

logger = logging.getLogger(__name__)

# The 5 arXiv categories we search across
ML_CATEGORIES = ["cs.LG", "cs.AI", "cs.CL", "cs.CV", "stat.ML"]
CATEGORY_QUERY = " OR ".join(f"cat:{c}" for c in ML_CATEGORIES)


def fetch_papers_for_month(month_key: str, session: Session, max_results: int = 300) -> int:
    """
    Fetch papers for a month like "2024-06" and save to DB.
    Returns the number of NEW papers stored (skips duplicates).
    """
    year, month = map(int, month_key.split("-"))
    start = datetime(year, month, 1)

    # Calculate last day of month
    if month == 12:
        end = datetime(year + 1, 1, 1) - timedelta(seconds=1)
    else:
        end = datetime(year, month + 1, 1) - timedelta(seconds=1)

    # arXiv requires this exact date format
    date_from = start.strftime("%Y%m%d000000")
    date_to = end.strftime("%Y%m%d235959")

    # Full search query: categories AND date range
    query = f"({CATEGORY_QUERY}) AND submittedDate:[{date_from} TO {date_to}]"
    logger.info(f"Fetching papers for {month_key}")

    # Configure arXiv client — delay_seconds=3 is polite to arXiv's servers
    client = arxiv.Client(page_size=100, delay_seconds=3)
    search = arxiv.Search(
        query=query,
        max_results=max_results,
        sort_by=arxiv.SortCriterion.SubmittedDate,
        sort_order=arxiv.SortOrder.Descending,
    )

    new_count = 0
    for result in client.results(search):
        arxiv_id = result.entry_id.split("/")[-1]

        # Skip if already in database (avoid duplicates)
        existing = session.exec(select(Paper).where(Paper.arxiv_id == arxiv_id)).first()
        if existing:
            continue

        paper = Paper(
            arxiv_id=arxiv_id,
            title=result.title.replace("\n", " ").strip(),
            abstract=result.summary.replace("\n", " ").strip(),
            authors=json.dumps([a.name for a in result.authors[:10]]),
            categories=json.dumps(list(result.categories)),
            published=result.published,
            month_key=month_key,
            url=result.entry_id,
            pdf_url=result.pdf_url or "",
        )
        session.add(paper)
        new_count += 1

    session.commit()
    logger.info(f"Stored {new_count} new papers for {month_key}")
    return new_count
EOF

# ── backend/app/services/scorer.py ──────────────────────────────────────────
cat > backend/app/services/scorer.py << 'EOF'
# STEP 2 OF PIPELINE: Calculates a trend score 0-100 for every paper.
#
# Score formula (weights):
#   40% citation velocity (influential citations from Semantic Scholar)
#   30% recency (newer papers score higher)
#   20% citation count (total citations)
#   10% keyword boost (abstract mentions hot ML topics)

import httpx
import logging
from datetime import datetime, timezone
from sqlmodel import Session, select
from app.models.paper import Paper

logger = logging.getLogger(__name__)
SEMANTIC_SCHOLAR_URL = "https://api.semanticscholar.org/graph/v1/paper"


async def enrich_with_citations(papers, session):
    """
    Optional: fetch citation counts from Semantic Scholar (free, no key needed).
    Updates paper objects in place before scoring.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        for paper in papers:
            try:
                arxiv_id = paper.arxiv_id.split("v")[0]  # strip version suffix
                url = f"{SEMANTIC_SCHOLAR_URL}/arXiv:{arxiv_id}"
                r = await client.get(url, params={"fields": "citationCount,influentialCitationCount"})
                if r.status_code == 200:
                    data = r.json()
                    paper.citation_count = data.get("citationCount", 0) or 0
                    paper.citation_velocity = float(data.get("influentialCitationCount", 0) or 0)
            except Exception as e:
                logger.debug(f"Could not enrich {paper.arxiv_id}: {e}")


def compute_trend_score(paper: Paper) -> float:
    """Calculate raw trend score for one paper (normalised later)."""
    now = datetime.now(timezone.utc)
    published = paper.published
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)

    # Recency: 0 days old = 1.0, 365 days old = 0.0
    days_old = max((now - published).days, 1)
    recency = max(0.0, 1.0 - (days_old / 365.0))

    # Keyword boost: count hot ML terms in the abstract
    hot_keywords = [
        "large language model", "llm", "transformer", "diffusion",
        "reinforcement learning from human feedback", "rlhf", "lora",
        "chain-of-thought", "in-context learning", "foundation model",
        "instruction tuning", "vision language", "multimodal", "alignment",
        "agent", "reasoning", "neural scaling", "mixture of experts",
    ]
    hits = sum(1 for kw in hot_keywords if kw in paper.abstract.lower())
    keyword_boost = min(hits / 5.0, 1.0)

    return round(
        0.4 * paper.citation_velocity +
        0.3 * recency * 10 +
        0.2 * paper.citation_count +
        0.1 * keyword_boost * 10,
        4
    )


def score_papers_for_month(month_key: str, session: Session) -> None:
    """Score all papers for a month and normalise scores to 0-100."""
    papers = session.exec(select(Paper).where(Paper.month_key == month_key)).all()
    if not papers:
        logger.warning(f"No papers found for {month_key}")
        return

    raw_scores = [compute_trend_score(p) for p in papers]

    # Min-max normalisation so scores are 0-100 within the month
    min_s, max_s = min(raw_scores), max(raw_scores)
    span = max(max_s - min_s, 1e-9)
    for paper, raw in zip(papers, raw_scores):
        paper.trend_score = round((raw - min_s) / span * 100, 2)
        session.add(paper)

    session.commit()
    logger.info(f"Scored {len(papers)} papers for {month_key}")
EOF

# ── backend/app/services/topics.py ──────────────────────────────────────────
cat > backend/app/services/topics.py << 'EOF'
# STEP 3 OF PIPELINE: Groups papers into topic clusters.
#
# HOW IT WORKS:
#   1. Convert all abstracts to TF-IDF vectors (numbers representing word importance)
#   2. Run KMeans to group similar papers into 12 clusters
#   3. Label each cluster from its most distinctive words
#   4. Save topic_label to each paper and create TopicSummary rows for the UI

import json
import logging
from typing import List, Dict
from sqlmodel import Session, select
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
import numpy as np
from app.models.paper import Paper, TopicSummary

logger = logging.getLogger(__name__)
N_TOPICS = 12  # max topic clusters per month


def _top_terms(tfidf: TfidfVectorizer, cluster_center: np.ndarray, n: int = 5) -> List[str]:
    """Get the n most distinctive words for a cluster from its centroid."""
    feature_names = tfidf.get_feature_names_out()
    top_idx = cluster_center.argsort()[-n:][::-1]
    return [feature_names[i] for i in top_idx]


def _make_label(terms: List[str]) -> str:
    """Turn ["diffusion", "image", "generation"] → "Diffusion · Image · Generation" """
    return " · ".join(t.replace("_", " ").title() for t in terms[:3])


def extract_topics_for_month(month_key: str, session: Session) -> int:
    """Cluster papers into topics and save labels. Returns number of clusters."""
    papers = session.exec(select(Paper).where(Paper.month_key == month_key)).all()

    # Fallback: too few papers to cluster
    if len(papers) < N_TOPICS:
        for p in papers:
            p.topic_id = 0
            p.topic_label = "Machine Learning"
            session.add(p)
        session.commit()
        return 1

    abstracts = [p.abstract for p in papers]

    # TF-IDF: convert text → numerical vectors
    # max_features=2000: keep only the 2000 most important words
    # ngram_range=(1,2): consider single words and two-word phrases
    vectorizer = TfidfVectorizer(max_features=2000, ngram_range=(1, 2),
                                  stop_words="english", min_df=2)
    X = vectorizer.fit_transform(abstracts)

    # KMeans: group similar vectors into clusters
    n_clusters = min(N_TOPICS, len(papers) // 5)
    km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = km.fit_predict(X)

    # Build labels from cluster centroids
    topic_labels: Dict[int, str] = {}
    for cid in range(n_clusters):
        terms = _top_terms(vectorizer, km.cluster_centers_[cid])
        topic_labels[cid] = _make_label(terms)

    # Assign topic to each paper
    for paper, cid in zip(papers, labels):
        paper.topic_id = int(cid)
        paper.topic_label = topic_labels[cid]
        session.add(paper)

    # Delete old summaries and create new ones
    for old in session.exec(select(TopicSummary).where(TopicSummary.month_key == month_key)).all():
        session.delete(old)

    for cid in range(n_clusters):
        cluster_papers = [p for p, l in zip(papers, labels) if l == cid]
        if not cluster_papers:
            continue
        avg_score = sum(p.trend_score for p in cluster_papers) / len(cluster_papers)
        top_ids = sorted(cluster_papers, key=lambda p: p.trend_score, reverse=True)[:5]
        session.add(TopicSummary(
            month_key=month_key,
            topic_label=topic_labels[cid],
            topic_id=cid,
            paper_count=len(cluster_papers),
            avg_score=round(avg_score, 2),
            top_paper_ids=json.dumps([p.arxiv_id for p in top_ids]),
        ))

    session.commit()
    logger.info(f"Extracted {n_clusters} topics for {month_key}")
    return n_clusters
EOF

# ── backend/app/api/papers.py ────────────────────────────────────────────────
cat > backend/app/api/papers.py << 'EOF'
# All the API endpoints the frontend calls.
# Every function here = one URL the frontend can fetch.

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlmodel import Session, select
from typing import Optional
import json
from datetime import datetime

from app.core.init_db import get_session
from app.models.paper import Paper, TopicSummary
from app.services.fetcher import fetch_papers_for_month
from app.services.scorer import score_papers_for_month
from app.services.topics import extract_topics_for_month

router = APIRouter(prefix="/api", tags=["papers"])


def _paper_to_dict(p: Paper) -> dict:
    """Convert a Paper DB row to a JSON-serialisable dict for the frontend."""
    return {
        "id": p.id,
        "arxiv_id": p.arxiv_id,
        "title": p.title,
        "abstract": p.abstract[:400] + "..." if len(p.abstract) > 400 else p.abstract,
        "authors": json.loads(p.authors),        # decode JSON string → list
        "categories": json.loads(p.categories),  # decode JSON string → list
        "published": p.published.isoformat(),    # datetime → string for JSON
        "month_key": p.month_key,
        "url": p.url,
        "pdf_url": p.pdf_url,
        "trend_score": p.trend_score,
        "citation_count": p.citation_count,
        "topic_label": p.topic_label,
        "topic_id": p.topic_id,
    }


@router.get("/papers")
def get_papers(
    month: str = Query(...),
    topic: Optional[str] = Query(None),
    limit: int = Query(20, le=100),
    offset: int = Query(0),
    session: Session = Depends(get_session),
):
    """GET /api/papers?month=2024-06&topic=...&limit=20 — returns ranked papers."""
    query = select(Paper).where(Paper.month_key == month)
    if topic:
        query = query.where(Paper.topic_label == topic)
    query = query.order_by(Paper.trend_score.desc()).offset(offset).limit(limit)
    papers = session.exec(query).all()
    total = session.exec(select(Paper).where(Paper.month_key == month)).all()
    return {"month": month, "total": len(total), "papers": [_paper_to_dict(p) for p in papers]}


@router.get("/topics")
def get_topics(month: str = Query(...), session: Session = Depends(get_session)):
    """GET /api/topics?month=2024-06 — returns topic clusters for the month."""
    topics = session.exec(
        select(TopicSummary).where(TopicSummary.month_key == month)
        .order_by(TopicSummary.avg_score.desc())
    ).all()
    return {"month": month, "topics": [
        {"id": t.topic_id, "label": t.topic_label, "paper_count": t.paper_count,
         "avg_score": t.avg_score, "top_paper_ids": json.loads(t.top_paper_ids)}
        for t in topics
    ]}


@router.get("/months")
def get_available_months(session: Session = Depends(get_session)):
    """GET /api/months — returns all months that have data."""
    papers = session.exec(select(Paper.month_key).distinct()).all()
    return {"months": sorted(set(papers), reverse=True)}


@router.get("/search")
def search_papers(
    q: str = Query(..., min_length=2),
    month: Optional[str] = Query(None),
    limit: int = Query(20, le=50),
    session: Session = Depends(get_session),
):
    """GET /api/search?q=attention — keyword search across titles and abstracts."""
    query = select(Paper).where(Paper.title.contains(q) | Paper.abstract.contains(q))
    if month:
        query = query.where(Paper.month_key == month)
    papers = session.exec(query.order_by(Paper.trend_score.desc()).limit(limit)).all()
    return {"query": q, "papers": [_paper_to_dict(p) for p in papers]}


def _run_pipeline(month_key: str, session: Session):
    """Run all 3 pipeline steps in sequence."""
    fetch_papers_for_month(month_key, session)
    score_papers_for_month(month_key, session)
    extract_topics_for_month(month_key, session)


@router.post("/ingest")
def ingest_month(
    month: str = Query(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    session: Session = Depends(get_session),
):
    """POST /api/ingest?month=2024-06 — starts fetching in background, returns immediately."""
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM format")
    background_tasks.add_task(_run_pipeline, month, session)
    return {"status": "ingestion started", "month": month}


@router.get("/stats")
def get_stats(session: Session = Depends(get_session)):
    """GET /api/stats — overall database statistics shown in the header."""
    all_papers = session.exec(select(Paper)).all()
    months = list(set(p.month_key for p in all_papers))
    return {
        "total_papers": len(all_papers),
        "months_indexed": sorted(months, reverse=True),
        "top_topics": list(set(p.topic_label for p in all_papers if p.topic_label))[:10],
    }
EOF

# ── backend/app/main.py ──────────────────────────────────────────────────────
cat > backend/app/main.py << 'EOF'
# Entry point for the backend server.
# Start with: uvicorn app.main:app --reload

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.init_db import create_db
from app.api.papers import router as papers_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db()  # create DB tables on startup if they don't exist
    yield


app = FastAPI(title="ArXiv ML Trends API", lifespan=lifespan)

# CORS: allows the frontend (localhost:3000) to call this backend (localhost:8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.github.dev", "https://*.app.github.dev"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(papers_router)

@app.get("/")
def root():
    return {"message": "ArXiv ML Trends API", "docs": "/docs"}
EOF

echo "Creating frontend files..."

# ── frontend/package.json ────────────────────────────────────────────────────
cat > frontend/package.json << 'EOF'
{
  "name": "arxiv-trends-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.2.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "typescript": "^5",
    "tailwindcss": "^3.4.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38"
  }
}
EOF

# ── frontend/next.config.js ──────────────────────────────────────────────────
cat > frontend/next.config.js << 'EOF'
// Proxies /api/* requests from the frontend to the backend on port 8000
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://localhost:8000/api/:path*" }];
  },
};
module.exports = nextConfig;
EOF

# ── frontend/tailwind.config.js ──────────────────────────────────────────────
cat > frontend/tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["'JetBrains Mono'", "monospace"] },
      colors: {
        ink: { 950:"#0a0a0f", 900:"#111118", 800:"#1a1a24", 700:"#252530", 600:"#363645", 400:"#888899", 300:"#aaaacc" },
        accent: { DEFAULT:"#7c6af7", light:"#a89cf9", dim:"#3d3578" },
        signal: "#4ade80",
        warm: "#f97316",
      },
    },
  },
  plugins: [],
};
EOF

# ── frontend/postcss.config.js ───────────────────────────────────────────────
cat > frontend/postcss.config.js << 'EOF'
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
EOF

# ── frontend/tsconfig.json ───────────────────────────────────────────────────
cat > frontend/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "es5", "lib": ["dom","dom.iterable","esnext"], "allowJs": true,
    "skipLibCheck": true, "strict": true, "noEmit": true, "esModuleInterop": true,
    "module": "esnext", "moduleResolution": "bundler", "resolveJsonModule": true,
    "isolatedModules": true, "jsx": "preserve", "incremental": true,
    "plugins": [{"name":"next"}], "paths": {"@/*": ["./src/*"]}
  },
  "include": ["next-env.d.ts","**/*.ts","**/*.tsx",".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
EOF

# ── frontend/src/app/globals.css ─────────────────────────────────────────────
cat > frontend/src/app/globals.css << 'EOF'
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Inter:wght@300;400;500;600&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

* { box-sizing: border-box; }
body { background: #0a0a0f; color: #e2e2ee; font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: #111118; }
::-webkit-scrollbar-thumb { background: #363645; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #7c6af7; }
@layer utilities {
  .card-hover { transition: border-color 0.15s ease, transform 0.15s ease; }
  .card-hover:hover { border-color: #7c6af7; transform: translateY(-1px); }
}
EOF

# ── frontend/src/app/layout.tsx ──────────────────────────────────────────────
cat > frontend/src/app/layout.tsx << 'EOF'
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArXiv ML Trends",
  description: "Discover trending machine learning papers by month and topic",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink-950">{children}</body>
    </html>
  );
}
EOF

# ── frontend/src/lib/api.ts ──────────────────────────────────────────────────
cat > frontend/src/lib/api.ts << 'EOF'
// All functions for calling the backend API.
// Each function = one endpoint.

const API = process.env.NEXT_PUBLIC_API_URL || "";

export interface Paper {
  id: number; arxiv_id: string; title: string; abstract: string;
  authors: string[]; categories: string[]; published: string;
  month_key: string; url: string; pdf_url: string;
  trend_score: number; citation_count: number;
  topic_label: string | null; topic_id: number | null;
}

export interface Topic {
  id: number; label: string; paper_count: number;
  avg_score: number; top_paper_ids: string[];
}

export async function fetchPapers(month: string, topic?: string, limit = 20, offset = 0) {
  const params = new URLSearchParams({ month, limit: String(limit), offset: String(offset) });
  if (topic) params.set("topic", topic);
  const r = await fetch(`${API}/api/papers?${params}`);
  if (!r.ok) throw new Error("Failed to fetch papers");
  return r.json() as Promise<{ month: string; total: number; papers: Paper[] }>;
}

export async function fetchTopics(month: string) {
  const r = await fetch(`${API}/api/topics?month=${month}`);
  if (!r.ok) throw new Error("Failed to fetch topics");
  return r.json() as Promise<{ month: string; topics: Topic[] }>;
}

export async function fetchMonths() {
  const r = await fetch(`${API}/api/months`);
  if (!r.ok) throw new Error("Failed to fetch months");
  return r.json() as Promise<{ months: string[] }>;
}

export async function searchPapers(q: string, month?: string) {
  const params = new URLSearchParams({ q });
  if (month) params.set("month", month);
  const r = await fetch(`${API}/api/search?${params}`);
  if (!r.ok) throw new Error("Search failed");
  return r.json() as Promise<{ query: string; papers: Paper[] }>;
}

export async function triggerIngest(month: string) {
  const r = await fetch(`${API}/api/ingest?month=${month}`, { method: "POST" });
  if (!r.ok) throw new Error("Ingest failed");
  return r.json();
}

export async function fetchStats() {
  const r = await fetch(`${API}/api/stats`);
  if (!r.ok) throw new Error("Stats failed");
  return r.json();
}

export function formatMonth(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

export function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
EOF

# ── frontend/src/app/page.tsx ────────────────────────────────────────────────
cat > frontend/src/app/page.tsx << 'EOF'
"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchPapers, fetchTopics, fetchMonths, searchPapers, triggerIngest, fetchStats, formatMonth, currentMonthKey, Paper, Topic } from "@/lib/api";

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score);
  const color = score > 70 ? "#4ade80" : score > 40 ? "#7c6af7" : "#f97316";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-ink-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{pct}</span>
    </div>
  );
}

const CAT_COLORS: Record<string, string> = { "cs.LG":"#7c6af7","cs.AI":"#a89cf9","cs.CL":"#4ade80","cs.CV":"#f97316","stat.ML":"#38bdf8" };
function CatBadge({ cat }: { cat: string }) {
  const c = CAT_COLORS[cat] || "#888";
  return <span className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: c+"22", color: c, border: `1px solid ${c}44` }}>{cat}</span>;
}

function PaperCard({ paper, rank }: { paper: Paper; rank: number }) {
  const [expanded, setExpanded] = useState(false);
  const authors = paper.authors.slice(0, 3).join(", ") + (paper.authors.length > 3 ? " et al." : "");
  const date = new Date(paper.published).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <div className="card-hover rounded-xl border border-ink-600 bg-ink-800 p-4 cursor-pointer" onClick={() => setExpanded(e => !e)}>
      <div className="flex gap-3">
        <span className="text-2xl font-mono font-light text-ink-600 w-8 shrink-0 pt-0.5">{String(rank).padStart(2, "0")}</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {paper.categories.slice(0, 3).map(c => <CatBadge key={c} cat={c} />)}
            {paper.topic_label && <span className="text-xs px-1.5 py-0.5 rounded bg-ink-700 text-ink-300 border border-ink-600">{paper.topic_label}</span>}
          </div>
          <h3 className="text-sm font-medium text-white leading-snug mb-1">{paper.title}</h3>
          <p className="text-xs text-ink-300 mb-2 truncate">{authors} · {date}</p>
          <ScoreBar score={paper.trend_score} />
          {expanded && (
            <div className="mt-3 pt-3 border-t border-ink-700">
              <p className="text-xs text-ink-300 leading-relaxed mb-3">{paper.abstract}</p>
              <div className="flex gap-2">
                <a href={paper.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-light transition-colors">Abstract</a>
                {paper.pdf_url && <a href={paper.pdf_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-xs px-3 py-1.5 rounded-lg border border-ink-600 text-ink-300 hover:border-accent hover:text-white transition-colors">PDF</a>}
                <span className="text-xs px-2 py-1.5 text-ink-400">{paper.citation_count} citations</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MonthPicker({ months, selected, onChange }: { months: string[]; selected: string; onChange: (m: string) => void }) {
  if (!months.length) return null;
  return (
    <div className="flex gap-2 flex-wrap">
      {months.map(m => (
        <button key={m} onClick={() => onChange(m)} className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-colors ${m === selected ? "bg-accent text-white" : "bg-ink-800 border border-ink-600 text-ink-300 hover:border-accent hover:text-white"}`}>
          {formatMonth(m)}
        </button>
      ))}
    </div>
  );
}

function TopicPills({ topics, selected, onChange }: { topics: Topic[]; selected: string | null; onChange: (t: string | null) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <button onClick={() => onChange(null)} className={`px-3 py-1 rounded-full text-xs font-mono transition-colors ${selected === null ? "bg-accent text-white" : "bg-ink-800 border border-ink-600 text-ink-400 hover:text-white"}`}>All topics</button>
      {topics.slice(0, 10).map(t => (
        <button key={t.id} onClick={() => onChange(t.label)} className={`px-3 py-1 rounded-full text-xs transition-colors ${selected === t.label ? "bg-accent text-white" : "bg-ink-800 border border-ink-600 text-ink-400 hover:text-white"}`}>
          {t.label}<span className="ml-1.5 opacity-60">{t.paper_count}</span>
        </button>
      ))}
    </div>
  );
}

function IngestPanel({ onDone }: { onDone: () => void }) {
  const [month, setMonth] = useState(currentMonthKey());
  const [status, setStatus] = useState<"idle"|"running"|"done"|"error">("idle");
  async function run() {
    setStatus("running");
    try { await triggerIngest(month); setStatus("done"); setTimeout(() => { setStatus("idle"); onDone(); }, 3000); }
    catch { setStatus("error"); }
  }
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-800 p-4">
      <h2 className="text-sm font-medium text-white mb-3">Fetch papers</h2>
      <p className="text-xs text-ink-400 mb-4">Ingests arXiv papers for a month, scores them, and extracts topics. Takes 2–5 minutes.</p>
      <div className="flex gap-2">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="flex-1 bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm text-white focus:border-accent outline-none font-mono" />
        <button onClick={run} disabled={status==="running"} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-light transition-colors disabled:opacity-50">
          {status==="running" ? "Fetching…" : status==="done" ? "Done ✓" : "Fetch"}
        </button>
      </div>
      {status==="running" && <p className="text-xs text-accent mt-2 font-mono animate-pulse">Fetching papers from arXiv → scoring → extracting topics…</p>}
      {status==="error" && <p className="text-xs text-red-400 mt-2">Something went wrong. Check the backend terminal.</p>}
    </div>
  );
}

export default function Home() {
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Paper[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"browse"|"ingest">("browse");
  const [stats, setStats] = useState<any>(null);

  const loadMonths = useCallback(async () => {
    const data = await fetchMonths();
    setMonths(data.months);
    if (data.months.length && !data.months.includes(selectedMonth)) setSelectedMonth(data.months[0]);
  }, [selectedMonth]);

  useEffect(() => { loadMonths(); fetchStats().then(setStats).catch(() => {}); }, []);
  useEffect(() => {
    if (!selectedMonth) return;
    fetchTopics(selectedMonth).then(d => setTopics(d.topics)).catch(() => setTopics([]));
    setSelectedTopic(null); setSearchResults(null); setSearchQ("");
  }, [selectedMonth]);
  useEffect(() => {
    if (!selectedMonth) return;
    setLoading(true);
    fetchPapers(selectedMonth, selectedTopic || undefined)
      .then(d => { setPapers(d.papers); setTotal(d.total); })
      .catch(() => setPapers([])).finally(() => setLoading(false));
  }, [selectedMonth, selectedTopic]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQ.trim()) { setSearchResults(null); return; }
    setLoading(true);
    const data = await searchPapers(searchQ, selectedMonth).catch(() => ({ papers: [] as Paper[], query: "" }));
    setSearchResults(data.papers); setLoading(false);
  }

  const displayPapers = searchResults ?? papers;

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="border-b border-ink-700 px-6 py-4 flex items-center justify-between sticky top-0 z-10 bg-ink-950/90 backdrop-blur-sm">
        <div>
          <h1 className="text-lg font-medium text-white tracking-tight"><span className="text-accent font-mono">arXiv</span> ML Trends</h1>
          <p className="text-xs text-ink-400">trending machine learning papers by month</p>
        </div>
        <div className="flex items-center gap-4">
          {stats && <span className="text-xs text-ink-400 font-mono hidden sm:block">{stats.total_papers.toLocaleString()} papers indexed</span>}
          <div className="flex rounded-lg border border-ink-600 overflow-hidden">
            {(["browse","ingest"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 text-xs capitalize transition-colors ${tab===t ? "bg-accent text-white" : "text-ink-400 hover:text-white"}`}>{t}</button>
            ))}
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {tab === "ingest" && (
          <div className="max-w-md">
            <IngestPanel onDone={() => { loadMonths(); setTab("browse"); }} />
            <div className="mt-4 rounded-xl border border-ink-600 bg-ink-800 p-4">
              <h3 className="text-sm font-medium text-white mb-2">How it works</h3>
              <ol className="text-xs text-ink-400 space-y-1.5 list-decimal list-inside">
                <li>Queries arXiv API for ML categories (cs.LG, cs.AI, cs.CL, cs.CV, stat.ML)</li>
                <li>Enriches each paper with citation data from Semantic Scholar</li>
                <li>Computes a trend score: citations + recency + keyword boost</li>
                <li>Runs TF-IDF + KMeans clustering to extract topic groups</li>
                <li>Stores everything in a local SQLite database</li>
              </ol>
            </div>
          </div>
        )}
        {tab === "browse" && (
          <>
            {months.length > 0 ? (
              <MonthPicker months={months} selected={selectedMonth} onChange={setSelectedMonth} />
            ) : (
              <div className="rounded-xl border border-ink-600 bg-ink-800 p-6 text-center">
                <p className="text-ink-400 text-sm mb-1">No data yet.</p>
                <p className="text-ink-500 text-xs">Go to the <button onClick={() => setTab("ingest")} className="text-accent underline">Fetch papers</button> tab to load your first month.</p>
              </div>
            )}
            {months.length > 0 && (
              <form onSubmit={handleSearch} className="flex gap-2">
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search titles and abstracts…" className="flex-1 bg-ink-800 border border-ink-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 focus:border-accent outline-none" />
                <button type="submit" className="px-4 py-2 rounded-xl bg-accent text-white text-sm hover:bg-accent-light transition-colors">Search</button>
                {searchResults && <button type="button" onClick={() => { setSearchResults(null); setSearchQ(""); }} className="px-3 py-2 rounded-xl border border-ink-600 text-ink-400 text-sm hover:text-white">✕</button>}
              </form>
            )}
            {topics.length > 0 && !searchResults && (
              <div>
                <p className="text-xs text-ink-500 mb-2 font-mono uppercase tracking-wider">Topics · {formatMonth(selectedMonth)}</p>
                <TopicPills topics={topics} selected={selectedTopic} onChange={setSelectedTopic} />
              </div>
            )}
            <div>
              {searchResults ? (
                <p className="text-xs text-ink-500 mb-3 font-mono">{searchResults.length} results for "{searchQ}"</p>
              ) : total > 0 && (
                <p className="text-xs text-ink-500 mb-3 font-mono">{total} papers · {selectedTopic ?? "all topics"} · sorted by trend score</p>
              )}
              {loading ? (
                <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-ink-800 border border-ink-700 animate-pulse" />)}</div>
              ) : displayPapers.length > 0 ? (
                <div className="space-y-3">{displayPapers.map((p, i) => <PaperCard key={p.arxiv_id} paper={p} rank={i + 1} />)}</div>
              ) : months.length > 0 ? (
                <div className="rounded-xl border border-ink-700 bg-ink-800 p-8 text-center">
                  <p className="text-ink-400 text-sm">No papers found.</p>
                  <p className="text-ink-500 text-xs mt-1">Try a different month or topic.</p>
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
EOF

# ── start.sh ─────────────────────────────────────────────────────────────────
cat > start.sh << 'EOF'
#!/bin/bash
# Run from the project root: bash start.sh
# Starts both servers. Press Ctrl+C to stop both.

echo "Starting ArXiv Trends..."

cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "Backend → http://localhost:8000"

cd ../frontend
npm run dev &
FRONTEND_PID=$!
echo "Frontend → http://localhost:3000"

echo "Press Ctrl+C to stop."
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo Stopped." INT TERM
wait
EOF

chmod +x start.sh

echo ""
echo "✅ All files created successfully!"
echo ""
echo "Next steps:"
echo "  1. cd backend && pip install -r requirements.txt"
echo "  2. cd ../frontend && npm install"
echo "  3. cd .. && bash start.sh"
echo "  4. Open http://localhost:3000"