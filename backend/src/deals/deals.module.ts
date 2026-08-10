import { Module } from '@nestjs/common';
import { DealsController } from './deals.controller';

@Module({
  controllers: [DealsController],
})
export class DealsModule {}
