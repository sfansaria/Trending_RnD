"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchPapers, fetchTopics, fetchMonths, searchPapers,
  triggerIngest, fetchStats, formatMonth, currentMonthKey,
  savePaper, unsavePaper, fetchSavedPapers, Paper, Topic
} from "@/lib/api";

// =============================================================================
// COMPONENT: ScoreBar
// Takes a score 0-100 and draws a coloured progress bar.
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
// Renders one coloured tag for an arXiv category like "cs.LG"
// =============================================================================
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

// =============================================================================
// HELPER: buildBibTeX
// Builds a BibTeX citation string from a paper object.
//
// BibTeX is the standard citation format used in LaTeX academic papers.
// Format:
//   @misc{arxiv_id,
//     title  = {Paper Title},
//     author = {Author One and Author Two},
//     year   = {2024},
//     url    = {https://arxiv.org/abs/...}
//   }
//
// The citation key (first line) uses the first author's last name + year,
// e.g. "vaswani2017" — this is the standard academic convention.
// =============================================================================
function buildBibTeX(paper: Paper): string {
  // Extract the first author's last name for the citation key
  // "Ashish Vaswani" → "vaswani"
  const firstAuthor = paper.authors[0] || "unknown";
  const lastName = firstAuthor.split(" ").pop()?.toLowerCase() || "unknown";

  // Extract the year from the published date string
  const year = new Date(paper.published).getFullYear();

  // Build citation key: lastnameyear e.g. "vaswani2017"
  const key = `${lastName}${year}`;

  // Format authors as "First Last and First Last and ..."
  // BibTeX uses "and" as the separator between authors
  const authors = paper.authors.join(" and ");

  // Build and return the full BibTeX string
  return `@misc{${key},
  title  = {${paper.title}},
  author = {${authors}},
  year   = {${year}},
  url    = {${paper.url}}
}`;
}

// =============================================================================
// HELPER: buildShareURL
// Builds a shareable URL for a paper.
// Simply uses the paper's arXiv abstract URL — universally accessible,
// no login required, works in any browser.
// =============================================================================
function buildShareURL(paper: Paper): string {
  return paper.url;
}

