// =============================================================================
// FILE: frontend/src/app/page.tsx
// PURPOSE: The entire UI of the app — one page with all components.
//          This is what you see at http://localhost:3000
//
// "use client" at the top tells Next.js: run this code in the browser (not
// on the server). We need this because we use useState and useEffect hooks
// which only work in the browser.
//
// COMPONENT TREE:
//   Home (main page)
//   ├── Header (title + tab switcher)
//   ├── IngestPanel (fetch papers form) — shown when tab = "ingest"
//   └── Browse content — shown when tab = "browse"
//       ├── MonthPicker (month buttons)
//       ├── Search bar
//       ├── TopicPills (topic filter buttons)
//       └── PaperCard[] (list of papers)
//           ├── ScoreBar (coloured progress bar)
//           └── CatBadge[] (category tags like cs.LG)
// =============================================================================

"use client";

// React hooks:
// useState  = store a value that makes the UI re-render when it changes
// useEffect = run code when a value changes (like fetching data)
// useCallback = memoize a function so it doesn't get recreated every render
import { useState, useEffect, useCallback } from "react";

// Import all our API functions and types from api.ts
import {fetchPapers, fetchTopics, fetchMonths, searchPapers, triggerIngest, fetchStats,
  formatMonth, currentMonthKey,
  Paper, Topic,
} from "@/lib/api";  // @/ is a TypeScript alias for /src


// =============================================================================
// COMPONENT: ScoreBar
// A small horizontal progress bar that shows a paper's trend score.
// Color changes based on score: green (hot) → purple (trending) → orange (cool)
// =============================================================================
function ScoreBar({ score }: { score: number }) {  // { score } = destructure props
  const pct = Math.round(score);  // round to integer for display

  // Pick colour based on score range
  const color = score > 70 ? "#4ade80"   // green = hot paper
              : score > 40 ? "#7c6af7"   // purple = trending
              :               "#f97316"; // orange = lower score

  return (
    <div className="flex items-center gap-2">
      {/* Grey track — full width */}
      <div className="flex-1 h-1 bg-ink-700 rounded-full overflow-hidden">
        {/* Filled portion — width set by the score percentage */}
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      {/* Number label on the right */}
      <span className="text-xs font-mono" style={{ color }}>{pct}</span>
    </div>
  );
}



// =============================================================================
// COMPONENT: CatBadge
// A small coloured tag showing an arXiv category like "cs.LG"
// Each category has its own colour so you can identify them at a glance
// =============================================================================

// Map from category code → hex colour
const CAT_COLORS: Record<string, string> = {
  "cs.LG": "#7c6af7",   // purple = Machine Learning
  "cs.AI": "#a89cf9",   // light purple = Artificial Intelligence
  "cs.CL": "#4ade80",   // green = Computation and Language (NLP)
  "cs.CV": "#f97316",   // orange = Computer Vision
  "stat.ML": "#38bdf8", // blue = Statistics ML
};

function CatBadge({ cat }: { cat: string }) {
  const c = CAT_COLORS[cat] || "#888";  // fallback grey for unknown categories

  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-mono"
      style={{
        background: c + "22",          // hex colour + "22" = 13% opacity background
        color: c,
        border: `1px solid ${c}44`,   // hex colour + "44" = 27% opacity border
      }}
    >
      {cat}
    </span>
  );
}

