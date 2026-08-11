import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import sharp from 'sharp';
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
    const coverArray = [...covers.values()].slice(0, settings.maxCovers);
    const attachments = coverArray.map((payload, index) => ({
      filename: `cover${index}.jpg`,
      content: payload.data,
      contentType: payload.mime,
      cid: `cover${index}`,
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

        const resized = await sharp(bytes)
          .resize({ width: 150, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        result.set(url, {
          data: resized,
          mime: 'image/jpeg',
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
      const coverSrc =
        index < coversRealLimit(records, covers) && record.coverUrl
          ? this.getCoverSrc(record.coverUrl, covers, useDataUri, index)
          : '';
      return this.cardHtml(record, index, coverSrc, previousPrices);
    });

    const summary = `${records.length} book(s) matching your deal rules`;
    const truncated = records.some(
      (r, i) => i >= coversRealLimit(records, covers) && r.coverUrl,
    )
      ? '<p style="font-size:11px;color:#999;margin:8px 0 0;">Some covers omitted (too many deals to embed).</p>'
      : '';

    const COLS = 3;
    const ROW_HEIGHT = 200;
    const rows: string[] = [];
    for (let i = 0; i < cards.length; i += COLS) {
      const rowCards = cards.slice(i, i + COLS);
      const cells = rowCards
        .map(
          (card) =>
            `<td width="${100 / COLS}%" valign="bottom" height="${ROW_HEIGHT}" style="padding:4px;">${card}</td>`,
        )
        .join('\n');
      rows.push(`<tr>${cells}</tr>`);
    }

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<title>Kobo deals for ${htmlEscape(dateLabel)}</title>`,
      '</head>',
      '<body style="margin:0;padding:20px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222;">',
      '<!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td><![endif]-->',
      `<h1 style="font-size:20px;margin:0 0 4px;">Kobo deals for ${htmlEscape(dateLabel)}</h1>`,
      `<p style="font-size:13px;color:#555;margin:0 0 12px;">${htmlEscape(summary)}</p>`,
      '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:700px;">',
      ...rows,
      '</table>',
      truncated,
      '<!--[if mso]></td></tr></table><![endif]-->',
      '</body>',
      '</html>',
    ].join('\n');
  }

  private getCoverSrc(
    url: string,
    covers: Map<string, { data: Buffer; mime: string }>,
    useDataUri: boolean,
    index: number,
  ): string {
    const payload = covers.get(url);
    if (!payload) return '';
    return useDataUri
      ? `data:${payload.mime};base64,${payload.data.toString('base64')}`
      : `cid:cover${index}`;
  }

  private cardHtml(
    record: DealRecord,
    index: number,
    coverSrc: string,
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

    const coverCell = coverSrc
      ? `<td width="110" valign="bottom" style="padding:8px 0 8px 8px;"><img src="${coverSrc}" alt="" width="110" style="display:block;border:0;width:110px;height:auto;border-radius:4px;"></td>`
      : '';

    const lines = [
      '<table cellpadding="0" cellspacing="0" border="0" width="100%" height="100%" style="background:#ffffff;border:1px solid #e0e0e0;border-radius:6px;">',
      '<tr>',
      coverCell,
      `<td valign="bottom" style="padding:8px;font-family:Arial,Helvetica,sans-serif;">`,
      '<div style="margin-bottom:4px;">',
      `<span style="background:#0a7d30;color:#ffffff;font-size:10px;font-weight:bold;padding:1px 6px;border-radius:8px;">${badge}</span>`,
      ` <span style="background:#eeeeee;color:#555;font-size:10px;padding:1px 6px;border-radius:8px;">${source}</span>`,
      '</div>',
      `<div style="font-size:13px;font-weight:bold;margin:0 0 2px;line-height:1.3;">${titleLink}</div>`,
    ];
    if (record.author) {
      lines.push(
        `<div style="font-size:11px;color:#555;margin:0 0 1px;">by ${htmlEscape(record.author)}</div>`,
      );
    }
    if (record.series) {
      lines.push(
        `<div style="font-size:10px;color:#777;margin:0 0 2px;">${htmlEscape(record.series)}</div>`,
      );
    }
    lines.push(
      `<div style="font-size:12px;margin:4px 0 0;">${this.priceLine(record)}</div>`,
    );

    const prevPrice = previousPrices[record.productId];
    if (prevPrice !== undefined && record.priceEur < prevPrice) {
      lines.push(
        `<div style="font-size:10px;color:#7a7a7a;margin:1px 0 0;">Down from ${money(prevPrice)}</div>`,
      );
    }
    if (record.language) {
      lines.push(
        `<div style="font-size:9px;color:#999;margin:1px 0 0;">${htmlEscape(record.language)}</div>`,
      );
    }
    lines.push('</td></tr></table>');
    return lines.join('\n');
  }

  private priceLine(record: DealRecord): string {
    if (record.priceEur <= 0) {
      return '<span style="color:#0a7d30;font-weight:bold;">FREE</span>';
    }
    const bits = [
      `<span style="font-weight:bold;">${money(record.priceEur)}</span>`,
    ];
    if (record.wasPriceEur !== null && record.wasPriceEur > 0) {
      bits.push(
        `<span style="color:#999;text-decoration:line-through;">was ${money(record.wasPriceEur)}</span>`,
      );
      if (record.discountPercent !== null) {
        bits.push(
          `<span style="color:#c62828;font-weight:bold;">-${record.discountPercent}%</span>`,
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
