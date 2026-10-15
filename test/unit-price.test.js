'use strict';

/**
 * Regression tests for the merchant-supplied unit price Google prints on its
 * own cards ("$28/lb", "$1.22/oz", "$3.00/ct").
 *
 * These exist because the first version of the extension ignored that line
 * entirely and inferred sizes from titles, which is strictly worse: the unit
 * price is declared by the merchant rather than guessed.
 */

const test = require('node:test');
const assert = require('node:assert');
const { price, units } = require('./load.js');

test('a merchant unit price is recognised', () => {
  const a = price.parseUnitPrice('$28/lb');
  assert.strictEqual(a.amount, 28);
  assert.strictEqual(a.perUnit.dimension, 'mass');
  assert.strictEqual(a.perUnit.key, 'lb');

  const b = price.parseUnitPrice('$1.22/oz');
  assert.strictEqual(b.amount, 1.22);
  assert.strictEqual(b.perUnit.key, 'oz');

  const c = price.parseUnitPrice('$0.13 per fl oz');
  assert.strictEqual(c.perUnit.dimension, 'volume');
  assert.strictEqual(c.perUnit.key, 'floz');
});

test('per-count unit prices are identified as counts, not weights', () => {
  for (const text of ['$3.00/ct', '$2.12/count', '$0.25/each', '$1.50/capsule']) {
    const parsed = price.parseUnitPrice(text);
    assert.ok(parsed, `expected a unit price in "${text}"`);
    assert.strictEqual(parsed.perUnit.dimension, 'count', text);
    assert.strictEqual(parsed.perUnit.factor, null, text);
  }
});

test('the unit price is never mistaken for the item price', () => {
  // Regression: the lowest-price-wins rule used to return $28 here.
  assert.strictEqual(price.parsePrice('$139.99 $28/lb').amount, 139.99);
  assert.strictEqual(price.parsePrice('$29.97 $3.00/ct').amount, 29.97);
  assert.strictEqual(price.parsePrice('$19.99 $1.22/oz').amount, 19.99);
});

test('a card with only a unit price has no item price', () => {
  assert.strictEqual(price.parsePrice('$28/lb'), null);
});

test('a struck-through original still loses to the current price', () => {
  assert.strictEqual(price.parsePrice('$10.24 $37').amount, 10.24);
});

test('text with no unit price yields none', () => {
  assert.strictEqual(price.parseUnitPrice('$46.97'), null);
  assert.strictEqual(price.parseUnitPrice('Free delivery on $35+'), null);
});

/**
 * Google's tile markup carries no whitespace between elements, so reading a
 * card with `textContent` welds the unit price onto the merchant name. The
 * unit then ends in a letter and is rejected as truncated, and a card visibly
 * reading "$1.67/ct" reports no size at all - 44 of 180 live tiles did.
 *
 * The adapter now reads cards node by node and joins on the element boundary.
 * These cases pin down the parser contract that fix depends on: a separated
 * unit price must parse, and a welded one is known NOT to. If the welded case
 * ever starts passing, this test should be revisited rather than deleted.
 */
test('a unit price separated from the next word parses', () => {
  const cases = [
    ['$33.43 $1.67/ct Walmart & more', 1.67, 'count'],
    ['$131.99 $26/lb Optimum Nutrition', 26, 'lb'],
    ['$23.97 $6.85/oz BulkSupplements', 6.85, 'oz']
  ];
  for (const [text, amount, key] of cases) {
    const parsed = price.parseUnitPrice(text);
    assert.ok(parsed, `expected a unit price in "${text}"`);
    assert.strictEqual(parsed.amount, amount, text);
    assert.strictEqual(parsed.perUnit.key, key, text);
  }
});

test('a unit price welded to the following word is rejected, not misread', () => {
  // Silently dropping these is what the adapter's node-wise read prevents.
  // Misreading them would be far worse than reporting no size.
  assert.strictEqual(price.parseUnitPrice('$33.43$1.67/ctWalmart & more'), null);
  assert.strictEqual(price.parseUnitPrice('$131.99$26/lbOptimum Nutrition'), null);
});

test('a unit price split across nodes still parses once rejoined', () => {
  // Amazon puts "$1.41" in a hidden span and "/ ounce)" in a separate node;
  // joining on the boundary must not break the pair back apart.
  const parsed = price.parseUnitPrice('$1.41 / ounce)');
  assert.ok(parsed);
  assert.strictEqual(parsed.amount, 1.41);
  assert.strictEqual(parsed.perUnit.key, 'oz');
});

