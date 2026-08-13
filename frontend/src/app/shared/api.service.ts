import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import type {
  AppSettings,
  DealsQuery,
  Deal,
  Health,
  PairingInfo,
  PairingStatus,
  Run,
  RunDetail,
  SettingsResponse,
} from './models';
import { MOCK_DEALS } from './mock-deals';
import { renderMockEmail } from './mock-email-renderer';

const BASE = '/api';
const USE_MOCK = true; // Set to false when backend is running

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  health(): Observable<Health> {
    if (USE_MOCK) {
      return of({ status: 'ok', db: true, paired: true, nextRun: null, version: '1.0.0-mock' });
    }
    return this.http.get<Health>(`${BASE}/health`);
  }

  listDeals(query?: DealsQuery): Observable<Deal[]> {
    if (USE_MOCK) {
      let filtered = [...MOCK_DEALS];

      if (query?.source) {
        filtered = filtered.filter((d) => d.source === query.source);
      }
      if (query?.isNew) {
        filtered = filtered.filter((d) => d.isNew);
      }
      if (query?.isDrop) {
        filtered = filtered.filter((d) => d.isPriceDrop);
      }
      if (query?.isOwned !== undefined) {
        filtered = filtered.filter((d) => d.isOwned === query.isOwned);
      }
      if (query?.minDiscount) {
        filtered = filtered.filter((d) => (d.discountPercent ?? 0) >= query.minDiscount!);
      }
      if (query?.q) {
        const needle = query.q.toLowerCase();
        filtered = filtered.filter(
          (d) =>
            d.title.toLowerCase().includes(needle) ||
            d.author.toLowerCase().includes(needle) ||
            d.series.toLowerCase().includes(needle),
        );
      }

      switch (query?.sort) {
        case 'price-asc':
          filtered.sort((a, b) => a.priceEur - b.priceEur);
          break;
        case 'price-desc':
          filtered.sort((a, b) => b.priceEur - a.priceEur);
          break;
        case 'discount-desc':
          filtered.sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0));
          break;
        default:
          filtered.sort((a, b) => b.priceEur - a.priceEur);
          break;
      }

      return of(filtered);
    }

    let params = new HttpParams();
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        if (typeof value === 'boolean') {
          params = params.set(key, value ? '1' : '0');
        } else {
          params = params.set(key, String(value));
        }
      }
    }
    return this.http.get<Deal[]>(`${BASE}/deals`, { params });
  }

  dealHistory(productId: string): Observable<unknown> {
    return this.http.get(`${BASE}/deals/${encodeURIComponent(productId)}/history`);
  }

  listRuns(): Observable<Run[]> {
    if (USE_MOCK) {
      return of([
        {
          id: 1,
          startedAt: '2026-08-13T10:00:00Z',
          finishedAt: '2026-08-13T10:02:30Z',
          status: 'success' as const,
          itemsScanned: 150,
          dealsFound: 12,
          newDeals: 4,
          priceDrops: 3,
          notified: 7,
          summaryPath: null,
          error: null,
        },
      ]);
    }
    return this.http.get<Run[]>(`${BASE}/runs`);
  }

  runDetail(id: number): Observable<RunDetail> {
    return this.http.get<RunDetail>(`${BASE}/runs/${id}`);
  }

  triggerRun(): Observable<{ runId: number }> {
    if (USE_MOCK) {
      return of({ runId: 999 });
    }
    return this.http.post<{ runId: number }>(`${BASE}/runs`, {});
  }

  getSettings(): Observable<SettingsResponse> {
    if (USE_MOCK) {
      return of({
        priceThresholdEur: 5,
        minDiscountPercent: 10,
        checkTime: '10:00',
        tz: 'Europe/Brussels',
        dryRun: false,
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpTls: true,
        emailFrom: '',
        emailTo: '',
        maxCovers: 40,
        coverTimeoutSec: 8,
        koboDevicePlatformId: '00000000-0000-0000-0000-000000000373',
        koboAffiliate: 'Kobo',
        koboAppVersion: '4.38.23171',
        secretsSet: { smtpPassword: false },
      });
    }
    return this.http.get<SettingsResponse>(`${BASE}/settings`);
  }

  updateSettings(patch: Partial<AppSettings> & { smtpPassword?: string }): Observable<SettingsResponse> {
    return this.http.put<SettingsResponse>(`${BASE}/settings`, patch);
  }

  authStatus(): Observable<{ paired: boolean; email: string | null }> {
    if (USE_MOCK) {
      return of({ paired: true, email: 'mock@example.com' });
    }
    return this.http.get<{ paired: boolean; email: string | null }>(`${BASE}/auth/status`);
  }

  startPairing(): Observable<PairingInfo> {
    return this.http.post<PairingInfo>(`${BASE}/auth/pair`, {});
  }

  pairingStatus(pairingId: string): Observable<PairingStatus> {
    return this.http.get<PairingStatus>(`${BASE}/auth/pair/${pairingId}`);
  }

  sendTestEmail(): Observable<{ message: string }> {
    if (USE_MOCK) {
      return of({ message: 'Mock: Test email sent successfully' });
    }
    return this.http.post<{ message: string }>(`${BASE}/email/test`, {});
  }

  sendSummaryEmail(): Observable<{ message: string }> {
    if (USE_MOCK) {
      const html = renderMockEmail(MOCK_DEALS);
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(html);
        newWindow.document.close();
      }
      return of({ message: `Preview opened with ${MOCK_DEALS.length} deals` });
    }
    return this.http.post<{ message: string }>(`${BASE}/email/send-summary`, {});
  }

  toggleOwned(productId: string): Observable<{ isOwned: boolean }> {
    if (USE_MOCK) {
      const deal = MOCK_DEALS.find((d) => d.productId === productId);
      if (deal) {
        deal.isOwned = !deal.isOwned;
        return of({ isOwned: deal.isOwned });
      }
      return of({ isOwned: false });
    }
    return this.http.patch<{ isOwned: boolean }>(
      `${BASE}/deals/${encodeURIComponent(productId)}/owned`,
      {},
    );
  }
}