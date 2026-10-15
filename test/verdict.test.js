'use strict';

/**
 * Verdict rules: the code that decides which badge a shopper sees and whether
 * a result is hidden. Inputs are built with the real parsers so the tests
 * exercise the same shapes the content script produces.
 */

const test = require('node:test');
const assert = require('node:assert');
const { price, quantity, settings, verdict } = require('./load.js');

function card({ itemPrice, unitPrice, size }) {
  const priceInfo = itemPrice ? price.parsePrice(itemPrice) : null;
  const parsed = size ? quantity.parseQuantity(size) : null;
  return {
    price: priceInfo,
    unitPrice: unitPrice ? price.parseUnitPrice(unitPrice) : null,
    quantity: parsed,
    quantitySource: parsed ? 'title' : '',
    pricePerCanonical: priceInfo && parsed ? priceInfo.amount / parsed.amount : null
  };
}

const limit = (threshold, extra) => Object.assign(settings.sanitize({}), { threshold }, extra);

test('an inferred price at or under the limit passes, over it fails', () => {
  const data = card({ itemPrice: '$10.00', size: 'Rice, 5 lb bag' });
  assert.strictEqual(verdict.evaluate(data, limit(2)).state, 'pass');
  assert.strictEqual(verdict.evaluate(data, limit(1.99)).state, 'fail');
  assert.strictEqual(Math.round(verdict.evaluate(data, limit(2)).unitPrice * 100), 200);
});

test('the merchant unit price beats a title size', () => {
  // Title says 5 lb ($2/lb) but the store declares $3/lb; the store wins.
  const data = card({ itemPrice: '$10.00', unitPrice: '$3.00/lb', size: '5 lb' });
  const result = verdict.evaluate(data, limit(2.5));
  assert.strictEqual(result.source, 'site');
  assert.strictEqual(result.state, 'fail');
});

test('a per-count merchant price falls through to the title size', () => {
  const data = card({ itemPrice: '$10.00', unitPrice: '$1.67/ct', size: '5 lb' });
  const result = verdict.evaluate(data, limit(3));
  assert.strictEqual(result.state, 'pass');
  assert.strictEqual(result.source, 'title');
});

test('a per-count price with no size is reported, never filtered', () => {
  const data = card({ itemPrice: '$33.43', unitPrice: '$1.67/ct' });
  const result = verdict.evaluate(data, limit(0.01));
  assert.strictEqual(result.state, 'unknown');
  assert.strictEqual(verdict.badgeText(result, data, 'USD', 'en-US'), '$1.67/ct');
});

test('the other dimension is n/a and converted to its own natural base', () => {
  const data = card({ itemPrice: '$11.99', size: 'Detergent 92 fl oz' });
  const result = verdict.evaluate(data, limit(1, { basis: 'lb' }));
  assert.strictEqual(result.state, 'na');
  assert.strictEqual(result.altBase.key, 'l');
});

test('a size below the confidence floor is treated as unknown', () => {
  const data = card({ itemPrice: '$9.00', size: '(6-Pack) 16 oz' }); // pack-ambiguous, 0.45
  assert.strictEqual(verdict.evaluate(data, limit(100, { minConfidence: 0.6 })).reason, 'size unclear');
  assert.notStrictEqual(verdict.evaluate(data, limit(100, { minConfidence: 0.4 })).state, 'unknown');
  assert.strictEqual(verdict.isUncertain(verdict.evaluate(data, limit(100)), data), true);
});

test('declared prices are never flagged uncertain', () => {
  const data = card({ itemPrice: '$9.00', unitPrice: '$2/lb', size: '(6-Pack) 16 oz' });
  assert.strictEqual(verdict.isUncertain(verdict.evaluate(data, limit(5)), data), false);
});

