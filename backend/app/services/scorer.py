import httpx
import logging
from datetime import datetime, timezone
from sqlmodel import Session, select
from app.models.paper import Paper

logger = logging.getLogger(__name__)
SEMANTIC_SCHOLAR_URL = "https://api.semanticscholar.org/graph/v1/paper"


async def enrich_with_citations(papers, session):
    async with httpx.AsyncClient(timeout=10) as client:
        for paper in papers:
            try:
                arxiv_id = paper.arxiv_id.split("v")[0]
                url = f"{SEMANTIC_SCHOLAR_URL}/arXiv:{arxiv_id}"
                r = await client.get(url, params={"fields": "citationCount,influentialCitationCount"})
                if r.status_code == 200:
                    data = r.json()
                    paper.citation_count = data.get("citationCount", 0) or 0
                    paper.citation_velocity = float(data.get("influentialCitationCount", 0) or 0)
            except Exception as e:
                logger.debug(f"Could not enrich {paper.arxiv_id}: {e}")


def compute_trend_score(paper: Paper) -> float:
    now = datetime.now(timezone.utc)
    published = paper.published
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)

    days_old = max((now - published).days, 1)
    recency = max(0.0, 1.0 - (days_old / 365.0))

    hot_keywords = [
        "large language model", "llm", "transformer", "diffusion",
        "reinforcement learning from human feedback", "rlhf", "lora",
        "chain-of-thought", "in-context learning", "foundation model",
        "instruction tuning", "vision language", "multimodal", "alignment",
        "agent", "reasoning", "neural scaling", "mixture of experts",
        "speech recognition", "text to speech", "speaker", "audio",
        "whisper", "wav2vec", "hubert", "voice",
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
    papers = session.exec(select(Paper).where(Paper.month_key == month_key)).all()
    if not papers:
        logger.warning(f"No papers found for {month_key}")
        return

    raw_scores = [compute_trend_score(p) for p in papers]
    min_s, max_s = min(raw_scores), max(raw_scores)
    span = max(max_s - min_s, 1e-9)

    for paper, raw in zip(papers, raw_scores):
        paper.trend_score = round((raw - min_s) / span * 100, 2)
        session.add(paper)

    session.commit()
    logger.info(f"Scored {len(papers)} papers for {month_key}")
