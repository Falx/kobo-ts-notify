import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { StateModule } from './state/state.module';
import { AuthModule } from './auth/auth.module';
import { KoboModule } from './kobo/kobo.module';
import { EmailModule } from './email/email.module';
import { RunsModule } from './runs/runs.module';
import { DealsModule } from './deals/deals.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule,
    StateModule,
    AuthModule,
    KoboModule,
    EmailModule,
    RunsModule,
    DealsModule,
    SchedulerModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
