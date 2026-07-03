# Trending_RnD

Discover machine learning papers by month, topic, and trend strength. This app fetches papers from arXiv, enriches them with ranking signals, extracts monthly topics, and helps users explore what was trending in ML during any month of the year.

# Overview 
Machine learning research moves fast, and it is hard to keep track of what topics are rising each month. This project builds a searchable and browsable interface over ML papers so users can see the most relevant papers for a given month and topic.

The app combines:

- arXiv paper metadata and abstracts.
- Citation-based signals from Semantic Scholar.
- Automated monthly topic clustering.
- A ranked paper feed and topic heatmap

Features: 
- Browse ML papers by month.
- Filter papers by topic, category, or keyword.
- See trending topics for each month.
- Rank papers using a composite trend score.
- Search papers using semantic similarity.
- View paper details, abstracts, and external links.


# How it works: 

The backend pulls papers from arXiv using the public API, which supports queries by category, title, abstract, and date-related filtering through search terms and query parameters. The system then enriches each paper with citation metadata from Semantic Scholar and stores it in a database for faster querying.

For topic discovery, the app clusters abstracts by month using a lightweight topic modeling approach such as BERTopic or LDA. This makes it possible to surface monthly themes like transformers, diffusion models, LoRA, or retrieval-augmented generation without manual labeling.

# Trend scoring

Each paper gets a trend score based on a weighted combination of signals such as recency, citation velocity, and other engagement or relevance metrics. A simple formula looks like this:

# score = 0.4 * citation_velocity + 0.3 * social_mentions + 0.2 * recency + 0.1 * downloads

This ranking helps surface papers that are both recent and influential rather than only newest or only most cited.


#Tech stack recommendation
For a quick build: Next.js frontend, a Python FastAPI backend, PostgreSQL with a papers table, and a cron job using arxiv + semanticscholar Python libraries. 
The arXiv API is free and requires no key; Semantic Scholar's free tier allows 100 requests/second.
