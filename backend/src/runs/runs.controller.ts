import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { RunsService } from './runs.service';
import type { RunRow } from '../state/state.service';
import type { DealDto } from '../deals/deals.controller';
import { RunParamsDto } from '../api/dto';

export interface RunDto {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: RunRow['status'];
  itemsScanned: number;
  dealsFound: number;
  newDeals: number;
  priceDrops: number;
  notified: number;
  summaryPath: string | null;
  error: string | null;
}

export interface RunDetailDto {
  run: RunDto;
  deals: DealDto[];
}

@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  list(): RunDto[] {
    return this.runs.list().map((r) => this.toDto(r));
  }

  @Get(':id')
  detail(@Param() params: RunParamsDto): RunDetailDto {
    const found = this.runs.get(params.id);
    if (!found) throw new NotFoundException(`Run ${params.id} not found`);
    return {
      run: this.toDto(found.run),
      deals: found.deals.map((s) => ({
        productId: s.productId,
        title: s.title,
        author: s.author,
        series: s.series,
        url: s.url,
        coverUrl: s.coverUrl,
        language: s.language,
        source: s.source,
        priceEur: s.priceEur,
        wasPriceEur: s.wasPriceEur,
        discountPercent: s.discountPercent,
        isFree: s.priceEur <= 0,
        isNew: s.isNew,
        isPriceDrop: s.isPriceDrop,
        isOwned: s.isOwned,
        firstSeen: '',
        lastSeen: '',
        runId: s.runId,
      })),
    };
  }

  @Post()
  trigger(): { runId: number } {
    try {
      return this.runs.triggerRun();
    } catch (error) {
      throw new ConflictException((error as Error).message);
    }
  }

  private toDto(run: RunRow): RunDto {
    return { ...run };
  }
}
