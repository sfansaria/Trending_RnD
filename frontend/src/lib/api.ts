// =============================================================================
// FILE: frontend/src/lib/api.ts
// PURPOSE: All the functions the frontend uses to talk to the backend API.
//          Instead of writing fetch() calls scattered across the UI code,
//          we centralise them here. Each function = one API call.
//
// WHY TYPESCRIPT (.ts not .js):
//   TypeScript adds type annotations (like Paper, Topic interfaces below).
//   This means VS Code will warn you if you try to use a field that doesn't
//   exist, catching bugs before you even run the code.
// =============================================================================

// NEXT_PUBLIC_API_URL: an environment variable you can set to point to a
// deployed backend. In development it's empty (""), so requests go to the
// same origin (localhost:3000), which Next.js proxies to localhost:8000
// via the rewrite rule in next.config.js
const API = process.env.NEXT_PUBLIC_API_URL || "";


// =============================================================================
// TYPE DEFINITIONS
// These describe the shape of data we receive from the API.
// TypeScript uses these to catch bugs at development time.
// They must match exactly what _paper_to_dict() returns in papers.py
// =============================================================================

// Matches the dict returned by _paper_to_dict() in backend/app/api/papers.py
export interface Paper {
  id: number;
  arxiv_id: string;          // e.g. "2401.12345v1"
  title: string;
  abstract: string;          // truncated to 400 chars by the backend
  authors: string[];         // already decoded from JSON: ["Author One", "Author Two"]
  categories: string[];      // e.g. ["cs.LG", "cs.AI"]
  published: string;         // ISO date string e.g. "2024-06-15T09:30:00"
  month_key: string;         // e.g. "2024-06"
  url: string;               // arXiv abstract page URL
  pdf_url: string;           // direct PDF URL
  trend_score: number;       // 0–100
  citation_count: number;
  topic_label: string | null; // null if topics haven't been extracted yet
  topic_id: number | null;
}

// Matches the topic dicts returned by get_topics() in papers.py
export interface Topic {
  id: number;
  label: string;             // e.g. "Diffusion · Image · Generation"
  paper_count: number;       // how many papers are in this cluster
  avg_score: number;         // average trend score of papers in this cluster
  top_paper_ids: string[];   // arxiv_ids of the top 5 papers
}

// HeatmapCell: data for one cell in the heatmap grid (one topic x one month)
// null means that topic had no papers that month
export interface HeatmapCell {
  paper_count: number;
  avg_score: number;
  top_paper_ids: string[];
}
 
// HeatmapData: the full grid returned by /api/heatmap
// months = list of month strings (columns)
// topics = list of topic labels (rows)
// grid   = topic_label → month_key → cell data (or null if no data)
export interface HeatmapData {
  months: string[];
  topics: string[];
  grid: Record<string, Record<string, HeatmapCell | null>>;
}


// =============================================================================
// API FUNCTIONS
// Each function calls one backend endpoint and returns typed data.
// async/await: these are asynchronous — they wait for the network response
//              without blocking the browser from doing other things.
// =============================================================================

// -----------------------------------------------------------------------------
// fetchPapers: GET /api/papers?month=...&topic=...&limit=...&offset=...
// Returns paginated list of papers for a month, optionally filtered by topic
// -----------------------------------------------------------------------------
export async function fetchPapers(month: string, topic?: string, limit = 20, offset = 0, sort="score") {
  // URLSearchParams builds a query string: month=2024-06&limit=20&offset=0
  const params = new URLSearchParams({ month, limit: String(limit), offset: String(offset), sort, }); //send the sort choice to the backnend
  if (topic) params.set("topic", topic);  // only add topic param if provided

  const r = await fetch(`${API}/api/papers?${params}`);
  if (!r.ok) throw new Error("Failed to fetch papers");  // throw = show error to user

  // r.json() parses the JSON response body into a JavaScript object
  // "as Promise<...>" tells TypeScript what type to expect
  return r.json() as Promise<{ month: string; total: number; sort: string, papers: Paper[] }>;
}

