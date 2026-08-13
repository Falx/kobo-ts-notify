import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { EmailService } from './email.service';
import { SettingsService } from '../config/settings.service';
import { StateService } from '../state/state.service';
import type { DealRecord } from '../engine/deal-engine';

@Controller('email')
export class EmailController {
  constructor(
    private readonly email: EmailService,
    private readonly settings: SettingsService,
    private readonly state: StateService,
  ) {}

  @Post('test')
  async test(): Promise<{ message: string }> {
    try {
      const message = await this.email.sendTestEmail(this.settings.get());
      return { message };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  @Post('send-summary')
  async sendSummary(
    @Body() body?: { deals?: DealRecord[] },
  ): Promise<{ message: string }> {
    try {
      let records: DealRecord[];
      let previousPrices: Record<string, number> = {};

      if (body?.deals && body.deals.length > 0) {
        // Use provided deals (e.g., from frontend mock data)
        records = body.deals;
      } else {
        // Fetch current deals from database
        const deals = this.state.latestDeals();
        if (deals.length === 0) {
          throw new Error('No deals found. Run a check first.');
        }

        for (const deal of deals) {
          const product = this.state.getCurrentProduct(deal.productId);
          if (product) {
            previousPrices[deal.productId] = product.priceEur;
          }
        }

        records = deals.map((d) => ({
          source: d.source as 'wishlist' | 'bestdeals',
          title: d.title,
          author: d.author,
          series: d.series,
          priceEur: d.priceEur,
          wasPriceEur: d.wasPriceEur,
          discountPercent: d.discountPercent,
          isFree: d.priceEur <= 0,
          url: d.url,
          coverUrl: d.coverUrl,
          language: d.language,
          productId: d.productId,
        }));
      }

      const path = await this.email.sendSummary(
        this.settings.get(),
        records,
        previousPrices,
      );

      if (!path) {
        throw new Error('Summary generation failed (dry run or no records).');
      }

      return { message: `Summary email sent to ${this.settings.get().emailTo}` };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }
}
