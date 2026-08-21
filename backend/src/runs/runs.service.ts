import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from '../config/settings.service';
import {
  DealEngine,
  dedupeBest,
} from '../engine/deal-engine';
import { BestDealsCrawler } from '../kobo/bestdeals';
import { KoboClient } from '../kobo/kobo-client';
import { PlaywrightScraper } from '../kobo/playwright-scraper';
import { bookUrl } from '../kobo/urls';
import { StateService } from '../state/state.service';
import type { RunRow, SnapshotRow } from '../state/state.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);
  private running = false;

  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    private readonly state: StateService,
    private readonly koboClient: KoboClient,
    private readonly crawler: BestDealsCrawler,
    private readonly scraper: PlaywrightScraper,
    private readonly email: EmailService,
  ) {}

  list(): RunRow[] {
    return this.state.listRuns();
  }

  get(id: number): { run: RunRow; deals: SnapshotRow[] } | null {
    const run = this.state.getRun(id);
    if (!run) return null;
    return { run, deals: this.state.snapshotsForRun(id) };
  }

  /** Start a manual run asynchronously; returns the created run id. */
  triggerRun(): { runId: number } {
    if (this.running) {
      throw new Error('A run is already in progress');
    }
    const runId = this.state.createRun();
    this.running = true;
    void this.executeRun(runId).finally(() => {
      this.running = false;
    });
    this.logger.log(`Run #${runId} started`);
    return { runId };
  }

  private async executeRun(runId: number): Promise<void> {
    try {
      await this.runPipeline(runId);
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      this.logger.error(`Run #${runId} failed: ${message}`);
      this.state.finishRun(runId, {
        status: 'failed',
        itemsScanned: 0,
        dealsFound: 0,
        newDeals: 0,
        priceDrops: 0,
        notified: 0,
        summaryPath: null,
        error: message,
      });
    }
  }

  private async runPipeline(runId: number): Promise<void> {
    if (!this.auth.haveTokens) {
      throw new Error(
        "Kobo not paired yet — use the 'Pair with Kobo' button first",
      );
    }

    this.logger.log(`Run #${runId}: refreshing auth tokens`);
    await this.auth.refresh();

    const cfg = this.settings.get();
    const engine = new DealEngine(
      cfg.priceThresholdEur,
      cfg.minDiscountPercent,
    );

    // 1. Get wishlist
    const rawWishlist = await this.koboClient.getWishlist();
    this.logger.log(
      `Wishlist: ${rawWishlist.map((w) => w.title).join(', ')}`,
    );

    // 2. For each wishlist book, search Kobo for cheaper editions
    this.logger.log(
      `Searching for cheaper editions of ${rawWishlist.length} wishlist book(s)...`,
    );
    const wishlist: typeof rawWishlist = [];
    for (let i = 0; i < rawWishlist.length; i++) {
      const item = rawWishlist[i];
      try {
        this.logger.log(`[${i + 1}/${rawWishlist.length}] Searching for "${item.title}"...`);
        const searchResults = await this.scraper.search(item.title);
        this.logger.log(
          `"${item.title}": ${searchResults.length} result(s)`,
        );
        if (searchResults.length <= 1) {
          wishlist.push(item);
          continue;
        }
        // Match same title AND author, with a valid price, cheaper than current
        const norm = (s: string) =>
          s.toLowerCase().replace(/[''\u2018\u2019\u00b4`]/g, '').replace(/[^a-z0-9]/g, '');
        const candidates = searchResults.filter(
          (r) =>
            norm(r.title) === norm(item.title) &&
            norm(r.author) === norm(item.author) &&
            r.price !== null &&
            r.price > 0 &&
            r.price < item.priceEur &&
            r.slug !== item.slug,
        );
        if (candidates.length === 0) {
          wishlist.push(item);
          continue;
        }
        const cheapest = candidates.reduce((a, b) =>
          (a.price ?? Infinity) < (b.price ?? Infinity) ? a : b,
        );
        this.logger.log(
          `"${item.title}": cheaper edition found — ${cheapest.price}€ (was ${item.priceEur}€, slug: ${cheapest.slug})`,
        );
        wishlist.push({
          ...item,
          slug: cheapest.slug,
          url: bookUrl(cheapest.slug),
          priceEur: cheapest.price!,
          wasPriceEur: item.priceEur,
        });
      } catch {
        wishlist.push(item);
      }
      if (i < rawWishlist.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const wishlistRecords = engine.process(wishlist, 'wishlist');

    const bestdeals = await this.crawler.crawl();
    const bestdealsRecords = engine.process(bestdeals, 'bestdeals');

    const records = dedupeBest([...wishlistRecords, ...bestdealsRecords]);
    const itemsScanned = rawWishlist.length + bestdeals.length;
    this.logger.log(
      `Run #${runId}: scanned ${itemsScanned} item(s), ${records.length} deal(s) after dedupe`,
    );

    // Decide new / price-drop against the stored product state.
    const previousPrices: Record<string, number> = {};
    let newDeals = 0;
    let priceDrops = 0;
    const snapshotByProduct = new Map<string, SnapshotRow>();
    const snapshots: SnapshotRow[] = records.map((record) => {
      const current = this.state.getCurrentProduct(record.productId);
      const isNew = !current;
      const isPriceDrop = !!current && record.priceEur < current.priceEur;
      if (current) previousPrices[record.productId] = current.priceEur;
      if (isNew) newDeals += 1;
      if (isPriceDrop) priceDrops += 1;
      const snapshot: SnapshotRow = {
        runId,
        productId: record.productId,
        title: record.title,
        author: record.author,
        series: record.series,
        url: record.url,
        coverUrl: record.coverUrl,
        language: record.language,
        source: record.source,
        priceEur: record.priceEur,
        wasPriceEur: record.wasPriceEur,
        discountPercent: record.discountPercent,
        isNew,
        isPriceDrop,
        isOwned: current?.isOwned ?? false,
      };
      snapshotByProduct.set(record.productId, snapshot);
      return snapshot;
    });
    this.state.insertSnapshots(runId, snapshots);

    const toNotify = records.filter((record) => {
      const snap = snapshotByProduct.get(record.productId);
      return snap?.isNew || snap?.isPriceDrop;
    });
    this.logger.log(
      `Run #${runId}: ${newDeals} new, ${priceDrops} price drop(s), ${toNotify.length} to notify`,
    );

    const summaryPath = await this.email.sendSummary(
      cfg,
      toNotify,
      previousPrices,
    );

    if (!cfg.dryRun) {
      this.state.upsertProducts(
        records.map((r) => ({
          ...r,
          isOwned: this.state.getCurrentProduct(r.productId)?.isOwned ?? false,
        })),
      );
      this.logger.log(
        `Run #${runId}: price history updated for ${records.length} deal(s)`,
      );
    }

    this.state.finishRun(runId, {
      status: 'success',
      itemsScanned,
      dealsFound: records.length,
      newDeals,
      priceDrops,
      notified: toNotify.length,
      summaryPath,
      error: null,
    });
    this.logger.log(
      `Run #${runId} complete — ${toNotify.length} deal(s) notified`,
    );
  }
}
