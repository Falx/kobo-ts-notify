import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as crypto from 'node:crypto';
import { SettingsService } from '../config/settings.service';
import { getTokensPath } from '../common/env';

// ---------------------------------------------------------------------------
// Verified endpoints and constants (see kobo-notify PLAN.md)
// ---------------------------------------------------------------------------

const WEB_ACTIVATION_URL = 'https://auth.kobobooks.com/ActivateOnWeb';
const DEVICE_AUTH_URL = 'https://storeapi.kobo.com/v1/auth/device';
const REFRESH_URL = 'https://storeapi.kobo.com/v1/auth/refresh';

const POLL_INTERVAL_MS = 5000;
const PAIRING_TIMEOUT_MS = 600_000; // 10 minutes at kobo.com/activate

const POLL_ENDPOINT_RE = /data-poll-endpoint="([^"]+)"/;
const ACTIVATION_CODE_RE = /%26code%3D(\d+)|code=(\d+)/i;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  userKey: string;
  email: string;
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

/** Kobo device-pairing authenticator with token persistence and refresh. */
@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private tokens: AuthTokens | null = null;
  private readonly pairingStates = new Map<string, PairingState>();

  constructor(private readonly settings: SettingsService) {}

  onModuleInit() {
    this.loadTokens();
  }

  // ---- public API ---------------------------------------------------------

  get haveTokens(): boolean {
    return Boolean(this.tokens?.accessToken && this.tokens.refreshToken);
  }

  get email(): string | null {
    return this.tokens?.email || null;
  }

  get status(): { paired: boolean; email: string | null } {
    return { paired: this.haveTokens, email: this.email };
  }

  getAuthHeaders(): Record<string, string> {
    if (!this.haveTokens || !this.tokens) {
      throw new Error(
        'Kobo not paired yet — start pairing to authenticate once',
      );
    }
    return { Authorization: `Bearer ${this.tokens.accessToken}` };
  }

  /** Exchange the current refresh token for a fresh access token. */
  async refresh(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available — start pairing again');
    }
    const response = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(this.refreshPayload()),
    });
    if (response.status === 401) {
      throw new Error(
        'Kobo rejected the refresh token — start pairing to re-pair',
      );
    }
    if (!response.ok) {
      throw new Error(`Kobo refresh failed (HTTP ${response.status})`);
    }
    const data = (await response.json()) as Partial<Record<string, string>>;
    if (!data.AccessToken) {
      throw new Error(
        `Refresh response missing AccessToken: ${JSON.stringify(data)}`,
      );
    }
    this.tokens.accessToken = data.AccessToken;
    if (data.RefreshToken) this.tokens.refreshToken = data.RefreshToken;
    this.persistTokens();
    this.logger.log('Tokens refreshed');
  }

  /** Begin interactive pairing; the user enters the code at kobo.com/activate. */
  async startPairing(): Promise<PairingInfo> {
    const state = await this.beginWebActivation();
    this.pairingStates.set(state.pairingId, state);
    return {
      pairingId: state.pairingId,
      activationCode: state.activationCode,
      pollIntervalMs: POLL_INTERVAL_MS,
    };
  }

  getPairingStatus(pairingId: string): PairingStatus {
    const state = this.pairingStates.get(pairingId);
    if (!state) {
      return { status: 'failed', error: 'Unknown pairing id' };
    }
    if (state.completed) return { status: 'complete', email: state.email };
    if (state.error) return { status: 'failed', error: state.error };
    if (Date.now() > state.deadlineAt) {
      this.stopPairing(state);
      return { status: 'timeout' };
    }
    return { status: 'pending' };
  }

  // ---- pairing internals --------------------------------------------------

  private async beginWebActivation(): Promise<PairingState> {
    const cfg = this.settings.get();
    const params = new URLSearchParams({
      pwspid: cfg.koboDevicePlatformId,
      wsa: cfg.koboAffiliate,
      pwsdid: crypto.randomBytes(32).toString('hex'),
      pwsav: cfg.koboAppVersion,
      pwsdm: 'Desktop',
      pwspos: 'Web',
      pwspov: 'Kobo',
    });
    const response = await fetch(`${WEB_ACTIVATION_URL}?${params}`, {
      headers: BROWSER_HEADERS,
    });
    if (!response.ok) {
      throw new Error(`Kobo activation page returned HTTP ${response.status}`);
    }
    const html = await response.text();

    const pollMatch = POLL_ENDPOINT_RE.exec(html);
    if (!pollMatch) {
      throw new Error(
        'Could not find data-poll-endpoint in the activation page',
      );
    }
    let pollEndpoint = pollMatch[1];
    if (pollEndpoint.startsWith('/')) {
      pollEndpoint = new URL(pollEndpoint, WEB_ACTIVATION_URL).href;
    }

    const codeMatch = ACTIVATION_CODE_RE.exec(html);
    if (!codeMatch) {
      throw new Error(
        'Could not find the activation code in the activation page',
      );
    }
    const activationCode = codeMatch[1] ?? codeMatch[2];

    const state: PairingState = {
      pairingId: crypto.randomUUID(),
      activationCode,
      pollEndpoint,
      deadlineAt: Date.now() + PAIRING_TIMEOUT_MS,
    };
    state.timer = setInterval(
      () => void this.pollActivation(state),
      POLL_INTERVAL_MS,
    );
    this.logger.log(`Pairing started — activation code ${activationCode}`);
    return state;
  }

  private async pollActivation(state: PairingState): Promise<void> {
    if (state.completed || state.error) return;
    if (Date.now() > state.deadlineAt) {
      this.logger.warn('Pairing timed out');
      this.stopPairing(state);
      return;
    }
    try {
      const response = await fetch(state.pollEndpoint, { method: 'POST' });
      if (!response.ok) return;
      let data: Record<string, unknown>;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        return; // non-JSON poll response, keep waiting
      }
      if (data.Status !== 'Complete') return;

      const redirectRaw = data.RedirectUrl;
      const { userKey, email } = this.parseRedirect(
        typeof redirectRaw === 'string' ? redirectRaw : '',
      );
      this.stopPairing(state);
      this.tokens = await this.deviceAuth(userKey, email);
      state.completed = true;
      state.email = email || userKey;
      this.persistTokens();
      this.logger.log(`Pairing complete for ${state.email}`);
    } catch (error) {
      this.logger.warn(`Pairing poll error: ${(error as Error).message}`);
    }
  }

  private stopPairing(state: PairingState) {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = undefined;
    }
  }

  private parseRedirect(redirectUrl: string): {
    userKey: string;
    email: string;
  } {
    const query = new URL(redirectUrl).searchParams;
    const userKey = query.get('userKey') ?? '';
    const email = query.get('email') ?? '';
    if (!userKey)
      throw new Error(`RedirectUrl missing userKey: ${redirectUrl}`);
    return { userKey, email };
  }

  private clientKey(): string {
    return Buffer.from(
      this.settings.get().koboDevicePlatformId,
      'ascii',
    ).toString('base64');
  }

  private async deviceAuth(
    userKey: string,
    email: string,
  ): Promise<AuthTokens> {
    const cfg = this.settings.get();
    const payload: Record<string, string> = {
      AffiliateName: cfg.koboAffiliate,
      AppVersion: cfg.koboAppVersion,
      ClientKey: this.clientKey(),
      DeviceId: crypto.randomBytes(32).toString('hex'),
      PlatformId: cfg.koboDevicePlatformId,
      SerialNumber: crypto.randomBytes(16).toString('hex'),
    };
    if (userKey) payload.UserKey = userKey;

    const response = await fetch(DEVICE_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Kobo device auth failed (HTTP ${response.status})`);
    }
    const data = (await response.json()) as Record<string, string>;
    if (data.TokenType && data.TokenType !== 'Bearer') {
      throw new Error(`Unexpected TokenType ${data.TokenType}`);
    }
    if (!data.AccessToken || !data.RefreshToken) {
      throw new Error(
        `Device auth response missing tokens: ${JSON.stringify(data)}`,
      );
    }
    return {
      accessToken: data.AccessToken,
      refreshToken: data.RefreshToken,
      userKey,
      email,
    };
  }

  private refreshPayload(): Record<string, string> {
    const cfg = this.settings.get();
    return {
      AppVersion: cfg.koboAppVersion,
      ClientKey: this.clientKey(),
      PlatformId: cfg.koboDevicePlatformId,
      RefreshToken: this.tokens!.refreshToken,
    };
  }

  // ---- persistence --------------------------------------------------------

  private loadTokens() {
    const path = getTokensPath();
    if (!existsSync(path)) return;
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<
        string,
        string
      >;
      this.tokens = {
        accessToken: data.AccessToken ?? '',
        refreshToken: data.RefreshToken ?? '',
        userKey: data.UserKey ?? '',
        email: data.email ?? '',
      };
    } catch (error) {
      this.logger.warn(`Could not load tokens: ${(error as Error).message}`);
      this.tokens = null;
    }
  }

  private persistTokens() {
    if (!this.tokens) return;
    const path = getTokensPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify(
        {
          AccessToken: this.tokens.accessToken,
          RefreshToken: this.tokens.refreshToken,
          UserKey: this.tokens.userKey,
          email: this.tokens.email,
        },
        null,
        2,
      ),
      'utf-8',
    );
  }
}

interface PairingState {
  pairingId: string;
  activationCode: string;
  pollEndpoint: string;
  deadlineAt: number;
  timer?: ReturnType<typeof setInterval>;
  completed?: boolean;
  email?: string;
  error?: string;
}
