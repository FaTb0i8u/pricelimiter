'use strict';

/**
 * Settings persistence rules. These decide whether what the user typed is
 * what the filter actually uses, so a failure here is silent and total.
 */

const test = require('node:test');
const assert = require('node:assert');
const { settings } = require('./load.js');

test('a limit typed with no detected currency is kept, not dropped', () => {
  // Regression: this used to return the settings unchanged, so the panel
  // re-rendered the old value and the keystroke did nothing.
  const updated = settings.setThreshold(settings.sanitize({}), null, 7);
  assert.strictEqual(updated.threshold, 7);
  assert.strictEqual(settings.thresholdFor(updated, null), 7);
  assert.deepStrictEqual(updated.thresholds, {});
});

test('a currency limit never leaks into another currency', () => {
  const usd = settings.setThreshold(settings.sanitize({}), 'USD', 8);
  assert.strictEqual(settings.thresholdFor(usd, 'CAD'), settings.DEFAULTS.threshold);
  assert.strictEqual(settings.thresholdFor(usd, 'USD'), 8);
});

test('setThreshold rejects malformed input without losing existing limits', () => {
  const base = settings.setThreshold(settings.sanitize({}), 'USD', 8);
  for (const [currency, value] of [['usd', 5], ['USD', -1], ['USD', 'abc'], ['USD', NaN]]) {
    const out = settings.setThreshold(base, currency, value);
    assert.strictEqual(out.thresholds.USD, 8, `${currency}=${value}`);
    assert.strictEqual(out.thresholds.usd, undefined);
  }
  assert.strictEqual(settings.setThreshold(base, 'USD', 5e9).thresholds.USD, 1e6);
});

test('withCurrency does not modify its input', () => {
  const stored = settings.setThreshold(settings.sanitize({}), 'GBP', 4);
  const snapshot = JSON.stringify(stored);
  settings.withCurrency(stored, 'USD');
  assert.strictEqual(JSON.stringify(stored), snapshot);
});

test('panel corner is limited to the four known corners', () => {
  for (const corner of settings.PANEL_CORNERS) {
    assert.strictEqual(settings.sanitize({ panelCorner: corner }).panelCorner, corner);
  }
  assert.strictEqual(settings.sanitize({ panelCorner: 'middle' }).panelCorner, 'bottom-right');
  assert.strictEqual(settings.sanitize({ panelCorner: 42 }).panelCorner, 'bottom-right');
});

test('new preferences default off and coerce to booleans', () => {
  assert.strictEqual(settings.sanitize(null).sortByUnitPrice, false);
  assert.strictEqual(settings.sanitize({ sortByUnitPrice: 1 }).sortByUnitPrice, true);
});

test('confidence presets are ordered and within range', () => {
  const values = settings.CONFIDENCE_PRESETS.map((p) => p.value);
  assert.deepStrictEqual(values, values.slice().sort((a, b) => a - b));
  assert.ok(values.every((v) => v >= 0 && v <= 1));
  assert.ok(values.includes(settings.DEFAULTS.minConfidence), 'the default is a preset');
});

test('storage absent: load and save degrade quietly', async () => {
  assert.deepStrictEqual(await settings.load(), settings.sanitize(null));
  await settings.save({ basis: 'kg' });
  assert.strictEqual(typeof settings.subscribe(() => {}), 'function');
});

test('switching unit converts every saved limit within a dimension', () => {
  // Regression: the number used to stay put, so "$3/lb" became "$3/kg" - a
  // limit 2.2 times stricter than the one the user chose.
  let s = settings.setThreshold(settings.sanitize({}), 'USD', 3);
  s = settings.setThreshold(s, 'GBP', 2);
  const kg = settings.setBasis(s, 'kg');
  assert.strictEqual(kg.basis, 'kg');
  assert.strictEqual(kg.thresholds.USD, 6.614);
  assert.strictEqual(kg.thresholds.GBP, 4.409);
  assert.strictEqual(kg.threshold, 4.409, 'the unscoped limit follows the last one typed');

  const oz = settings.setBasis(s, 'oz');
  assert.strictEqual(oz.thresholds.USD, 0.1875);
  assert.strictEqual(settings.setBasis(kg, 'lb').thresholds.USD, 3, 'round trip is exact');
  assert.strictEqual(settings.setBasis(s, 'g100').thresholds.USD, 0.6614);
});

test('switching between weight and volume keeps the number', () => {
  const s = settings.setThreshold(settings.sanitize({}), 'USD', 3);
  assert.strictEqual(settings.setBasis(s, 'l').thresholds.USD, 3);
  assert.strictEqual(settings.setBasis(s, 'nonsense').basis, 'lb');
  const snapshot = JSON.stringify(s);
  settings.setBasis(s, 'kg');
  assert.strictEqual(JSON.stringify(s), snapshot, 'input is not modified');
});

test('a currency with no saved limit starts from the default in the current unit', () => {
  assert.strictEqual(settings.thresholdFor(settings.sanitize({ basis: 'lb' }), 'USD'), 3);
  assert.strictEqual(settings.thresholdFor(settings.sanitize({ basis: 'kg' }), 'USD'), 6.614);
  assert.strictEqual(settings.thresholdFor(settings.sanitize({ basis: 'l' }), 'USD'), 3);
  assert.strictEqual(settings.thresholdFor(settings.sanitize({ basis: 'floz' }), 'USD'), 0.08872);
});

test('an invalidated extension context degrades quietly', async () => {
  const explode = () => { throw new Error('Extension context invalidated.'); };
  globalThis.chrome = {
    storage: { sync: { get: explode, set: explode }, onChanged: { addListener: explode } },
    runtime: {}
  };
  try {
    assert.strictEqual(settings.contextAlive(), false);
    assert.deepStrictEqual(await settings.load(), settings.sanitize(null));
    await settings.save({ basis: 'kg' });
    assert.strictEqual(typeof settings.subscribe(() => {}), 'function');

    globalThis.chrome.runtime.id = 'test-extension';
    assert.strictEqual(settings.contextAlive(), true);
    assert.deepStrictEqual(await settings.load(), settings.sanitize(null));
    await settings.save({ basis: 'kg' });
  } finally {
    delete globalThis.chrome;
  }
});

test('automatic product-page lookups are opt-in', () => {
  assert.strictEqual(settings.sanitize(null).autoLookup, false);
  assert.strictEqual(settings.sanitize({ autoLookup: 1 }).autoLookup, true);
});
