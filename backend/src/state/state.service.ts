import { Injectable } from '@nestjs/common';
import { DbService } from './db.service';

/** One normalized deal as stored per run / per product. */
export interface StoredDeal {
  productId: string;
  title: string;
  author: string;
  series: string;
  url: string;
  coverUrl: string;
  language: string;
  source: string;
  priceEur: number;
  wasPriceEur: number | null;
  discountPercent: number | null;
}

export interface RunRow {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'pending' | 'running' | 'success' | 'failed';
  itemsScanned: number;
  dealsFound: number;
  newDeals: number;
  priceDrops: number;
  notified: number;
  summaryPath: string | null;
  error: string | null;
}

export interface SnapshotRow extends StoredDeal {
  runId: number;
  isNew: boolean;
  isPriceDrop: boolean;
}

const NOW = () => new Date().toISOString();

@Injectable()
export class StateService {
  constructor(private readonly db: DbService) {}

  // ---- settings ----------------------------------------------------------

  getSettingsRaw(): Record<string, string> {
    const rows = this.db.connection
      .prepare('SELECT key, value FROM settings')
      .all() as Array<{ key: string; value: string }>;
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  }

  setSettings(values: Record<string, string | number | boolean>): void {
    const stmt = this.db.connection.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    const tx = this.db.connection.transaction(
      (entries: Array<[string, string]>) => {
        for (const [key, value] of entries) stmt.run(key, value);
      },
    );
    tx(Object.entries(values).map(([k, v]) => [k, String(v)]));
  }

  // ---- products (current state per product_id) ---------------------------

  getCurrentProduct(
    productId: string,
  ): (StoredDeal & { firstSeen: string; lastSeen: string }) | null {
    const row = this.db.connection
      .prepare('SELECT * FROM products WHERE product_id = ?')
      .get(productId) as
      | {
          product_id: string;
          title: string;
          author: string;
          series: string;
          url: string;
          cover_url: string;
          language: string;
          source: string;
          price_eur: number;
          was_price_eur: number | null;
          discount_percent: number | null;
          first_seen: string;
          last_seen: string;
        }
      | undefined;
    return row
      ? toStoredDeal(row, {
          firstSeen: row.first_seen,
          lastSeen: row.last_seen,
        })
      : null;
  }

  upsertProducts(deals: StoredDeal[], now: string = NOW()): void {
    const stmt = this.db.connection.prepare(
      `INSERT INTO products (product_id, title, author, series, url, cover_url, language,
         source, price_eur, was_price_eur, discount_percent, first_seen, last_seen)
       VALUES (@product_id, @title, @author, @series, @url, @cover_url, @language,
         @source, @price_eur, @was_price_eur, @discount_percent, @first_seen, @last_seen)
       ON CONFLICT(product_id) DO UPDATE SET
         title=excluded.title, author=excluded.author, series=excluded.series,
         url=excluded.url, cover_url=excluded.cover_url, language=excluded.language,
         source=excluded.source, price_eur=excluded.price_eur,
         was_price_eur=excluded.was_price_eur, discount_percent=excluded.discount_percent,
         last_seen=excluded.last_seen`,
    );
    const tx = this.db.connection.transaction((all: StoredDeal[]) => {
      for (const d of all) {
        const existing = this.getCurrentProduct(d.productId);
        stmt.run({
          ...toDbRow(d),
          first_seen: existing?.firstSeen ?? now,
          last_seen: now,
        });
      }
    });
    tx(deals);
  }

  // ---- runs --------------------------------------------------------------

  createRun(startedAt: string = NOW()): number {
    const info = this.db.connection
      .prepare('INSERT INTO runs (started_at, status) VALUES (?, ?)')
      .run(startedAt, 'running');
    return Number(info.lastInsertRowid);
  }

  finishRun(
    id: number,
    result: {
      status: 'success' | 'failed';
      itemsScanned: number;
      dealsFound: number;
      newDeals: number;
      priceDrops: number;
      notified: number;
      summaryPath: string | null;
      error: string | null;
    },
  ): void {
    this.db.connection
      .prepare(
        `UPDATE runs SET finished_at=?, status=?, items_scanned=?, deals_found=?,
           new_deals=?, price_drops=?, notified=?, summary_path=?, error=?
         WHERE id=?`,
      )
      .run(
        NOW(),
        result.status,
        result.itemsScanned,
        result.dealsFound,
        result.newDeals,
        result.priceDrops,
        result.notified,
        result.summaryPath,
        result.error,
        id,
      );
  }

  listRuns(limit = 50): RunRow[] {
    const rows = this.db.connection
      .prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?')
      .all(limit) as RunRowRaw[];
    return rows.map(toRunRow);
  }

  getRun(id: number): RunRow | null {
    const row = this.db.connection
      .prepare('SELECT * FROM runs WHERE id = ?')
      .get(id) as RunRowRaw | undefined;
    return row ? toRunRow(row) : null;
  }

