#!/bin/bash
# =============================================================================
# FILE: start.sh
# PURPOSE: One command to start both the backend and frontend servers.
#          Run this from the project root:  bash start.sh
#
# WHAT IT DOES:
#   1. Starts the FastAPI backend on port 8000 (in the background with &)
#   2. Starts the Next.js frontend on port 3000 (in the background with &)
#   3. Waits for both to finish (they run forever until you press Ctrl+C)
#   4. When you press Ctrl+C, it kills both servers cleanly
# =============================================================================

echo "Starting ArXiv Trends App..."

# Start FastAPI backend
# uvicorn: the server that runs FastAPI
# app.main:app = the Python module path (app/main.py) and the FastAPI instance
# --host 0.0.0.0 = accept connections from any IP (needed for Codespaces)
# --port 8000 = listen on port 8000
# --reload = restart automatically when Python files change (hot reload)
# & = run in the background so we can start the frontend too
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!  # save the process ID so we can kill it later
echo "Backend running on http://localhost:8000 (PID: $BACKEND_PID)"

# Start Next.js frontend
# npm run dev = runs "next dev" (defined in package.json)
# Also runs in background with &
cd ../frontend
npm run dev &
FRONTEND_PID=$!
echo "Frontend running on http://localhost:3000 (PID: $FRONTEND_PID)"

echo ""
echo "Press Ctrl+C to stop both servers."

# trap: when you press Ctrl+C (SIGINT) or the script is killed (SIGTERM),
# run this command: kill both server processes, then print "Stopped."
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" INT TERM

# wait: pause here until both background processes finish.
# Without this, the script would exit immediately, leaving orphaned servers.
wait