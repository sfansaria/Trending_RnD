"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchPapers, fetchTopics, fetchMonths, searchPapers,
  triggerIngest, fetchStats, formatMonth, currentMonthKey,
  savePaper, unsavePaper, fetchSavedPapers, Paper, Topic
} from "@/lib/api";

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score);
  const color = score > 70 ? "#4ade80" : score > 40 ? "#7c6af7" : "#f97316";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-ink-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-xs font-mono" style={{ color }}>{pct}</span>
    </div>
  );
}

const CAT_COLORS: Record<string, string> = {
  "cs.LG": "#7c6af7",
  "cs.AI": "#a89cf9",
  "cs.CL": "#4ade80",
  "cs.CV": "#f97316",
  "stat.ML": "#38bdf8"
};

function CatBadge({ cat }: { cat: string }) {
  const c = CAT_COLORS[cat] || "#888";
  return (
    <span className="text-xs px-1.5 py-0.5 rounded font-mono"
      style={{ background: c + "22", color: c, border: `1px solid ${c}44` }}>
      {cat}
    </span>
  );
}

function PaperCard({ paper, rank, isSaved, onToggleSave }: {
  paper: Paper;
  rank: number;
  isSaved: boolean;
  onToggleSave: (arxivId: string, currentlySaved: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const authors = paper.authors.slice(0, 3).join(", ")
    + (paper.authors.length > 3 ? " et al." : "");
  const date = new Date(paper.published).toLocaleDateString("en-GB", {
    day: "numeric", month: "short"
  });

  return (
    <div
      className="card-hover rounded-xl border border-ink-600 bg-ink-800 p-4 cursor-pointer"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex gap-3">
        <span className="text-2xl font-mono font-light text-ink-600 w-8 shrink-0 pt-0.5">
          {String(rank).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex flex-wrap gap-1.5">
              {paper.categories.slice(0, 3).map(c => <CatBadge key={c} cat={c} />)}
              {paper.topic_label && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-ink-700 text-ink-300 border border-ink-600">
                  {paper.topic_label}
                </span>
              )}
            </div>
            <button
              onClick={e => { e.stopPropagation(); onToggleSave(paper.arxiv_id, isSaved); }}
              className="shrink-0 text-lg leading-none transition-colors"
              style={{ color: isSaved ? "#f97316" : "#363645" }}
              aria-label={isSaved ? "Remove bookmark" : "Save paper"}
            >
              {isSaved ? "★" : "☆"}
            </button>
          </div>
          <h3 className="text-sm font-medium text-white leading-snug mb-1">{paper.title}</h3>
          <p className="text-xs text-ink-300 mb-2 truncate">{authors} · {date}</p>
          <ScoreBar score={paper.trend_score} />
          {expanded && (
            <div className="mt-3 pt-3 border-t border-ink-700">
              <p className="text-xs text-ink-300 leading-relaxed mb-3">{paper.abstract}</p>
              <div className="flex gap-2">
                <a href={paper.url} target="_blank" rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-light transition-colors">
                  Abstract
                </a>
                {paper.pdf_url && (
                  <a href={paper.pdf_url} target="_blank" rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-xs px-3 py-1.5 rounded-lg border border-ink-600 text-ink-300 hover:border-accent hover:text-white transition-colors">
                    PDF
                  </a>
                )}
                <span className="text-xs px-2 py-1.5 text-ink-400">
                  {paper.citation_count} citations
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MonthPicker({ months, selected, onChange }: {
  months: string[];
  selected: string;
  onChange: (m: string) => void;
}) {
  if (!months.length) return null;
  return (
    <div className="flex gap-2 flex-wrap">
      {months.map(m => (
        <button key={m} onClick={() => onChange(m)}
          className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-colors ${
            m === selected
              ? "bg-accent text-white"
              : "bg-ink-800 border border-ink-600 text-ink-300 hover:border-accent hover:text-white"
          }`}>
          {formatMonth(m)}
        </button>
      ))}
    </div>
  );
}

function TopicPills({ topics, selected, onChange }: {
  topics: Topic[];
  selected: string | null;
  onChange: (t: string | null) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      <button onClick={() => onChange(null)}
        className={`px-3 py-1 rounded-full text-xs font-mono transition-colors ${
          selected === null
            ? "bg-accent text-white"
            : "bg-ink-800 border border-ink-600 text-ink-400 hover:text-white"
        }`}>
        All topics
      </button>
      {topics.slice(0, 10).map(t => (
        <button key={t.id} onClick={() => onChange(t.label)}
          className={`px-3 py-1 rounded-full text-xs transition-colors ${
            selected === t.label
              ? "bg-accent text-white"
              : "bg-ink-800 border border-ink-600 text-ink-400 hover:text-white"
          }`}>
          {t.label}
          <span className="ml-1.5 opacity-60">{t.paper_count}</span>
        </button>
      ))}
    </div>
  );
}

function IngestPanel({ onDone }: { onDone: () => void }) {
  const [month, setMonth] = useState(currentMonthKey());
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");

  async function run() {
    setStatus("running");
    try {
      await triggerIngest(month);
      setStatus("done");
      setTimeout(() => { setStatus("idle"); onDone(); }, 3000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-800 p-4">
      <h2 className="text-sm font-medium text-white mb-3">Fetch papers</h2>
      <p className="text-xs text-ink-400 mb-4">
        Ingests arXiv papers for a month, scores them, and extracts topics. Takes 2-5 minutes.
      </p>
      <div className="flex gap-2">
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="flex-1 bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm text-white focus:border-accent outline-none font-mono"
        />
        <button onClick={run} disabled={status === "running"}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-light transition-colors disabled:opacity-50">
          {status === "running" ? "Fetching..." : status === "done" ? "Done" : "Fetch"}
        </button>
      </div>
      {status === "running" && (
        <p className="text-xs text-accent mt-2 font-mono animate-pulse">
          Fetching papers from arXiv, scoring, extracting topics...
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-400 mt-2">Something went wrong. Check the backend terminal.</p>
      )}
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
  const [tab, setTab] = useState<"browse" | "ingest" | "saved">("browse");
  const [stats, setStats] = useState<any>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedPapers, setSavedPapers] = useState<Paper[]>([]);

  const loadMonths = useCallback(async () => {
    const data = await fetchMonths();
    setMonths(data.months);
    if (data.months.length && !data.months.includes(selectedMonth)) {
      setSelectedMonth(data.months[0]);
    }
  }, [selectedMonth]);

  const loadSaved = useCallback(async () => {
    const data = await fetchSavedPapers().catch(() => ({ total: 0, papers: [] as Paper[] }));
    setSavedPapers(data.papers);
    setSavedIds(new Set(data.papers.map(p => p.arxiv_id)));
  }, []);

  async function handleToggleSave(arxivId: string, currentlySaved: boolean) {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (currentlySaved) next.delete(arxivId); else next.add(arxivId);
      return next;
    });
    try {
      if (currentlySaved) await unsavePaper(arxivId);
      else await savePaper(arxivId);
      loadSaved();
    } catch {
      setSavedIds(prev => {
        const next = new Set(prev);
        if (currentlySaved) next.add(arxivId); else next.delete(arxivId);
        return next;
      });
    }
  }

  useEffect(() => {
    loadMonths();
    loadSaved();
    fetchStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    fetchTopics(selectedMonth).then(d => setTopics(d.topics)).catch(() => setTopics([]));
    setSelectedTopic(null);
    setSearchResults(null);
    setSearchQ("");
  }, [selectedMonth]);

  useEffect(() => {
    if (!selectedMonth) return;
    setLoading(true);
    fetchPapers(selectedMonth, selectedTopic || undefined)
      .then(d => { setPapers(d.papers); setTotal(d.total); })
      .catch(() => setPapers([]))
      .finally(() => setLoading(false));
  }, [selectedMonth, selectedTopic]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQ.trim()) { setSearchResults(null); return; }
    setLoading(true);
    const data = await searchPapers(searchQ, selectedMonth)
      .catch(() => ({ papers: [] as Paper[], query: "" }));
    setSearchResults(data.papers);
    setLoading(false);
  }

  const displayPapers = searchResults ?? papers;

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="border-b border-ink-700 px-6 py-4 flex items-center justify-between sticky top-0 z-10 bg-ink-950/90 backdrop-blur-sm">
        <div>
          <h1 className="text-lg font-medium text-white tracking-tight">
            <span className="text-accent font-mono">arXiv</span> ML Trends
          </h1>
          <p className="text-xs text-ink-400">trending machine learning papers by month</p>
        </div>
        <div className="flex items-center gap-4">
          {stats && (
            <span className="text-xs text-ink-400 font-mono hidden sm:block">
              {stats.total_papers.toLocaleString()} papers indexed
            </span>
          )}
          <div className="flex rounded-lg border border-ink-600 overflow-hidden">
            {(["browse", "saved", "ingest"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs capitalize transition-colors ${
                  tab === t ? "bg-accent text-white" : "text-ink-400 hover:text-white"
                }`}>
                {t === "saved" ? `saved (${savedIds.size})` : t}
              </button>
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

        {tab === "saved" && (
          <div>
            <p className="text-xs text-ink-500 mb-3 font-mono">
              {savedPapers.length} saved paper{savedPapers.length !== 1 ? "s" : ""}
            </p>
            {savedPapers.length > 0 ? (
              <div className="space-y-3">
                {savedPapers.map((p, i) => (
                  <PaperCard
                    key={p.arxiv_id}
                    paper={p}
                    rank={i + 1}
                    isSaved={true}
                    onToggleSave={handleToggleSave}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-ink-700 bg-ink-800 p-8 text-center">
                <p className="text-ink-400 text-sm">No saved papers yet.</p>
                <p className="text-ink-500 text-xs mt-1">
                  Click the star on any paper to save it here.
                </p>
              </div>
            )}
          </div>
        )}

        {tab === "browse" && (
          <>
            {months.length > 0 ? (
              <MonthPicker months={months} selected={selectedMonth} onChange={setSelectedMonth} />
            ) : (
              <div className="rounded-xl border border-ink-600 bg-ink-800 p-6 text-center">
                <p className="text-ink-400 text-sm mb-1">No data yet.</p>
                <p className="text-ink-500 text-xs">
                  Go to the{" "}
                  <button onClick={() => setTab("ingest")} className="text-accent underline">
                    Fetch papers
                  </button>{" "}
                  tab to load your first month.
                </p>
              </div>
            )}

            {months.length > 0 && (
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search titles and abstracts..."
                  className="flex-1 bg-ink-800 border border-ink-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 focus:border-accent outline-none"
                />
                <button type="submit"
                  className="px-4 py-2 rounded-xl bg-accent text-white text-sm hover:bg-accent-light transition-colors">
                  Search
                </button>
                {searchResults && (
                  <button type="button"
                    onClick={() => { setSearchResults(null); setSearchQ(""); }}
                    className="px-3 py-2 rounded-xl border border-ink-600 text-ink-400 text-sm hover:text-white">
                    X
                  </button>
                )}
              </form>
            )}

            {topics.length > 0 && !searchResults && (
              <div>
                <p className="text-xs text-ink-500 mb-2 font-mono uppercase tracking-wider">
                  Topics · {formatMonth(selectedMonth)}
                </p>
                <TopicPills topics={topics} selected={selectedTopic} onChange={setSelectedTopic} />
              </div>
            )}

            <div>
              {searchResults ? (
                <p className="text-xs text-ink-500 mb-3 font-mono">
                  {searchResults.length} results for "{searchQ}"
                </p>
              ) : total > 0 && (
                <p className="text-xs text-ink-500 mb-3 font-mono">
                  {total} papers · {selectedTopic ?? "all topics"} · sorted by trend score
                </p>
              )}

              {loading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-20 rounded-xl bg-ink-800 border border-ink-700 animate-pulse" />
                  ))}
                </div>
              ) : displayPapers.length > 0 ? (
                <div className="space-y-3">
                  {displayPapers.map((p, i) => (
                    <PaperCard
                      key={p.arxiv_id}
                      paper={p}
                      rank={i + 1}
                      isSaved={savedIds.has(p.arxiv_id)}
                      onToggleSave={handleToggleSave}
                    />
                  ))}
                </div>
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
