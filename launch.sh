#!/usr/bin/env bash
# Stella AI Chatbot Launcher Script
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

# Ensure venv exists
if [ ! -f "$DIR/.venv/bin/python3" ]; then
    echo "Virtual environment not found, creating..."
    uv venv "$DIR/.venv"
    uv pip install --python "$DIR/.venv/bin/python3" fastapi uvicorn kokoro-onnx soundfile ddgs httpx pydantic requests
fi

# Check if server is already running on port 5050
if ! curl -s http://127.0.0.1:5050/api/health >/dev/null 2>&1; then
    echo "Starting Stella AI Server on port 5050..."
    nohup "$DIR/.venv/bin/python3" "$DIR/server.py" >> "$DIR/server.log" 2>&1 &
    disown
    
    # Wait for server to become healthy
    for i in {1..20}; do
        if curl -s http://127.0.0.1:5050/api/health >/dev/null 2>&1; then
            echo "Stella AI Server started successfully."
            break
        fi
        sleep 0.25
    done
else
    echo "Stella AI Server is already running on port 5050."
fi

# Launch application window in Google Chrome (App mode) or default browser
URL="http://localhost:5050"
if command -v google-chrome >/dev/null 2>&1; then
    exec google-chrome --app="$URL" >/dev/null 2>&1 &
elif command -v brave-browser >/dev/null 2>&1; then
    exec brave-browser --app="$URL" >/dev/null 2>&1 &
elif command -v chromium >/dev/null 2>&1; then
    exec chromium --app="$URL" >/dev/null 2>&1 &
else
    exec xdg-open "$URL" >/dev/null 2>&1 &
fi
