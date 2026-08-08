'use strict';

/**
 * Discount handling.
 *
 * Stores show a struck-through "was" price next to the current one, and the
 * error is asymmetric: reporting the OLD price makes a discounted item look
 * more expensive than it is, so the extension hides exactly the bargains it
 * exists to find. Walmart shipped this bug because it puts both prices in one
 * accessible label ("current price Now $46.72, Was $51.97") and strikes the old
 * one with `class="strike"` rather than an `<s>` tag.
 */

const test = require('node:test');
const assert = require('node:assert');

const { price, adapter } = require('./load.js');

const strip = adapter.stripWasPrices;

test('a combined current-and-was label yields the current price', () => {
  const label = 'current price Now $46.72, Was $51.97';
  assert.strictEqual(price.parsePrice(strip(label)).amount, 46.72);
});

test('every wording stores use for an old price is removed', () => {
  for (const wording of [
    'Now $19.08, Was $22.47',
    'Now $19.08, was $22.47',
    '$19.08 List price $22.47',
    '$19.08 Original price $22.47',
    '$19.08 Original Price: $22.47',
    '$19.08 Regular price $22.47',
    '$19.08 Compare at $22.47'
  ]) {
    const parsed = price.parsePrice(strip(wording));
    assert.ok(parsed, wording);
    assert.strictEqual(parsed.amount, 19.08, wording);
  }
});

test('a lone was-price leaves nothing to parse', () => {
  // The node is then skipped rather than reported as the item's price.
  assert.strictEqual(price.looksLikePrice(strip('Was $51.97')), false);
  assert.strictEqual(price.looksLikePrice(strip('List price $89.00')), false);
});

test('an old price is not removed when it is the cheaper number', () => {
  // Guards against the rule quietly inverting: whatever the label says is the
  // old price is dropped, and the remaining figure is reported as-is.
  assert.strictEqual(price.parsePrice(strip('Now $60.00, Was $12.00')).amount, 60);
});

test('ordinary prices are untouched', () => {
  for (const text of ['$29.97', '$1,234.56', '12,99 \u20ac', '$139.99 $28/lb']) {
    assert.strictEqual(strip(text), text);
  }
});

test('the word "was" without a price is harmless', () => {
  // "Washington" and similar must not be mangled into a broken price string.
  assert.strictEqual(strip('Washington Apples $4.99'), 'Washington Apples $4.99');
  assert.strictEqual(price.parsePrice(strip('Washington Apples $4.99')).amount, 4.99);
});

test('empty and missing input are safe', () => {
  assert.strictEqual(strip(''), '');
  assert.strictEqual(strip(null), '');
  assert.strictEqual(strip(undefined), '');
});
