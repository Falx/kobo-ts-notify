import { Injectable, Logger } from '@nestjs/common';
import type { DealSourceItem } from '../engine/deal-engine';
import { bookUrl } from './urls';
import {
  asStr,
  authorFromContributors,
  bookFromItem,
  coerceBool,
  coerceTotalPages,
  extractAmount,
  languageOf,
  seriesFrom,
  toFloat,
} from './parse';
import { AuthService } from '../auth/auth.service';

const BESTDEALS_URL = 'https://www.kobo.com/be/en/p/BestDeals';
const FEATURED_URL_TEMPLATE =
  'https://storeapi.kobo.com/v1/products/featured/{listId}';

// Verified SF&F carousel ("Fanstastic and futuristic") — hardcoded fallback.
const CONFIRMED_SF_AND_F_LIST_ID = '6da2830a-40ed-c0a8-4c06-08d72d743eef';

const PAGE_SIZE = 100;
const MAX_PAGES_PER_LIST = 20;

// Case-insensitive English allowlist (exact live value could not be probed).
const ENGLISH_LANGS = new Set(['en', 'eng', 'english']);

// Lowercased substrings used to recognize SF&F carousels by name.
// "fanst" deliberately catches Kobo's "Fanstastic and futuristic" typo; "fiction"
// is NOT included so a generic carousel ("Best fiction …") never gets grabbed.
const SF_KEYWORDS = [
  'sci-fi',
  'scifi',
  'science fiction',
  'fantas',
  'fanst',
  'futur',
  'speculat',
];

// Full browser header set; the BestDeals page returns HTTP 403 with a bare UA.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua':
    '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  Referer: 'https://www.kobo.com/be/en',
};

