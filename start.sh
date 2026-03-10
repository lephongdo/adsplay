#!/bin/bash

set -e

MODE="${1:-dev}"

echo "========================================================="
echo "AdPlay Startup Script (macOS / Linux)"
echo "========================================================="
echo "Mode: $MODE"
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is not installed or not in your PATH."
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

cleanup() {
    echo ""
    echo "Stopping AdPlay..."
    if [ -n "$BE_PID" ]; then kill "$BE_PID" 2>/dev/null || true; fi
    if [ -n "$FE_PID" ]; then kill "$FE_PID" 2>/dev/null || true; fi
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "Checking dependencies..."
(
    cd backend
    if [ ! -d "node_modules" ]; then
        npm install
    fi
)
(
    cd frontend
    if [ ! -d "node_modules" ]; then
        npm install
    fi
)

if [ "$MODE" = "prod" ]; then
    echo "Building frontend..."
    (
        cd frontend
        npm run build
    )

    echo "Building backend..."
    (
        cd backend
        npm run build
    )

    echo "Starting production server..."
    (
        cd backend
        npm run start:prod
    ) &
    BE_PID=$!

    echo ""
    echo "AdPlay is starting in production mode."
    echo "Open: http://localhost:3000"
    echo ""
    wait "$BE_PID"
else
    echo "Starting backend dev server..."
    (
        cd backend
        npm run dev
    ) &
    BE_PID=$!

    echo "Starting frontend dev server..."
    (
        cd frontend
        npm run start
    ) &
    FE_PID=$!

    echo ""
    echo "AdPlay is starting in development mode."
    echo "Frontend: http://localhost:4200"
    echo "Backend:  http://localhost:3000"
    echo ""
    wait "$BE_PID" "$FE_PID"
fi