// =============================================================================
// COMPONENT: CopyButton
// A button that copies text to the clipboard when clicked.
// Shows "Copied!" for 2 seconds after a successful copy, then resets.
//
// Props:
//   text  — the string to copy to clipboard
//   label — the button label in its normal state (e.g. "BibTeX" or "Link")
// =============================================================================
function CopyButton({ text, label }: { text: string; label: string }) {
  // "idle" = normal state showing the label
  // "copied" = shows "Copied!" for 2 seconds after a successful copy
  // "error" = shows "Failed" if the clipboard API isn't available
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy(e: React.MouseEvent) {
    // Stop the click from bubbling up to the PaperCard and collapsing it
    e.stopPropagation();

    try {
      // navigator.clipboard.writeText is the modern clipboard API.
      // It requires the page to be served over HTTPS or localhost.
      // Both our dev setup (localhost) and production satisfy this.
      await navigator.clipboard.writeText(text);
      setState("copied");

      // Reset back to "idle" after 2 seconds
      setTimeout(() => setState("idle"), 2000);
    } catch {
      // Fallback: clipboard API blocked (e.g. in some iframe contexts)
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  }

  // Pick the button label based on current state
  const displayLabel =
    state === "copied" ? "Copied!" :
    state === "error"  ? "Failed"  :
    label;

  // Pick the button colour based on state
  // idle = default outline style
  // copied = green to confirm success
  // error = red to signal failure
  const style =
    state === "copied" ? "border-green-500 text-green-400" :
    state === "error"  ? "border-red-500 text-red-400"     :
    "border-ink-600 text-ink-300 hover:border-accent hover:text-white";

  return (
    <button
      onClick={handleCopy}
      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${style}`}
    >
      {displayLabel}
    </button>
  );
}

// =============================================================================
// COMPONENT: PaperCard
// Displays one paper. Click anywhere on the card to expand the abstract.
// Expanded view shows: abstract, Abstract link, PDF link, BibTeX copy button,
// Share link copy button, and citation count.
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
    <div
      className="card-hover rounded-xl border border-ink-600 bg-ink-800 p-4 cursor-pointer"
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex gap-3">
        {/* Rank number on the left */}
        <span className="text-2xl font-mono font-light text-ink-600 w-8 shrink-0 pt-0.5">
          {String(rank).padStart(2, "0")}
        </span>

        {/* All paper content sits inside this div */}
        <div className="flex-1 min-w-0">

          {/* Top row: category badges + star button */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex flex-wrap gap-1.5">
              {paper.categories.slice(0, 3).map(c => <CatBadge key={c} cat={c} />)}
              {paper.topic_label && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-ink-700 text-ink-300 border border-ink-600">
                  {paper.topic_label}
                </span>
              )}
            </div>
            {/* Star button: stopPropagation prevents the card expanding when clicking star */}
            <button
              onClick={e => { e.stopPropagation(); onToggleSave(paper.arxiv_id, isSaved); }}
              className="shrink-0 text-lg leading-none transition-colors"
              style={{ color: isSaved ? "#f97316" : "#363645" }}
              aria-label={isSaved ? "Remove bookmark" : "Save paper"}
            >
              {isSaved ? "★" : "☆"}
            </button>
          </div>

          {/* Title */}
          <h3 className="text-sm font-medium text-white leading-snug mb-1">{paper.title}</h3>

          {/* Authors and publish date */}
          <p className="text-xs text-ink-300 mb-2 truncate">{authors} · {date}</p>

          {/* Trend score bar */}
          <ScoreBar score={paper.trend_score} />

          {/* Expanded content — shown when card is clicked */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-ink-700">

              {/* Full abstract */}
              <p className="text-xs text-ink-300 leading-relaxed mb-3">{paper.abstract}</p>

              {/* Action buttons row */}
              <div className="flex flex-wrap gap-2">

                {/* Link to arXiv abstract page — opens in new tab */}
                <a
                  href={paper.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
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

                {/* Copy BibTeX citation to clipboard
                    buildBibTeX() generates the full @misc{...} string.
                    CopyButton handles the clipboard write and shows "Copied!" feedback. */}
                <CopyButton
                  text={buildBibTeX(paper)}
                  label="BibTeX"
                />

                {/* Copy shareable link to clipboard
                    buildShareURL() just returns paper.url (the arXiv abstract page).
                    Anyone with the link can read the paper for free. */}
                <CopyButton
                  text={buildShareURL(paper)}
                  label="Copy Link"
                />

                {/* Citation count — display only, not a button */}
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
// Row of buttons, one per month that has data in the DB.
// Clicking a month tells Home to switch to it via onChange callback.
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
// Row of topic filter pills generated by the KMeans clustering.
// First pill = "All topics" which clears the filter (sets selected to null).
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
// A small dropdown to pick how papers are sorted.
// Options: trend score (default), citations, publish date.
// Calls onChange with the new value — Home re-fetches with the new sort order.
// =============================================================================
function SortDropdown({ value, onChange }: {
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-ink-500 font-mono">sort by</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-ink-800 border border-ink-600 rounded-lg px-2 py-1 text-xs text-ink-300 font-mono focus:border-accent outline-none cursor-pointer hover:border-ink-400 transition-colors"
      >
        <option value="score">trend score</option>
        <option value="citations">citations</option>
        <option value="date">publish date</option>
      </select>
    </div>
  );
}

// =============================================================================
// COMPONENT: IngestPanel
// The "Fetch papers" form. User picks a month and clicks Fetch.
// Manages its own status state (idle/running/done/error).
// Calls onDone() when finished so Home can reload months and switch tabs.
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

// =============================================================================
// COMPONENT: Home (main page — default export)
// The root of the entire UI. Owns all state and fetches all data.
// Passes data DOWN to children as props.
// Receives events UP from children via callback functions.
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

  // Sort state: "score" | "citations" | "date"
  const [sort, setSort] = useState("score");

  // Tab state: "browse" | "saved" | "ingest"
  const [tab, setTab] = useState<"browse" | "ingest" | "saved">("browse");
  const [stats, setStats] = useState<any>(null);

  // Bookmark state
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedPapers, setSavedPapers] = useState<Paper[]>([]);

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

  // Optimistic star toggle: flips instantly, then syncs with backend
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

  // Re-fetch when month, topic, OR sort changes
  useEffect(() => {
    if (!selectedMonth) return;
    setLoading(true);
    fetchPapers(selectedMonth, selectedTopic || undefined, 20, 0, sort)
      .then(d => { setPapers(d.papers); setTotal(d.total); })
      .catch(() => setPapers([]))
      .finally(() => setLoading(false));
  }, [selectedMonth, selectedTopic, sort]);

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
          <p className="text-xs text-ink-400">discover trending machine learning research papers by month</p>
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

        {/* INGEST TAB */}
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

        {/* SAVED TAB */}
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