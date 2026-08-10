import { Module } from '@nestjs/common';
import { KoboClient } from './kobo-client';
import { BestDealsCrawler } from './bestdeals';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [KoboClient, BestDealsCrawler],
  exports: [KoboClient, BestDealsCrawler],
})
export class KoboModule {}
