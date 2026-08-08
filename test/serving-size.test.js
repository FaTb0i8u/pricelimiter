'use strict';

/**
 * Serving sizes are doses, not pack sizes.
 *
 * Found on live Google Shopping: a $24.99 protein powder badged at $377.80/lb,
 * because the card body read "Amino Acids . 30 g per serving" and 30 g was
 * taken as the net weight. The number is not merely wrong, it is wrong by a
 * factor of ~75, which destroys trust in every other badge on the page.
 */

const test = require('node:test');
const assert = require('node:assert');

const { quantity } = require('./load.js');

const parse = (text) => quantity.parseQuantity(text);

test('the exact live failure no longer parses', () => {
  assert.strictEqual(parse('Amino Acids \u00b7 30 g per serving \u00b7 Whey'), null);
});

test('a serving size is never mistaken for a net weight', () => {
  for (const text of [
    '30 g per serving',
    '30g protein per serving',
    '24 g protein per scoop',
    '2 g per dose',
    '500 mg per capsule',
    'Serving size: 30 g',
    'Serving Size 2 tablets'
  ]) {
    assert.strictEqual(parse(text), null, text);
  }
});

test('a real net weight still wins when a serving size sits beside it', () => {
  // The tub size is the number we want; the dose must not displace or beat it.
  const parsed = parse('Whey Protein 5 lb tub, 30 g per serving');
  assert.ok(parsed, 'expected the pack size to parse');
  assert.strictEqual(parsed.dimension, 'mass');
  assert.strictEqual(parsed.raw, '5 lb');
  assert.strictEqual(Math.round(parsed.amount), 2268); // grams in 5 lb
});

test('per-item pack sizes are still multiplied', () => {
  // Guards the edit that removed "serving" from the each/per-item list: the
  // genuine per-container wordings must keep working.
  const parsed = parse('6 pack, 16 oz per bottle');
  assert.ok(parsed);
  assert.strictEqual(parsed.packCount, 6);
  assert.strictEqual(Math.round(parsed.amount), 2722); // 6 x 16 oz
});

test('the word serving without a size is harmless', () => {
  const parsed = parse('Whey Protein 5 lb, 60 servings');
  assert.ok(parsed);
  assert.strictEqual(parsed.raw, '5 lb');
  assert.strictEqual(Math.round(parsed.amount), 2268);
});
