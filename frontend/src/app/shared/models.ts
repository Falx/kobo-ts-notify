export interface Deal {
  productId: string;
  title: string;
  author: string;
  series: string;
  url: string;
  coverUrl: string;
  language: string;
  source: 'wishlist' | 'bestdeals';
  priceEur: number;
  wasPriceEur: number | null;
  discountPercent: number | null;
  isFree: boolean;
  isNew: boolean;
  isPriceDrop: boolean;
  isOwned: boolean;
  firstSeen: string;
  lastSeen: string;
  runId: number;
}

export type RunStatus = 'pending' | 'running' | 'success' | 'failed';

export interface Run {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  itemsScanned: number;
  dealsFound: number;
  newDeals: number;
  priceDrops: number;
  notified: number;
  summaryPath: string | null;
  error: string | null;
}

export interface RunDetail {
  run: Run;
  deals: Deal[];
}

export type SortKey = 'latest' | 'price-asc' | 'price-desc' | 'discount-desc';

export interface DealsQuery {
  source?: string;
  isNew?: boolean;
  isDrop?: boolean;
  isOwned?: boolean;
  minDiscount?: number;
  q?: string;
  sort?: SortKey;
}

export interface AppSettings {
  priceThresholdEur: number;
  minDiscountPercent: number;
  checkTime: string;
  tz: string;
  dryRun: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpTls: boolean;
  emailFrom: string;
  emailTo: string;
  maxCovers: number;
  coverTimeoutSec: number;
  koboDevicePlatformId: string;
  koboAffiliate: string;
  koboAppVersion: string;
}

export interface SettingsResponse {
  priceThresholdEur: number;
  minDiscountPercent: number;
  checkTime: string;
  tz: string;
  dryRun: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpTls: boolean;
  emailFrom: string;
  emailTo: string;
  maxCovers: number;
  coverTimeoutSec: number;
  koboDevicePlatformId: string;
  koboAffiliate: string;
  koboAppVersion: string;
  secretsSet: Record<string, boolean>;
}

export interface PairingInfo {
  pairingId: string;
  activationCode: string;
  pollIntervalMs: number;
}

export interface PairingStatus {
  status: 'pending' | 'complete' | 'timeout' | 'failed';
  email?: string;
  error?: string;
}

export interface Health {
  status: string;
  db: boolean;
  paired: boolean;
  nextRun: string | null;
  version: string;
}