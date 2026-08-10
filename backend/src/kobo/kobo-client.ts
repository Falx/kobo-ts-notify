import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from '../config/settings.service';
import type { DealSourceItem, DealSource } from '../engine/deal-engine';
import { coverUrl as koboCoverUrl, bookUrl } from './urls';
import {
  asStr,
  authorFromContributors,
  coerceBool,
  coerceTotalPages,
  extractAmount,
  languageOf,
  seriesFrom,
  toFloat,
} from './parse';

const WISHLIST_URL = 'https://storeapi.kobo.com/v1/user/wishlist';
const WISHLIST_PAGE_SIZE = 100;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 kobo-notify';

@Injectable()
export class KoboClient {
  private readonly logger = new Logger(KoboClient.name);

  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  async getWishlist(): Promise<DealSourceItem[]> {
    if (!this.auth.haveTokens) {
      throw new Error(
        'Kobo not paired yet — start pairing to authenticate once',
      );
    }
    const items: DealSourceItem[] = [];
    let page = 0;
    for (;;) {
      const data = (await this.request(`${WISHLIST_URL}`, {
        params: {
          PageIndex: String(page),
          PageSize: String(WISHLIST_PAGE_SIZE),
        },
      })) as Record<string, unknown>;
      const parsed = this.parseWishlistPage(data);
      items.push(...parsed);
      page += 1;
      const totalPages = coerceTotalPages(data.TotalPageCount);
      if (totalPages !== null && page >= totalPages) break;
      if (parsed.length === 0) break;
    }
    this.logger.log(
      `Wishlist parsed: ${items.length} item(s) across ${page} page(s)`,
    );
    return items;
  }

  private parseWishlistPage(data: Record<string, unknown>): DealSourceItem[] {
    const out: DealSourceItem[] = [];
    const rawItems = data.Items;
    if (!Array.isArray(rawItems)) return out;
    for (const item of rawItems) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const metadata = (item as Record<string, unknown>).ProductMetadata;
      if (!metadata || typeof metadata !== 'object') continue;
      const book = (metadata as Record<string, unknown>).Book;
      if (!book || typeof book !== 'object' || Array.isArray(book)) continue;
      out.push(this.parseBook(book as Record<string, unknown>, 'wishlist'));
    }
    return out;
  }

  parseBook(book: Record<string, unknown>, source: DealSource): DealSourceItem {
    const title = asStr(book.Title);
    const priceInfo = book.Price;
    const rawPrice =
      priceInfo && typeof priceInfo === 'object'
        ? extractAmount(priceInfo)
        : extractAmount(book.Price);
    const rawWasPrice = extractAmount(book.WasPrice);
    const isFree = coerceBool(book.IsFree, false);

    let priceEur = 0;
    if (!isFree) {
      const parsed = toFloat(rawPrice, title, 'Price');
      priceEur = parsed ?? 0;
    }
    const wasPriceEur =
      rawWasPrice === null || rawWasPrice === undefined
        ? null
        : toFloat(rawWasPrice, title, 'WasPrice');

    const slug = asStr(book.Slug);
    const productIdRaw = book.Id;
    const language = languageOf(book.Language);
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
      source,
    };
  }

  /** Metadata helpers (mirrors the Python client's static methods). */
  static coverUrl(imageId: string): string {
    return koboCoverUrl(imageId);
  }

  /** GET/POST with Bearer auth; refreshes tokens once on HTTP 401. */
  async request(
    url: string,
    options: {
      method?: string;
      params?: Record<string, string>;
      body?: unknown;
    } = {},
    allowRetry = true,
  ): Promise<unknown> {
    const { method = 'GET', params, body } = options;
    const target = new URL(url);
    if (params) {
      for (const [key, value] of Object.entries(params))
        target.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      ...this.auth.getAuthHeaders(),
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json',
    };
    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new Error(
        `Kobo request to ${url} failed: ${(error as Error).message}`,
      );
    }

    if (response.status === 401 && allowRetry) {
      this.logger.log(
        `Got HTTP 401 from ${url} — refreshing auth tokens and retrying once`,
      );
      await this.auth.refresh();
      return this.request(url, options, false);
    }
    if (!response.ok) {
      throw new Error(`Kobo ${url} returned HTTP ${response.status}`);
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }
}
