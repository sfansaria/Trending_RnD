

// =============================================================================
// FILE: frontend/src/app/layout.tsx
// PURPOSE: The root layout — a wrapper that surrounds EVERY page in the app.
//
// In Next.js, layout.tsx is special. It is NOT a regular component you call
// yourself. Next.js automatically wraps your page.tsx content inside this file.
//
// Think of it like a picture frame:
//   layout.tsx  = the frame (dark background, fonts, tab title)
//   page.tsx    = the picture inside the frame
//
// EXECUTION ORDER when the app loads:
//   1. next.config.js  → sets up the /api proxy
//   2. layout.tsx      → this file, runs once, sets up the shell
//   3. page.tsx        → the actual UI renders inside {children}
// =============================================================================


// "import type" = import only the TypeScript type definition, not actual code.
// Metadata is a TypeScript type provided by Next.js.
// It tells TypeScript what fields are valid inside the metadata object below.
// At runtime this import disappears — it's only used during development
// to catch typos like writing "tittle" instead of "title".
import type { Metadata } from "next";


// Import the global CSS file that applies styles to the ENTIRE app.
// This must be imported here (in the root layout) so it loads on every page.
// It loads: Google Fonts (Inter + JetBrains Mono), Tailwind base styles,
// the dark background, and the card hover animation.

import "./globals.css";

// =============================================================================
// METADATA
// Next.js reads this exported object and puts it into the <head> of the HTML.
// You never write <head> or <title> tags manually in Next.js — this handles it.
// =============================================================================

export const metadata: Metadata = {
  // Sets the browser tab title — what you see in the tab at the top of Chrome.
  title: "Trending RnD",

  // Sets the meta description — used by Google and other search engines
  // to show a summary under the page title in search results.
  description: "Discover trending machine learning research papers by month and topic",
};


// =============================================================================
// ROOT LAYOUT COMPONENT
// This is the default export — Next.js automatically uses this as the shell.
//
// PROPS:
//   children = the content of page.tsx gets injected here by Next.js.
//   React.ReactNode = a TypeScript type meaning "anything React can render"
//                     (JSX, strings, numbers, arrays of elements, etc.)
// =============================================================================


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // <html lang="en"> — the outermost HTML element.
    // lang="en" tells the browser and screen readers the page is in English.
    // This is important for accessibility tools.
    <html lang="en" suppressHydrationWarning>
      {/* <body> wraps all visible content on the page.
          
          className applies two Tailwind CSS utility classes:
          
          min-h-screen  → minimum height = 100% of the viewport height.
                          Ensures the dark background covers the full screen
                          even if the page has very little content.
          
          bg-ink-950    → sets background colour to #0a0a0f (near-black).
                          "ink-950" is our custom colour defined in
                          tailwind.config.js under theme.extend.colors.ink.
                          Without this, the background would be white.
          
          {children}    → this is where page.tsx renders.
                          Next.js replaces {children} with the full output
                          of page.tsx at runtime. */}
      <body className="min-h-screen bg-ink-950">{children}</body>
    </html>
  );
}