test('unit prices convert to the selected basis', () => {
  const perOz = price.parseUnitPrice('$1.22/oz');
  const perGram = perOz.amount / perOz.perUnit.factor;
  const perLb = perGram * units.BASES.lb.perBase;
  assert.strictEqual(Math.round(perLb * 100) / 100, 19.52);

  const perLbDeclared = price.parseUnitPrice('$28/lb');
  const perKg = (perLbDeclared.amount / perLbDeclared.perUnit.factor) * units.BASES.kg.perBase;
  assert.strictEqual(Math.round(perKg * 100) / 100, 61.73);
});

test('the fixture corpus parses as expected end to end', () => {
  // Mirrors test/fixtures/shopping-fixture.js, which is what the browser
  // harness renders. Kept here so the arithmetic is checked without a browser.
  const cases = [
    { text: '$29.98 $17/lb', item: 29.98, perLb: 17 },
    { text: '$74.49 $37/lb', item: 74.49, perLb: 37 },
    { text: '$34.99 $34/lb', item: 34.99, perLb: 34 },
    { text: '$42.49 $30/lb', item: 42.49, perLb: 30 }
  ];
  for (const c of cases) {
    assert.strictEqual(price.parsePrice(c.text).amount, c.item, c.text);
    const unit = price.parseUnitPrice(c.text);
    const perLb = (unit.amount / unit.perUnit.factor) * units.BASES.lb.perBase;
    assert.strictEqual(Math.round(perLb * 100) / 100, c.perLb, c.text);
  }
});

/**
 * Amazon's UK, Canadian and Australian storefronts quote unit prices per
 * 100 g or 100 ml, and Amazon US quotes some per 100 count. The number in the
 * denominator used to stop the tail matching, so "£0.83" was read as an ITEM
 * price and - being the lowest - won, pricing a £2.50 tin at a third of its
 * cost. That is the dangerous direction: it makes a bad deal look cheap.
 */
test('a unit price quoted per 100 g is a unit price, not the item price', () => {
  const text = '£2.50 (£0.83/100 g)';
  assert.strictEqual(price.parsePrice(text).amount, 2.5);

  const unit = price.parseUnitPrice(text);
  assert.strictEqual(unit.amount, 0.83);
  assert.strictEqual(unit.perUnit.key, 'g');
  assert.strictEqual(unit.perUnit.factor, 100);
  assert.strictEqual(unit.perUnit.label, '100 g');
  assert.strictEqual(unit.raw, '£0.83/100 g');
  const perKg = (unit.amount / unit.perUnit.factor) * units.BASES.kg.perBase;
  assert.strictEqual(Math.round(perKg * 100) / 100, 8.3);
});

test('numbered denominators work for volume, "per" and counts', () => {
  const ml = price.parseUnitPrice('£1.20 per 100ml');
  assert.strictEqual(ml.perUnit.dimension, 'volume');
  assert.strictEqual(ml.perUnit.factor, 100);

  const count = price.parseUnitPrice('$12.99 ($0.13/100 Count)');
  assert.strictEqual(count.perUnit.dimension, 'count');
  assert.strictEqual(count.perUnit.label, '100 Count');
  assert.strictEqual(price.parsePrice('$12.99 ($0.13/100 Count)').amount, 12.99);

  const one = price.parseUnitPrice('$9.99 ($9.99/1 lb)');
  assert.strictEqual(one.perUnit.factor, units.MASS_TO_GRAMS.lb);
});

test('a zero denominator is not a price of anything', () => {
  assert.strictEqual(price.parseUnitPrice('$1.00/0 g'), null);
  assert.strictEqual(price.parsePrice('$1.00/0 g'), null);
});

test('Walmart cent unit prices and sub-dollar item prices parse', () => {
  const unit = price.parseUnitPrice('$3.98 11.2 \u00a2/oz');
  assert.strictEqual(unit.amount, 0.112);
  assert.strictEqual(unit.perUnit.key, 'oz');
  assert.strictEqual(unit.currency, null, 'a cent sign names no currency');
  assert.strictEqual(price.parsePrice('$3.98 11.2 \u00a2/oz').amount, 3.98);

  assert.strictEqual(price.parsePrice('88\u00a2').amount, 0.88);
  assert.strictEqual(price.parseUnitPrice('$1.48 9.3\u00a2/fl oz').perUnit.key, 'floz');
  assert.ok(price.looksLikePrice('11.2 \u00a2/oz'));
});

test('unit price display text is tidied, not squashed', () => {
  assert.strictEqual(price.parseUnitPrice('$0.62/Fl Oz').raw, '$0.62/Fl Oz');
  assert.strictEqual(price.parseUnitPrice('$1.41 / ounce)').raw, '$1.41/ounce');
  assert.strictEqual(price.parseUnitPrice('$0.13 per fl oz').raw, '$0.13 per fl oz');
});
