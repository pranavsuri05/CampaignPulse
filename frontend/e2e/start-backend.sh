#!/usr/bin/env bash
# Starts an isolated backend for Playwright on a fresh, empty database.
set -euo pipefail
cd "$(dirname "$0")/../../backend"
rm -f data/e2e.db
export DATABASE_URL="sqlite:///$(pwd)/data/e2e.db"
export CORS_ORIGINS="http://localhost:3100,http://127.0.0.1:3100"
.venv/bin/alembic upgrade head
exec .venv/bin/uvicorn app.main:app --port 8100
