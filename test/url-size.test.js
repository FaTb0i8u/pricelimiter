/**
 * Sizes recovered from the merchant's own product URL.
 *
 * Google renders a large share of Shopping tiles with no size anywhere in the
 * visible card - the weight only appears once you open the listing. The
 * outgoing merchant link usually spells it out in the path slug, which costs
 * nothing to read and requires no click and no network request.
 *
 * Every URL below was taken verbatim from a live `whey protein` search.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { adapter, quantity } = require('./load.js');

/** The full pipeline: URL in, parsed quantity out. */
function sizeFrom(href) {
  const text = adapter.sizeTextFromUrl(href);
  return text ? quantity.parseQuantity(text) : null;
}

test('a merchant product path yields the pack size', () => {
  // iHerb prints both units in the slug ("5-lb-2-27-kg"). Either reading is
  // correct and they agree to within 0.1%, so assert the mass, not the unit.
  const cases = [
    [
      'https://www.vitaminshoppe.com/p/optimum-nutrition-100-whey-gold-standard-french-vanilla-creme-2-lb-powder/op-2054',
      907.18
    ],
    [
      'https://iherb.com/pr/optimum-nutrition-gold-standard-100-whey-protein-extreme-milk-chocolate-5-lb-2-27-kg/2',
      2270
    ],
    [
      'https://iherb.com/pr/dymatize-iso100-hydrolyzed-100-whey-protein-isolate-gourmet-vanilla-5-lb-2-3-kg/66697',
      2300
    ]
  ];

  for (const [href, grams] of cases) {
    const parsed = sizeFrom(href);
    assert.ok(parsed, `no size read from ${href}`);
    assert.equal(parsed.dimension, 'mass');
    assert.ok(
      Math.abs(parsed.amount - grams) / grams < 0.01,
      `${href} -> ${parsed.amount} g, expected about ${grams} g`
    );
  }
});

test('a decimal written with the slug separator is not read as two numbers', () => {
  // "1-98-lb" is 1.98 lb, not 1 lb and not 98 lb.
  const parsed = sizeFrom(
    'https://iherb.com/pr/optimum-nutrition-gold-standard-100-whey-protein-vanilla-ice-cream-1-98-lb-899-g/27501'
  );
  assert.ok(parsed);
  assert.equal(parsed.unitKey, 'lb');
  assert.ok(Math.abs(parsed.amount - 898.1) < 1, `got ${parsed.amount} g`);

  const five = sizeFrom(
    'https://iherb.com/pr/optimum-nutrition-gold-standard-100-whey-protein-double-rich-chocolate-5-05-lb-2-29-kg'
  );
  assert.ok(five);
  assert.ok(Math.abs(five.amount - 2290.7) < 2, `got ${five.amount} g`);
});

test('a nutrition claim in the slug is not mistaken for a pack size', () => {
  // "24-g-protein" describes a serving, not the tub. Reading it as the pack
  // size is how a $25 tub once came out at $377.80/lb.
  assert.equal(sizeFrom('https://example.com/products/whey-blend-24-g-protein'), null);
  assert.equal(sizeFrom('https://example.com/products/isolate-25-g-protein-chocolate'), null);
  assert.equal(sizeFrom('https://example.com/products/whey-30-servings-vanilla'), null);
});

test('links that describe no product are ignored', () => {
  // Google's own redirect wrapper carries the merchant URL in a parameter; the
  // wrapper's own path is meaningless, and its query string is full of digits.
  assert.equal(adapter.sizeTextFromUrl('https://www.google.com/aclk?sa=L&ai=2-lb'), '');
  assert.equal(adapter.sizeTextFromUrl('https://www.google.co.uk/url?q=x'), '');
  assert.equal(adapter.sizeTextFromUrl('/search?q=whey+5+lb'), '');
  assert.equal(adapter.sizeTextFromUrl('javascript:void(0)'), '');
  assert.equal(adapter.sizeTextFromUrl(''), '');
});

test('the query string is never read', () => {
  // Tracking parameters carry sizes belonging to other products, campaign IDs
  // and prices. Only the path describes this item.
  const text = adapter.sizeTextFromUrl('https://example.com/p/whey?variant=5-lb&utm_campaign=10-lb-sale');
  assert.equal(/lb/.test(text), false, `query leaked into "${text}"`);
});

test('an opaque tracking token is not mined for a size', () => {
  // Taken verbatim from a live Amazon results page. Split on separators this
  // base64 blob yields "42" next to "l", which read as 42 litres and gave
  // three real products a wrong size on the first live run.
  const href =
    'https://aax-us-east-retail-direct.amazon.com/x/c/JHrsSGNLByjPTyZ4KDRtFtkAAAGf42__lAEAAAH2AQBvbm9fdHhuX2JpZDIgICBvbm9fdHhuX2ltcDEgICCuRQjX';
  assert.equal(sizeFrom(href), null, `read a size out of an ad token: "${adapter.sizeTextFromUrl(href)}"`);
});

test('identifiers are dropped rather than parsed', () => {
  // ASINs, SKUs and hashes mix letters with digits; a pack size never does.
  assert.equal(sizeFrom('https://www.amazon.com/dp/B08L6ZHJM5'), null);
  assert.equal(sizeFrom('https://example.com/item/8kJ2x9g4Lp'), null);
});

test('a number cannot pair with a unit from the next path segment', () => {
  // "/5/lb-powder" is two unrelated segments, not "5 lb".
  assert.equal(sizeFrom('https://example.com/5/lb-powder'), null);
});
