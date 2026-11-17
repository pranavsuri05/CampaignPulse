#!/usr/bin/env bash
# Starts backend (FastAPI) and frontend (Next.js). Ctrl+C stops both.
# Usage: scripts/start.sh [--prod]    Env: BACKEND_PORT (default 8000), FRONTEND_PORT (default 3000)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

die() { printf "\033[31m✗ %s\033[0m\n" "$1" >&2; exit 1; }
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

[ -x backend/.venv/bin/uvicorn ] || die "Backend is not set up. Run scripts/setup.sh first."
[ -d frontend/node_modules ] || die "Frontend is not set up. Run scripts/setup.sh first."
for p in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  port_busy "$p" && die "Port $p is already in use. Stop the other process or run e.g. BACKEND_PORT=8010 FRONTEND_PORT=3010 scripts/start.sh"
done

(cd backend && .venv/bin/alembic upgrade head >/dev/null) || die "Database migration failed."

PIDS=()
cleanup() { echo; echo "Stopping…"; for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; exit 0; }
trap cleanup INT TERM

export CORS_ORIGINS="http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}"
(cd backend && exec .venv/bin/uvicorn app.main:app --port "$BACKEND_PORT") & PIDS+=($!)

export NEXT_PUBLIC_API_BASE_URL="http://localhost:${BACKEND_PORT}"
if [ "${1:-}" = "--prod" ]; then
  (cd frontend && npx next build && exec npx next start -p "$FRONTEND_PORT") & PIDS+=($!)
else
  (cd frontend && exec npx next dev -p "$FRONTEND_PORT") & PIDS+=($!)
fi

printf "Waiting for services"
for _ in $(seq 1 90); do
  curl -fs "http://localhost:${BACKEND_PORT}/api/health" >/dev/null 2>&1 && curl -fs -o /dev/null "http://localhost:${FRONTEND_PORT}" 2>/dev/null && break
  printf "."; sleep 1
done
echo
curl -fs "http://localhost:${BACKEND_PORT}/api/health" >/dev/null 2>&1 || die "Backend did not become healthy. See output above."

cat <<MSG

  Campaign Pulse is running  (Simulation Mode — No real emails are being sent.)

  Frontend:  http://localhost:${FRONTEND_PORT}
  Backend:   http://localhost:${BACKEND_PORT}
  Swagger:   http://localhost:${BACKEND_PORT}/docs
  Health:    http://localhost:${BACKEND_PORT}/api/health

  Press Ctrl+C to stop.
MSG
wait
