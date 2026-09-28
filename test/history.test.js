'use strict';

/**
 * Price history. The failure that matters is a false "New low": it tells the
 * shopper a price is a bargain when it is not, so most cases here are about
 * refusing to compare things that are not the same product in the same money.
 */

const test = require('node:test');
const assert = require('node:assert');
const { history, verdict, settings, price, quantity } = require('./load.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 28, 12);

test('keys separate currency and dimension, and ignore cosmetic title differences', () => {
  const a = history.keyFor('Café Bustelo Espresso, 10 oz', 'USD', 'mass');
  const b = history.keyFor('  CAFE BUSTELO — espresso 10 oz ', 'USD', 'mass');
  assert.ok(a);
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, history.keyFor('Café Bustelo Espresso, 10 oz', 'CAD', 'mass'));
  assert.notStrictEqual(a, history.keyFor('Café Bustelo Espresso, 10 oz', 'USD', 'volume'));
});

test('products that cannot be identified are not remembered', () => {
  assert.strictEqual(history.keyFor('Rice', 'USD', 'mass'), null);
  assert.strictEqual(history.keyFor('Jasmine rice 5 lb', null, 'mass'), null);
  assert.strictEqual(history.keyFor('Jasmine rice 5 lb', 'USD', 'count'), null);
});

test('merge keeps the lowest price and when it was seen', () => {
  const key = 'USD|mass|jasmine rice 5 lb';
  let result = history.merge({}, [{ key, price: 0.004, site: 'Amazon' }], NOW - 3 * DAY);
  assert.strictEqual(result.changed, true);

  result = history.merge(result.store, [{ key, price: 0.005, site: 'Walmart' }], NOW);
  assert.strictEqual(result.store[key].p, 0.004, 'a higher price never replaces the low');
  assert.strictEqual(result.store[key].s, 'Amazon');
  assert.strictEqual(result.store[key].l, NOW, 'but the product was seen again');

  result = history.merge(result.store, [{ key, price: 0.003, site: 'Walmart' }], NOW);
  assert.deepStrictEqual(result.store[key], { p: 0.003, t: NOW, s: 'Walmart', l: NOW });
});

test('merge does not mutate its input and skips needless writes', () => {
  const key = 'USD|mass|jasmine rice 5 lb';
  const store = { [key]: { p: 0.004, t: NOW, s: 'Amazon', l: NOW } };
  const snapshot = JSON.stringify(store);
  const result = history.merge(store, [{ key, price: 0.005, site: 'Amazon' }], NOW + 60 * 1000);
  assert.strictEqual(JSON.stringify(store), snapshot);
  assert.strictEqual(result.changed, false, 'a re-scan minutes later writes nothing');
});

test('merge rejects junk observations', () => {
  for (const bad of [null, {}, { key: 'k', price: 0 }, { key: 'k', price: -1 }, { key: 'k', price: NaN }]) {
    assert.strictEqual(history.merge({}, [bad], NOW).changed, false, JSON.stringify(bad));
  }
});

test('the store is capped by dropping the least recently seen', () => {
  const store = {};
  for (let i = 0; i < history.MAX_ENTRIES; i++) {
    store['USD|mass|product ' + i] = { p: 1, t: NOW, s: 'x', l: NOW - i * 1000 };
  }
  const { store: next } = history.merge(store, [{ key: 'USD|mass|brand new', price: 1, site: 'x' }], NOW);
  assert.strictEqual(Object.keys(next).length, history.MAX_ENTRIES);
  assert.ok(next['USD|mass|brand new']);
  assert.strictEqual(next['USD|mass|product ' + (history.MAX_ENTRIES - 1)], undefined, 'oldest dropped');
  assert.ok(next['USD|mass|product 0']);
});

