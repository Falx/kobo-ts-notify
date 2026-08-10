import { join } from 'node:path';

/** Bootstrap-only value: where kobo.db, tokens.json and summary-*.html live. */
export function getDataDir(): string {
  return process.env.DATA_DIR ?? join(process.cwd(), 'data');
}

export const TOKENS_FILENAME = 'tokens.json';

export function getTokensPath(): string {
  return join(getDataDir(), TOKENS_FILENAME);
}

export function nowIso(): string {
  return new Date().toISOString();
}
