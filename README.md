##Trending RnD

A local web app that pulls machine learning research papers from arXiv, scores them by how trending they are, groups them into topic clusters, and lets you browse, search, sort, and save papers — all running on your own machine with no paid APIs or accounts required.

---

## What it does

- Fetches ML papers from arXiv across five categories: `cs.LG`, `cs.AI`, `cs.CL`, `cs.CV`, `stat.ML`
- Scores every paper using a trend formula: citation velocity + recency + citation count + keyword boost
- Groups papers into topic clusters automatically using TF-IDF + KMeans (e.g. "Diffusion · Image · Generation")
- Lets you browse papers by month, filter by topic, sort by different criteria, and search by keyword
- Lets you bookmark papers and view them in a dedicated Saved tab
- Stores everything locally in a SQLite database — no cloud, no accounts

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.11 |
| Database | SQLite via SQLModel |
| ML / scoring | scikit-learn (TF-IDF, KMeans), numpy |
| Paper data | arXiv Python library (free, no key needed) |
| Citation data | Semantic Scholar API (free, no key needed) |

---

## Project structure

```
Trending_RnD/
├── start.sh                          # starts both servers in one command
├── backend/
│   ├── requirements.txt              # Python dependencies
│   ├── arxiv_trends.db               # SQLite database (auto-created)
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
    ├── next.config.js                # proxies /api/* to backend port 8000
    ├── tailwind.config.js            # custom colours and fonts
    ├── postcss.config.js             # runs Tailwind and Autoprefixer
    └── src/
        ├── app/
        │   ├── layout.tsx            # root shell: fonts, dark background, tab title
        │   ├── globals.css           # global styles and card hover animation
        │   └── page.tsx              # entire UI: all components in one file
        └── lib/
            └── api.ts                # typed functions for every backend endpoint
```

---

## Getting started

### Prerequisites

You need Python 3.11 and Node 20. The recommended way on a Mac without admin rights is Conda:

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
cd ~/Downloads/Trending_RnD
bash start.sh
```

This starts both servers:
- Frontend at `http://localhost:3000`
- Backend at `http://localhost:8000`

Open `http://localhost:3000` in your browser.

### If port 8000 is already in use

```bash
lsof -ti:8000 | xargs kill -9
bash start.sh
```

---

## How to use it

### Fetching papers

1. Click the **ingest** tab in the top right
2. Pick a month using the date picker (e.g. `2025-04`)
3. Click **Fetch**
4. Wait 2–5 minutes while the pipeline runs
5. Switch to **browse** — papers appear automatically

### Browsing

- Click any **month button** to switch months
- Click a **topic pill** to filter papers by that cluster
- Click any **paper card** to expand the abstract and see links to the arXiv page and PDF

### Sorting

Use the **sort by** dropdown above the paper list to switch between:
- **trend score** — default, highest composite score first
- **citations** — most cited papers first
- **publish date** — most recently published first

The sort applies instantly and re-fetches from the backend — no page reload needed.

### Saving papers

- Click the **star (☆)** on any paper card to bookmark it
- The star turns orange (★) and the paper is saved to the database
- Click **saved (N)** in the tab bar to see all your saved papers
- Click the star again on any saved paper to remove it
- Saved papers persist across restarts — they are stored in `arxiv_trends.db`

### Searching

- Type in the search bar and press **Search** (or Enter)
- Searches across paper titles and abstracts within the selected month
- Click **X** to clear the search and return to the full list

---

## API endpoints

The backend exposes these endpoints (interactive docs at `http://localhost:8000/docs`):

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/papers?month=&topic=&sort=&limit=&offset=` | Ranked papers for a month |
| GET | `/api/topics?month=` | Topic clusters for a month |
| GET | `/api/months` | All months that have data |
| GET | `/api/search?q=&month=` | Keyword search across papers |
| POST | `/api/ingest?month=` | Start fetching papers in background |
| GET | `/api/saved` | All bookmarked papers |
| POST | `/api/saved/{arxiv_id}` | Bookmark a paper |
| DELETE | `/api/saved/{arxiv_id}` | Remove a bookmark |
| GET | `/api/stats` | Total paper count and indexed months |

---

## How the pipeline works

When you click Fetch, three steps run in sequence in the background:

**Step 1 — Fetch** (`fetcher.py`)
Queries arXiv's public API for the requested month across all five ML categories. Stores up to 300 papers in SQLite. Skips papers already in the database.

**Step 2 — Score** (`scorer.py`)
Computes a raw trend score for each paper using:
- 40% citation velocity (influential citations from Semantic Scholar)
- 30% recency (newer papers score higher, decays over 365 days)
- 20% total citation count
- 10% keyword boost (abstract mentions hot terms like "LoRA", "diffusion", "chain-of-thought")

Scores are normalised to 0–100 within each month so papers from the same period are comparable.

**Step 3 — Topics** (`topics.py`)
Runs TF-IDF vectorisation on all abstracts, then KMeans clustering into up to 12 groups. Labels each cluster from its top 3 most distinctive terms (e.g. "Reasoning · Llms · Spatial"). Saves a topic label to every paper and creates TopicSummary rows for the UI filter pills.

---

## Features

### Implemented

- Fetch papers from arXiv by month
- Trend scoring (citations + recency + keywords)
- Automatic topic clustering with readable labels
- Browse by month with month picker
- Filter by topic cluster
- Sort by trend score, citation count, or publish date
- Keyword search across titles and abstracts
- Save / bookmark papers with persistent storage
- Saved papers tab with bookmark count in header
- Optimistic UI updates for star button (instant feedback)

### Planned

- Topic heatmap across months (topics × months grid)
- Auto-fetch on a nightly schedule
- Weekly email digest of top papers
- Author leaderboard (most active researchers per month)
- GitHub stars signal via Papers With Code
- Semantic search using sentence-transformers + pgvector
- AI-generated plain-English summaries via Claude API
- Citation graph visualisation

---

## Database

SQLite file lives at `backend/arxiv_trends.db`. Three tables:

**`paper`** — one row per arXiv paper. Stores title, abstract, authors, categories, publish date, trend score, citation counts, and topic assignment.

**`topicsummary`** — one row per topic cluster per month. Stores the label, paper count, average score, and top paper IDs. Powers the topic filter pills.

**`savedpaper`** — one row per bookmarked paper. Stores the arxiv_id and the timestamp when it was saved. Powers the Saved tab.

To reset the database:
```bash
cd backend
rm arxiv_trends.db
python -m app.core.init_db
```

This deletes all fetched papers and bookmarks. Re-fetch any month to restore papers.

---

## Development notes

**Hot reload** — both servers watch for file changes. Editing any Python file restarts the backend automatically. Editing any TypeScript/TSX file updates the frontend in the browser without a page reload.

**CORS** — the frontend proxies all `/api/*` requests to port 8000 via `next.config.js`, avoiding CORS issues in development. The backend also has explicit CORS headers in `main.py` for production deployments.

**No admin rights needed** — the entire stack runs in a Conda environment with no system-level installs required.
