import { coverUrl as koboCoverUrl } from '../kobo/urls';
import { asStr } from '../kobo/parse';

export type DealSource = 'wishlist' | 'bestdeals';

/** One normalized deal, ready for emailing / state tracking / the UI. */
export interface DealRecord {
  source: DealSource;
  title: string;
  author: string;
  series: string;
  priceEur: number;
  wasPriceEur: number | null;
  discountPercent: number | null;
  isFree: boolean;
  url: string;
  coverUrl: string;
  language: string;
  productId: string;
}

/** Raw item shape produced by the wishlist client and the BestDeals crawler. */
export interface DealSourceItem {
  title: string;
  author: string;
  priceEur: number;
  wasPriceEur: number | null;
  isFree: boolean;
  productId: string;
  slug: string;
  imageId: string;
  language: string;
  series: string;
  url: string;
  source?: DealSource;
}

const toStr = (v: unknown): string => asStr(v);
const toFloat = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const toFloatOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Drop duplicate books, keeping the record with the lowest price.
 * When prices are equal, prefers the URL with series info (e.g. "fitz-and-the-fool-book-2").
 * Matches by normalized title+author so different editions of the same book
 * (e.g. different URLs/productIds) are treated as the same.
 * Records without a product id are kept as-is (unique by position).
 */
export function dedupeBest(records: DealRecord[]): DealRecord[] {
  const best = new Map<string, DealRecord>();
  const order: string[] = [];
  records.forEach((rec, index) => {
    const key = dedupeKey(rec) || `__no_id_${index}`;
    const existing = best.get(key);
    if (existing) {
      if (rec.priceEur < existing.priceEur) {
        best.set(key, rec);
      } else if (rec.priceEur === existing.priceEur) {
        // Prefer URL with series info (longer slug) when prices are equal
        if (rec.url.length > existing.url.length) best.set(key, rec);
      }
    } else {
      best.set(key, rec);
      order.push(key);
    }
  });
  return order.map((key) => best.get(key)!);
}

/** Normalize a string for deduplication: lowercase, collapse whitespace, strip punctuation. */
function normalizeForDedupe(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[\u2018\u2019\u201a\u201b\u2032\u2035\u0060]/g, "'") // normalize curly quotes/apostrophes to straight
    .replace(/[^a-z0-9\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a dedup key from title + author, or fall back to productId. */
function dedupeKey(rec: DealRecord): string {
  const title = normalizeForDedupe(rec.title);
  const author = normalizeForDedupe(rec.author);
  if (title || author) return `${title}|||${author}`;
  return rec.productId;
}

/** Applies the deal rules to raw items from any source. */
export class DealEngine {
  private readonly priceThresholdEur: number;
  private readonly minDiscountPercent: number;

  constructor(priceThresholdEur: number, minDiscountPercent: number) {
    this.priceThresholdEur = priceThresholdEur;
    this.minDiscountPercent = minDiscountPercent;
  }

  /** Turn one raw item into a DealRecord, or null if no deal. */
  evaluate(item: unknown, source?: DealSource): DealRecord | null {
    const i = item as Partial<DealSourceItem>;
    const priceEur = toFloat(i.priceEur, 0);
    const wasPriceEur = toFloatOrNull(i.wasPriceEur);
    const isFree = Boolean(i.isFree);
    const discountPercent = this.discount(priceEur, wasPriceEur, isFree);

    if (!this.matches(priceEur, wasPriceEur, discountPercent, isFree)) {
      return null;
    }

    const src: DealSource = source || i.source || 'wishlist';
    const imageId = toStr(i.imageId);
    return {
      source: src,
      title: toStr(i.title),
      author: toStr(i.author),
      series: toStr(i.series),
      priceEur,
      wasPriceEur,
      discountPercent,
      isFree,
      url: toStr(i.url),
      coverUrl: imageId ? koboCoverUrl(imageId) : '',
      language: toStr(i.language),
      productId: toStr(i.productId),
    };
  }

  /** Evaluate every item, drop non-deals, dedupe keeping lowest price. */
  process(items: Array<unknown>, source: DealSource): DealRecord[] {
    const records: DealRecord[] = [];
    for (const item of items) {
      const record = this.evaluate(item, source);
      if (record) records.push(record);
    }
    return dedupeBest(records);
  }

  /** Rounded discount percent; 0 for free books; null when price unknown. */
  private discount(
    price: number,
    wasPrice: number | null,
    isFree: boolean,
  ): number | null {
    if (wasPrice !== null && wasPrice > 0) {
      const discount = Math.round((1 - price / wasPrice) * 100);
      return Math.max(0, discount);
    }
    return isFree ? 0 : null;
  }

  /** Rule evaluation: free OR (Rule A) OR (Rule B). */
  private matches(
    price: number,
    wasPrice: number | null,
    discountPercent: number | null,
    isFree: boolean,
  ): boolean {
    if (isFree) return true;
    if (
      wasPrice !== null &&
      wasPrice > price &&
      discountPercent !== null &&
      discountPercent >= this.minDiscountPercent
    ) {
      return true;
    }
    return price < this.priceThresholdEur;
  }
}
