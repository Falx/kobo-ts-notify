export type SettingsKey =
  | 'priceThresholdEur'
  | 'minDiscountPercent'
  | 'checkTime'
  | 'tz'
  | 'dryRun'
  | 'smtpHost'
  | 'smtpPort'
  | 'smtpUser'
  | 'smtpPassword'
  | 'smtpTls'
  | 'emailFrom'
  | 'emailTo'
  | 'maxCovers'
  | 'coverTimeoutSec'
  | 'koboDevicePlatformId'
  | 'koboAffiliate'
  | 'koboAppVersion';

export interface AppSettings {
  priceThresholdEur: number;
  minDiscountPercent: number;
  checkTime: string;

  tz: string;
  dryRun: boolean;

  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpTls: boolean;
  emailFrom: string;
  emailTo: string;

  maxCovers: number;
  coverTimeoutSec: number;

  koboDevicePlatformId: string;
  koboAffiliate: string;
  koboAppVersion: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  priceThresholdEur: 5.0,
  minDiscountPercent: 0,
  checkTime: '10:00',
  tz: 'Europe/Brussels',
  dryRun: false,
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpTls: true,
  emailFrom: '',
  emailTo: '',
  maxCovers: 40,
  coverTimeoutSec: 8,
  koboDevicePlatformId: '00000000-0000-0000-0000-000000000373',
  koboAffiliate: 'Kobo',
  koboAppVersion: '4.38.23171',
};

/** env var name → settings key for first-boot seeding from .env / process env. */
export const ENV_TO_SETTINGS: Readonly<Record<string, SettingsKey>> = {
  PRICE_THRESHOLD_EUR: 'priceThresholdEur',
  MIN_DISCOUNT_PERCENT: 'minDiscountPercent',
  CHECK_TIME: 'checkTime',
  TZ: 'tz',
  DRY_RUN: 'dryRun',
  SMTP_HOST: 'smtpHost',
  SMTP_PORT: 'smtpPort',
  SMTP_USER: 'smtpUser',
  SMTP_PASSWORD: 'smtpPassword',
  SMTP_TLS: 'smtpTls',
  EMAIL_FROM: 'emailFrom',
  EMAIL_TO: 'emailTo',
  KOBO_DEVICE_PLATFORM_ID: 'koboDevicePlatformId',
  KOBO_AFFILIATE: 'koboAffiliate',
  KOBO_APP_VERSION: 'koboAppVersion',
};

/** Values that must never be echoed back from the API. */
export const SECRET_KEYS: ReadonlySet<SettingsKey> = new Set(['smtpPassword']);

export function parseBool(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function parseNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}
