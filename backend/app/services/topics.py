# =============================================================================
# FILE: backend/app/services/topics.py
# PURPOSE: Groups papers into topic clusters using machine learning.
#          This is STEP 3 of the pipeline:
#          database (scored papers) → topics.py → database (topic_label updated)
#
# HOW IT WORKS (plain English):
#   1. Take all paper abstracts for a month
#   2. Convert each abstract into a vector of numbers using TF-IDF
#      (TF-IDF measures which words are important in each abstract)
#   3. Run KMeans to group similar vectors into 12 clusters
#   4. Label each cluster by its most distinctive words
#   5. Assign each paper to its cluster and save the label
#
# RESULT: Papers are grouped into topics like:
#   "Diffusion · Image · Generation" or "Language · Instruction · Tuning"
# =============================================================================

import json
import logging
import re
from typing import List, Dict
from sqlmodel import Session, select

# scikit-learn: Python's most popular ML library
# TfidfVectorizer: converts text → numerical vectors
# KMeans: clusters similar vectors together
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
import numpy as np  # for array operations on cluster centres

from app.models.paper import Paper, TopicSummary

logger = logging.getLogger(__name__)

# How many topic clusters to create per month.
# 12 gives a good balance — broad enough to cover all ML subfields,
# specific enough to be useful filters.
N_TOPICS = 12

# Words to ignore when building topic labels — these appear in almost every
# ML paper abstract so they don't help distinguish topics
STOP_WORDS = [
    "paper", "propose", "show", "model", "method", "approach", "use",
    "result", "task", "dataset", "performance", "training", "based",
    "using", "also", "work", "achieve", "state", "art", "new", "large",
    "learn", "network", "deep", "neural", "data", "experiment",
]


# -----------------------------------------------------------------------------
# HELPER: Get the top N terms from a cluster centroid
# The centroid is an average of all TF-IDF vectors in the cluster.
# The terms with the highest values in the centroid = most distinctive words.
# -----------------------------------------------------------------------------
def _top_terms(tfidf: TfidfVectorizer, cluster_center: np.ndarray, n: int = 5) -> List[str]:
    """Return the n most distinctive terms for a cluster."""
    # get_feature_names_out() returns the list of all words/phrases the
    # vectorizer knows about (up to 2000 in our config)
    feature_names = tfidf.get_feature_names_out()

    # argsort() returns indices that would sort the array smallest-to-largest
    # [-n:] takes the last n (the highest values)
    # [::-1] reverses to get highest-first
    top_idx = cluster_center.argsort()[-n:][::-1]

    # Map indices back to actual words
    return [feature_names[i] for i in top_idx]


# -----------------------------------------------------------------------------
# HELPER: Turn a list of terms into a readable label
# e.g. ["diffusion", "image", "generation"] → "Diffusion · Image · Generation"
# -----------------------------------------------------------------------------
def _make_label(terms: List[str]) -> str:
    """Create a human-readable topic label from the top 3 TF-IDF terms."""
    return " · ".join(
        t.replace("_", " ").title()   # "vision_language" → "Vision Language"
        for t in terms[:3]            # only use top 3 terms
    )


