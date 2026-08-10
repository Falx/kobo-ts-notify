import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { ApiService } from '../../shared/api.service';
import type { Deal, SortKey } from '../../shared/models';

@Component({
  selector: 'app-deals',
  imports: [
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
  ],
  templateUrl: './deals.html',
  styleUrl: './deals.css',
})
export class DealsPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly searchDebounce = new Subject<void>();
  private readonly subs: Subscription[] = [];

  protected readonly deals = signal<Deal[]>([]);
  protected readonly loading = signal(false);
  protected readonly running = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly message = signal<string | null>(null);

  protected readonly q = signal('');
  protected readonly source = signal<'' | 'wishlist' | 'bestdeals'>('');
  protected readonly onlyNew = signal(false);
  protected readonly onlyDrop = signal(false);
  protected readonly minDiscount = signal(0);
  protected readonly sort = signal<SortKey>('discount-desc');

  protected readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.source()) count++;
    if (this.onlyNew()) count++;
    if (this.onlyDrop()) count++;
    if (this.minDiscount()) count++;
    if (this.q()) count++;
    return count;
  });

  protected clearFilters() {
    this.q.set('');
    this.source.set('');
    this.onlyNew.set(false);
    this.onlyDrop.set(false);
    this.minDiscount.set(0);
    this.sort.set('discount-desc');
    this.load();
  }

  ngOnInit() {
    this.subs.push(
      this.searchDebounce.pipe(debounceTime(350)).subscribe(() => this.load()),
    );
    this.load();
  }

  ngOnDestroy() {
    this.subs.forEach((s) => s.unsubscribe());
  }

  protected onSearchChange(value: string) {
    this.q.set(value);
    this.searchDebounce.next();
  }

  protected refresh() {
    this.load();
  }

  protected runNow() {
    this.running.set(true);
    this.message.set('Starting a run — this scans the wishlist and BestDeals...');
    this.api.triggerRun().subscribe({
      next: () => {
        this.message.set('Run started. Refresh in a moment to see new deals.');
        this.running.set(false);
        setTimeout(() => this.load(), 1500);
      },
      error: (err) => {
        this.running.set(false);
        this.error.set(apiError(err));
      },
    });
  }

  protected load() {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .listDeals({
        source: this.source() || undefined,
        isNew: this.onlyNew() || undefined,
        isDrop: this.onlyDrop() || undefined,
        minDiscount: this.minDiscount() || undefined,
        q: this.q() || undefined,
        sort: this.sort(),
      })
      .subscribe({
        next: (deals) => {
          this.deals.set(deals);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(apiError(err));
          this.loading.set(false);
        },
      });
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
      const message = (body as { message: unknown }).message;
      if (Array.isArray(message)) return message.join(', ');
      return String(message);
    }
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'Something went wrong';
}