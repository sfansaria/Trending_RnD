// =============================================================================
// FILE: frontend/next.config.js
// PURPOSE: Next.js configuration file.
//          The most important thing here is the "rewrite" rule that proxies
//          all /api/* requests from the frontend to the backend.
//
// WHY WE NEED THIS:
//   The frontend runs on localhost:3000
//   The backend runs on localhost:8000
//   When the frontend calls /api/papers, the browser would look for that
//   on localhost:3000 (where there's no backend).
//   The rewrite rule intercepts those requests and forwards them to :8000.
//   This also avoids CORS issues in development.
// =============================================================================

/** @type {import('next').NextConfig} */
const nextConfig = {
    async rewrites() {
      return [
        {
          // Match any URL starting with /api/
          source: "/api/:path*",
          // Forward it to the backend on port 8000
          // :path* captures everything after /api/ and forwards it
          // e.g. /api/papers?month=2024-06 → http://localhost:8000/api/papers?month=2024-06
          destination: "http://localhost:8000/api/:path*",
        },
      ];
    },
  };
  
  module.exports = nextConfig;
