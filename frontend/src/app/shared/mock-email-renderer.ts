import type { Deal } from './models';

const money = (value: number): string => `\u20AC${value.toFixed(2)}`;

const SOURCE_LABELS: Record<string, string> = {
  wishlist: 'Wishlist',
  bestdeals: 'BestDeals',
};

function priceLine(deal: Deal): string {
  if (deal.priceEur <= 0) {
    return '<span style="color:#0a7d30;font-weight:bold;">FREE</span>';
  }
  const bits = [`<span style="font-weight:bold;">${money(deal.priceEur)}</span>`];
  if (deal.wasPriceEur !== null && deal.wasPriceEur > 0) {
    bits.push(`<span style="color:#999;text-decoration:line-through;">was ${money(deal.wasPriceEur)}</span>`);
    if (deal.discountPercent !== null) {
      bits.push(`<span style="color:#c62828;font-weight:bold;">-${deal.discountPercent}%</span>`);
    }
  }
  return bits.join(' ');
}

function cardHtml(deal: Deal): string {
  const badge = deal.isFree ? 'FREE' : (deal.isOwned ? 'OWNED' : (deal.isNew ? 'NEW' : (deal.isPriceDrop ? 'PRICE DROP' : 'ON SALE')));
  const badgeColor = deal.isOwned ? '#1a4f8b' : (deal.isFree ? '#0a7d30' : (deal.isNew ? '#0a7d30' : '#c62828'));
  const source = SOURCE_LABELS[deal.source] ?? deal.source;
  const titleLink = deal.url
    ? `<a style="color:#1a4f8b;text-decoration:none;" href="${escapeHtml(deal.url)}">${escapeHtml(deal.title)}</a>`
    : escapeHtml(deal.title);

  const coverCell = deal.coverUrl
    ? `<td width="110" valign="top" style="padding:10px 0 10px 10px;"><img src="${escapeHtml(deal.coverUrl)}" alt="" width="110" style="display:block;border:0;width:110px;height:auto;border-radius:4px;"></td>`
    : '';

  const lines = [
    '<table cellpadding="0" cellspacing="0" border="0" width="100%" height="100%" style="background:#ffffff;border:1px solid #e0e0e0;border-radius:6px;">',
    '<tr>',
    coverCell,
    `<td valign="top" style="padding:10px;font-family:Arial,Helvetica,sans-serif;">`,
    '<div style="margin-bottom:5px;">',
    `<span style="background:${badgeColor};color:#ffffff;font-size:11px;font-weight:bold;padding:2px 7px;border-radius:8px;">${badge}</span>`,
    ` <span style="background:#eeeeee;color:#555;font-size:11px;padding:2px 7px;border-radius:8px;">${source}</span>`,
    '</div>',
    `<div style="font-size:14px;font-weight:bold;margin:0 0 3px;line-height:1.3;">${titleLink}</div>`,
  ];
  if (deal.author) {
    lines.push(`<div style="font-size:12px;color:#555;margin:0 0 2px;">by ${escapeHtml(deal.author)}</div>`);
  }
  if (deal.series) {
    lines.push(`<div style="font-size:11px;color:#777;margin:0 0 3px;">${escapeHtml(deal.series)}</div>`);
  }
  lines.push(`<div style="font-size:13px;margin:5px 0 0;">${priceLine(deal)}</div>`);
  if (deal.language) {
    lines.push(`<div style="font-size:10px;color:#999;margin:2px 0 0;">${escapeHtml(deal.language)}</div>`);
  }
  lines.push('</td></tr></table>');
  return lines.join('\n');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderMockEmail(deals: Deal[]): string {
  const COLS = 1;
  const rows: string[] = [];
  for (let i = 0; i < deals.length; i += COLS) {
    const rowCards = deals.slice(i, i + COLS);
    const cells = rowCards
      .map((deal) => `<td width="${100 / COLS}%" valign="top" style="padding:4px;">${cardHtml(deal)}</td>`)
      .join('\n');
    rows.push(`<tr>${cells}</tr>`);
  }

  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>Kobo deals for ${escapeHtml(dateLabel)}</title>`,
    '</head>',
    '<body style="margin:0;padding:20px;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#222;">',
    `<h1 style="font-size:20px;margin:0 0 4px;">Kobo deals for ${escapeHtml(dateLabel)}</h1>`,
    `<p style="font-size:13px;color:#555;margin:0 0 12px;">${deals.length} book(s) matching your deal rules</p>`,
    '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:700px;">',
    ...rows,
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}
