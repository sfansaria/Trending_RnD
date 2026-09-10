# Trending RnD

A full-stack web application for discovering and tracking trending machine learning research papers. Fetches papers from arXiv, scores them by trendiness, clusters them into topics automatically, and lets you browse, search, sort, save, and cite papers — all in one place.

---

## Running the App

This project is self-hosted via Docker Compose (no external hosting service is required.
For [Deployment](#deployment) see below to run it yourself.

---

## Features

- **Fetch papers by month** — pulls up to 300 ML papers from arXiv across 5 categories
- **Trend scoring** — ranks papers using citation velocity, recency, and keyword signals
- **Topic clustering** — groups papers into readable topics using TF-IDF + KMeans (e.g. "Diffusion · Image · Generation")
- **Browse by month** — month picker shows only months with data
- **Filter by topic** — click any topic pill to filter the paper list
- **Sort options** — sort by trend score, citation count, or publish date
- **Keyword search** — search across titles and abstracts
- **Save papers** — bookmark papers with a star, view them in a dedicated Saved tab
- **Copy citation** — copy a BibTeX citation or shareable arXiv link to clipboard
- **Persistent storage** — all data stored in PostgreSQL (cloud) or SQLite (local)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 18, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.11, Uvicorn |
| Database | PostgreSQL (production), SQLite (development) |
| ORM | SQLModel |
| ML / NLP | scikit-learn (TF-IDF, KMeans), numpy |
| Paper data | arXiv Python library |
| Citation data | Semantic Scholar API |
| Deployment | Docker (self-hosted |

---

## Project Structure

```
Trending_RnD/
├── start.sh                          # starts both servers locally
├── README.md
├── .gitignore
|-- docker-compose.yml
containers
├── backend/
│   ├── requirements.txt              # Python dependencies
│   ├── Dockerfile                    # backend container build
│   ├── arxiv_trends.db               # local SQLite database (not committed)
│   └── app/
│       ├── main.py                   # FastAPI entry point + CORS
│       ├── core/
│       │   └── init_db.py            # database engine + session factory
│       ├── models/
│       │   └── paper.py              # Paper, TopicSummary, SavedPaper tables
│       ├── services/
│       │   ├── fetcher.py            # fetches papers from arXiv API
│       │   ├── scorer.py             # computes trend scores
│       │   └── topics.py             # TF-IDF + KMeans topic clustering
│       └── api/
│           └── papers.py             # all REST endpoints
└── frontend/
    ├── package.json
    |-- Dockerfile                    # frontend container build
    ├── next.config.js                # proxies /api/* to backend in development
    ├── tailwind.config.js            # custom colours and fonts
    ├── postcss.config.js             # runs Tailwind and Autoprefixer
    └── src/
        ├── app/
        │   ├── layout.tsx            # root layout: title, fonts, dark background
        │   ├── globals.css           # global styles
        │   └── page.tsx              # entire UI: all components in one file
        └── lib/
            └── api.ts                # typed functions for every backend endpoint
```

---

## Getting Started Locally

### Prerequisites

Python 3.11 and Node 20. Recommended setup on Mac without admin rights:

```bash
conda create -n rnd-trends python=3.11 nodejs=20 -c conda-forge
conda activate rnd-trends
```

### Install dependencies

```bash
# Python packages
cd backend
pip install -r requirements.txt

# Node packages
cd ../frontend
npm install
```

### Run the app

```bash
# From the project root
bash start.sh
```

Opens:
- Frontend at `http://localhost:3000`
- Backend at `http://localhost:8000`
- API docs at `http://localhost:8000/docs`

### If port 8000 is already in use

```bash
lsof -ti:8000 | xargs kill -9
bash start.sh
```

---

## How to Use

### Fetch papers
1. Click the **ingest** tab
2. Pick a month (e.g. `2025-04`)
3. Click **Fetch** — wait 2-5 minutes
4. Switch to **browse** — papers appear

### Browse and filter
- Click a **month button** to switch months
- Click a **topic pill** to filter by topic cluster
- Use the **sort by** dropdown to sort by trend score, citations, or publish date
- Click any **paper card** to expand the abstract

### Save papers
- Click the **star (☆)** on any card to bookmark it
- Click **saved (N)** in the header to view bookmarks
- Click the star again to remove a bookmark

### Search
- Type in the search bar and press **Search**
- Searches titles and abstracts within the selected month
- Click **X** to clear

### Copy citation or link
- Expand any paper card
- Click **BibTeX** to copy a formatted academic citation
- Click **Copy Link** to copy the arXiv URL

---

## Pipeline

When you click Fetch, three steps run in the background:

```
arXiv API → fetcher.py → scorer.py → topics.py → database
```

**Step 1 — Fetch** (`fetcher.py`)
Queries arXiv across `cs.LG`, `cs.AI`, `cs.CL`, `cs.CV`, `stat.ML` for the requested month. Stores up to 300 papers. Skips duplicates.

**Step 2 — Score** (`scorer.py`)
Computes a trend score for each paper:
- 40% citation velocity (influential citations from Semantic Scholar)
- 30% recency (newer = higher, decays over 365 days)
- 20% total citation count
- 10% keyword boost (abstract mentions hot terms like "LoRA", "diffusion", "RLHF")

Scores are normalised to 0-100 within each month.

**Step 3 — Topics** (`topics.py`)
Runs TF-IDF vectorisation on all abstracts then KMeans clustering into up to 12 groups. Labels each cluster from its top 3 terms. Creates TopicSummary rows for the UI filter pills.

---

## API Endpoints

Interactive docs at `/docs`. All endpoints:

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/papers?month=&topic=&sort=&limit=&offset=` | Ranked papers for a month |
| GET | `/api/topics?month=` | Topic clusters for a month |
| GET | `/api/months` | All months that have data |
| GET | `/api/search?q=&month=` | Keyword search |
| POST | `/api/ingest?month=` | Start fetching papers in background |
| GET | `/api/saved` | All bookmarked papers |
| POST | `/api/saved/{arxiv_id}` | Bookmark a paper |
| DELETE | `/api/saved/{arxiv_id}` | Remove a bookmark |
| GET | `/api/stats` | Total paper count and indexed months |

---

## Database

Three tables:

**`paper`** — one row per arXiv paper. Stores title, abstract, authors, categories, publish date, trend score, citation counts, and topic assignment.

**`topicsummary`** — one row per topic cluster per month. Powers the topic filter pills in the UI.

**`savedpaper`** — one row per bookmarked paper. Powers the Saved tab.

### Reset the local database

```bash
cd backend
rm arxiv_trends.db
python -m app.core.init_db
```

---

## Deployment

This project runs entirely via Docker Compose — Postgres, the FastAPI backend, and the Next.js frontend all run as containers.
No external services (Supabase, Vercel, Render) are required.

Requirements

- Docker installed and running

## Quick start

- git clone https://github.com/sfansaria/Trending_RnD.git
- cd Trending_RnD
- docker compose up -d --build

This starts three containers:

postgres -> Database -> internal only
backend	-> FastAPI (API) -> http://localhost:8000
frontend ->	Next.js (UI) ->	http://localhost:3000

- Open http://localhost:3000 once all three containers report Up.

- For checking container status
  docker compose ps
- For Viewing logs
  docker compose logs backend --tail=50
  docker compose logs frontend --tail=50

- Deploying publicly (e.g. on a Raspberry Pi)

- If deploying somewhere reachable from outside the local network, 
  update NEXT_PUBLIC_API_URL under the frontend service's build.args 
  in docker-compose.yml to the real public URL (it must be set at build time, 
  since Next.js bakes it into the compiled JS). Then rebuild using - docker compose up -d --build frontend

- A production Caddyfile for automatic HTTPS is planned - see project roadmap.

- Environment variables
  The backend reads DATABASE_URL from the environment (set automatically by docker-compose.yml for the containerized Postgres). 
  No manual .env file is needed for local Docker use.


PASTED


---

## Roadmap

- [x] Fetch papers from arXiv by month
- [x] Trend scoring
- [x] Topic clustering
- [x] Browse, search, filter, sort
- [x] Save / bookmark papers
- [x] Copy BibTeX citation and share link
- [ ] Topic heatmap across months
- [ ] A production Caddyfile for automatic HTTPS 
- [ ] Auto-fetch on nightly schedule
- [ ] Weekly email digest via Brevo
- [ ] Author leaderboard
- [ ] GitHub stars signal via Papers With Code
- [ ] Semantic search with sentence-transformers
- [ ] User login and per-user bookmarks


---

## Development Notes

**Local vs Docker database** — running directly with `start.sh` uses `arxiv_trends.db` (SQLite). 
                               Running via Docker Compose uses PostgreSQL in the `postgres` container instead, 
                               connected via the `DATABASE_URL` environment variable. The two are independent.

**Adding features** — build and test locally, 
                      then rebuild the relevant container:`docker compose up -d --build backend` or `docker compose up -d --build frontend`.

---

## Author

Built by [@sfansaria](https://github.com/sfansaria)