// =============================================================================
// COMPONENT: PaperCard
// Displays one paper as a card. Click to expand and see the full abstract.
// =============================================================================
function PaperCard({ paper, rank }: { paper: Paper; rank: number }) {
  // expanded = whether the abstract is visible
  // starts collapsed (false), toggles on click
  const [expanded, setExpanded] = useState(false);

  // Format authors: show first 3, then "et al." if there are more
  const authors = paper.authors.slice(0, 3).join(", ")
    + (paper.authors.length > 3 ? " et al." : "");

  // Format the publish date as "15 Jun"
  const date = new Date(paper.published).toLocaleDateString("en-GB", {
    day: "numeric", month: "short"
  });

  return (
    // The whole card is clickable — toggles expanded state
    <div
      className="card-hover rounded-xl border border-ink-600 bg-ink-800 p-4 cursor-pointer"
      onClick={() => setExpanded(e => !e)}  // e => !e flips the boolean
    >
      <div className="flex gap-3">
        {/* Rank number on the left — padded to 2 digits: 1 → "01" */}
        <span className="text-2xl font-mono font-light text-ink-600 w-8 shrink-0 pt-0.5">
          {String(rank).padStart(2, "0")}
        </span>

        {/* Paper content */}
        <div className="flex-1 min-w-0">
          {/* Category badges + topic tag */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {paper.categories.slice(0, 3).map(c => <CatBadge key={c} cat={c} />)}
            {paper.topic_label && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-ink-700 text-ink-300 border border-ink-600">
                {paper.topic_label}
              </span>
            )}
          </div>

          {/* Paper title */}
          <h3 className="text-sm font-medium text-white leading-snug mb-1">
            {paper.title}
          </h3>

          {/* Authors and date */}
          <p className="text-xs text-ink-300 mb-2 truncate">
            {authors} · {date}
          </p>

          {/* Trend score bar */}
          <ScoreBar score={paper.trend_score} />

          {/* EXPANDED CONTENT — only visible when card is clicked */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-ink-700">
              {/* Full abstract */}
              <p className="text-xs text-ink-300 leading-relaxed mb-3">
                {paper.abstract}
              </p>

              {/* Action buttons */}
              <div className="flex gap-2">
                {/* Link to arXiv abstract page */}
                <a
                  href={paper.url}
                  target="_blank"         // open in new tab
                  rel="noreferrer"        // security: don't send referrer header
                  onClick={e => e.stopPropagation()}  // don't collapse card when clicking link
                  className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-light transition-colors"
                >
                  Abstract
                </a>

                {/* PDF link — only shown if pdf_url exists */}
                {paper.pdf_url && (
                  <a
                    href={paper.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-xs px-3 py-1.5 rounded-lg border border-ink-600 text-ink-300 hover:border-accent hover:text-white transition-colors"
                  >
                    PDF
                  </a>
                )}

                {/* Citation count display */}
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
// Row of buttons, one per month that has data. Click to switch months.
// =============================================================================

function MonthPicker({ months, selected, onChange }: {
  months: string[];           // e.g. ["2024-06", "2024-05", "2024-04"]
  selected: string;           // currently selected month e.g. "2024-06"
  onChange: (m: string) => void;  // callback when user picks a different month
}) {
  // Don't render anything if there are no months yet
  if (!months.length) return null;

  return (
    <div className="flex gap-2 flex-wrap">
      {months.map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-3 py-1.5 rounded-lg text-sm font-mono transition-colors
            ${m === selected
              ? "bg-accent text-white"                                        // active = filled purple
              : "bg-ink-800 border border-ink-600 text-ink-300 hover:border-accent hover:text-white"  // inactive = outline
            }`}
        >
          {formatMonth(m)}  {/* "2024-06" → "June 2024" */}
        </button>
      ))}
    </div>
  );
}


// =============================================================================
// COMPONENT: TopicPills
// Row of pill buttons for filtering papers by topic.
// First pill = "All topics" (no filter). Others = specific topic clusters.
// =============================================================================

function TopicPills({ topics, selected, onChange }: {
  topics: Topic[];
  selected: string | null;   // null = no topic filter (show all)
  onChange: (t: string | null) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {/* "All topics" button — clears the filter */}
      <button
        onClick={() => onChange(null)}
        className={`px-3 py-1 rounded-full text-xs font-mono transition-colors
          ${selected === null
            ? "bg-accent text-white"
            : "bg-ink-800 border border-ink-600 text-ink-400 hover:text-white"
          }`}
      >
        All topics
      </button>

      {/* One pill per topic cluster, sorted by avg_score (hottest first) */}
      {topics.slice(0, 10).map(t => (  // show max 10 topic pills to avoid overflow
        <button
          key={t.id}
          onClick={() => onChange(t.label)}
          className={`px-3 py-1 rounded-full text-xs transition-colors
            ${selected === t.label
              ? "bg-accent text-white"
              : "bg-ink-800 border border-ink-600 text-ink-400 hover:text-white"
            }`}
        >
          {t.label}
          {/* Paper count in grey — slightly dimmed */}
          <span className="ml-1.5 opacity-60">{t.paper_count}</span>
        </button>
      ))}
    </div>
  );


// =============================================================================
// COMPONENT: IngestPanel
// Form for fetching papers. User picks a month and clicks "Fetch".
// Shows the pipeline status while running.
// =============================================================================

function IngestPanel({ onDone }: { onDone: () => void }) {
  // Which month to fetch — defaults to current month
  const [month, setMonth] = useState(currentMonthKey());

  // Current state of the fetch operation
  // "idle"    = waiting for user to click Fetch
  // "running" = backend is fetching papers (takes 2-5 min)
  // "done"    = finished successfully
  // "error"   = something went wrong
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");

  async function run() {
    setStatus("running");
    try {
      // This returns almost immediately — backend starts work in the background
      await triggerIngest(month);
      setStatus("done");
      // After 3 seconds, reset and switch to browse tab
      setTimeout(() => { setStatus("idle"); onDone(); }, 3000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="rounded-xl border border-ink-600 bg-ink-800 p-4">
      <h2 className="text-sm font-medium text-white mb-3">Fetch papers</h2>
      <p className="text-xs text-ink-400 mb-4">
        Ingests arXiv papers for a month, scores them, and extracts topics.
        Takes 2–5 minutes depending on paper count.
      </p>

      <div className="flex gap-2">
        {/* Month input — native HTML date picker (shows month/year only) */}
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="flex-1 bg-ink-900 border border-ink-600 rounded-lg px-3 py-2 text-sm text-white focus:border-accent outline-none font-mono"
        />

        {/* Fetch button — disabled while running to prevent double-clicks */}
        <button
          onClick={run}
          disabled={status === "running"}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-light transition-colors disabled:opacity-50"
        >
          {/* Button label changes based on status */}
          {status === "running" ? "Fetching…" : status === "done" ? "Done ✓" : "Fetch"}
        </button>
      </div>

      {/* Status messages below the form */}
      {status === "running" && (
        <p className="text-xs text-accent mt-2 font-mono animate-pulse">
          Fetching papers from arXiv → scoring → extracting topics…
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-400 mt-2">
          Something went wrong. Check the backend logs.
        </p>
      )}
    </div>
  );
}



// =============================================================================
// COMPONENT: Home (the main page)
// This is the default export — Next.js renders this for the "/" route
// =============================================================================
export default function Home() {
  // ── STATE ──────────────────────────────────────────────────────────────────
  // All the data the page needs to display, stored in React state.
  // When any of these change, React re-renders the relevant parts of the UI.

  const [months, setMonths] = useState<string[]>([]);          // available months from DB
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey()); // active month
  const [topics, setTopics] = useState<Topic[]>([]);           // topic clusters for active month
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null); // active topic filter
  const [papers, setPapers] = useState<Paper[]>([]);           // papers shown in list
  const [total, setTotal] = useState(0);                       // total count (for "X papers" label)
  const [searchQ, setSearchQ] = useState("");                  // search input value
  const [searchResults, setSearchResults] = useState<Paper[] | null>(null); // null = not searching
  const [loading, setLoading] = useState(false);               // shows skeleton cards while loading
  const [tab, setTab] = useState<"browse" | "ingest">("browse"); // active tab
  const [stats, setStats] = useState<any>(null);               // overall DB stats for header

  // ── DATA LOADING ───────────────────────────────────────────────────────────

  // loadMonths: fetch available months from the API
  // useCallback prevents this from being recreated on every render
  const loadMonths = useCallback(async () => {
    const data = await fetchMonths();
    setMonths(data.months);
    // If current month isn't in the DB, switch to the most recent one
    if (data.months.length && !data.months.includes(selectedMonth)) {
      setSelectedMonth(data.months[0]);
    }
  }, [selectedMonth]);

  // Run once when the page first loads
  useEffect(() => {
    loadMonths();
    fetchStats().then(setStats).catch(() => {});  // ignore stats errors (non-critical)
  }, []);  // [] = empty dependency array = run only once

  // When the selected month changes: reload topics and clear search
  useEffect(() => {
    if (!selectedMonth) return;
    fetchTopics(selectedMonth)
      .then(d => setTopics(d.topics))
      .catch(() => setTopics([]));  // if it fails, show no topics (not a crash)
    setSelectedTopic(null);   // clear topic filter
    setSearchResults(null);   // clear search results
    setSearchQ("");           // clear search input
  }, [selectedMonth]);  // re-run whenever selectedMonth changes

  // When month OR topic filter changes: reload the paper list
  useEffect(() => {
    if (!selectedMonth) return;
    setLoading(true);
    fetchPapers(selectedMonth, selectedTopic || undefined)
      .then(d => { setPapers(d.papers); setTotal(d.total); })
      .catch(() => setPapers([]))
      .finally(() => setLoading(false));  // always stop loading, even on error
  }, [selectedMonth, selectedTopic]);  // re-run when either changes

  // Handle search form submission
  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();  // prevent the form from reloading the page (default HTML behaviour)
    if (!searchQ.trim()) { setSearchResults(null); return; }  // clear if empty
    setLoading(true);
    const data = await searchPapers(searchQ, selectedMonth)
      .catch(() => ({ papers: [] as Paper[], query: "" }));
    setSearchResults(data.papers);
    setLoading(false);
  }

  // Show search results if searching, otherwise show regular paper list
  const displayPapers = searchResults ?? papers;  // ?? = "nullish coalescing": use papers if searchResults is null

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-ink-950">

      {/* ── HEADER ── */}
      {/* sticky top-0 = sticks to top when scrolling; backdrop-blur = frosted glass */}
      <header className="border-b border-ink-700 px-6 py-4 flex items-center justify-between sticky top-0 z-10 bg-ink-950/90 backdrop-blur-sm">
        <div>
          <h1 className="text-lg font-medium text-white tracking-tight">
            <span className="text-accent font-mono">arXiv</span> ML Trends
          </h1>
          <p className="text-xs text-ink-400">trending machine learning papers by month</p>
        </div>

        <div className="flex items-center gap-4">
          {/* Paper count — only shown if stats have loaded */}
          {stats && (
            <span className="text-xs text-ink-400 font-mono hidden sm:block">
              {stats.total_papers.toLocaleString()} papers indexed
            </span>
          )}

          {/* Tab switcher: Browse | Fetch papers */}
          <div className="flex rounded-lg border border-ink-600 overflow-hidden">
            {(["browse", "ingest"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs capitalize transition-colors
                  ${tab === t ? "bg-accent text-white" : "text-ink-400 hover:text-white"}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ── INGEST TAB ── */}
        {tab === "ingest" && (
          <div className="max-w-md">
            {/* onDone: after fetching, reload months and switch to browse tab */}
            <IngestPanel onDone={() => { loadMonths(); setTab("browse"); }} />

            {/* Explanation of what happens when you click Fetch */}
            <div className="mt-4 rounded-xl border border-ink-600 bg-ink-800 p-4">
              <h3 className="text-sm font-medium text-white mb-2">How it works</h3>
              <ol className="text-xs text-ink-400 space-y-1.5 list-decimal list-inside">
                <li>Queries arXiv API for ML categories (cs.LG, cs.AI, cs.CL, cs.CV, stat.ML)</li>
                <li>Tries to enrich each paper with citation data from Semantic Scholar</li>
                <li>Computes a trend score: citations + recency + keyword boost</li>
                <li>Runs TF-IDF + KMeans clustering to extract topic groups</li>
                <li>Stores everything in a local SQLite database</li>
              </ol>
            </div>
          </div>
        )}

        {/* ── BROWSE TAB ── */}
        {tab === "browse" && (
          <>
            {/* Month picker — or empty state if no data yet */}
            {months.length > 0 ? (
              <MonthPicker months={months} selected={selectedMonth} onChange={setSelectedMonth} />
            ) : (
              // Empty state: shown when database is empty
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

            {/* Search bar — only shown if we have data */}
            {months.length > 0 && (
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="Search titles and abstracts…"
                  className="flex-1 bg-ink-800 border border-ink-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 focus:border-accent outline-none"
                />
                <button type="submit"
                  className="px-4 py-2 rounded-xl bg-accent text-white text-sm hover:bg-accent-light transition-colors">
                  Search
                </button>
                {/* Clear button — only shown when search results are active */}
                {searchResults && (
                  <button
                    type="button"
                    onClick={() => { setSearchResults(null); setSearchQ(""); }}
                    className="px-3 py-2 rounded-xl border border-ink-600 text-ink-400 text-sm hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </form>
            )}

            {/* Topic pills — only shown if topics exist and we're not searching */}
            {topics.length > 0 && !searchResults && (
              <div>
                <p className="text-xs text-ink-500 mb-2 font-mono uppercase tracking-wider">
                  Topics · {formatMonth(selectedMonth)}
                </p>
                <TopicPills topics={topics} selected={selectedTopic} onChange={setSelectedTopic} />
              </div>
            )}

            {/* Paper list */}
            <div>
              {/* Status bar above the list */}
              {searchResults ? (
                <p className="text-xs text-ink-500 mb-3 font-mono">
                  {searchResults.length} results for "{searchQ}"
                  {selectedMonth && ` in ${formatMonth(selectedMonth)}`}
                </p>
              ) : (
                total > 0 && (
                  <p className="text-xs text-ink-500 mb-3 font-mono">
                    {total} papers · {selectedTopic ?? "all topics"} · sorted by trend score
                  </p>
                )
              )}

              {loading ? (
                // Skeleton loading cards — shown while data is being fetched
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    // animate-pulse makes the cards fade in and out
                    <div key={i} className="h-20 rounded-xl bg-ink-800 border border-ink-700 animate-pulse" />
                  ))}
                </div>
              ) : displayPapers.length > 0 ? (
                // The actual paper cards
                <div className="space-y-3">
                  {displayPapers.map((p, i) => (
                    <PaperCard key={p.arxiv_id} paper={p} rank={i + 1} />
                  ))}
                </div>
              ) : months.length > 0 ? (
                // Empty results (searched but found nothing)
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