# -----------------------------------------------------------------------------
# MAIN FUNCTION: Extract topics for all papers in a month
# -----------------------------------------------------------------------------
def extract_topics_for_month(month_key: str, session: Session) -> int:
    """
    Run TF-IDF + KMeans clustering on paper abstracts for a month.
    Assigns a topic_id and topic_label to each paper.
    Creates TopicSummary rows for the UI topic filter.

    Returns: number of clusters created
    """

    # ── STEP 1: Load all papers for this month ───────────────────────────────
    papers = session.exec(
        select(Paper).where(Paper.month_key == month_key)
    ).all()

    # Edge case: if we have fewer papers than N_TOPICS, KMeans would fail
    # (you can't have 12 clusters with only 5 papers)
    if len(papers) < N_TOPICS:
        logger.warning(f"Too few papers ({len(papers)}) for topic extraction in {month_key}")
        # Assign everything to one fallback topic
        for p in papers:
            p.topic_id = 0
            p.topic_label = "Machine Learning"
            session.add(p)
        session.commit()
        return 1

    # ── STEP 2: Convert abstracts to TF-IDF vectors ──────────────────────────
    abstracts = [p.abstract for p in papers]

    vectorizer = TfidfVectorizer(
        max_features=2000,      # keep only the 2000 most important words
        ngram_range=(1, 2),     # consider single words AND two-word phrases
                                # e.g. "large" and "large model" are separate features
        stop_words="english",   # ignore common English words (the, is, are...)
        min_df=2,               # ignore words that appear in fewer than 2 abstracts
                                # (very rare words don't help find patterns)
    )

    # fit_transform does two things:
    # 1. "fit": learn the vocabulary from all abstracts
    # 2. "transform": convert each abstract to a TF-IDF vector
    # X is a sparse matrix: shape = (num_papers × 2000)
    X = vectorizer.fit_transform(abstracts)

    # ── STEP 3: Run KMeans clustering ────────────────────────────────────────
    # Decide how many clusters to actually use:
    # - At most N_TOPICS (12)
    # - At most 1 cluster per 5 papers (so small months get fewer clusters)
    n_clusters = min(N_TOPICS, len(papers) // 5)

    km = KMeans(
        n_clusters=n_clusters,
        random_state=42,   # makes results reproducible (same seed = same clusters)
        n_init=10,         # run 10 times with different starting points, keep best
    )

    # fit_predict: run KMeans and return which cluster each paper belongs to
    # labels is an array like [0, 2, 1, 0, 3, 2, ...] — one number per paper
    labels = km.fit_predict(X)

    # ── STEP 4: Build human-readable labels for each cluster ─────────────────
    # km.cluster_centers_ is an array with one row per cluster
    # Each row is the "average" TF-IDF vector of papers in that cluster
    topic_labels: Dict[int, str] = {}
    for cluster_id in range(n_clusters):
        terms = _top_terms(vectorizer, km.cluster_centers_[cluster_id])
        topic_labels[cluster_id] = _make_label(terms)

    # ── STEP 5: Assign topic labels to each paper ────────────────────────────
    # zip(papers, labels) pairs each paper with its cluster number
    for paper, cluster_id in zip(papers, labels):
        paper.topic_id = int(cluster_id)                    # e.g. 3
        paper.topic_label = topic_labels[cluster_id]        # e.g. "Diffusion · Image · Generation"
        session.add(paper)

    # ── STEP 6: Delete old TopicSummary rows and create new ones ─────────────
    # We delete first in case we're re-running for a month we already processed
    old = session.exec(
        select(TopicSummary).where(TopicSummary.month_key == month_key)
    ).all()
    for o in old:
        session.delete(o)

    # Create one TopicSummary per cluster
    for cluster_id in range(n_clusters):
        # Get all papers in this cluster
        cluster_papers = [p for p, l in zip(papers, labels) if l == cluster_id]
        if not cluster_papers:
            continue  # skip empty clusters (rare but possible)

        # Average trend score across all papers in the cluster
        avg_score = sum(p.trend_score for p in cluster_papers) / len(cluster_papers)

        # Top 5 papers by trend score (these appear when you click the topic pill)
        top_ids = sorted(cluster_papers, key=lambda p: p.trend_score, reverse=True)[:5]

        summary = TopicSummary(
            month_key=month_key,
            topic_label=topic_labels[cluster_id],
            topic_id=cluster_id,
            paper_count=len(cluster_papers),
            avg_score=round(avg_score, 2),
            top_paper_ids=json.dumps([p.arxiv_id for p in top_ids]),
        )
        session.add(summary)

    # Write everything to the database at once
    session.commit()
    logger.info(f"Extracted {n_clusters} topics for {month_key}")
    return n_clusters