// data-track-info may be wrapped in single or double quotes; values are
// entity-encoded JSON so they never contain a literal quote character.
const TRACK_INFO_RE = /data-track-info=(["'])(.*?)\1/gs;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class BestDealsCrawler {
  private readonly logger = new Logger(BestDealsCrawler.name);
  private discovered: string[] | null = null;

  constructor(private readonly auth: AuthService) {}

  async crawl(): Promise<DealSourceItem[]> {
    const listIds = await this.discoverSfLists();
    const items: DealSourceItem[] = [];
    for (const listId of listIds) {
      items.push(...(await this.crawlList(listId)));
    }
    const unique: DealSourceItem[] = [];
    const seen = new Set<string>();
    for (const deal of items) {
      if (deal.productId) {
        if (seen.has(deal.productId)) continue;
        seen.add(deal.productId);
      }
      unique.push(deal);
    }
    this.logger.log(`BestDeals crawl complete: ${unique.length} deal(s)`);
    return unique;
  }

  // ---- discovery ----------------------------------------------------------

  async discoverSfLists(): Promise<string[]> {
    if (this.discovered) return this.discovered;
    let carousels: Array<{ listId: string; carouselName: string }> = [];
    try {
      const response = await fetch(BESTDEALS_URL, { headers: BROWSER_HEADERS });
      if (!response.ok) {
        throw new Error(`BestDeals page returned HTTP ${response.status}`);
      }
      carousels = parseCarousels(await response.text());
    } catch (error) {
      this.logger.warn(
        `BestDeals page unreachable (${(error as Error).message}) — using confirmed SF&F listId`,
      );
    }

    const sfIds = carousels
      .filter((c) => isSfName(c.carouselName))
      .map((c) => c.listId);
    if (!sfIds.includes(CONFIRMED_SF_AND_F_LIST_ID)) {
      sfIds.push(CONFIRMED_SF_AND_F_LIST_ID);
    }
    if (sfIds.length === 1) {
      this.logger.warn(
        `No SF&F carousel recognized (${carousels.length} parsed) — using confirmed SF&F listId`,
      );
    }
    this.logger.log(
      `Discovered ${sfIds.length} SF&F carousel(s): ${sfIds.join(', ')}`,
    );
    this.discovered = sfIds;
    return sfIds;
  }

  // ---- crawl internals ----------------------------------------------------

  private async crawlList(listId: string): Promise<DealSourceItem[]> {
    const out: DealSourceItem[] = [];
    for (let page = 0; page < MAX_PAGES_PER_LIST; page += 1) {
      let data: Record<string, unknown>;
      try {
        data = await this.fetchFeaturedPage(listId, page);
      } catch (error) {
        const status = (error as { status?: number }).status;
        const message = (error as Error).message;
        if ([401, 403].includes(status ?? 0)) {
          this.logger.warn(
            `featured list ${listId} requires auth / is forbidden (${message}) — skipping`,
          );
        } else {
          this.logger.warn(
            `featured list ${listId} page ${page} failed (${message}) — skipping`,
          );
        }
        break;
      }

      const rawItems = pickKey(data, 'Items', 'items', 'Products', 'products');
      if (!Array.isArray(rawItems)) {
        this.logger.warn(
          `featured list ${listId} page ${page} has no Items array; keys=${Object.keys(data).sort().join(',')}`,
        );
        break;
      }

      const pageItems = this.parseFeaturedPage(rawItems);
      out.push(...pageItems);
      const totalPages = coerceTotalPages(
        pickKey(data, 'TotalPageCount', 'totalPageCount'),
      );
      if (rawItems.length === 0) break;
      if (totalPages !== null && page + 1 >= totalPages) break;
      if (page < MAX_PAGES_PER_LIST - 1) {
        await sleep(300 + Math.random() * 200); // polite 0.3–0.5 s between pages
      }
    }
    this.logger.log(`featured list ${listId} parsed: ${out.length} item(s)`);
    return out;
  }

  private async fetchFeaturedPage(
    listId: string,
    page: number,
  ): Promise<Record<string, unknown>> {
    const url = new URL(FEATURED_URL_TEMPLATE.replace('{listId}', listId));
    // Lowercase pair only — sending both casings together is rejected (HTTP 400).
    url.searchParams.set('pageindex', String(page));
    url.searchParams.set('pagesize', String(PAGE_SIZE));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.auth.haveTokens) {
      Object.assign(headers, this.auth.getAuthHeaders());
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== 'object') {
      throw new Error('featured response is not an object');
    }
    return body as Record<string, unknown>;
  }

  private parseFeaturedPage(rawItems: unknown[]): DealSourceItem[] {
    const out: DealSourceItem[] = [];
    for (const item of rawItems) {
      const book = bookFromItem(item);
      if (!book) continue;
      const deal = this.dealFromBook(book);
      if (deal) out.push(deal);
    }
    return out;
  }

  private dealFromBook(book: Record<string, unknown>): DealSourceItem | null {
    const title = asStr(book.Title);
    const language = languageOf(book.Language);
    if (!ENGLISH_LANGS.has(language.toLowerCase())) {
      this.logger.log(
        `Dropping non-English item (language ${language || '<empty>'})`,
      );
      return null;
    }

    const rawPrice = extractAmount(book.Price);
    const rawWasPrice = extractAmount(book.WasPrice);
    const isFree = coerceBool(book.IsFree, false);
    const priceEur = isFree ? 0 : (toFloat(rawPrice, title, 'Price') ?? 0);
    const wasPriceEur =
      rawWasPrice === null || rawWasPrice === undefined
        ? null
        : toFloat(rawWasPrice, title, 'WasPrice');

    const slug = asStr(book.Slug);
    const productIdRaw = book.Id;
    const imageId = asStr(book.ImageId);

    return {
      title,
      author: authorFromContributors(book.Contributors),
      priceEur,
      wasPriceEur,
      isFree,
      productId:
        productIdRaw === null || productIdRaw === undefined
          ? ''
          : asStr(productIdRaw),
      slug,
      imageId,
      language,
      series: seriesFrom(book.Series),
      url: slug ? bookUrl(slug) : '',
      source: 'bestdeals',
    };
  }
}

// ---- module-level parsing helpers ------------------------------------------

/** First value whose key matches one of *names* case-insensitively. */
export function pickKey(
  data: Record<string, unknown>,
  ...names: string[]
): unknown {
  const folded = new Map<string, unknown>();
  for (const [k, v] of Object.entries(data)) folded.set(k.toLowerCase(), v);
  for (const name of names) {
    const hit = folded.get(name.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return null;
}

function decodeTrackInfo(raw: string): Record<string, unknown> | null {
  const text = raw
    .split('&quot;')
    .join('"')
    .split('&#x27;')
    .join("'")
    .split('&#39;')
    .join("'")
    .split('&amp;')
    .join('&');
  try {
    const data = JSON.parse(text) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isSfName(name: string): boolean {
  if (!name) return false;
  const folded = name.toLowerCase();
  return SF_KEYWORDS.some((term) => folded.includes(term));
}

export function parseCarousels(
  html: string,
): Array<{ listId: string; carouselName: string }> {
  const out: Array<{ listId: string; carouselName: string }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(TRACK_INFO_RE)) {
    const data = decodeTrackInfo(match[2]);
    if (!data || typeof data.listId !== 'string') continue;
    const listId = data.listId;
    if (!listId || seen.has(listId)) continue;
    seen.add(listId);
    out.push({
      listId,
      carouselName: asStr(data.carouselName),
    });
  }
  return out;
}
