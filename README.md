# Campaign Pulse

> **Send with confidence. Understand every outcome.**

Campaign Pulse is an independent product-extension concept for event organizers using [Airmeet](https://www.airmeet.com/). It is **not** an official Airmeet product and has **no Airmeet API integration**. It addresses two customer requests listed *Under Review* on Airmeet's public roadmap:

1. **More details on email performance data** — see exactly *which* addresses failed delivery, not just a percentage.
2. **Add subject line and further details to email preview** — verify sender, subject, audience and the real email *without entering edit mode*.

> **Simulation Mode — No real emails are being sent.** Email sending **and** all delivery, bounce, open and click outcomes are simulated by a deterministic `SimulationEmailProvider`, or come from the CSV files you import. Real delivery is not implemented.

## Features

**Pre-send verification (request 2)**
- 7-step campaign flow: details → sender → subject/preview text → audience → HTML content → pre-send review → approval & execution
- Read-only review: sender, subject, preview text, audience counts (total / eligible / invalid / duplicate / suppressed / unsubscribed), sanitized HTML rendered in a sandboxed iframe, desktop and mobile views, sample-recipient personalization
- 14-point checklist with **Blocking / Warning / Information** severities, a correction suggestion for every failure, and a documented readiness score (100 − 25 per blocking − 10 per warning)
- Viewing never modifies a campaign; **Edit** is a separate action. Editing an approved campaign resets its approval.

**Post-send analytics & diagnostics (request 1)**
- KPIs computed from delivery/event rows (attempted, delivered, bounced, unique opens/clicks and the four rates), delivery donut, engagement bars, timeline, bounce-reason distribution, rule-based insights
- Recipient table: search, delivery/bounce/engagement filters, campaign filter, sorting, pagination, detail drawer, CSV export that respects the active filters
- Bounce classes: hard, soft, invalid email, mailbox unavailable, domain issue, other/unknown (never invented when the source lacks a reason)

**Supporting**
- Follow-up segments (bounced-retryable, delivered-unopened, opened-not-clicked) with per-recipient include/exclude reasons, editable deterministic draft templates, suppression-safe CSV export. Follow-ups are **never** sent.
- CSV import with header detection, column mapping, preview, validation, duplicate detection, error report and transactional commit
- Sender settings

No LLM or paid API is used anywhere; insights are deterministic rules over database metrics.

## Tech stack
Next.js 15 (App Router) · TypeScript strict · Tailwind CSS · shadcn/ui-style components (Radix) · Lucide · Recharts · React Hook Form + Zod — FastAPI · SQLAlchemy 2 · Pydantic · Alembic · SQLite — Pytest · Vitest + React Testing Library · Playwright.

## Architecture overview
Two local processes and one SQLite file; no queues, caches or external services.

```
Browser ── Next.js 15 (App Router) ──▶ FastAPI ──▶ services ──▶ SQLAlchemy ──▶ SQLite
              └─ iframe[sandbox=""] ◀── sanitised email HTML ──┘
```
- **Frontend** (`frontend/`): pages for Overview, Pre-send Review, Email Analytics, Recipient Diagnostics and Settings; typed API client, Zod forms, Recharts.
- **Backend** (`backend/app/`): thin routers over a service layer (validation, audience resolution, analytics, imports/exports, follow-ups) and an `EmailProvider` abstraction whose only implementation is the deterministic `SimulationEmailProvider`.
- **Data**: normalized tables for campaigns, contacts, suppressions, campaign recipients, deliveries, events, templates and senders; all metrics are computed from rows, never stored. Migrations are managed with Alembic.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Screenshots
_Screenshots will be added here._

<!-- | Pre-send review | Email analytics | Recipient diagnostics | -->
<!-- | docs/screenshots/review.png | docs/screenshots/analytics.png | docs/screenshots/diagnostics.png | -->

## Install and run (macOS)

Prerequisites: Python 3.11+, Node.js 20+.

```bash
scripts/setup.sh        # venv, dependencies, .env, migrations (add --with-e2e to download the Playwright browser)
scripts/start.sh        # starts backend + frontend; Ctrl+C stops both
```

| | URL |
| --- | --- |
| Frontend | http://localhost:3000 |
| Backend | http://localhost:8000 |
| Swagger | http://localhost:8000/docs |
| Health | http://localhost:8000/api/health |

Ports in use? `BACKEND_PORT=8010 FRONTEND_PORT=3010 scripts/start.sh`. Production build: `scripts/start.sh --prod`.

## CSV import
The app starts empty. Click **Import contacts** on the Overview (or in Settings), choose `sample-data/contacts.csv`, review the preview, then import. Repeat with `sample-data/campaign_recipients.csv` (**contacts first**). Details: [sample-data/README.md](sample-data/README.md).

## Tests
```bash
scripts/test.sh          # lint, pytest, tsc, eslint, vitest, production build, Playwright
scripts/test.sh --quick  # skip build and E2E
cd backend && .venv/bin/python -m pytest -q
cd frontend && npx vitest run && npx playwright test
```
Results and caveats: [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## API
Interactive docs at `/docs`. Main routes: `/api/campaigns` (CRUD) · `POST /api/campaigns/{id}/validate|approve|execute` · `GET /api/campaigns/{id}/preview|analytics|followups` · `/api/recipients` · `/api/analytics` · `POST /api/import/contacts|campaign-recipients` · `/api/exports/recipients` · `/api/settings/senders` · `/api/health`. Errors share one shape: `{"error": {"code", "message", "details"}}`.

## Documentation
[Product spec](docs/PRODUCT_SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [Test report](docs/TEST_REPORT.md) · [Deployment](docs/DEPLOYMENT.md)

## Limitations
- Simulation only; no real email delivery, no Airmeet integration, no scheduling, no registration/attendance data.
- Simulated engagement timestamps are synthetic offsets after the send time and can lie in the near future.
- Opens/clicks are approximations (privacy proxies, security scanners).
- Some dependency advisories remain open; see the Dependencies note in [docs/TEST_REPORT.md](docs/TEST_REPORT.md).
- No user accounts. Optional shared `API_KEY` guards mutating requests, but the bundled UI does not send it.
- SQLite for local use; Playwright runs against Next dev server with a throwaway database.
