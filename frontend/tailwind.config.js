// =============================================================================
// FILE: frontend/tailwind.config.js
<<<<<<< HEAD
// PURPOSE: Configures Tailwind CSS — the styling framework we use.
=======
// PURPOSE: Configures Tailwind CSS — the styling framework we use
>>>>>>> dc3743cf2912bb497a84286063f1b324b8b79b74
//          Tailwind works by scanning your code for class names and generating
//          only the CSS those classes need. This file tells it where to look
//          and lets you add custom colours/fonts.
//
// HOW TAILWIND WORKS:
//   Instead of writing CSS files, you add utility classes directly in your HTML:
//   className="flex items-center gap-2 text-white bg-ink-800 rounded-xl"
//   Each class does one thing. Tailwind generates the CSS at build time.
// =============================================================================

/** @type {import('tailwindcss').Config} */
module.exports = {
    // CONTENT: Tell Tailwind which files to scan for class names.
    // It generates CSS ONLY for classes it finds here.
    // This keeps the output CSS small.
    content: ["./src/**/*.{js,ts,jsx,tsx}"],  // scan all files in /src
  
    theme: {
      extend: {
        // CUSTOM FONTS
        // JetBrains Mono is a developer-friendly monospace font.
        // We use it for rank numbers, month keys, and code-like text.
        // Loaded via Google Fonts in globals.css
        fontFamily: {
          mono: ["'JetBrains Mono'", "monospace"],
        },
  
        // CUSTOM COLOURS
        // "ink" = dark background shades (our dark theme)
        // Numbers go from lightest (600) to darkest (950)
        // Use as: bg-ink-800, text-ink-400, border-ink-600, etc.
        colors: {
          ink: {
            950: "#0a0a0f",   // page background (almost black)
            900: "#111118",   // slightly lighter
            800: "#1a1a24",   // card backgrounds
            700: "#252530",   // score bar track, dividers
            600: "#363645",   // borders, muted elements
            400: "#888899",   // muted text
            300: "#aaaacc",   // secondary text
          },
          // "accent" = the purple brand colour used for buttons and highlights
          accent: {
            DEFAULT: "#7c6af7",  // main purple (used as bg-accent, text-accent)
            light: "#a89cf9",    // lighter purple (hover states)
            dim: "#3d3578",      // darker purple (rarely used)
          },
          signal: "#4ade80",  // green — used for high trend scores
          warm: "#f97316",    // orange — used for low trend scores
        },
      },
    },
    plugins: [],
<<<<<<< HEAD
  };
=======
  };
>>>>>>> dc3743cf2912bb497a84286063f1b324b8b79b74
