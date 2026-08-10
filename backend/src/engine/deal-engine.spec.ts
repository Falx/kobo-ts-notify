import { DealEngine, dedupeBest } from './deal-engine';
import type { DealRecord, DealSourceItem } from './deal-engine';

describe('DealEngine', () => {
  const make = (partial: Partial<DealSourceItem>): DealSourceItem => ({
    title: 'Book',
    author: 'Author',
    priceEur: 1,
    wasPriceEur: null,
    isFree: false,
    productId: 'id',
    slug: 'book',
    imageId: 'img',
    language: 'en',
    series: '',
    url: '',
    ...partial,
  });

  it('treats a free item as a deal', () => {
    const engine = new DealEngine(5, 0);
    const rec = engine.evaluate(
      make({ priceEur: 0, isFree: true, wasPriceEur: 9.99 }),
    );
    expect(rec).not.toBeNull();
    expect(rec!.priceEur).toBe(0);
    expect(rec!.isFree).toBe(true);
  });

  it('Rule A: strikethrough sale above the min discount', () => {
    const engine = new DealEngine(5, 20);
    const rec = engine.evaluate(make({ priceEur: 8, wasPriceEur: 10 }));
    expect(rec).not.toBeNull();
    expect(rec!.discountPercent).toBe(20);
  });

  it('Rule A: sale below min discount is not a deal', () => {
    const engine = new DealEngine(5, 25);
    expect(engine.evaluate(make({ priceEur: 8, wasPriceEur: 10 }))).toBeNull();
  });

  it('Rule B: price below threshold even without a was-price', () => {
    const engine = new DealEngine(5, 0);
    expect(
      engine.evaluate(make({ priceEur: 4.99, wasPriceEur: null })),
    ).not.toBeNull();
  });

  it('rejects a price above the threshold with no sale', () => {
    const engine = new DealEngine(5, 0);
    expect(
      engine.evaluate(make({ priceEur: 9.99, wasPriceEur: null })),
    ).toBeNull();
  });

  it('clamps a negative discount to 0 and still catches a cheap risen price via Rule B', () => {
    const engine = new DealEngine(5, 0);
    const rec = engine.evaluate(make({ priceEur: 4, wasPriceEur: 3 }));
    expect(rec).not.toBeNull();
    expect(rec!.discountPercent).toBe(0);
  });

  it('builds the cover url from the image id', () => {
    const engine = new DealEngine(5, 0);
    const rec = engine.evaluate(make({ priceEur: 1 }));
    expect(rec!.coverUrl).toBe(
      'https://cdn.kobo.com/book-images/img/image.jpg',
    );
  });

  it('process() dedupes keeping the lowest price', () => {
    const engine = new DealEngine(5, 0);
    const items = [
      make({ productId: 'a', priceEur: 3, wasPriceEur: 5 }),
      make({ productId: 'a', priceEur: 2, wasPriceEur: 6 }),
      make({ productId: 'b', priceEur: 1 }),
    ];
    const records = engine.process(items, 'wishlist');
    expect(records.map((r) => r.productId)).toEqual(['a', 'b']);
    expect(records[0].priceEur).toBe(2);
  });
});

describe('dedupeBest', () => {
  const rec = (productId: string, price: number): DealRecord => ({
    source: 'wishlist',
    title: '',
    author: '',
    series: '',
    priceEur: price,
    wasPriceEur: null,
    discountPercent: null,
    isFree: false,
    url: '',
    coverUrl: '',
    language: '',
    productId,
  });

  it('keeps order of first appearance and lowest price per id', () => {
    const result = dedupeBest([rec('a', 5), rec('b', 1), rec('a', 2)]);
    expect(result.length).toBe(2);
    expect(result[0].productId).toBe('a');
    expect(result[0].priceEur).toBe(2);
    expect(result[1].productId).toBe('b');
  });

  it('keeps records without a product id by position', () => {
    const result = dedupeBest([rec('', 1), rec('', 2)]);
    expect(result.length).toBe(2);
  });
});
