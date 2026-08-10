import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, timer } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ApiService } from '../../shared/api.service';
import type {
  AppSettings,
  PairingInfo,
  PairingStatus,
  SettingsResponse,
} from '../../shared/models';

const PAIRING_LINK = 'https://www.kobo.com/activate';

@Component({
  selector: 'app-settings',
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
  ],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly pairingStop = new Subject<void>();
  private readonly subs: Subscription[] = [];

  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveMessage = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** Public (secrets stripped) settings as returned by the API. */
  protected settings: SettingsResponse | null = null;

  /** Editable copy; smtpPassword is tracked separately (blank = keep stored). */
  protected draft: SettingsDraft = {};

  // pairing
  protected readonly paired = signal(false);
  protected readonly pairEmail = signal<string | null>(null);
  protected readonly pairingActive = signal(false);
  protected readonly pairingInfo = signal<PairingInfo | null>(null);
  protected readonly pairingStatus = signal<PairingStatus | null>(null);

  // email test
  protected readonly testingEmail = signal(false);
  protected readonly emailTestResult = signal<string | null>(null);

  ngOnInit() {
    this.loadAll();
  }

  ngOnDestroy() {
    this.pairingStop.next();
    this.pairingStop.complete();
    this.subs.forEach((s) => s.unsubscribe());
  }

  private loadAll() {
    this.subs.push(
      this.api.health().subscribe((h) => {
        this.paired.set(h.paired);
      }),
    );
    this.subs.push(
      this.api.authStatus().subscribe((s) => {
        this.paired.set(s.paired);
        this.pairEmail.set(s.email);
      }),
    );
    this.subs.push(
      this.api.getSettings().subscribe({
        next: (s) => {
          this.settings = s;
          this.draft = {
            priceThresholdEur: s.priceThresholdEur as number,
            minDiscountPercent: s.minDiscountPercent as number,
            checkTime: s.checkTime as string,
            tz: s.tz as string,
            dryRun: s.dryRun as boolean,
            smtpHost: s.smtpHost as string,
            smtpPort: s.smtpPort as number,
            smtpUser: s.smtpUser as string,
            smtpTls: s.smtpTls as boolean,
            emailFrom: s.emailFrom as string,
            emailTo: s.emailTo as string,
            maxCovers: s.maxCovers as number,
            coverTimeoutSec: s.coverTimeoutSec as number,
            koboDevicePlatformId: s.koboDevicePlatformId as string,
            koboAffiliate: s.koboAffiliate as string,
            koboAppVersion: s.koboAppVersion as string,
          };
          this.loaded.set(true);
        },
        error: (err) => this.error.set(apiError(err)),
      }),
    );
  }

  protected secretsSet(): boolean {
    return Boolean(this.settings?.secretsSet['smtpPassword']);
  }

  protected save() {
    this.saving.set(true);
    this.saveMessage.set(null);
    this.error.set(null);
    const current = (this.settings ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(this.draft)) {
      // skip secrets that were left blank; skip unchanged values
      if (key === 'smtpPassword') continue;
      if (typeof value === 'string' && value.trim() === '') continue;
      if (value === null || value === undefined) continue;
      if (current[key] === value) continue;
      patch[key] = value;
    }

    const password = this.draft.smtpPassword;
    if (password) patch['smtpPassword'] = password;

    if (Object.keys(patch).length === 0) {
      this.saving.set(false);
      this.saveMessage.set('Nothing to save — no changes were made.');
      return;
    }

    this.api.updateSettings(patch as Partial<AppSettings>).subscribe({
      next: (s) => {
        this.settings = s;
        this.saveMessage.set('Settings saved.');
        this.saving.set(false);
      },
      error: (err) => {
        this.error.set(apiError(err));
        this.saving.set(false);
      },
    });
  }

  // ---- pairing ----------------------------------------------------------

  protected startPairing() {
    this.error.set(null);
    this.pairingActive.set(true);
    this.pairingStatus.set({ status: 'pending' });
    this.api.startPairing().subscribe({
      next: (info) => {
        this.pairingInfo.set(info);
        this.pollPairing(info);
      },
      error: (err) => {
        this.pairingActive.set(false);
        this.pairingStatus.set({ status: 'failed', error: apiError(err) });
      },
    });
  }

  private pollPairing(info: PairingInfo) {
    const poll$ = timer(0, Math.max(2000, info.pollIntervalMs)).pipe(
      switchMap(() => this.api.pairingStatus(info.pairingId)),
      takeUntil(this.pairingStop),
    );
    this.subs.push(
      poll$.subscribe({
        next: (s) => {
          this.pairingStatus.set(s);
          if (s.status === 'complete') {
            this.paired.set(true);
            this.pairEmail.set(s.email ?? null);
            this.pairingActive.set(false);
            this.pairingStop.next();
          } else if (s.status === 'timeout' || s.status === 'failed') {
            this.pairingActive.set(false);
            this.pairingStop.next();
          }
        },
        error: () => {
          this.pairingActive.set(false);
          this.error.set('Pairing status check failed.');
          this.pairingStop.next();
        },
      }),
    );
  }

  protected pairingLink(): string {
    return PAIRING_LINK;
  }

  // ---- email test -------------------------------------------------------

  protected testEmail() {
    this.testingEmail.set(true);
    this.emailTestResult.set(null);
    this.api.sendTestEmail().subscribe({
      next: (res) => {
        this.emailTestResult.set(res.message);
        this.testingEmail.set(false);
      },
      error: (err) => {
        this.emailTestResult.set(`Failed: ${apiError(err)}`);
        this.testingEmail.set(false);
      },
    });
  }
}

function apiError(err: unknown): string {
  if (err && typeof err === 'object' && 'error' in err) {
    const body = (err as { error: unknown }).error;
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message;
      return Array.isArray(message) ? message.join(', ') : String(message);
    }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Something went wrong';
}

interface SettingsDraft extends Partial<AppSettings> {
  smtpPassword?: string;
}