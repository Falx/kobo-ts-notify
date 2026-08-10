/** Verified Kobo URL templates (Belgian store, /be/en). */

export const COVER_URL_TEMPLATE =
  'https://cdn.kobo.com/book-images/{imageId}/image.jpg';
export const BOOK_URL_TEMPLATE = 'https://www.kobo.com/be/en/ebook/{slug}';

export function coverUrl(imageId: string): string {
  return COVER_URL_TEMPLATE.replace('{imageId}', imageId);
}

export function bookUrl(slug: string): string {
  return BOOK_URL_TEMPLATE.replace('{slug}', slug);
}
