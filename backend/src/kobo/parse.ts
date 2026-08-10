// Defensive parsing helpers shared by the wishlist client and the BestDeals
// crawler. Mirrors the verified payload-fact handling of the Python original.

type JsonLike = Record<string, unknown>;

/** Type-safe coercion of a loosely-typed JSON field to string. */
export function asStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

/** Unwrap a nested price object (Price.Price, Price.amount, …). */
export function extractAmount(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of [
      'Price',
      'price',
      'Amount',
      'amount',
      'Value',
      'value',
    ]) {
      const inner = (raw as JsonLike)[key];
      if (inner !== null && inner !== undefined) return inner;
    }
    return null;
  }
  return raw;
}

/** Best-effort numeric conversion; handles "5,99", symbols and thousands separators. */
export function toFloat(
  value: unknown,
  context: string,
  what: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = asStr(value).trim();
  if (!text) return null;
  for (const symbol of ['€', 'EUR', '$', 'USD', 'GBP', '£']) {
    text = text.split(symbol).join('');
  }
  text = text.replace(/\u00a0/g, '');
  if (text.includes('.') && text.includes(',')) text = text.split(',').join('');
  else if (text.includes(',') && !text.includes('.'))
    text = text.split(',').join('.');
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Unparseable ${what} "${asStr(value)}" for "${context}"`);
  }
  return parsed;
}

/** Tolerant truthiness for IsFree. */
export function coerceBool(raw: unknown, fallback: boolean): boolean {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  return ['1', 'true', 'yes', 'on'].includes(asStr(raw).trim().toLowerCase());
}

/** Accept a comma-separated string OR a list of {Name|name} dicts. */
export function authorFromContributors(contributors: unknown): string {
  if (!contributors) return '';
  if (typeof contributors === 'string') return contributors;
  if (Array.isArray(contributors)) {
    const names: string[] = [];
    for (const c of contributors) {
      if (typeof c === 'string') names.push(c);
      else if (c && typeof c === 'object') {
        const name =
          ((c as JsonLike).Name as string) ?? ((c as JsonLike).name as string);
        if (name) names.push(String(name));
      }
    }
    return names.join(', ');
  }
  return asStr(contributors);
}

/** Optional Series field: plain string or a dict with a name-ish key. */
export function seriesFrom(series: unknown): string {
  if (!series) return '';
  if (typeof series === 'string') return series;
  if (series && typeof series === 'object') {
    for (const key of ['Title', 'Name', 'name', 'title']) {
      const value = (series as JsonLike)[key];
      if (value) return asStr(value);
    }
    return '';
  }
  return asStr(series);
}

export function languageOf(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return asStr(raw).trim();
}

/** Locate the Book dict: Items[i].Book or Items[i].ProductMetadata.Book. */
export function bookFromItem(item: unknown): JsonLike | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const obj = item as JsonLike;
  if (obj.Book && typeof obj.Book === 'object') return obj.Book as JsonLike;
  const metadata = obj.ProductMetadata;
  if (metadata && typeof metadata === 'object') {
    const nested = (metadata as JsonLike).Book;
    if (nested && typeof nested === 'object') return nested as JsonLike;
  }
  return null;
}

/** Coerce TotalPageCount-ish values to an int; null when missing/unparseable. */
export function coerceTotalPages(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}
