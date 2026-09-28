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
