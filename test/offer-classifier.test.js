'use strict';

/**
 * Offer wording for the Aisle filter: only outright free items survive, never
 * BOGO, "buy" rebates, "free with purchase of" or money-off offers. Lines
 * marked "live" are tags copied from discover.gotoaisle.com/offers.
 */

const test = require('node:test');
const assert = require('node:assert');
const offers = require('../src/common/offer-classifier.js');

const cases = {
  free: [
    'FREE Olipop',
    'Get a FREE Poppi',
    'Try Siete for FREE',
    'Get 2 FREE cans of bubly',
    '3 FREE Chobani Flips',
    'Free 4-pack',
    'FREE Liquid Death (up to $2.49)',
    'Free Olipop — up to $2.99 back',
    '100% cash back on any OLIPOP',
    'Your next Celsius is on us',
    'Buy 1, get it free',
    'Get it for $0',
    'Try For FREE',
    'Olipop: FREE'
  ],
  bogo: [
    'Buy 1 Get 1 FREE',
    'BOGO Siete chips',
    'B1G1 free',
    'Buy 2, get 1 free',
    'Buy one get one 50% off',
    'Buy any 2 Chobani, get 1 FREE',
    '2 for 1 Kombucha',
    'FREE dip with purchase of any Siete chips',
    'Free bar when you buy a 12-pack',
    'Second one free',
    'BOGO' // live
  ],
  purchase: [
    'Buy 2 Packs, Get $15', // live
    'Buy 2, Get $7', // live
    'Buy 3 Get $10', // live
    'Get Rewarded For Buying C2O!', // live
    'Get Rewarded For Buying Evergreen!', // live
    'Buy More, Earn More', // live
    'Buy a Poppi, get a full refund. FREE!'
  ],
  discount: [
    '$2 off any Siete product',
    'Save $1.50 on Chobani',
    '$3 back on Olipop 12-pack',
    '50% off',
    '50% back on Poppi',
    '75¢ off',
    'Get $1 cash back',
    '$2 off gluten free bread',
    'Try For $8' // live
  ],
  none: [
    'Olipop',
    'Gluten free tortilla chips',
    'Kudos Chlorine Free Cotton-Lined Disposable Diapers (All Sizes)', // live
    'Sugar-free',
    'Free shipping',
    'Free-range eggs',
    '',
    'Limit 1 per customer',
    'Redeem To Unlock More Offers!', // live
    'GET GROUNDED, GET REWARDED!', // live
    'SHOP C2O AT TARGET AND GET REWARDED!', // live
    'Instinct FreshRaw Meals For Dogs Loyalty Pass' // live
  ]
};

for (const [kind, lines] of Object.entries(cases)) {
  test(`${kind} offers are recognised`, () => {
    for (const line of lines) {
      assert.strictEqual(offers.classify(line), kind, line);
    }
  });
}

test('a card is judged by its headline, not its fine print', () => {
  assert.strictEqual(offers.classifyLines(['OLIPOP', 'FREE Olipop', 'Up to $2.99 back', 'Expires 10/31']), 'free');
  assert.strictEqual(offers.classifyLines(['Siete', '$2 off', 'Gluten free tortilla chips']), 'discount');
  assert.strictEqual(offers.classifyLines('Chobani\n$1 off\nFree to claim'), 'discount');
});

test('a BOGO phrase anywhere on a card wins, even split across lines', () => {
  assert.strictEqual(offers.classifyLines(['FREE', 'Buy 1 Get 1 on bubly']), 'bogo');
  assert.strictEqual(offers.classifyLines(['Buy 1,', 'Get 1 FREE']), 'bogo');
  assert.strictEqual(offers.classifyLines(['Poppi', 'Buy 2', 'get 1 FREE']), 'bogo');
});

test('a product name that says "free" does not make a paid offer free', () => {
  assert.strictEqual(
    offers.classifyLines(['Buy 2 Packs, Get $15', 'Kudos Chlorine Free Cotton-Lined Disposable Diapers (All Sizes)']),
    'purchase'
  );
  assert.strictEqual(offers.classifyLines(['LOYALTY', 'Try For $8', 'Lioness 4pk At Target']), 'discount');
  assert.strictEqual(offers.classifyLines(['Redeem To Unlock More Offers!', 'YUMI Organic Superbar']), 'none');
});

test('isFree is true only for free offers', () => {
  assert.strictEqual(offers.isFree(['Get 2 FREE']), true);
  assert.strictEqual(offers.isFree(['Buy 1 Get 1 FREE']), false);
  assert.strictEqual(offers.isFree(['$1 off']), false);
  assert.strictEqual(offers.isFree(['Buy 2, Get $5', 'Jukebox Soaps']), false);
  assert.strictEqual(offers.isFree(['A "Realsy" Good Deal', 'Realsy Nut Butter-Filled Medjool Dates']), false);
  assert.strictEqual(offers.isFree([]), false);
  assert.strictEqual(offers.isFree(null), false);
});
