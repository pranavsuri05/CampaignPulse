# Deployment

Campaign Pulse is a local-first prototype. Nothing here is deployed, and no paid hosting is used.

## Free hosting recipe: Vercel + Render + Neon
Prepared for a public demo; **not deployed by this repository's tooling**. Steps run in your own accounts (no card is needed for the free tiers as far as I know; check each sign-up page).

1. **Database — Neon (free Postgres).** Create a project, copy the connection string (`postgresql://…?sslmode=require`). The app accepts it as is and uses the `psycopg` driver.
2. **API — Render (free web service).** New → Blueprint → select this repo (it reads `render.yaml`). Set `DATABASE_URL` (Neon string) and `CORS_ORIGINS` (your Vercel URL, set after step 3, then redeploy). On every start the service runs `alembic upgrade head`, then `uvicorn`.
3. **Frontend — Vercel (Hobby).** Import the repo, set **Root Directory = `frontend`**, add `NEXT_PUBLIC_API_BASE_URL=https://<your-render-service>.onrender.com`, deploy. The value is inlined at build time, so changing it requires a redeploy.
4. Check `https://<render>/api/health`, then open the Vercel URL.

Free-tier behaviour to expect (verified against provider documentation/pricing pages on 2026-11-17; limits change, so re-check):
- **Render free:** sleeps after 15 minutes without traffic; the next request takes roughly 30–60 s to wake. 750 free instance hours per month. The filesystem is ephemeral, which is why the database is external.
- **Neon free:** about 1 GB storage and 100 compute-hours per project per month, scales to zero when idle (short wake-up on first query); writes fail if storage is exceeded. The app enables `pool_pre_ping` to survive dropped idle connections.
- **Vercel Hobby:** free for personal, non-commercial use only.
- **No authentication:** anyone with the URL can import, edit and delete data. Use only fictional data, keep the URL unlisted, and treat the demo as resettable. `API_KEY` does not help because the browser app would expose it.
- Postgres compatibility was verified with the full backend suite and Alembic migration against a local PostgreSQL 16.14. It has **not** been exercised on Neon itself, and the Playwright E2E suite runs on SQLite only.

## Preparation
1. `scripts/test.sh` must pass.
2. Build the frontend with the **public** API URL: `NEXT_PUBLIC_API_BASE_URL=https://api.example.com npx next build` (the value is inlined at build time).
3. Add real authentication before exposing the app: today there are no user accounts.

## Environment variables
| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./data/campaign_pulse.db` (relative to `backend/`) | `postgresql://user:pass@host/db` also works (`psycopg` is already in requirements) |
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
