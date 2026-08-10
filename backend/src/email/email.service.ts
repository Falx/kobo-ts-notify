import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { htmlEscape, capitalize } from './escape';
import type { AppSettings } from '../config/app-settings';
import type { DealRecord } from '../engine/deal-engine';
import { getDataDir } from '../common/env';

const SOURCE_LABELS: Record<string, string> = {
  wishlist: 'Wishlist',
  bestdeals: 'BestDeals',
};

const money = (value: number): string => `€${value.toFixed(2)}`;

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  /**
   * Write the standalone summary HTML to disk, then email it unless dry-run.
   * Returns the summary path or null when there is nothing to send.
   */
  async sendSummary(
    settings: AppSettings,
    records: DealRecord[],
    previousPrices: Record<string, number> = {},
  ): Promise<string | null> {
    if (records.length === 0) return null;

    const covers = await this.fetchCovers(records, settings);
    const now = new Date();
    const dateLabel = new Intl.DateTimeFormat('en-GB', {
      timeZone: settings.tz,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(now);
    const yyyymmdd = new Intl.DateTimeFormat('en-CA', {
      timeZone: settings.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(now)
      .replaceAll('-', '');

    const standalone = this.renderHtml(
      records,
      previousPrices,
      covers,
      true,
      dateLabel,
    );
    const outPath = join(getDataDir(), `summary-${yyyymmdd}.html`);
    mkdirSync(getDataDir(), { recursive: true });
    writeFileSync(outPath, standalone, 'utf-8');
    this.logger.log(`Summary HTML written to ${outPath}`);

    if (settings.dryRun) {
      this.logger.log('DRY RUN — not sending email');
      return outPath;
    }

    const emailHtml = this.renderHtml(
      records,
      previousPrices,
      covers,
      false,
      dateLabel,
    );
    const subject = `Kobo deals: ${records.length} book(s) — ${dateLabel}`;
    try {
      await this.sendViaSmtp(settings, emailHtml, covers, subject);
    } catch (error) {
      this.logger.error(
        `SMTP delivery failed (HTML kept at ${outPath}): ${(error as Error).message}`,
      );
    }
    return outPath;
  }

  /** Send a plain test email using the configured SMTP settings. */
  async sendTestEmail(settings: AppSettings): Promise<string> {
    if (!settings.smtpHost || !settings.emailFrom || !settings.emailTo) {
      throw new Error(
        'SMTP not configured: set smtpHost, emailFrom and emailTo',
      );
    }
    const transport = this.buildTransport(settings);
    await transport.sendMail({
      from: settings.emailFrom,
      to: settings.emailTo,
      subject: 'Kobo Deal Notifier — test message',
      html: '<p>This is a test email from the Kobo Deal Notifier.</p>',
    });
    return `Test email sent to ${settings.emailTo}`;
  }

  // ---- internals ----------------------------------------------------------

  private buildTransport(settings: AppSettings) {
    return nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: !settings.smtpTls, // false → STARTTLS on :587
      auth:
        settings.smtpUser || settings.smtpPassword
          ? { user: settings.smtpUser, pass: settings.smtpPassword }
          : undefined,
      tls: settings.smtpTls ? undefined : { rejectUnauthorized: false },
    });
  }

  private async sendViaSmtp(
    settings: AppSettings,
    html: string,
    covers: Map<string, { data: Buffer; mime: string }>,
    subject: string,
  ): Promise<void> {
    if (!settings.smtpHost || !settings.emailFrom || !settings.emailTo) {
      throw new Error(
        'SMTP not configured: set smtpHost, emailFrom and emailTo',
      );
    }
    const transport = this.buildTransport(settings);
    const attachments = [...covers.entries()]
      .slice(0, settings.maxCovers)
      .map(([cid, payload]) => ({
        filename: `${cid}.jpg`,
        content: payload.data,
        contentType: payload.mime,
        cid,
      }));
    await transport.sendMail({
      from: settings.emailFrom,
      to: settings.emailTo,
      subject,
      html,
      attachments,
    });
    this.logger.log(`Summary email sent to ${settings.emailTo}`);
  }

  private async fetchCovers(
    records: DealRecord[],
    settings: AppSettings,
  ): Promise<Map<string, { data: Buffer; mime: string }>> {
    const targets = new Set(
      records
        .slice(0, settings.maxCovers)
        .map((r) => r.coverUrl)
        .filter(Boolean),
    );
    const result = new Map<string, { data: Buffer; mime: string }>();
    const timeoutMs = Math.max(1, settings.coverTimeoutSec) * 1000;
    for (const url of targets) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'kobo-notify/2.0' },
          redirect: 'follow',
        });
        clearTimeout(timer);
        if (!response.ok) continue;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length === 0) continue;
        const raw = (response.headers.get('content-type') ?? '')
          .split(';')[0]
          .trim();
        result.set(url, {
          data: bytes,
          mime: raw.startsWith('image/') ? raw : 'image/jpeg',
        });
      } catch {
        // failed cover download → omit cover silently
      }
    }
    return result;
  }

  private renderHtml(
    records: DealRecord[],
    previousPrices: Record<string, number>,
    covers: Map<string, { data: Buffer; mime: string }>,
    useDataUri: boolean,
    dateLabel: string,
  ): string {
    const cards = records.map((record, index) => {
      const coverHtml =
        index < coversRealLimit(records, covers) && record.coverUrl
          ? this.coverSrc(
              record.coverUrl,
              covers,
              useDataUri,
              index,
              record.title,
            )
          : '';
      return this.cardHtml(record, index, coverHtml, previousPrices);
    });

    const summary = `${records.length} book(s) matching your deal rules`;
    const truncated = records.some(
      (r, i) => i >= coversRealLimit(records, covers) && r.coverUrl,
    )
      ? '<p class="note">Some covers omitted (too many deals to embed).</p>'
      : '';

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      `<title>Kobo deals for ${htmlEscape(dateLabel)}</title>`,
      '</head>',
      '<body style="margin:0;padding:20px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222;">',
      `<h1 style="font-size:22px;margin:0 0 4px;">Kobo deals for ${htmlEscape(dateLabel)}</h1>`,
      `<p class="summary">${htmlEscape(summary)}</p>`,
      ...cards,
      truncated,
      '</body>',
      '</html>',
    ].join('\n');
  }

  private coverSrc(
    url: string,
    covers: Map<string, { data: Buffer; mime: string }>,
    useDataUri: boolean,
    index: number,
    title: string,
  ): string {
    const payload = covers.get(url);
    if (!payload) return '';
    const src = useDataUri
      ? `data:${payload.mime};base64,${payload.data.toString('base64')}`
      : `cid:cover${index}`;
    return `<img class="cover" src="${src}" alt="Cover of ${htmlEscape(title)}">`;
  }

  private cardHtml(
    record: DealRecord,
    index: number,
    coverHtml: string,
    previousPrices: Record<string, number>,
  ): string {
    const badge =
      record.wasPriceEur !== null || record.priceEur <= 0
        ? 'ON SALE'
        : 'LOW PRICE';
    const source = SOURCE_LABELS[record.source] ?? capitalize(record.source);
    const titleLink = record.url
      ? `<a style="color:#1a4f8b;text-decoration:none;" href="${htmlEscape(record.url)}">${htmlEscape(record.title)}</a>`
      : htmlEscape(record.title);

    const lines = [
      '<div class="card" style="background:#ffffff;border:1px solid #e0e0e0;border-radius:8px;padding:14px;margin:14px 0;overflow:hidden;">',
      coverHtml,
      '<div class="body" style="overflow:hidden;padding-left:8px;">',
      '<div class="meta" style="margin-bottom:6px;">',
      `<span class="badge" style="background:#0a7d30;color:#ffffff;font-size:11px;font-weight:bold;padding:2px 8px;border-radius:10px;">${badge}</span>`,
      `<span class="source" style="background:#eeeeee;color:#555;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:6px;">${source}</span>`,
      '</div>',
      `<h3 style="font-size:16px;margin:0 0 2px;">${titleLink}</h3>`,
    ];
    if (record.author) {
      lines.push(
        `<p class="author" style="font-size:13px;color:#555;margin:0 0 2px;">by ${htmlEscape(record.author)}</p>`,
      );
    }
    if (record.series) {
      lines.push(
        `<p class="series" style="font-size:12px;color:#777;margin:0 0 2px;">${htmlEscape(record.series)}</p>`,
      );
    }
    lines.push(
      `<p class="price" style="font-size:14px;margin:6px 0 0;">${this.priceLine(record)}</p>`,
    );

    const prevPrice = previousPrices[record.productId];
    if (prevPrice !== undefined && record.priceEur < prevPrice) {
      lines.push(
        `<p class="delta" style="font-size:12px;color:#7a7a7a;margin:2px 0 0;">Down from ${money(prevPrice)}</p>`,
      );
    }
    if (record.language) {
      lines.push(
        `<p class="language" style="font-size:11px;color:#999;margin:2px 0 0;">${htmlEscape(record.language)}</p>`,
      );
    }
    lines.push('</div></div>');
    return lines.join('\n');
  }

  private priceLine(record: DealRecord): string {
    if (record.priceEur <= 0) {
      return '<span class="price-free">FREE</span>';
    }
    const bits = [
      `<span class="price-current">${money(record.priceEur)}</span>`,
    ];
    if (record.wasPriceEur !== null && record.wasPriceEur > 0) {
      bits.push(
        `<span class="price-was"><s>was ${money(record.wasPriceEur)}</s></span>`,
      );
      if (record.discountPercent !== null) {
        bits.push(
          `<span class="price-discount">-${record.discountPercent}%</span>`,
        );
      }
    }
    return bits.join(' ');
  }
}

function coversRealLimit(
  records: DealRecord[],
  covers: Map<string, { data: Buffer; mime: string }>,
): number {
  return Math.min(records.length, covers.size);
}
