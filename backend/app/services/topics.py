import json
import logging
from typing import List, Dict
from sqlmodel import Session, select
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
import numpy as np
from app.models.paper import Paper, TopicSummary

logger = logging.getLogger(__name__)
N_TOPICS = 12


def _top_terms(tfidf: TfidfVectorizer, cluster_center: np.ndarray, n: int = 5) -> List[str]:
    feature_names = tfidf.get_feature_names_out()
    top_idx = cluster_center.argsort()[-n:][::-1]
    return [feature_names[i] for i in top_idx]


def _make_label(terms: List[str]) -> str:
    return " · ".join(t.replace("_", " ").title() for t in terms[:3])


def extract_topics_for_month(month_key: str, session: Session) -> int:
    papers = session.exec(select(Paper).where(Paper.month_key == month_key)).all()

    if len(papers) < N_TOPICS:
        for p in papers:
            p.topic_id = 0
            p.topic_label = "Machine Learning"
            session.add(p)
        session.commit()
        return 1

    abstracts = [p.abstract for p in papers]

    vectorizer = TfidfVectorizer(
        max_features=2000,
        ngram_range=(1, 2),
        stop_words="english",
        min_df=2
    )
    X = vectorizer.fit_transform(abstracts)

    n_clusters = min(N_TOPICS, len(papers) // 5)
    km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = km.fit_predict(X)

    topic_labels: Dict[int, str] = {}
    for cid in range(n_clusters):
        terms = _top_terms(vectorizer, km.cluster_centers_[cid])
        topic_labels[cid] = _make_label(terms)

    for paper, cid in zip(papers, labels):
        paper.topic_id = int(cid)
        paper.topic_label = topic_labels[cid]
        session.add(paper)

    for old in session.exec(
        select(TopicSummary).where(TopicSummary.month_key == month_key)
    ).all():
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
