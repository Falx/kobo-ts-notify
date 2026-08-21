import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser, Page } from 'playwright';

export interface SearchResult {
  slug: string;
  title: string;
  author: string;
  price: number | null;
  currency: string | null;
  wasPrice: number | null;
  isFree: boolean;
}

@Injectable()
export class PlaywrightScraper implements OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightScraper.name);
  private browser: Browser | null = null;
  private requestCount = 0;
  private readonly MAX_REQUESTS_BEFORE_ROTATE = 8;

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }

  private async getBrowser(): Promise<Browser> {
    this.requestCount++;
    if (this.requestCount > this.MAX_REQUESTS_BEFORE_ROTATE) {
      this.logger.log('Rotating browser session to avoid detection');
      await this.browser?.close().catch(() => {});
      this.browser = null;
      this.requestCount = 1;
    }
    if (!this.browser) {
      const { chromium } = await import('playwright-extra');
      const StealthPlugin = (await import('puppeteer-extra-plugin-stealth'))
        .default;
      chromium.use(StealthPlugin());
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });
      this.logger.log('Playwright stealth browser launched');
    }
    return this.browser;
  }

  /**
   * Fetch a page's HTML content using Playwright.
   * Used for pages that block non-browser requests (e.g., BestDeals page).
   */
  async fetchPage(url: string): Promise<string | null> {
    let page: Page | null = null;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);
      return await page.content();
    } catch (error) {
      this.logger.warn(
        `Playwright fetchPage failed for ${url}: ${(error as Error).message}`,
      );
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /**
   * Search Kobo for a query and return all results with prices.
   * Uses __NEXT_DATA__ embedded JSON for reliable data extraction.
   */
  async search(query: string): Promise<SearchResult[]> {
    let page: Page | null = null;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
      const encoded = encodeURIComponent(query);
      const url = `https://www.kobo.com/be/en/search?query=${encoded}&ac=1&ac.morein=true&ac.title=${encoded}&fcmedia=Book&fcsearchfield=title`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(5000);

      const nextData = await page.evaluate(() => {
        const el = document.querySelector('#__NEXT_DATA__');
        return el ? el.textContent : null;
      });
      if (!nextData) return [];

      const data = JSON.parse(nextData);
      const items = data.props?.pageProps?.searchResultSSR?.Items;
      if (!Array.isArray(items)) return [];

      return items
        .map((item) => {
          const book = item.Book || item;
          const slug = book.Slug || '';
          const title = book.Title || '';
          const contributors = book.Contributors;
          const author =
            typeof contributors === 'string'
              ? contributors
              : Array.isArray(contributors) && contributors.length > 0
                ? contributors[0].Name || ''
                : '';
          const priceObj = book.Price;
          const wasPriceObj = book.WasPrice;
          const isFree = book.IsFree === true;

          let price: number | null = null;
          let currency: string | null = null;
          if (priceObj && typeof priceObj === 'object') {
            price = priceObj.Price ?? null;
            currency = priceObj.Currency || 'EUR';
          } else if (typeof priceObj === 'number') {
            price = priceObj;
            currency = 'EUR';
          }

          let wasPrice: number | null = null;
          if (wasPriceObj && typeof wasPriceObj === 'object') {
            wasPrice = wasPriceObj.Price ?? null;
          } else if (typeof wasPriceObj === 'number') {
            wasPrice = wasPriceObj;
          }

          return {
            slug,
            title,
            author,
            price,
            currency,
            wasPrice,
            isFree,
          };
        })
        .filter((r) => r.slug && r.title);
    } catch (error) {
      this.logger.warn(
        `Playwright search failed for "${query}": ${(error as Error).message}`,
      );
      return [];
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  /**
   * Fetch a Kobo product page and extract price from the gizmo config.
   */
  async fetchProductPrice(
    slug: string,
  ): Promise<{ price: number | null; currency: string | null } | null> {
    let page: Page | null = null;
    try {
      const browser = await this.getBrowser();
      page = await browser.newPage();
      const url = `https://www.kobo.com/be/en/ebook/${slug}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      const gizmoConfig = await page.evaluate(() => {
        const el = document.querySelector(
          '[data-kobo-gizmo="ItemDetailActions"]',
        );
        if (!el) return null;
        try {
          return JSON.parse(el.getAttribute('data-kobo-gizmo-config') || '{}');
        } catch {
          return null;
        }
      });

      if (!gizmoConfig?.priceDetails) return null;
      const pd = gizmoConfig.priceDetails;
      const priceStr = pd.displayPrice || pd.listPrice;
      const price = priceStr ? this.parsePrice(priceStr) : null;
      return { price, currency: pd.currency || 'EUR' };
    } catch (error) {
      this.logger.warn(
        `Playwright fetchProductPrice failed for ${slug}: ${(error as Error).message}`,
      );
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  private parsePrice(priceStr: string): number | null {
    const cleaned = priceStr.replace(/[^\d.,]/g, '');
    const normalized = cleaned.replace(',', '.');
    const num = parseFloat(normalized);
    return isNaN(num) ? null : num;
  }
}
