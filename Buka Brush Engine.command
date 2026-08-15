#!/bin/bash
# Double-click this file to start the Brush Engine (no Terminal knowledge needed).

cd "$(dirname "$0")" || exit 1

PORT=8765
URL="http://127.0.0.1:${PORT}/project/index.html"

# Stop any previous server on this port (quiet)
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null)
  if [ -n "$PIDS" ]; then
    kill $PIDS 2>/dev/null
    sleep 0.4
  fi
fi

echo ""
echo "  Brush Engine starting..."
echo "  Keep this window open while you use the page."
echo "  Close this window (or press Ctrl+C) to stop."
echo ""

# Open the browser shortly after the server is up
(
  sleep 0.8
  open "$URL" 2>/dev/null || true
) &

# Serve from this folder so /project and /assets both work
python3 -m http.server "$PORT"
