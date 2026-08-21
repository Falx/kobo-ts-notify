import { Module } from '@nestjs/common';
import { KoboClient } from './kobo-client';
import { BestDealsCrawler } from './bestdeals';
import { PlaywrightScraper } from './playwright-scraper';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [KoboClient, BestDealsCrawler, PlaywrightScraper],
  exports: [KoboClient, BestDealsCrawler, PlaywrightScraper],
})
export class KoboModule {}
