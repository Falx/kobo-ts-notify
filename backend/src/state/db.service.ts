import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DB_FILENAME = 'kobo.db';

/**
 * Owns the single SQLite connection (better-sqlite3) and the schema.
 * DATA_DIR is a bootstrap env value; it cannot be changed at runtime.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private db: Database.Database | null = null;

  constructor() {
    const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, DB_FILENAME);
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 10000');
    db.exec(_SCHEMA);
    this.db = db;
  }

  get connection(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialised');
    }
    return this.db;
  }

  onModuleDestroy() {
    this.db?.close();
    this.db = null;
  }
}

const _SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  product_id       TEXT PRIMARY KEY,
  title            TEXT NOT NULL DEFAULT '',
  author           TEXT NOT NULL DEFAULT '',
  series           TEXT NOT NULL DEFAULT '',
  url              TEXT NOT NULL DEFAULT '',
  cover_url        TEXT NOT NULL DEFAULT '',
  language         TEXT NOT NULL DEFAULT '',
  source           TEXT NOT NULL DEFAULT '',
  price_eur        REAL NOT NULL,
  was_price_eur    REAL,
  discount_percent INTEGER,
  first_seen       TEXT NOT NULL,
  last_seen        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL DEFAULT 'running',
  items_scanned INTEGER NOT NULL DEFAULT 0,
  deals_found   INTEGER NOT NULL DEFAULT 0,
  new_deals     INTEGER NOT NULL DEFAULT 0,
  price_drops   INTEGER NOT NULL DEFAULT 0,
  notified      INTEGER NOT NULL DEFAULT 0,
  summary_path  TEXT,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS deal_snapshots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER NOT NULL,
  product_id      TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  author          TEXT NOT NULL DEFAULT '',
  series          TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL DEFAULT '',
  cover_url       TEXT NOT NULL DEFAULT '',
  language        TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT '',
  price_eur       REAL NOT NULL,
  was_price_eur   REAL,
  discount_percent INTEGER,
  is_new          INTEGER NOT NULL DEFAULT 0,
  is_price_drop   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_run ON deal_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_product ON deal_snapshots(product_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
`;
