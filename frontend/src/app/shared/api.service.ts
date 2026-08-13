import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
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

const BASE = '/api';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  health(): Observable<Health> {
    return this.http.get<Health>(`${BASE}/health`);
  }

  listDeals(query?: DealsQuery): Observable<Deal[]> {
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
    return this.http.get<Run[]>(`${BASE}/runs`);
  }

  runDetail(id: number): Observable<RunDetail> {
    return this.http.get<RunDetail>(`${BASE}/runs/${id}`);
  }

  triggerRun(): Observable<{ runId: number }> {
    return this.http.post<{ runId: number }>(`${BASE}/runs`, {});
  }

  getSettings(): Observable<SettingsResponse> {
    return this.http.get<SettingsResponse>(`${BASE}/settings`);
  }

  updateSettings(patch: Partial<AppSettings> & { smtpPassword?: string }): Observable<SettingsResponse> {
    return this.http.put<SettingsResponse>(`${BASE}/settings`, patch);
  }

  authStatus(): Observable<{ paired: boolean; email: string | null }> {
    return this.http.get<{ paired: boolean; email: string | null }>(`${BASE}/auth/status`);
  }

  startPairing(): Observable<PairingInfo> {
    return this.http.post<PairingInfo>(`${BASE}/auth/pair`, {});
  }

  pairingStatus(pairingId: string): Observable<PairingStatus> {
    return this.http.get<PairingStatus>(`${BASE}/auth/pair/${pairingId}`);
  }

  sendTestEmail(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${BASE}/email/test`, {});
  }

  toggleOwned(productId: string): Observable<{ isOwned: boolean }> {
    return this.http.patch<{ isOwned: boolean }>(
      `${BASE}/deals/${encodeURIComponent(productId)}/owned`,
      {},
    );
  }
}