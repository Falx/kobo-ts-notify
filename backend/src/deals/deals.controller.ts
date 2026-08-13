import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { StateService } from '../state/state.service';
import type { SnapshotRow } from '../state/state.service';
import { DealsQueryDto } from '../api/dto';

export interface DealDto {
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
  isFree: boolean;
  isNew: boolean;
  isPriceDrop: boolean;
  isOwned: boolean;
  firstSeen: string;
  lastSeen: string;
  runId: number;
}

export interface PricePointDto {
  runId: number;
  priceEur: number;
  wasPriceEur: number | null;
  discountPercent: number | null;
  source: string;
  isNew: boolean;
  isPriceDrop: boolean;
}

@Controller('deals')
export class DealsController {
  constructor(private readonly state: StateService) {}

  /** Latest-run snapshot deals, with filters/sort. */
  @Get()
  list(@Query() query: DealsQueryDto): DealDto[] {
    let deals = this.state.latestDeals().map((snap) => this.toDealDto(snap));

    if (query.source) deals = deals.filter((d) => d.source === query.source);
    if (isTruthy(query.isNew)) deals = deals.filter((d) => d.isNew);
    if (isTruthy(query.isDrop)) deals = deals.filter((d) => d.isPriceDrop);
    if (query.isOwned !== undefined) {
      const showOwned = isTruthy(query.isOwned);
      deals = deals.filter((d) => d.isOwned === showOwned);
    }
    if (query.minDiscount !== undefined) {
      deals = deals.filter(
        (d) => (d.discountPercent ?? 0) >= (query.minDiscount ?? 0),
      );
    }
    if (query.q) {
      const needle = query.q.toLowerCase();
      deals = deals.filter(
        (d) =>
          d.title.toLowerCase().includes(needle) ||
          d.author.toLowerCase().includes(needle) ||
          d.series.toLowerCase().includes(needle),
      );
    }

    switch (query.sort) {
      case 'price-asc':
        deals.sort((a, b) => a.priceEur - b.priceEur);
        break;
      case 'price-desc':
        deals.sort((a, b) => b.priceEur - a.priceEur);
        break;
      case 'discount-desc':
        deals.sort(
          (a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0),
        );
        break;
      default:
        deals.sort((a, b) => b.priceEur - a.priceEur); // newest run, highest price first
        break;
    }
    return deals;
  }

  /** Per-product price history across runs. */
  @Get(':productId/history')
  history(
    @Param('productId') productId: string,
  ): PricePointDto[] | { error: string } {
    const decoded = decodeURIComponentSafe(productId || '');
    const points = this.state.historyForProduct(decoded);
    return points.map((p) => ({
      runId: p.runId,
      priceEur: p.priceEur,
      wasPriceEur: p.wasPriceEur,
      discountPercent: p.discountPercent,
      source: p.source,
      isNew: p.isNew,
      isPriceDrop: p.isPriceDrop,
    }));
  }

  /** Toggle owned status for a product. */
  @Patch(':productId/owned')
  toggleOwned(@Param('productId') productId: string): { isOwned: boolean } {
    const decoded = decodeURIComponentSafe(productId || '');
    const isOwned = this.state.toggleOwned(decoded);
    return { isOwned };
  }

  private toDealDto(snap: SnapshotRow): DealDto {
    const product = this.state.getCurrentProduct(snap.productId);
    return {
      productId: snap.productId,
      title: snap.title,
      author: snap.author,
      series: snap.series,
      url: snap.url,
      coverUrl: snap.coverUrl,
      language: snap.language,
      source: snap.source,
      priceEur: snap.priceEur,
      wasPriceEur: snap.wasPriceEur,
      discountPercent: snap.discountPercent,
      isFree: snap.priceEur <= 0,
      isNew: snap.isNew,
      isPriceDrop: snap.isPriceDrop,
      isOwned: snap.isOwned,
      firstSeen: product?.firstSeen ?? '',
      lastSeen: product?.lastSeen ?? '',
      runId: snap.runId,
    };
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
