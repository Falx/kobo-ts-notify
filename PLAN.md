# Kobo Deal Notifier — TypeScript + Angular 22 Recreation

Status: APPROVED — implementation in progress (workspace: `C:\Users\Falx\Workspaces\kobo-ts-notify`)

## Goal

Recreate the Python `kobo-notify` service as a self-hosted TypeScript application:

- **NestJS backend** that fully ports the Python logic (Kobo device pairing, storeapi
  wishlist client, BestDeals SF&F crawler, deal engine, SMTP HTML emailer, daily scheduler).
- **Angular 22 + Angular Material frontend** that is "accessible" (a real web UI) and lets
  the user:
  1. view all the **last fetched deals** (latest run snapshot, with filters + price history),
  2. review **run history**,
  3. edit **all configurable options through the UI** (deal rules, schedule, SMTP, pairing,
     dry-run),
  4. trigger a run on demand and watch it complete.
- **Docker Compose** deployment: `backend` (API + scheduler) and `frontend` (nginx static
  build proxying `/api`).

## User decisions (confirmed)

- Full TypeScript port of the Python logic (no Python retained at runtime).
- NestJS backend.
- Angular Material for the UI.
- Keep the daily SMTP summary email **and** the web UI (both are part of the app).

## Verified facts about the Python original

- Sources: user wishlist (`storeapi.kobo.com/v1/user/wishlist`, Bearer auth, paginated) and
  Kobo Belgium BestDeals page (`kobo.com/be/en/p/BestDeals`) — Science-Fiction & Fantasy
  carousels only, English-language books only.
- Carousels are discovered by parsing `data-track-info` (single-quoted, HTML-entity-encoded
  JSON carrying `listId`); the confirmed SF&F listId
  `6da2830a-40ed-c0a8-4c06-08d72d743eef` is the hardcoded fallback.
- Featured lists: `GET /v1/products/featured/{listId}?pageindex=N&pagesize=100` (Auth
  required; *both* param casings together → HTTP 400; the page returns 403 for a bare UA).
- Deal rules (**OR** logic, runtime-configurable): free → always a deal; **Rule A** — a
  strikethrough `WasPrice > Price` with rounded discount ≥ `MIN_DISCOUNT_PERCENT`;
  **Rule B** — current price `< PRICE_THRESHOLD_EUR` (default 5.00).
- Dedup: one entry per `product_id`, lowest price wins; every edition is reported separately.
- Notification: **new** deals and **price drops** only; unchanged deals are never re-notified.
- SMTP failures never crash a run; dry-run writes `summary-<date>.html` instead of sending.
- Pairing: `auth.kobobooks.com/ActivateOnWeb` → activation code → user enters code once at
  `kobo.com/activate` → poll endpoint until `Status == Complete` → device auth → tokens
  persisted to `tokens.json` and auto-refreshed on HTTP 401.
- Kobo is a gray-area ToS target: keep to **one polite daily pass**.

## Target layout

```
kobo-ts-notify/
├── PLAN.md
├── README.md
├── .env.example                 # seeds DB-backed settings on first boot
├── .gitignore
├── .dockerignore
├── docker-compose.yml           # backend + frontend, volume ./data
├── backend/
│   ├── Dockerfile               # node:24-alpine, non-root
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   └── src/
│       ├── main.ts              # Fastify/Nest bootstrap, CORS, global prefix /api
│       ├── app.module.ts
│       ├── config/              # settings store (DB-backed, seeded from env/.env)
│       ├── state/               # SQLite (better-sqlite3) schema + repositories
│       ├── auth/                # Kobo pairing + token persistence/refresh
│       ├── kobo/                # storeapi client + BestDeals crawler
│       ├── engine/              # deal rules + dedupe
│       ├── runs/                # run pipeline (async) + run store
│       ├── email/               # HTML summary builder + nodemailer sender
│       ├── scheduler/           # node-cron daily job (checkTime + tz)
│       └── api/                 # REST controllers + DTOs (validation)
└── frontend/
    ├── Dockerfile               # build → nginx (serves dist, proxies /api)
    ├── angular.json / package.json / …
    └── src/app/
        ├── deals/               # last-fetched-deal cards + filters
        ├── runs/                # run history + per-run deals
        ├── settings/            # settings form + pairing panel + test email
        └── core/                # ApiService, types, theme
```

## Data model (`data/kobo.db`, SQLite via better-sqlite3)

