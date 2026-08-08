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

  const defaults = settings.sanitize(null);
  assert.deepStrictEqual(defaults, settings.DEFAULTS);
});

test('unit conversion to a filter basis', () => {
  // $9.00 for 2 lb of coffee is $4.50/lb and about $9.92/kg.
  const grams = 2 * units.MASS_TO_GRAMS.lb;
  const perGram = 9 / grams;
  assert.strictEqual(Math.round(perGram * units.BASES.lb.perBase * 100) / 100, 4.5);
  assert.strictEqual(Math.round(perGram * units.BASES.kg.perBase * 100) / 100, 9.92);
});
