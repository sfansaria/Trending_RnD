"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchPapers, fetchTopics, fetchMonths, searchPapers,
  triggerIngest, fetchStats, formatMonth, formatMonthShort, currentMonthKey,
  savePaper, unsavePaper, fetchSavedPapers, fetchHeatmap,
  Paper, Topic, HeatmapData, HeatmapCell
} from "@/lib/api";

// =============================================================================
// COMPONENT: ScoreBar
// Coloured progress bar showing a paper's trend score 0-100.
// Green = hot (>70), Purple = trending (>40), Orange = lower (<40)
// =============================================================================
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

// =============================================================================
// COMPONENT: CatBadge
// Coloured tag for an arXiv category like "cs.LG" or "cs.SD".
// Each category has its own colour for quick visual identification.
// NEW: Added cs.SD (Sound) and eess.AS (Audio & Speech) colours.
// =============================================================================
const CAT_COLORS: Record<string, string> = {
  "cs.LG": "#7c6af7",    // purple = Machine Learning
  "cs.AI": "#a89cf9",    // light purple = Artificial Intelligence
  "cs.CL": "#4ade80",    // green = Computation and Language (NLP)
  "cs.CV": "#f97316",    // orange = Computer Vision
  "stat.ML": "#38bdf8",  // blue = Statistics ML
  "cs.SD": "#f43f5e",    // red = Sound / Speech Processing
  "eess.AS": "#fb923c",  // amber = Audio and Speech Processing
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

// =============================================================================
// HELPERS: BibTeX and Share URL builders
// =============================================================================
function buildBibTeX(paper: Paper): string {
  const firstAuthor = paper.authors[0] || "unknown";
  const lastName = firstAuthor.split(" ").pop()?.toLowerCase() || "unknown";
  const year = new Date(paper.published).getFullYear();
  const key = `${lastName}${year}`;
  const authors = paper.authors.join(" and ");
  return `@misc{${key},
  title  = {${paper.title}},
  author = {${authors}},
  year   = {${year}},
  url    = {${paper.url}}
}`;
}

function buildShareURL(paper: Paper): string {
  return paper.url;
}

// =============================================================================
// COMPONENT: CopyButton
// Copies text to clipboard. Shows "Copied!" for 2 seconds after success.
// =============================================================================
function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  const displayLabel = state === "copied" ? "Copied!" : state === "error" ? "Failed" : label;
  const style = state === "copied" ? "border-green-500 text-green-400"
              : state === "error"  ? "border-red-500 text-red-400"
              : "border-ink-600 text-ink-300 hover:border-accent hover:text-white";

  return (
    <button onClick={handleCopy}
      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${style}`}>
      {displayLabel}
    </button>
  );
}

// =============================================================================
// COMPONENT: PaperCard
// One paper card. Click to expand abstract + action buttons.
// Star button saves/unsaves the paper.
// =============================================================================
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
    <div className="card-hover rounded-xl border border-ink-600 bg-ink-800 p-4 cursor-pointer"
      onClick={() => setExpanded(e => !e)}>
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
              aria-label={isSaved ? "Remove bookmark" : "Save paper"}>
              {isSaved ? "★" : "☆"}
            </button>
          </div>
          <h3 className="text-sm font-medium text-white leading-snug mb-1">{paper.title}</h3>
          <p className="text-xs text-ink-300 mb-2 truncate">{authors} · {date}</p>
          <ScoreBar score={paper.trend_score} />
          {expanded && (
            <div className="mt-3 pt-3 border-t border-ink-700">
              <p className="text-xs text-ink-300 leading-relaxed mb-3">{paper.abstract}</p>
              <div className="flex flex-wrap gap-2">
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
                <CopyButton text={buildBibTeX(paper)} label="BibTeX" />
                <CopyButton text={buildShareURL(paper)} label="Copy Link" />
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

// =============================================================================
// COMPONENT: MonthPicker
// Row of buttons, one per month with data. Clicking switches months.
// =============================================================================
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

// =============================================================================
// COMPONENT: TopicPills
// Topic filter pills. "All topics" clears the filter.
// =============================================================================
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

// =============================================================================
// COMPONENT: SortDropdown
// Dropdown to pick sort order: trend score, citations, or publish date.
// =============================================================================
function SortDropdown({ value, onChange }: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-500 font-mono">sort by</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="bg-ink-800 border border-ink-600 rounded-lg px-2 py-1 text-xs text-ink-300 font-mono focus:border-accent outline-none cursor-pointer hover:border-ink-400 transition-colors">
        <option value="score">trend score</option>
        <option value="citations">citations</option>
        <option value="date">publish date</option>
      </select>
    </div>
  );
}

// =============================================================================
// COMPONENT: HeatmapView
// NEW COMPONENT — the topic x month heatmap grid.
//
// HOW IT WORKS:
//   - Rows = topic labels (e.g. "Diffusion · Image · Generation")
//   - Columns = months (e.g. "Jan 25", "Feb 25", "Mar 25")
//   - Each cell = coloured square showing paper count for that topic+month
//   - Colour intensity = more papers = darker/brighter colour
//   - Click a cell = switch to browse tab filtered by that topic+month
//   - Empty cells (topic didn't exist that month) = dark grey
//
// COLOUR SCALE:
//   0 papers    = very dark grey (empty)
//   1-5 papers  = dim purple
//   6-15 papers = medium purple
//   16+ papers  = bright purple/accent
// =============================================================================
function HeatmapView({ data, onCellClick }: {
  data: HeatmapData;
  // When user clicks a cell, tell Home to switch to browse tab with that month+topic
  onCellClick: (month: string, topic: string) => void;
}) {
  if (!data.months.length || !data.topics.length) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-800 p-8 text-center">
        <p className="text-ink-400 text-sm">No heatmap data yet.</p>
        <p className="text-ink-500 text-xs mt-1">
          Fetch papers for at least two months to see the heatmap.
        </p>
      </div>
    );
  }

  // Convert paper_count to a background colour
  // More papers = more opaque/bright accent colour
  function cellColor(cell: HeatmapCell | null): string {
    if (!cell || cell.paper_count === 0) return "rgba(36,36,48,0.8)"; // empty = dark
    const count = cell.paper_count;
    if (count >= 20) return "rgba(124,106,247,0.9)";  // very hot = bright purple
    if (count >= 10) return "rgba(124,106,247,0.65)"; // hot = medium purple
    if (count >= 5)  return "rgba(124,106,247,0.4)";  // warm = dim purple
    return "rgba(124,106,247,0.2)";                    // cool = very dim purple
  }

  // Tooltip text shown on hover
  function cellTitle(cell: HeatmapCell | null, topic: string, month: string): string {
    if (!cell) return `${topic} · ${month} · no data`;
    return `${topic} · ${month} · ${cell.paper_count} papers · avg score ${cell.avg_score.toFixed(1)}`;
  }

  return (
    <div>
      <p className="text-xs text-ink-500 mb-4 font-mono">
        {data.topics.length} topics x {data.months.length} months · click any cell to browse those papers
      </p>

      {/* Scrollable container — heatmap can be wide with many months */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: `${data.months.length * 56 + 200}px` }}>

          {/* Column headers — month names */}
          <div className="flex mb-1" style={{ paddingLeft: "200px" }}>
            {data.months.map(m => (
              <div key={m} className="text-center font-mono text-ink-500"
                style={{ width: "48px", marginRight: "4px", fontSize: "10px" }}>
                {formatMonthShort(m)}
              </div>
            ))}
          </div>

          {/* Rows — one per topic */}
          {data.topics.map(topic => (
            <div key={topic} className="flex items-center mb-1">
              {/* Row label — topic name, truncated */}
              <div className="text-ink-400 truncate pr-3 text-right shrink-0"
                style={{ width: "200px", fontSize: "11px" }}
                title={topic}>
                {topic}
              </div>

              {/* Cells — one per month */}
              {data.months.map(month => {
                const cell = data.grid[topic]?.[month] ?? null;
                return (
                  <div key={month}
                    onClick={() => cell && onCellClick(month, topic)}
                    title={cellTitle(cell, topic, month)}
                    className="rounded transition-all duration-150"
                    style={{
                      width: "48px",
                      height: "28px",
                      marginRight: "4px",
                      background: cellColor(cell),
                      cursor: cell ? "pointer" : "default",
                      border: cell ? "1px solid rgba(124,106,247,0.3)" : "1px solid rgba(255,255,255,0.05)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}>
                    {/* Show paper count inside cell if it fits */}
                    {cell && cell.paper_count > 0 && (
                      <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.7)", fontFamily: "monospace" }}>
                        {cell.paper_count}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-ink-700">
            <span className="text-xs text-ink-500">papers per topic per month:</span>
            {[
              { color: "rgba(36,36,48,0.8)", label: "none" },
              { color: "rgba(124,106,247,0.2)", label: "1-4" },
              { color: "rgba(124,106,247,0.4)", label: "5-9" },
              { color: "rgba(124,106,247,0.65)", label: "10-19" },
              { color: "rgba(124,106,247,0.9)", label: "20+" },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1">
                <div className="w-4 h-4 rounded" style={{ background: color, border: "1px solid rgba(124,106,247,0.3)" }} />
                <span className="text-xs text-ink-500 font-mono">{label}</span>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

// =============================================================================
// COMPONENT: IngestPanel
// Fetch papers form. Manages its own status state.
// =============================================================================
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
        Now includes speech and audio papers (cs.SD, eess.AS).
      </p>
      <div className="flex gap-2">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="flex-1 bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm text-white focus:border-accent outline-none font-mono" />
        <button onClick={run} disabled={status === "running"}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-light transition-colors disabled:opacity-50">
          {status === "running" ? "Fetching..." : status === "done" ? "Done" : "Fetch"}
        </button>
      </div>
      {status === "running" && (
        <p className="text-xs text-accent mt-2 font-mono animate-pulse">
          Fetching ML and speech papers from arXiv...
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-400 mt-2">Something went wrong. Check the backend terminal.</p>
      )}
    </div>
  );
}

// =============================================================================
// COMPONENT: Home (main page)
// Root component. Owns all state. Fetches all data.
// =============================================================================
export default function Home() {

  // ── STATE ──────────────────────────────────────────────────────────────────
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [total, setTotal] = useState(0);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Paper[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState("score");
  // "browse" | "saved" | "heatmap" | "ingest"
  const [tab, setTab] = useState<"browse" | "ingest" | "saved" | "heatmap">("browse");
  const [stats, setStats] = useState<any>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedPapers, setSavedPapers] = useState<Paper[]>([]);

  // Heatmap data — loaded when user clicks the heatmap tab
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  // ── DATA LOADING ───────────────────────────────────────────────────────────

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

  // Load heatmap data — called when user switches to the heatmap tab
  const loadHeatmap = useCallback(async () => {
    setHeatmapLoading(true);
    const data = await fetchHeatmap().catch(() => ({ months: [], topics: [], grid: {} } as HeatmapData));
    setHeatmapData(data);
    setHeatmapLoading(false);
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

  // When a heatmap cell is clicked — switch to browse tab with that month+topic
  function handleHeatmapCellClick(month: string, topic: string) {
    setSelectedMonth(month);
    setSelectedTopic(topic);
    setTab("browse");
  }

  // ── EFFECTS ────────────────────────────────────────────────────────────────

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
    fetchPapers(selectedMonth, selectedTopic || undefined, 20, 0, sort)
      .then(d => { setPapers(d.papers); setTotal(d.total); })
      .catch(() => setPapers([]))
      .finally(() => setLoading(false));
  }, [selectedMonth, selectedTopic, sort]);

  // Load heatmap when user switches to heatmap tab
  useEffect(() => {
    if (tab === "heatmap" && !heatmapData) {
      loadHeatmap();
    }
  }, [tab]);

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

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-ink-950">

      {/* HEADER */}
      <header className="border-b border-ink-700 px-6 py-4 flex items-center justify-between sticky top-0 z-10 bg-ink-950/90 backdrop-blur-sm">
        <div>
          <h1 className="text-lg font-medium text-white tracking-tight">
            <span className="text-accent font-mono">Trending</span> RnD
          </h1>
          <p className="text-xs text-ink-400">discover trending machine learning research by month</p>
        </div>
        <div className="flex items-center gap-4">
          {stats && (
            <span className="text-xs text-ink-400 font-mono hidden sm:block">
              {stats.total_papers.toLocaleString()} papers indexed
            </span>
          )}
          {/* Tab switcher: browse | saved | heatmap | ingest */}
          <div className="flex rounded-lg border border-ink-600 overflow-hidden">
            {(["browse", "saved", "heatmap", "ingest"] as const).map(t => (
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

        {/* INGEST TAB */}
        {tab === "ingest" && (
          <div className="max-w-md">
            <IngestPanel onDone={() => { loadMonths(); setTab("browse"); }} />
            <div className="mt-4 rounded-xl border border-ink-600 bg-ink-800 p-4">
              <h3 className="text-sm font-medium text-white mb-2">Categories fetched</h3>
              <div className="flex flex-wrap gap-2">
                {["cs.LG","cs.AI","cs.CL","cs.CV","stat.ML","cs.SD","eess.AS"].map(c => (
                  <CatBadge key={c} cat={c} />
                ))}
              </div>
              <p className="text-xs text-ink-500 mt-3">
                cs.SD and eess.AS are new — they bring in speech recognition, TTS,
                audio processing, and speaker diarisation papers.
              </p>
            </div>
          </div>
        )}

        {/* SAVED TAB */}
        {tab === "saved" && (
          <div>
            <p className="text-xs text-ink-500 mb-3 font-mono">
              {savedPapers.length} saved paper{savedPapers.length !== 1 ? "s" : ""}
            </p>
            {savedPapers.length > 0 ? (
              <div className="space-y-3">
                {savedPapers.map((p, i) => (
                  <PaperCard key={p.arxiv_id} paper={p} rank={i + 1}
                    isSaved={true} onToggleSave={handleToggleSave} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-ink-700 bg-ink-800 p-8 text-center">
                <p className="text-ink-400 text-sm">No saved papers yet.</p>
                <p className="text-ink-500 text-xs mt-1">Click the star on any paper to save it here.</p>
              </div>
            )}
          </div>
        )}

        {/* HEATMAP TAB */}
        {tab === "heatmap" && (
          <div>
            <div className="mb-4">
              <h2 className="text-sm font-medium text-white mb-1">Topic heatmap</h2>
              <p className="text-xs text-ink-500">
                How each topic cluster trends across months.
                Click any cell to browse those papers.
              </p>
            </div>
            {heatmapLoading ? (
              <div className="space-y-2">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-8 rounded bg-ink-800 border border-ink-700 animate-pulse" />
                ))}
              </div>
            ) : heatmapData ? (
              <HeatmapView data={heatmapData} onCellClick={handleHeatmapCellClick} />
            ) : null}
            {/* Refresh button */}
            <button onClick={loadHeatmap}
              className="mt-4 text-xs px-3 py-1.5 rounded-lg border border-ink-600 text-ink-400 hover:text-white hover:border-accent transition-colors">
              Refresh heatmap
            </button>
          </div>
        )}

        {/* BROWSE TAB */}
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
                    ingest
                  </button>{" "}
                  tab to fetch your first month.
                </p>
              </div>
            )}

            {months.length > 0 && (
              <form onSubmit={handleSearch} className="flex gap-2">
                <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search titles and abstracts..."
                  className="flex-1 bg-ink-800 border border-ink-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 focus:border-accent outline-none" />
                <button type="submit"
                  className="px-4 py-2 rounded-xl bg-accent text-white text-sm hover:bg-accent-light transition-colors">
                  Search
                </button>
                {searchResults && (
                  <button type="button" onClick={() => { setSearchResults(null); setSearchQ(""); }}
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
                  {selectedMonth && ` in ${formatMonth(selectedMonth)}`}
                </p>
              ) : (
                total > 0 && (
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-ink-500 font-mono">
                      {total} papers · {selectedTopic ?? "all topics"}
                    </p>
                    <SortDropdown value={sort} onChange={setSort} />
                  </div>
                )
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
                    <PaperCard key={p.arxiv_id} paper={p} rank={i + 1}
                      isSaved={savedIds.has(p.arxiv_id)} onToggleSave={handleToggleSave} />
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