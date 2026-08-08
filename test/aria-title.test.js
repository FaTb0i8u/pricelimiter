'use strict';

/**
 * Google's organic Shopping tiles have no heading. The product name is only
 * available as the opening sentence of a whole-card aria-label, e.g.
 *
 *   "Dymatize ISO 100 Protein.  Nearby, 9 mi. Current Price: $139.99. $28/lb."
 *
 * These cases pin down where that sentence ends. The cut must not be greedy:
 * truncating "5.15 lbs" or "Dr. Pepper" would throw away the size and leave a
 * card unpriceable.
 */

const test = require('node:test');
const assert = require('node:assert');

require('../src/common/units.js');
require('../src/common/parse-price.js');
require('../src/common/parse-quantity.js');
const adapter = require('../src/content/site-adapter.js');
const quantity = globalThis.PPP.quantity;

const cut = adapter.titleFromAriaLabel;

test('the product name is cut from a whole-card aria-label', () => {
  assert.strictEqual(
    cut('Dymatize ISO 100 Protein.  Nearby, 9 mi. Current Price: $139.99. $28/lb. GNC & more.'),
    'Dymatize ISO 100 Protein'
  );
  assert.strictEqual(
    cut('Transparent Labs Grass Fed Whey Protein Isolate.  Current Price: $59.99. $2.00/ct.'),
    'Transparent Labs Grass Fed Whey Protein Isolate'
  );
});

test('metadata phrases cut the label even without double spacing', () => {
  assert.strictEqual(
    cut('Naked Whey Protein 5 lb. Current Price: $89.99. Naked Nutrition & more.'),
    'Naked Whey Protein 5 lb'
  );
  assert.strictEqual(cut('Some Product. Nearby, 3 mi.'), 'Some Product');
  assert.strictEqual(cut('Some Product. Rated 4.5 out of 5.'), 'Some Product');
  assert.strictEqual(cut('Some Product. $19.99.'), 'Some Product');
});

test('a single space after a period does not truncate a real name', () => {
  // "Dr. Pepper" and "5.15 lbs" must survive: over-eager cutting would throw
  // away the size and leave the card unpriceable.
  assert.strictEqual(cut('Dr. Pepper Soda 12 pack'), 'Dr. Pepper Soda 12 pack');
  assert.strictEqual(
    cut('OPTIMUM 100% Whey Gold Standard 5.15 lbs'),
    'OPTIMUM 100% Whey Gold Standard 5.15 lbs'
  );
});

test('the cut label still yields the correct pack size', () => {
  const label = 'Naked Whey Protein Powder 5 lb.  Current Price: $89.99. $18/lb. Naked & more.';
  const parsed = quantity.parseQuantity(cut(label));
  assert.strictEqual(parsed.unitKey, 'lb');
  assert.strictEqual(Math.round(parsed.amount / 453.59237), 5);
});

test('a per-unit price is never mistaken for a pack size', () => {
  // The cut is defence in depth, not a fix for a live miscalculation: the size
  // parser already refuses "$28/lb". Asserted both ways so that a future change
  // loosening the parser is caught here.
  const raw = 'Dymatize ISO 100 Protein.  Nearby, 9 mi. Current Price: $139.99. $28/lb.';
  assert.strictEqual(quantity.parseQuantity(raw), null);
  assert.strictEqual(quantity.parseQuantity(cut(raw)), null);
});

test('empty and missing labels are safe', () => {
  assert.strictEqual(cut(''), '');
  assert.strictEqual(cut(null), '');
  assert.strictEqual(cut(undefined), '');
});
