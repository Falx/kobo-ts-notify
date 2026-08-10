import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { RunsModule } from '../runs/runs.module';

@Module({
  imports: [RunsModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
