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

/**
 * Walmart product pages carry no Schema.org size; everything is in the
 * Next.js state. The shape below is trimmed from a live page, including a
 * sponsored product in `contentLayout`, which must never be read.
 */
function walmartState(overrides) {
  const product = Object.assign({
    name: 'Great Value Creamy Peanut Butter, 40 oz',
    priceInfo: {
      currentPrice: { price: 4.18, priceString: '$4.18', currencyUnit: 'USD' },
      unitPrice: { price: 0.105, priceString: '10.5 \u00a2/oz', currencyUnit: 'USD' }
    }
  }, overrides && overrides.product);
  return {
    props: { pageProps: { initialData: { data: {
      contentLayout: { modules: [{ configs: { ad: { products: [{
        name: 'Sponsored Jar 99 oz',
        priceInfo: { currentPrice: { price: 1.0, currencyUnit: 'USD' }, unitPrice: { priceString: '1.0 \u00a2/oz' } }
      }] } } }] },
      product,
      idml: { specifications: (overrides && overrides.specs) || [
        { name: 'Flavor', value: 'Creamy' },
        { name: 'Size', value: '40 oz' },
        { name: 'Shelf life', value: '360 days' },
        { name: 'Net content statement', value: '40 oz' }
      ] }
    } } } }
  };
}

test('Walmart product state yields its own price, unit price and size, not an ad\u2019s', () => {
  const page = productData.fromWalmartNextData(walmartState());
  assert.strictEqual(page.title, 'Great Value Creamy Peanut Butter, 40 oz');
  assert.strictEqual(page.price.amount, 4.18);
  assert.strictEqual(page.price.currency, 'USD');
  assert.strictEqual(page.unitPrice.amount, 0.105);
  assert.strictEqual(page.unitPrice.perUnit.key, 'oz');
  // The explicit net-content statement comes first; shelf life never.
  assert.deepStrictEqual(page.sizes, ['40 oz', '40 oz']);
});

test('a Walmart product that names no size in its title still yields one from specs', () => {
  const page = productData.fromWalmartNextData(walmartState({
    product: { name: 'Nutricost Beef Bone Broth Protein Powder Unflavored (20 Servings)' },
    specs: [{ name: 'Net Content Statement', value: '15.5 oz' }]
  }));
  assert.strictEqual(quantity.parseQuantity(page.title), null);
  assert.strictEqual(quantity.parseQuantity(page.sizes[0]).raw, '15.5 oz');
});

test('malformed Walmart state is ignored, not trusted', () => {
  const empty = { title: '', price: null, unitPrice: null, sizes: [] };
  for (const junk of [null, 0, 'x', {}, { props: { pageProps: { initialData: { data: [] } } } }]) {
    assert.deepStrictEqual(productData.fromWalmartNextData(junk), empty);
  }
  const bad = productData.fromWalmartNextData(walmartState({
    product: { name: 42, priceInfo: { currentPrice: { price: -5, currencyUnit: 'usd' }, unitPrice: { priceString: 7 } } },
    specs: [{ name: 'Size', value: { evil: true } }, null, 'Size: 5 lb']
  }));
  assert.deepStrictEqual(bad, empty);
});

test('a Schema.org Product gives its name and offer price', () => {
  const json = { '@graph': [{ '@type': 'WebPage' }, {
    '@type': ['Product', 'Thing'], name: ' Coffee  2 lb ', offers: [{ price: '18.99', priceCurrency: 'USD' }]
  }] };
  const found = productData.productFromJsonLd(json);
  assert.strictEqual(found.title, 'Coffee 2 lb');
  assert.strictEqual(found.price.amount, 18.99);
  assert.strictEqual(productData.productFromJsonLd({ '@type': 'Product', offers: { lowPrice: 5, priceCurrency: 'EUR' } }).price.currency, 'EUR');
  assert.strictEqual(productData.productFromJsonLd({ '@type': 'Product', offers: { price: 'free' } }).price, null);
  assert.strictEqual(productData.productFromJsonLd({ '@type': 'Article' }), null);
});