test('a new low needs a real drop, not rounding noise', () => {
  const entry = { p: 1, t: NOW - DAY, s: 'Amazon', l: NOW - DAY };
  assert.strictEqual(history.compare(entry, 0.995).isNewLow, false);
  assert.strictEqual(history.compare(entry, 0.98).isNewLow, true);
  assert.strictEqual(history.compare(entry, 1.2).isNewLow, false);
  assert.strictEqual(history.compare(entry, 1.2).lowest, 1);
  assert.strictEqual(history.compare(undefined, 1), null);
  assert.strictEqual(history.compare({ p: 'x' }, 1), null);
});

test('stored data of the wrong shape is dropped, not trusted', () => {
  const clean = history.sanitize({
    good: { p: 0.5, t: NOW, s: 'Amazon', l: NOW },
    noPrice: { t: NOW, s: 'Amazon', l: NOW },
    badSite: { p: 0.5, t: NOW, s: 42, l: NOW },
    notAnObject: 'hello'
  });
  assert.deepStrictEqual(Object.keys(clean), ['good']);
  assert.deepStrictEqual(history.sanitize(null), {});
});

test('ages read naturally', () => {
  assert.strictEqual(history.describeAge(NOW - 10 * 1000, NOW, 'en'), 'just now');
  assert.strictEqual(history.describeAge(NOW - DAY, NOW, 'en'), 'yesterday');
  assert.strictEqual(history.describeAge(NOW - 3 * DAY, NOW, 'en'), '3 days ago');
  assert.strictEqual(history.describeAge(NOW - 3 * 3600 * 1000, NOW, 'en'), '3 hours ago');
});

test('canonical price is independent of the basis being viewed', () => {
  const data = (() => {
    const p = price.parsePrice('$10.00');
    const q = quantity.parseQuantity('Rice, 5 lb bag');
    return { price: p, unitPrice: null, quantity: q, quantitySource: 'title', pricePerCanonical: p.amount / q.amount };
  })();
  const perLb = verdict.canonicalPrice(verdict.evaluate(data, Object.assign(settings.sanitize({}), { basis: 'lb' })));
  const perKg = verdict.canonicalPrice(verdict.evaluate(data, Object.assign(settings.sanitize({}), { basis: 'kg' })));
  assert.strictEqual(perLb.dimension, 'mass');
  assert.ok(Math.abs(perLb.value - perKg.value) < 1e-12);
  assert.strictEqual(verdict.canonicalPrice({ state: 'unknown' }), null);
});

/* ------------------------------------------------------------------ storage */

function fakeStorage() {
  const data = {};
  return {
    data,
    get(key, cb) { cb({ [key]: data[key] }); },
    set(payload, cb) { Object.assign(data, JSON.parse(JSON.stringify(payload))); cb(); },
    remove(key, cb) { delete data[key]; cb(); }
  };
}

test('record merges with what another tab wrote meanwhile', async () => {
  const local = fakeStorage();
  globalThis.chrome = { storage: { local }, runtime: { lastError: undefined } };
  try {
    await history.record([{ key: 'USD|mass|tab one product', price: 1, site: 'Amazon' }], NOW);
    // Another tab writes directly between two flushes from this one.
    local.data[history.STORAGE_KEY]['USD|mass|tab two product'] = { p: 2, t: NOW, s: 'Walmart', l: NOW };
    await history.record([{ key: 'USD|mass|tab one other', price: 3, site: 'Amazon' }], NOW);

    const stored = await history.load();
    assert.deepStrictEqual(
      Object.keys(stored).sort(),
      ['USD|mass|tab one other', 'USD|mass|tab one product', 'USD|mass|tab two product']
    );

    await history.clear();
    assert.deepStrictEqual(await history.load(), {});
  } finally {
    delete globalThis.chrome;
  }
});

test('without extension storage everything is a quiet no-op', async () => {
  assert.deepStrictEqual(await history.load(), {});
  await history.record([{ key: 'USD|mass|anything at all', price: 1, site: 'x' }]);
  await history.clear();
});
