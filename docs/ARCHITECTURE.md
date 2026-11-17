# Architecture

## Overview
```
Browser ── Next.js 15 (App Router, client components) ── fetch ──▶ FastAPI ──▶ services ──▶ SQLAlchemy 2 ──▶ SQLite
                                   iframe[sandbox=""] ◀── sanitised HTML ──────┘
```
Two processes, no queues or caches.

### Backend (`backend/app`)
- `main.py` — app factory, CORS, optional API-key guard, uniform error handlers.
- `routers/` — thin HTTP layer (`campaigns.py`, `data.py`).
- `services/` — business logic: `campaigns` (validation, approval, execution, preview), `audience` (eligibility resolution), `analytics`, `recipients` (query/filter/sort), `followups`, `imports`, `exports`, `bounce`, `metrics`, `emailutil` (validation, sanitising, personalization, CSV safety), `provider`.
- `models.py`, `schemas.py`, `db.py`, `config.py`, `errors.py`.
- `alembic/` — migrations (`render_as_batch` for SQLite).

### Frontend (`frontend/`)
- `app/` routes: `/` Overview, `/review`, `/review/[id]`, `/campaigns/new`, `/campaigns/[id]/edit`, `/analytics`, `/diagnostics`, `/settings`.
- `components/` — app shell, wizard, review view, analytics view, charts, recipient table/drawer, follow-ups, import dialog, `ui/` primitives (Radix + Tailwind, shadcn-style).
- `lib/` — typed API client, Zod schemas, CSV helpers, `useApi` hook.

## Database schema
| Table | Purpose / key columns |
| --- | --- |
| `sender_configurations` | name, email (unique), is_default |
| `campaigns` | name, type, event_name, status (`draft|approved|sent`), source (`manual|import`), sender_*, subject, preview_text, audience_name, body_html, approved_at, executed_at, timestamps |
| `contacts` | external_id (unique), names, email, `email_normalized` (indexed), audience, is_valid_email |
| `suppressions` | `email_normalized`, kind (`unsubscribed|suppressed`), reason; unique(email, kind) — keyed by address so every contact with that address is covered |
| `campaign_recipients` | campaign_id, contact_id (unique pair), eligibility (`eligible|invalid|duplicate|unsubscribed|suppressed`), exclusion_reason |
| `email_deliveries` | one per attempted recipient (unique FK), status (`delivered|bounced`), bounce_type, bounce_reason, provider, sent_at |
| `communication_events` | delivery_id, event_type (`open|click`), occurred_at, url |
| `email_templates` | follow-up drafts: campaign_id, segment, subject, body_html |

Foreign keys use `ON DELETE CASCADE` (SQLite `PRAGMA foreign_keys=ON`). No metric is stored; all dashboards query these rows. The schema uses portable types and is PostgreSQL-ready.

## API design
REST/JSON, Swagger at `/docs`. Pagination `{items,total,page,page_size,pages}`; sorting via `sort`/`order`; errors `{"error":{"code","message","details"}}` with 401/404/409/413/422/500. Pydantic validates payloads; query parameters are validated with patterns/bounds. Search terms are bound parameters with `LIKE` wildcards escaped.

## Email provider abstraction
`EmailProvider.send(OutboundMessage) -> DeliveryOutcome` (`services/provider.py`). `get_provider()` reads `EMAIL_PROVIDER` (only `simulation`). `SimulationEmailProvider` derives every outcome from `sha256(campaign_name|address|salt)` buckets: ~84% delivered; bounces split into hard / soft / mailbox / domain / unknown; ~48% of delivered emails open, ~32% of openers click. Same inputs → same outputs; nothing random per request. Simulated bounce reasons carry "(simulated)".

Execution (`campaigns.execute`): validate → compare-and-set `approved → sending` (concurrent callers lose) → resolve audience → write `campaign_recipients` for every audience member (excluded ones keep their reason) → provider call + `email_deliveries` + events for eligible → `sent`, all in one transaction. Re-calls on a sent campaign return `already_executed: true` and write nothing.

## Analytics rules
- Delivery rate = delivered ÷ attempted × 100; bounce rate = bounced ÷ attempted × 100; open rate = unique opens ÷ delivered × 100; click rate = unique clicks ÷ delivered × 100. *Attempted* = delivery rows. *Unique* = distinct deliveries with ≥1 event. Rates are `null` ("—") when the denominator is 0.
- Health: bounce ≥ 10% → "Needs attention"; ≥ 5% → "Watch"; else "Healthy".
- Insights (deterministic): bounce ≥ 5% → elevated failures; ≥10 delivered and > 60% unopened → test subject/timing; ≥10 opens and click/open < 25% → review content/CTA.
- Bounce classification from free text (`bounce.classify_bounce`): ordered keyword rules; blank → unknown. Permanent = hard, invalid, domain; retryable = soft, mailbox unavailable; unknown is excluded from retries.
- Opens/clicks are approximate (privacy proxies, scanners). No registration data is ingested, so none is shown.

## Pre-send validation
14 checks → `{id,label,status,severity,message,suggestion}`. Blocking: sender name/email present+valid, subject, audience exists, eligible recipients > 0, body, valid variables. Warning: preview text, invalid addresses, invalid links. Information: duplicates, unsubscribed, suppressed. Allowed variables: `first_name, last_name, full_name, email, event_name, campaign_name, unsubscribe_url`.

## Security decisions
- **HTML**: server-side `bleach` allow-list (no script/style/iframe/forms/event handlers, only http/https/mailto/tel URLs, sanitised inline CSS). Sanitise first, then substitute HTML-escaped variables. Rendered document carries a CSP meta (`default-src 'none'`) and is shown in `<iframe sandbox="" srcdoc>` (no scripts, no same-origin).
- **CSV**: size limit, `.csv` + content-type + binary checks, UTF-8 only, row limit; exports prefix `=,+,-,@,\t,\r` cells with `'`.
- **SQL**: SQLAlchemy parameter binding only.
- **Config**: environment variables / `.env`; no secrets in code. Optional `API_KEY` guard for mutating requests.
- **CORS**: explicit origin list, limited methods/headers.
- **Errors/logs**: generic 500 message; logs record only the exception type, never request bodies or addresses.
- Not claimed: authentication, authorization, multi-tenancy, audit logging, rate limiting.
