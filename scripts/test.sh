#!/usr/bin/env bash
# Runs every quality gate. Usage: scripts/test.sh [--quick]   (--quick skips the production build and Playwright)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FAILED=()
run() { local name="$1"; shift; printf "\n\033[1m▸ %s\033[0m\n" "$name"; if "$@"; then echo "✓ $name"; else echo "✗ $name"; FAILED+=("$name"); fi; }

run "Backend lint (ruff)"        bash -c 'cd backend && .venv/bin/ruff check app tests'
run "Backend tests (pytest)"     bash -c 'cd backend && .venv/bin/python -m pytest -q'
run "Frontend type check"        bash -c 'cd frontend && npx tsc --noEmit'
run "Frontend lint"              bash -c 'cd frontend && npx next lint'
run "Frontend tests (Vitest)"    bash -c 'cd frontend && npx vitest run'
if [ "${1:-}" != "--quick" ]; then
  run "Production build"         bash -c 'cd frontend && NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npx next build'
  run "E2E (Playwright)"         bash -c 'cd frontend && npx playwright test'
fi

echo
if [ ${#FAILED[@]} -eq 0 ]; then printf "\033[32mAll checks passed.\033[0m\n"; else printf "\033[31mFailed: %s\033[0m\n" "${FAILED[*]}"; exit 1; fi
