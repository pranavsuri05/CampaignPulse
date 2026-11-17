# Test Report

Executed on macOS (Darwin 24.5), Python 3.12.4, Node 22.16, 2026-11-17, with `scripts/test.sh` (final run, after the last code change). Raw gate output: all seven gates reported success.

## Commands executed and results

| Gate | Command | Result |
| --- | --- | --- |
| Backend lint | `cd backend && .venv/bin/ruff check app tests` | pass |
| Backend tests | `cd backend && .venv/bin/python -m pytest -q` | **76 passed, 0 failed, 0 skipped** |
| Type check | `cd frontend && npx tsc --noEmit` (TypeScript strict) | pass, 0 errors |
| Frontend lint | `cd frontend && npx next lint` | 0 warnings, 0 errors |
| Frontend tests | `cd frontend && npx vitest run` | **64 passed, 0 failed, 0 skipped** (6 files) |
| Production build | `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npx next build` | success (9 routes) |
| E2E | `cd frontend && npx playwright test` (bundled Chromium, Next dev server on :3100, backend on :8100, fresh SQLite DB per run) | **2 passed, 0 failed** |

### Backend (76)
- `test_units.py` (29): email validation, bounce classification, rates/zero denominators, zero delivered/opens/clicks, health + insight rules, HTML sanitiser (script, event handlers, `javascript:`, iframe, style), escaped personalization, unsupported variables, link validation, CSV formula injection, simulation determinism, SQLite path resolution.
- `test_api.py` (46): error format, campaign CRUD and server-side validation, contacts import (preview writes nothing, invalid/duplicate/unsubscribed/suppressed counts, re-import reported), empty/malformed/binary/wrong-type/oversize files, missing columns and column mapping, row-level errors (missing id, long names, bad status, extra columns), campaign-recipient import and classification, search/filter/sort/pagination/detail, wildcard escaping, the 14 validation checks (missing sender / invalid sender / missing subject / empty audience / missing body / bad variables / bad links), blocking vs warning acknowledgement, approval reset on edit, **read-only preview** (campaign JSON including `updated_at` unchanged), unsafe HTML, execution (records, exclusions, suppression), **idempotent repeat execution**, reproducible simulation across campaigns, unapproved execution (409), analytics filters, zero-delivery campaign, follow-up segments and exclusion reasons, suppression-safe export, draft create/edit/preview, CSV export filters and formula neutralisation, senders, API-key guard (401), safe 500, Alembic migration on a fresh database.
- `test_sample_data.py` (1): the shipped CSVs import with 0 rejected rows and produce all six bounce classes.

### Frontend unit/component (64)
Navigation (exactly five items, active state, breadcrumb, Simulation banner); `EmailFrame` sandbox (`sandbox=""`, srcdoc, mobile width); Zod schemas; settings form validation and server errors; delete confirmation; wizard step validation, create/patch calls and save errors; sent-campaign edit refusal; overview empty/error/data states; review page (sender/subject/audience, **read-only: only GETs + the side-effect-free validate**, separate Edit link, desktop/mobile tabs, severity grouping + suggestions, acknowledgement gating, blocking gating, execute confirmation dialog, delete confirmation, error state); recipient table (rendering, debounced search, status/bounce filters, **regression test for a filter lost during a pending search debounce**, sorting, pagination, empty/no-match/error+retry, long names, export link filters); recipient drawer (diagnostics, no invented reason); analytics (KPIs, charts, filter-driven refetch, zero denominators, empty/error, summary export); follow-ups (reasons, export link, draft create/edit/preview, never executes); CSV import dialog (preview → commit, error report, server errors, column-mapping prompt).

### End-to-end (2 tests, real browser, real backend, real database checks via `sqlite3`)
`full-journey.spec.ts` walks all 26 requested steps: empty DB and dashboard → import `contacts.csv` (DB: 260 contacts, 15 unsubscribed, 10 suppressed; preview wrote nothing) → import `campaign_recipients.csv` (DB: 3 campaigns, 360 recipients, deliveries match the CSV) → configure sender (invalid email rejected) → create a campaign through the wizard with a deliberate unsupported variable and a `<script>` → pre-send review (sender, subject, audience counts equal the API; sandboxed iframe; script absent; page title untouched) → desktop vs mobile width → three reloads + preview API call leave the campaign row byte-identical and create no deliveries → blocking variable error and missing-preview-text warning visible; approve disabled; API returns 422/409 → Edit, fix, back to review → acknowledge warning, approve → confirm dialog, execute → DB: deliveries = eligible count, excluded recipients have none, no suppressed/unsubscribed address was sent to, all rows `simulation`; three repeat executes return `already_executed` and change nothing → analytics KPIs equal values computed independently from SQLite; domain filter changes the numbers → diagnostics: search a real hard-bounced address, hard-bounce filter count equals DB, every row is a hard bounce, drawer shows the stored reason → follow-up draft created, edited, saved (DB row checked) → CSV export equals the DB-computed eligible set and contains no suppressed address → no console errors.
`import-errors.spec.ts`: empty file, wrong extension, missing columns (mapping prompt, import disabled), invalid rows + downloadable error report.

## Defects found by the tests and fixed (not worked around)
1. Import dialog closed itself after a successful import (the Overview swapped branches and unmounted it) — found by E2E; fixed.
2. The "Acknowledge warnings" checkbox was invisible because a passed `className` replaced its base styles — found by E2E; fixed.
3. A pending search debounce could overwrite a filter chosen just before it fired (stale closure) — found by E2E; fixed, with a unit regression test.
4. `.env.example` used a relative SQLite path that would have created `backend/backend/data` — found while running `setup.sh`/`start.sh`; fixed with path resolution and a test.

## Known issues and caveats
- The E2E console-error check ignores one message: Chromium's "Blocked script execution in 'about:srcdoc'" caused by Playwright's own instrumentation of the deliberately script-less email sandbox. The same page logged no console errors when opened in a normal browser session.
- E2E runs against the Next **dev** server (not `next start`); `start.sh --prod` was not exercised.
- Only Chromium was tested. Firefox/Safari and real mobile devices were not; the "mobile preview" is a 375px iframe.
- `setup.sh` was run on a machine that already had the virtualenv and `node_modules`; a first-run on a clean machine was not verified.
- Airmeet's website was not inspected; the visual identity (indigo accent, light neutral UI) is an interpretation, not a derived match.
- Simulated engagement timestamps are synthetic offsets after the send time and may lie slightly in the future.
- PostgreSQL: after the original report, the Alembic migration and all 76 backend tests were run against a local PostgreSQL 16.14 (`TEST_DATABASE_URL=postgresql+psycopg://… pytest`) and passed. Not tested on Neon itself; the Playwright E2E suite was not run on Postgres.
- Dependencies: Next.js was upgraded from 15.1.3 to 15.5.29 to clear a critical advisory (all gates re-run afterwards and passed). `npm audit --omit=dev` still reports a PostCSS advisory (bundled inside Next) and a Zod 3 advisory whose fix requires the Zod 4 major; neither was addressed. `@playwright/test` is pinned to 1.51.1, the minimum version satisfying Next.js 15.5.29's optional peer dependency (`^1.51.1`); a mismatched version makes `npm install` fail with ERESOLVE (this broke the first Vercel build). Playwright 1.51.1 needs Chromium build 1161: run `npx playwright install chromium`.
- Delivery is simulated only; **no real email delivery was implemented or tested** and no Airmeet API integration exists.