  getLatestCompletedRun(): RunRow | null {
    const row = this.db.connection
      .prepare(
        "SELECT * FROM runs WHERE status IN ('success', 'failed') ORDER BY id DESC LIMIT 1",
      )
      .get() as RunRowRaw | undefined;
    return row ? toRunRow(row) : null;
  }

  insertSnapshots(runId: number, snapshots: Array<SnapshotRow>): void {
    if (snapshots.length === 0) return;
    const stmt = this.db.connection.prepare(
      `INSERT INTO deal_snapshots (run_id, product_id, title, author, series, url, cover_url,
         language, source, price_eur, was_price_eur, discount_percent, is_new, is_price_drop)
       VALUES (@run_id, @product_id, @title, @author, @series, @url, @cover_url, @language,
         @source, @price_eur, @was_price_eur, @discount_percent, @is_new, @is_price_drop)`,
    );
    const tx = this.db.connection.transaction((all: SnapshotRow[]) => {
      for (const s of all) stmt.run(toSnapshotDbRow(s, runId));
    });
    tx(snapshots);
  }

  snapshotsForRun(runId: number): SnapshotRow[] {
    const rows = this.db.connection
      .prepare('SELECT * FROM deal_snapshots WHERE run_id = ?')
      .all(runId) as Array<SnapshotRawRow>;
    return rows.map(toSnapshotRow);
  }

  historyForProduct(productId: string): SnapshotRow[] {
    const rows = this.db.connection
      .prepare(
        `SELECT s.*, r.finished_at AS _finished_at FROM deal_snapshots s
         JOIN runs r ON r.id = s.run_id
         WHERE s.product_id = ? ORDER BY s.run_id ASC`,
      )
      .all(productId) as Array<SnapshotRawRow>;
    return rows.map((r) => toSnapshotRow(r));
  }

  latestDeals(): SnapshotRow[] {
    const run = this.getLatestCompletedRun();
    if (!run) return [];
    return this.snapshotsForRun(run.id);
  }
}

// ---- row mappers ----------------------------------------------------------

interface StoreRowBase {
  product_id: string;
  title: string;
  author: string;
  series: string;
  url: string;
  cover_url: string;
  language: string;
  source: string;
  price_eur: number;
  was_price_eur: number | null;
  discount_percent: number | null;
}

function toDbRow(d: StoredDeal) {
  return {
    product_id: d.productId,
    title: d.title,
    author: d.author,
    series: d.series,
    url: d.url,
    cover_url: d.coverUrl,
    language: d.language,
    source: d.source,
    price_eur: d.priceEur,
    was_price_eur: d.wasPriceEur,
    discount_percent: d.discountPercent,
  };
}

function toStoredDeal(
  row: StoreRowBase,
  extra: { firstSeen?: string; lastSeen?: string } = {},
): StoredDeal & { firstSeen: string; lastSeen: string } {
  return {
    productId: row.product_id,
    title: row.title,
    author: row.author,
    series: row.series,
    url: row.url,
    coverUrl: row.cover_url,
    language: row.language,
    source: row.source,
    priceEur: row.price_eur,
    wasPriceEur: row.was_price_eur,
    discountPercent: row.discount_percent,
    firstSeen: extra.firstSeen ?? '',
    lastSeen: extra.lastSeen ?? '',
  };
}

interface RunRowRaw {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  items_scanned: number;
  deals_found: number;
  new_deals: number;
  price_drops: number;
  notified: number;
  summary_path: string | null;
  error: string | null;
}

function toRunRow(row: RunRowRaw): RunRow {
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as RunRow['status'],
    itemsScanned: row.items_scanned,
    dealsFound: row.deals_found,
    newDeals: row.new_deals,
    priceDrops: row.price_drops,
    notified: row.notified,
    summaryPath: row.summary_path,
    error: row.error,
  };
}

interface SnapshotRawRow extends StoreRowBase {
  run_id: number;
  is_new: number;
  is_price_drop: number;
}

function toSnapshotRow(row: SnapshotRawRow): SnapshotRow {
  return {
    runId: row.run_id,
    productId: row.product_id,
    title: row.title,
    author: row.author,
    series: row.series,
    url: row.url,
    coverUrl: row.cover_url,
    language: row.language,
    source: row.source,
    priceEur: row.price_eur,
    wasPriceEur: row.was_price_eur,
    discountPercent: row.discount_percent,
    isNew: Boolean(row.is_new),
    isPriceDrop: Boolean(row.is_price_drop),
  };
}

function toSnapshotDbRow(s: SnapshotRow, runId: number) {
  return {
    run_id: runId,
    product_id: s.productId,
    title: s.title,
    author: s.author,
    series: s.series,
    url: s.url,
    cover_url: s.coverUrl,
    language: s.language,
    source: s.source,
    price_eur: s.priceEur,
    was_price_eur: s.wasPriceEur,
    discount_percent: s.discountPercent,
    is_new: s.isNew ? 1 : 0,
    is_price_drop: s.isPriceDrop ? 1 : 0,
  };
}