```sql
settings(key   TEXT PRIMARY KEY, value TEXT);                 -- JSON per key; also the tokens path
products(
  product_id TEXT PRIMARY KEY,
  title TEXT, author TEXT, series TEXT, url TEXT, cover_url TEXT,
  language TEXT, source TEXT,
  price_eur REAL, was_price_eur REAL, discount_percent INTEGER,
  first_seen TEXT, last_seen TEXT
);                                                             -- current deal state per product
runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT, finished_at TEXT, status TEXT,              -- pending/running/success/failed
  items_scanned INTEGER, deals_found INTEGER,
  new_deals INTEGER, price_drops INTEGER, notified INTEGER,
  summary_path TEXT, error TEXT
);
deal_snapshots(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  title TEXT, author TEXT, series TEXT, url TEXT, cover_url TEXT,
  language TEXT, source TEXT,
  price_eur REAL, was_price_eur REAL, discount_percent INTEGER,
  is_new INTEGER, is_price_drop INTEGER,
  FOREIGN KEY(run_id) REFERENCES runs(id)
);                                                             -- per-run snapshot for the UI
```

- **`tokens.json` is reused** (identical JSON shape) — no re-pairing required.
- Legacy `history.db` (`prices` table has no title/author/cover) is **not** migrated; the UI
  starts from the first fresh run instead.

## Settings surface (UI-editable, stored in DB)

| Key | Type | Default | Notes |
|---|---|---|---|
| `priceThresholdEur` | number | 5.0 | Rule B threshold |
| `minDiscountPercent` | number | 0 | Rule A minimum drop % |
| `checkTime` | string `HH:MM` | `10:00` | daily run time, container tz |
| `tz` | string IANA | `Europe/Brussels` | scheduler timezone |
| `dryRun` | boolean | false | write summary HTML only |
| `smtpHost`, `smtpPort`, `smtpUser`, `smtpPassword` | string | — | SMTP (password masked in GET) |
| `smtpTls` | boolean | true | STARTTLS on send |
| `emailFrom`, `emailTo` | string | — | summary envelope |
| `maxCovers` | number | 40 | embedded cover cap |
| `coverTimeoutSec` | number | 8 | per-cover fetch timeout |

Runtime env still honored at bootstrap only: `DATA_DIR` (default `data`), plus defaults above.

## API (all under `/api`, NestJS + class-validator)

- `GET /deals` — latest-run snapshot deals (filters: `source`, `isNew`, `isDrop`,
  `minDiscount`, `q` search; sort: newest/price/discount).
- `GET /deals/:productId/history` — price+source history across runs.
- `GET /runs` / `GET /runs/:id` — run list + detail (with snapshot deals).
- `POST /runs` — trigger an async run; returns `{runId}`; client polls `GET /runs/:id`.
- `GET /settings` / `PUT /settings` — read/update all settings (passwords masked on read).
- `GET /auth/status` — `{paired, email}`.
- `POST /auth/pair` — start pairing; returns `{activationCode, pollIntervalMs}`.
- `GET /auth/pair/status` — poll until complete/expired.
- `POST /email/test` — send a test email (SMTP config expected).
- `GET /health`.

## Docker Compose

```yaml
services:
  backend:
    build: ./backend
    env_file: .env                 # bootstrap defaults (DATA_DIR, …, settings seeds)
    volumes:
      - ./data:/app/data           # kobo.db + tokens.json + summary-*.html
    restart: unless-stopped
    ports: ["3000:3000"]
  frontend:
    build: ./frontend
    ports: ["8080:80"]             # nginx → dist + proxy /api → backend:3000
    depends_on: [backend]
```

## Execution order

1. PLAN.md + repo scaffolding (.gitignore, .env.example, .dockerignore, docker-compose.yml).
2. Backend skeleton: NestJS + better-sqlite3 state module + DB-backed settings.
3. Deal engine + unit tests (rules + dedupe).
4. Kobo storeapi client + BestDeals crawler (ported from Python, incl. defensive parsing).
5. Auth/pairing service (reuses tokens.json) + endpoints.
6. Email builder + nodemailer + dry-run.
7. Scheduler (node-cron) + async run pipeline.
8. REST controllers + DTOs + async run API.
9. Backend Dockerfile + compose wiring.
10. Frontend: Angular 22 + Material scaffold, deals page, runs page, settings page, pairing.
11. Frontend Dockerfile (nginx) + compose final.
12. Build/lint/typecheck both; smoke-test `docker compose up`.

## Verification

- `backend`: Jest unit tests (engine rules, crawler parsing/dedupe, settings round-trip);
  `GET /api/health`; a live manual run using the existing `tokens.json`.
- `frontend`: `ng build` and `ng test`; manual UI pass (pairing status, run-once, deals,
  settings persist, test email).
- `docker compose up --build` — confirm both services healthy and data persists across restarts.