// -----------------------------------------------------------------------------
// fetchTopics: GET /api/topics?month=...
// Returns topic clusters for the month — used to populate the topic pills
// -----------------------------------------------------------------------------
export async function fetchTopics(month: string) {
  const r = await fetch(`${API}/api/topics?month=${month}`);
  if (!r.ok) throw new Error("Failed to fetch topics");
  return r.json() as Promise<{ month: string; topics: Topic[] }>;
}

// -----------------------------------------------------------------------------
// fetchMonths: GET /api/months
// Returns list of months that have data — used to show/hide the month picker
// -----------------------------------------------------------------------------
export async function fetchMonths() {
  const r = await fetch(`${API}/api/months`);
  if (!r.ok) throw new Error("Failed to fetch months");
  return r.json() as Promise<{ months: string[] }>;
}

// -----------------------------------------------------------------------------
// searchPapers: GET /api/search?q=...&month=...
// Full-text search across paper titles and abstracts
// -----------------------------------------------------------------------------
export async function searchPapers(q: string, month?: string) {
  const params = new URLSearchParams({ q });
  if (month) params.set("month", month);
  const r = await fetch(`${API}/api/search?${params}`);
  if (!r.ok) throw new Error("Search failed");
  return r.json() as Promise<{ query: string; papers: Paper[] }>;
}

// -----------------------------------------------------------------------------
// triggerIngest: POST /api/ingest?month=...
// Tells the backend to start fetching papers for a month.
// The backend returns immediately; the actual work happens in the background.
// -----------------------------------------------------------------------------
export async function triggerIngest(month: string) {
  // POST request (not GET) because this changes data on the server
  const r = await fetch(`${API}/api/ingest?month=${month}`, { method: "POST" });
  if (!r.ok) throw new Error("Ingest failed");
  return r.json();  // returns { status: "ingestion started", month: "2024-06" }
}

// -----------------------------------------------------------------------------
// fetchStats: GET /api/stats
// Returns total paper count — shown in the header "X papers indexed"
// -----------------------------------------------------------------------------
export async function fetchStats() {
  const r = await fetch(`${API}/api/stats`);
  if (!r.ok) throw new Error("Stats failed");
  return r.json();
}


// =============================================================================
// UTILITY FUNCTIONS
// Small helpers used in the UI to format data
// =============================================================================

// Convert "2024-06" → "June 2024" for display in the month picker
export function formatMonth(key: string) {
  const [y, m] = key.split("-");
  // Date constructor: month is 0-indexed so we subtract 1 from the month
  return new Date(Number(y), Number(m) - 1).toLocaleString("en-GB", {
    month: "long",
    year: "numeric"
  });
}

// Convert "2024-06" → "Jun 24" (short version for heatmap column headers)
export function formatMonthShort(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1).toLocaleString("en-GB", {
    month: "short", year: "2-digit"
  });
}


// Get the current month as "YYYY-MM" for the default month picker value
export function currentMonthKey() {
  const now = new Date();
  // padStart(2, "0") adds a leading zero: month 6 → "06"
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}


//new part for bookmarking

// Save a paper — calls POST /api/saved/{arxiv_id}
export async function savePaper(arxivId: string) {
  const r = await fetch(`${API}/api/saved/${arxivId}`, { method: "POST" });
  if (!r.ok) throw new Error("Failed to save paper");
  return r.json();
}
 
// Remove a saved paper — calls DELETE /api/saved/{arxiv_id}
export async function unsavePaper(arxivId: string) {
  const r = await fetch(`${API}/api/saved/${arxivId}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to unsave paper");
  return r.json();
}
 
// Get all saved papers — calls GET /api/saved
export async function fetchSavedPapers() {
  const r = await fetch(`${API}/api/saved`);
  if (!r.ok) throw new Error("Failed to fetch saved papers");
  return r.json() as Promise<{ total: number; papers: Paper[] }>;
}
 
//new part for heatmap
// GET /api/heatmap — topic x month grid data for the heatmap view
// Returns all topic summaries across all months in one call.
export async function fetchHeatmap() {
  const r = await fetch(`${API}/api/heatmap`);
  if (!r.ok) throw new Error("Failed to fetch heatmap data");
  return r.json() as Promise<HeatmapData>;
}
 
