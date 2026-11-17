# Deployment

Campaign Pulse is a local-first prototype. Nothing here is deployed, and no paid hosting is used.

## Preparation
1. `scripts/test.sh` must pass.
2. Build the frontend with the **public** API URL: `NEXT_PUBLIC_API_BASE_URL=https://api.example.com npx next build` (the value is inlined at build time).
3. Add real authentication before exposing the app: today there are no user accounts.

## Environment variables
| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./data/campaign_pulse.db` (relative to `backend/`) | Use `postgresql+psycopg://user:pass@host/db` in production (add `psycopg[binary]` to requirements) |
| `CORS_ORIGINS` | `http://localhost:3000,...` | Exact frontend origin(s) |
| `EMAIL_PROVIDER` | `simulation` | Only `simulation` exists |
| `MAX_UPLOAD_BYTES` / `MAX_IMPORT_ROWS` | 5 MB / 20000 | Import limits |
| `API_KEY` | empty | If set, POST/PATCH/DELETE require `X-API-Key` (the bundled UI does not send it; put the API behind an authenticating proxy instead) |
| `UNSUBSCRIBE_BASE_URL` | example.com | Base for the `{{unsubscribe_url}}` preview value |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Frontend → backend URL |

## Migrations
Run `alembic upgrade head` (from `backend/`) on every deploy before starting the API. The initial migration `0001` creates all tables. Test the migration on PostgreSQL before relying on it; SQLite-specific behaviour (batch mode) is harmless there. Note `suppressions` and `contacts` are keyed by normalized email strings; keep that normalization when moving data.

## Hosting architecture (suggested)
- Frontend: `next build && next start` (or a Node host / container) behind HTTPS.
- Backend: `uvicorn app.main:app --workers 2` behind a reverse proxy with TLS.
- Database: managed PostgreSQL with backups.
- One region, two small services; no Redis/queues are required.

## Adding a real email provider
1. Implement `EmailProvider.send` for the service (SES, SendGrid, SMTP, …) returning `DeliveryOutcome`.
2. Register it in `get_provider()` under a new `EMAIL_PROVIDER` value; read credentials from the environment only.
3. Replace the synchronous loop in `campaigns.execute` with batched sends and persist provider message ids.
4. Ingest provider webhooks (delivered, bounced with diagnostic codes, opened, clicked, unsubscribed, complaint) into `email_deliveries` / `communication_events` / `suppressions` — `classify_bounce` can map diagnostic text to the six classes.
5. Add sender-domain verification (SPF/DKIM/DMARC) before enabling real sends, and keep Simulation Mode available.

## Security checklist
- [ ] Authentication and authorization in front of the API (not implemented)
- [ ] HTTPS everywhere; restrict `CORS_ORIGINS`
- [ ] Secrets in a secret manager, not in `.env` files in the repo
- [ ] PostgreSQL with least-privilege role and backups
- [ ] Rate limiting and request-size limits at the proxy
- [ ] Log retention without personal data
- [ ] Dependency audit (`pip-audit`, `npm audit`) and pinned versions
- [ ] Legal basis, consent and unsubscribe handling reviewed before any real sending
