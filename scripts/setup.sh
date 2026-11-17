#!/usr/bin/env bash
# One-time setup: virtualenv, dependencies, local env files and database migrations.
# Usage: scripts/setup.sh [--with-e2e]   (--with-e2e also downloads the Playwright Chromium browser)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

say() { printf "\n\033[1m▸ %s\033[0m\n" "$1"; }
die() { printf "\033[31m✗ %s\033[0m\n" "$1" >&2; exit 1; }

say "Checking prerequisites"
PY=""
for c in python3.13 python3.12 python3.11 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' 2>/dev/null; then PY="$c"; break; fi
done
[ -n "$PY" ] || die "Python 3.11+ is required (found: $(python3 --version 2>&1 || echo none)). Install it from python.org or 'brew install python@3.12'."
command -v node >/dev/null 2>&1 || die "Node.js 20+ is required. Install it from nodejs.org or 'brew install node'."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ is required (found $(node --version))."
command -v npm >/dev/null 2>&1 || die "npm is required."
echo "Python: $($PY --version)  Node: $(node --version)  npm: $(npm --version)"

say "Backend: virtualenv and dependencies"
[ -d backend/.venv ] || "$PY" -m venv backend/.venv || die "Could not create the virtual environment."
backend/.venv/bin/pip install --quiet --upgrade pip
backend/.venv/bin/pip install --quiet -r backend/requirements-dev.txt || die "pip install failed. Check your network connection and retry."

say "Frontend: dependencies"
(cd frontend && npm install --no-audit --no-fund) || die "npm install failed. Check your network connection and retry."
if [ "${1:-}" = "--with-e2e" ]; then
  say "Playwright browser"
  (cd frontend && npx playwright install chromium) || die "Playwright browser download failed."
fi

say "Local configuration"
[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example"; }
[ -f frontend/.env.local ] || { echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:8000" > frontend/.env.local; echo "Created frontend/.env.local"; }

say "Database migrations"
mkdir -p backend/data
(cd backend && .venv/bin/alembic upgrade head) || die "Database migration failed."

printf "\n\033[32m✓ Setup complete.\033[0m The database is empty — nothing was imported.\n"
echo "Next: scripts/start.sh   (sample CSVs are in sample-data/)"
