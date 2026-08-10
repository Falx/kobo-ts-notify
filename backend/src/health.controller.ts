import { Controller, Get } from '@nestjs/common';
import { AuthService } from './auth/auth.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { DbService } from './state/db.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly auth: AuthService,
    private readonly scheduler: SchedulerService,
    private readonly db: DbService,
  ) {}

  @Get()
  health(): {
    status: string;
    db: boolean;
    paired: boolean;
    nextRun: string | null;
    version: string;
  } {
    let dbOk = true;
    try {
      this.db.connection.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    return {
      status: 'ok',
      db: dbOk,
      paired: this.auth.haveTokens,
      nextRun: this.scheduler.getNextRun()?.toISOString() ?? null,
      version: '2.0.0',
    };
  }
}
