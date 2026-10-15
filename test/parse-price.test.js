'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { price, settings, adapter, units } = require('./load.js');

test('simple US prices', () => {
  assert.deepStrictEqual(
    { amount: price.parsePrice('$12.99').amount, currency: price.parsePrice('$12.99').currency },
    { amount: 12.99, currency: 'USD' }
  );
  assert.strictEqual(price.parsePrice('$1,234.56').amount, 1234.56);
  assert.strictEqual(price.parsePrice('US$45.00').currency, 'USD');
  assert.strictEqual(price.parsePrice('$8').amount, 8);
});

test('non-US conventions', () => {
  assert.strictEqual(price.parsePrice('12,99 \u20ac').amount, 12.99);
  assert.strictEqual(price.parsePrice('12,99 \u20ac').currency, 'EUR');
  assert.strictEqual(price.parsePrice('1.234,56 \u20ac').amount, 1234.56);
  assert.strictEqual(price.parsePrice('\u00a39.99').currency, 'GBP');
  assert.strictEqual(price.parsePrice('100 USD').amount, 100);
});

test('ranges and prefixes resolve to the lowest price', () => {
  assert.strictEqual(price.parsePrice('from $9.99').amount, 9.99);
  assert.strictEqual(price.parsePrice('$10 - $20').amount, 10);
  assert.strictEqual(price.parsePrice('$29.99 $19.99').amount, 19.99);
});

test('non-prices are rejected', () => {
  assert.strictEqual(price.parsePrice('16 oz'), null);
  assert.strictEqual(price.parsePrice(''), null);
  assert.strictEqual(price.parsePrice('Free delivery'), null);
  assert.strictEqual(price.looksLikePrice('92 fl oz'), false);
  assert.strictEqual(price.looksLikePrice('$4.20'), true);
});

test('number normalisation', () => {
  assert.strictEqual(price.normalizeNumber('1,234'), 1234);
  assert.strictEqual(price.normalizeNumber('1.234.567'), 1234567);
  assert.strictEqual(price.normalizeNumber('9.99'), 9.99);
});

test('a lone dot before three digits is grouping only where the currency says so', () => {
  assert.strictEqual(price.normalizeNumber('1.234', 'EUR'), 1234);
  assert.strictEqual(price.normalizeNumber('1.980', 'JPY'), 1980);
  assert.strictEqual(price.normalizeNumber('1.234', 'USD'), 1.234);
  assert.strictEqual(price.normalizeNumber('1.234'), 1.234);
  assert.strictEqual(price.normalizeNumber('12.99', 'EUR'), 12.99);
  assert.strictEqual(price.parsePrice('1.234 \u20ac').amount, 1234);
});

test('every recognised currency symbol is exported for the other parsers', () => {
  for (const symbol of ['$', '\u00a3', '\u20ac', '\u00a5', '\u20b9', '\u20a9']) {
    assert.ok(price.SYMBOL_CHARS.includes(symbol), symbol);
  }
  // Non-USD symbols are stripped from was-prices too, not only $ € £.
  assert.strictEqual(adapter.stripWasPrices('Now \u00a5980, Was \u00a51,200').trim(), 'Now \u00a5980,');
});

test('shopping surface detection', () => {
  // Surface detection is host-aware now that several stores are supported, so
  // a path alone is not enough. Per-store URL coverage lives in sites.test.js;
  // this only checks that the adapter delegates to the registry at all.
  const on = (hostname, pathname, search) =>
    adapter.isShoppingSurface({ hostname, pathname, search });
  assert.strictEqual(on('www.google.com', '/search', '?q=rice&tbm=shop'), true);
  assert.strictEqual(on('www.google.com', '/search', '?q=rice&udm=28'), true);
  assert.strictEqual(on('www.google.com', '/shopping/product/123', ''), true);
  assert.strictEqual(on('www.google.com', '/search', '?q=rice'), false);
  assert.strictEqual(on('www.google.com', '/search', '?q=rice&udm=2'), false);
  assert.strictEqual(on('www.amazon.com', '/s', '?k=rice'), true);
  assert.strictEqual(on('www.walmart.com', '/search', '?q=rice'), true);
  // The same path on an unsupported host must stay inert.
  assert.strictEqual(on('example.com', '/search', '?q=rice'), false);
});

test('settings are sanitised against hostile or stale storage', () => {
  const clean = settings.sanitize({
    threshold: '4.5',
    basis: 'not-a-unit',
    filterEnabled: 'yes',
    minConfidence: 99,
    unknownKey: 'dropped'
  });
  assert.strictEqual(clean.threshold, 4.5);
  assert.strictEqual(clean.basis, 'lb');
  assert.strictEqual(clean.filterEnabled, true);
  assert.strictEqual(clean.minConfidence, 1);
  assert.strictEqual(clean.unknownKey, undefined);
  assert.strictEqual(clean.thresholds.USD, 4.5);

  const defaults = settings.sanitize(null);
  assert.deepStrictEqual(defaults, settings.DEFAULTS);
});

test('thresholds are isolated by currency and reject hostile entries', () => {
  const clean = settings.sanitize({
    thresholds: { USD: '8.5', CAD: 12, bad: 99, EUR: -1 }
  });
  assert.deepStrictEqual(clean.thresholds, { USD: 8.5, CAD: 12 });
  assert.strictEqual(settings.thresholdFor(clean, 'USD'), 8.5);
  assert.strictEqual(settings.thresholdFor(clean, 'GBP'), 3);

  const updated = settings.setThreshold(clean, 'GBP', 6.25);
  assert.strictEqual(settings.thresholdFor(updated, 'USD'), 8.5);
  assert.strictEqual(settings.thresholdFor(updated, 'GBP'), 6.25);
});

test('unit conversion to a filter basis', () => {
  // $9.00 for 2 lb of coffee is $4.50/lb and about $9.92/kg.
  const grams = 2 * units.MASS_TO_GRAMS.lb;
  const perGram = 9 / grams;
  assert.strictEqual(Math.round(perGram * units.BASES.lb.perBase * 100) / 100, 4.5);
  assert.strictEqual(Math.round(perGram * units.BASES.kg.perBase * 100) / 100, 9.92);
});

test('a decimal comma after a grouping space is still a decimal', () => {
  // Intl writes French and other grouping with U+202F; once the space is
  // gone "1234,56" must not be read as a grouping comma.
  assert.strictEqual(price.parsePrice('1\u202f234,56 \u20ac').amount, 1234.56);
  assert.strictEqual(price.parsePrice('1\u00a0234,56 \u20ac').amount, 1234.56);
  assert.strictEqual(price.normalizeNumber('1234,5'), 1234.5);
  assert.strictEqual(price.normalizeNumber('1,234'), 1234);
  assert.strictEqual(price.normalizeNumber('1,234,567'), 1234567);
});
