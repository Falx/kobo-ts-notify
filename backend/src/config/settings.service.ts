import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Subject } from 'rxjs';
import { StateService } from '../state/state.service';
import {
  AppSettings,
  DEFAULT_SETTINGS,
  ENV_TO_SETTINGS,
  SECRET_KEYS,
  SettingsKey,
  parseBool,
  parseNumber,
} from './app-settings';

/**
 * App configuration, backed by the SQLite `settings` table.
 *
 * On first boot (empty table) the values are seeded from a local `.env` file
 * and the process environment, mirroring the Python original. Afterwards every
 * value is editable via the API / UI. Emits on every persisted change.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);
  private readonly changes$ = new Subject<AppSettings>();
  private cached: AppSettings | null = null;

  constructor(private readonly state: StateService) {}

  onModuleInit() {
    const raw = this.state.getSettingsRaw();
    if (Object.keys(raw).length === 0) {
      this.seedFromEnv();
      this.logger.log('Seeded settings from environment (first boot)');
    }
    this.logger.log(
      `Settings loaded — threshold €${this.get().priceThresholdEur}, ` +
        `min discount ${this.get().minDiscountPercent}%`,
    );
  }

  /** Reactive stream of persisted settings changes. */
  get onChange() {
    return this.changes$.asObservable();
  }

  get(): AppSettings {
    if (this.cached) return this.cached;
    const raw = this.state.getSettingsRaw();
    const next: AppSettings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as SettingsKey[]) {
      const rawValue = raw[key];
      if (rawValue === undefined) continue;
      const def = DEFAULT_SETTINGS[key];
      (next as unknown as Record<string, unknown>)[key] =
        typeof def === 'boolean'
          ? parseBool(rawValue, def)
          : typeof def === 'number'
            ? parseNumber(rawValue, def)
            : rawValue;
    }
    this.cached = next;
    return next;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.get(), ...patch };
    this.state.setSettings(next);
    this.cached = next;
    this.changes$.next(next);
    return next;
  }

  /** Masked view safe to return over the API (secrets replaced by a flag). */
  getPublic(): AppSettings & { secretsSet: Record<string, boolean> } {
    const full = this.get();
    const publicView = { ...full };
    const secretsSet: Record<string, boolean> = {};
    for (const key of SECRET_KEYS) {
      secretsSet[key] = Boolean(publicView[key]);
      (publicView as Record<string, unknown>)[key] = '';
    }
    return { ...publicView, secretsSet };
  }

  private seedFromEnv() {
    const env = this.loadDotenv();
    const patch: Partial<AppSettings> = {};
    for (const [envName, key] of Object.entries(ENV_TO_SETTINGS)) {
      const value = process.env[envName] ?? env[envName];
      if (value === undefined) continue;
      const def = DEFAULT_SETTINGS[key];
      const patchTarget = patch as Record<string, string | boolean | number>;
      if (typeof def === 'boolean') patchTarget[key] = parseBool(value, def);
      else if (typeof def === 'number')
        patchTarget[key] = parseNumber(value, def);
      else patchTarget[key] = value;
    }
    if (Object.keys(patch).length > 0) this.update(patch);
  }

  private loadDotenv(): Record<string, string> {
    const candidates = [
      join(process.cwd(), '.env'),
      join(process.cwd(), '..', '.env'),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      try {
        const result: Record<string, string> = {};
        for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('='))
            continue;
          const idx = trimmed.indexOf('=');
          const key = trimmed.slice(0, idx).trim();
          let value = trimmed.slice(idx + 1).trim();
          if (
            value.length >= 2 &&
            value[0] === value[value.length - 1] &&
            (value[0] === "'" || value[0] === '"')
          ) {
            value = value.slice(1, -1);
          }
          if (key) result[key] = value;
        }
        return result;
      } catch {
        // ignore unreadable env file, fall through to process.env only
      }
    }
    return {};
  }
}