test('money is formatted for the currency, not with a bare dollar sign', () => {
  assert.strictEqual(verdict.formatMoney(2.05, 'USD', 'en-US'), '$2.05');
  assert.strictEqual(verdict.formatMoney(2.05, 'CAD', 'en-US'), 'CA$2.05');
  assert.strictEqual(verdict.formatMoney(2.05, 'GBP', 'en-GB'), '\u00a32.05');
  assert.strictEqual(verdict.formatMoney(123.45, 'USD', 'en-US'), '$123.5');
  assert.strictEqual(verdict.formatMoney(1234.5, 'USD', 'en-US'), '$1,235');
  assert.strictEqual(verdict.formatMoney(2.05, null), '2.05');
  assert.strictEqual(verdict.formatMoney(2.05, 'not-a-code'), '2.05');
  assert.strictEqual(verdict.formatMoney(NaN, 'USD'), '');
});

test('the currency symbol follows the locale', () => {
  assert.strictEqual(verdict.currencySymbol('USD', 'en-US'), '$');
  assert.strictEqual(verdict.currencySymbol('CAD', 'en-US'), 'CA$');
  assert.strictEqual(verdict.currencySymbol(null), '');
});

test('sorting puts comparable prices first, then other-dimension, then unsized', () => {
  const settingsLb = limit(100, { basis: 'lb' });
  const rows = [
    { id: 'unsized', data: card({ itemPrice: '$5.00' }) },
    { id: 'volume', data: card({ itemPrice: '$4.00', size: '1 L' }) },
    { id: 'dear', data: card({ itemPrice: '$30.00', size: '2 lb' }) },
    { id: 'cheap', data: card({ itemPrice: '$10.00', size: '5 lb' }) }
  ].map((row) => Object.assign(row, { v: verdict.evaluate(row.data, settingsLb) }));

  rows.sort((a, b) => verdict.compareVerdicts(a.v, b.v));
  assert.deepStrictEqual(rows.map((r) => r.id), ['cheap', 'dear', 'volume', 'unsized']);
});

test('sorting is stable among unsized results', () => {
  const unknown = { state: 'unknown' };
  assert.strictEqual(verdict.compareVerdicts(unknown, { state: 'unknown' }), 0);
});

test('a per-100 g merchant price is judged on its real unit price', () => {
  // £0.83/100 g is £3.76/lb. Before the fix the card read as a £0.83 item.
  const data = card({ itemPrice: '£2.50 (£0.83/100 g)', unitPrice: '£2.50 (£0.83/100 g)', size: 'Beans 415g' });
  assert.strictEqual(data.price.amount, 2.5);
  const result = verdict.evaluate(data, limit(3.5));
  assert.strictEqual(result.source, 'site');
  assert.strictEqual(result.state, 'fail');
  assert.strictEqual(verdict.badgeText(result, data, 'GBP', 'en-GB'), '\u00a33.76/lb');
});

test('a Walmart cent unit price is compared like any other', () => {
  const data = card({ itemPrice: '$3.98', unitPrice: '$3.98 11.2 \u00a2/oz', size: 'Peanut Butter 40 oz' });
  const result = verdict.evaluate(data, limit(2));
  assert.strictEqual(result.source, 'site');
  assert.strictEqual(result.state, 'pass');
  assert.strictEqual(verdict.badgeText(result, data, 'USD', 'en-US'), '$1.79/lb');
});

test('items measured the other way are shown in the paired unit', () => {
  const drink = card({ itemPrice: '\u00a31.50', size: 'Juice 1 L' });
  const per100g = verdict.evaluate(drink, limit(1, { basis: 'g100' }));
  assert.strictEqual(per100g.state, 'na');
  assert.strictEqual(verdict.badgeText(per100g, drink, 'GBP', 'en-GB'), '\u00a30.15/100 ml');

  const rice = card({ itemPrice: '$10.00', size: 'Rice 5 lb' });
  assert.strictEqual(verdict.evaluate(rice, limit(1, { basis: 'floz' })).altBase.key, 'oz');
  assert.strictEqual(verdict.evaluate(rice, limit(1, { basis: 'l' })).altBase.key, 'kg');
});

test('a per-100 g basis reads like the shelf label', () => {
  const data = card({ itemPrice: '\u00a32.50', size: 'Beans 415g' });
  const result = verdict.evaluate(data, limit(0.7, { basis: 'g100' }));
  assert.strictEqual(result.state, 'pass');
  assert.strictEqual(verdict.badgeText(result, data, 'GBP', 'en-GB'), '\u00a30.60/100 g');
});
