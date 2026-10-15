'use strict';

/**
 * Structured-data reading for the "Find package sizes" lookup. The page is
 * untrusted, so the rules here decide which of its claims are believed.
 */

const test = require('node:test');
const assert = require('node:assert');
const { productData, quantity } = require('./load.js');

test('only property names that state the contents\u2019 size are read', () => {
  for (const name of ['Weight', 'Net Weight', 'net volume', 'Volume', 'Package Weight', 'package size', ' Net Weight ']) {
    assert.ok(productData.isSizePropertyName(name), name);
  }
  // Regression: an unanchored alternation accepted all of these.
  for (const name of ['Weight Capacity', 'Volume Discount', 'Maximum Weight', 'Assembled Product Package Size', 'weightless', '', null, 42]) {
    assert.ok(!productData.isSizePropertyName(name), String(name));
  }
});

test('Schema.org quantities become prose the size parser understands', () => {
  assert.strictEqual(productData.structuredSizeText({ value: 5, unitCode: 'LBR' }), '5 lb');
  assert.strictEqual(productData.structuredSizeText({ value: '2.27', unitCode: 'KGR' }), '2.27 kg');
  assert.strictEqual(productData.structuredSizeText({ value: 64, unitCode: 'OZA' }), '64 fl oz');
  assert.strictEqual(productData.structuredSizeText({ value: 12, unitText: 'ounces' }), '12 ounces');
  assert.strictEqual(productData.structuredSizeText('16 oz'), '16 oz');
  assert.strictEqual(productData.structuredSizeText({ value: { nested: 1 } }), '');
  assert.strictEqual(productData.structuredSizeText(null), '');
  assert.strictEqual(quantity.parseQuantity(productData.structuredSizeText({ value: 64, unitCode: 'OZA' })).dimension, 'volume');
});

test('sizes are found anywhere in a JSON-LD graph, and only from size fields', () => {
  const json = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', name: 'Coffee 5 lb deals' },
      {
        '@type': 'Product',
        name: 'Whole Bean Coffee 2 lb',
        description: 'Try our 10 lb bag too',
        weight: { '@type': 'QuantitativeValue', value: 32, unitCode: 'ONZ' },
        additionalProperty: [
          { name: 'Weight Capacity', value: '250 lb' },
          { name: 'Net Weight', value: '2 lb' }
        ]
      }
    ]
  };
  assert.deepStrictEqual(productData.sizesFromJsonLd(json), ['32 oz', '2 lb']);
  assert.deepStrictEqual(productData.sizesFromJsonLd({ additionalProperty: { name: 'Volume', value: '1 L' } }), ['1 L']);
});

test('hostile JSON-LD is bounded rather than trusted', () => {
  let deep = { weight: '1 lb' };
  for (let i = 0; i < 5000; i++) deep = { child: deep };
  assert.deepStrictEqual(productData.sizesFromJsonLd(deep), []);

  const wide = Array.from({ length: 500 }, () => ({ weight: '1 lb' }));
  assert.strictEqual(productData.sizesFromJsonLd(wide).length, 20);

  for (const junk of [null, 0, 'text', [], [null, 1, 'x'], { additionalProperty: [null, 5] }]) {
    assert.deepStrictEqual(productData.sizesFromJsonLd(junk), []);
  }
});
