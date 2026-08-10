# Kobo Deal Notifier (TypeScript)

Self-hosted Kobo deal tracker. Scans your Kobo wishlist and the BestDeals
Science-Fiction & Fantasy carousel daily, flags new deals and price drops, and
sends you an HTML email summary. Full TypeScript recreation of the original
Python `kobo-notify`, with a web UI to browse deals, review run history, and
configure everything.

- **Backend**: NestJS API + daily scheduler (`backend/`)
- **Frontend**: Angular 22 + Angular Material UI (`frontend/`)
- **Storage**: SQLite via `better-sqlite3` (`data/kobo.db`), persisted on the host

## Features

- **Deal rules** (OR logic, UI-configurable): free books always qualify; Rule A =
  strikethrough `WasPrice > Price` with discount ≥ `minDiscountPercent`; Rule B =
  price below `priceThresholdEur`.
- **Notifications**: only new deals and price drops are emailed; unchanged deals
  are never re-notified.
- **Web UI**: browse the latest fetched deals (filters, search, price history),
  review run history, edit all settings, trigger runs on demand, and manage Kobo
  pairing.
- **Pairing**: activates your device once via `kobo.com/activate`; tokens persist
  in `tokens.json` and auto-refresh on HTTP 401. No re-pairing needed if you
  already have a `tokens.json` from the original project.

## Quick start

```bash
cp .env.example .env   # fill in your SMTP and deal settings
docker compose up -d --build
```

- Frontend: http://localhost:8080
- Backend API: http://localhost:3000/api (health check at `/api/health`)

### Local development

```bash
# backend (ports 3000)
cd backend && npm install && npm run start:dev

# frontend (ports 4200, proxies /api to :3000)
cd frontend && npm install && ng serve
```

## Configuration

Settings are seeded from `.env` on first boot and edited later from the web UI
(Settings page). Key options:

| Setting | Default | Description |
|---|---|---|
| `priceThresholdEur` | 5.00 | Rule B price threshold |
| `minDiscountPercent` | 0 | Rule A minimum discount % |
| `checkTime` / `tz` | 10:00 / Europe/Brussels | Daily run schedule |
| `dryRun` | false | Write `summary-<date>.html` to `DATA_DIR` instead of emailing |
| `smtpHost/Port/User/Password/Tls` | — | SMTP for the summary email |
| `emailFrom` / `emailTo` | — | Summary envelope |

Kobo device identity: `KOBO_DEVICE_PLATFORM_ID`, `KOBO_AFFILIATE`, `KOBO_APP_VERSION`.

## API (all under `/api`)

- `GET /deals` — latest-run deals (filters: `source`, `isNew`, `isDrop`, `minDiscount`, `q`)
- `GET /deals/:productId/history` — price/source history across runs
- `GET /runs`, `GET /runs/:id` — run history and detail
- `POST /runs` — trigger a run on demand (poll `GET /runs/:id`)
- `GET|PUT /settings` — read/update settings
- `GET /auth/status`, `POST /auth/pair`, `GET /auth/pair/status` — pairing
- `POST /email/test` — send a test email
- `GET /health`

## Tests

```bash
cd backend && npm test   # engine rules, crawler parsing/dedupe, settings
cd frontend && ng test
```

## Notes

- Maintains the original project's behavior of one polite daily pass against
  Kobo's store API.
- The legacy Python `history.db` is not migrated; the UI starts fresh from the
  first run.

See `PLAN.md` for the full design and porting details.