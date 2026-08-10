import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { schedule, ScheduledTask } from 'node-cron';
import type { Subscription } from 'rxjs';
import { SettingsService } from '../config/settings.service';
import { RunsService } from '../runs/runs.service';

/**
 * Daily scheduler. Reads `checkTime` + `tz` from settings and reschedules
 * whenever the settings are persisted via the UI.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private task: ScheduledTask | null = null;
  private subscription: Subscription | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly runs: RunsService,
  ) {}

  onModuleInit() {
    this.reschedule();
    this.subscription = this.settings.onChange.subscribe(() => {
      this.logger.log('Settings changed — rescheduling daily job');
      this.reschedule();
    });
  }

  onModuleDestroy() {
    void this.task?.stop();
    this.subscription?.unsubscribe();
  }

  getNextRun(): Date | null {
    return this.task ? this.task.getNextRun() : null;
  }

  private reschedule() {
    const cfg = this.settings.get();
    const { hour, minute } = this.parseCheckTime(cfg.checkTime);
    void this.task?.stop();
    this.task = null;
    const expression = `${minute} ${hour} * * *`;
    const run = () => {
      void this.runs.triggerRun();
    };
    try {
      this.task = schedule(expression, run, {
        timezone: cfg.tz,
        noOverlap: true,
      });
    } catch (error) {
      this.logger.warn(
        `Cannot schedule with tz "${cfg.tz}" (${(error as Error).message}) — retrying without tz`,
      );
      this.task = schedule(expression, run, { noOverlap: true });
    }
    this.logger.log(
      `Scheduler active — daily run at ${cfg.checkTime} ${cfg.tz || '(system timezone)'}`,
    );
    const next = this.task.getNextRun();
    if (next) this.logger.log(`Next run at ${next.toISOString()}`);
  }

  private parseCheckTime(checkTime: string): { hour: number; minute: number } {
    const [hourText = '10', minuteText = '0'] = (checkTime || '10:00').split(
      ':',
    );
    let hour = Number.parseInt(hourText, 10);
    let minute = Number.parseInt(minuteText, 10);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) hour = 10;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) minute = 0;
    return { hour, minute };
  }
}
