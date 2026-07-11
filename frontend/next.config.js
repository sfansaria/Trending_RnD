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

<<<<<<< HEAD
// /** @type {import('next').NextConfig} */
// const nextConfig = {
//     async rewrites() {
//       return [
//         {
//           // Match any URL starting with /api/
//           source: "/api/:path*",
//           // Forward it to the backend on port 8000
//           // :path* captures everything after /api/ and forwards it
//           // e.g. /api/papers?month=2024-06 → http://localhost:8000/api/papers?month=2024-06
//           destination: "http://localhost:8000/api/:path*",
//         },
//       ];
//     },
//   };
  
//   module.exports = nextConfig;


//new

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (process.env.NODE_ENV === "development") { //It checks NODE_ENV — an environment variable that Next.js sets automatically:
      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:8000/api/:path*",
        },
      ];
    }
    return []; // no proxy in production
  },
};

module.exports = nextConfig;

// on the mac the proxy is needed to avoid the CORS issue (NODE_ENV) is set to ""development" when running the Next.js dev server on your Mac, so the proxy is enabled.
//but in production (when deployed to Vercel), NODE_ENV is set to "production", so the proxy is disabled. 
// This is because in production, the frontend and backend are served from the same domain, so there's no CORS issue. 
//On your Mac        → proxy is ON  → /api/* → localhost:8000  
//On Vercel          → proxy is OFF → /api/* goes directly via NEXT_PUBLIC_API_URL  
=======
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
>>>>>>> dc3743cf2912bb497a84286063f1b324b8b79b74
