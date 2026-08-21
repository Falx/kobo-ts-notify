import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatChipsModule } from '@angular/material/chips';
import { ApiService } from '../../shared/api.service';
import type { Deal, Run } from '../../shared/models';

@Component({
  selector: 'app-runs',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatExpansionModule,
    MatChipsModule,
  ],
  templateUrl: './runs.html',
  styleUrl: './runs.css',
})
export class RunsPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);

  protected readonly runs = signal<Run[]>([]);
  protected readonly loading = signal(false);
  protected readonly refreshing = signal(false);
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);

  /** run id -> cached deals, as loaded by the expansion panel. */
  private readonly runDeals = new Map<number, Deal[]>();
  protected readonly cache = this.runDeals;

  protected readonly openRuns = signal<Set<number>>(new Set());
  protected readonly loadingDeal = signal<number | null>(null);

  private readonly subs: Subscription[] = [];

  ngOnInit() {
    this.load();
    this.subs.push(
      interval(20000).subscribe(() => {
        if (this.hasActive()) this.load();
      }),
    );
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }

  protected refresh() {
    this.load();
  }

  protected runNow() {
    this.running.set(true);
    this.error.set(null);
    this.api.triggerRun().subscribe({
      next: () => {
        this.running.set(false);
        this.load();
        setTimeout(() => this.load(), 1500);
      },
      error: (err) => {
        this.running.set(false);
        this.error.set(apiError(err));
      },
    });
  }

  private hasActive(): boolean {
    return this.runs().some((r) => r.status === 'pending' || r.status === 'running');
  }

  protected load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.listRuns().subscribe({
      next: (runs) => {
        this.runs.set(runs);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(apiError(err));
        this.loading.set(false);
      },
    });
  }

  protected toggleDetails(runId: number) {
    const next = new Set(this.openRuns());
    const currentlyOpen = this.openRuns().has(runId);

    // close all others, keep the UI focused
    next.clear();
    if (!currentlyOpen) {
      next.add(runId);
      if (!this.runDeals.has(runId)) this.fetchDeals(runId);
    }
    this.openRuns.set(next);
  }

  private fetchDeals(runId: number) {
    this.loadingDeal.set(runId);
    this.api.runDetail(runId).subscribe({
      next: (detail) => {
        this.runDeals.set(runId, detail.deals);
        this.loadingDeal.set(null);
      },
      error: () => {
        this.runDeals.set(runId, []);
        this.loadingDeal.set(null);
      },
    });
  }

  protected statusLabel(status: Run['status']): string {
    switch (status) {
      case 'success':
        return 'Success';
      case 'failed':
        return 'Failed';
      case 'running':
        return 'Running';
      default:
        return 'Pending';
    }
  }

  protected duration(run: Run): string {
    if (!run.finishedAt) return '—';
    const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    if (ms < 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  protected formatPrice(value: number): string {
    return `€${value.toFixed(2)}`;
  }

  protected formatDate(value: string): string {
    if (!value) return '—';
    return new Date(value).toLocaleString();
  }
}

function apiError(err: unknown): string {
  if (err && typeof err === 'object' && 'error' in err) {
    const body = (err as { error: unknown }).error;
    if (body && typeof body === 'object' && 'message' in body) {
      return String((body as { message: unknown }).message);
    }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Something went wrong';
}