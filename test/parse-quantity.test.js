'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { quantity, units } = require('./load.js');

const LB = units.MASS_TO_GRAMS.lb;
const OZ = units.MASS_TO_GRAMS.oz;
const KG = units.MASS_TO_GRAMS.kg;
const FLOZ = units.VOLUME_TO_ML.floz;
const GAL = units.VOLUME_TO_ML.gal;

function close(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test('exact unit constants', () => {
  assert.strictEqual(units.MASS_TO_GRAMS.lb, 453.59237);
  assert.strictEqual(units.MASS_TO_GRAMS.oz, 28.349523125);
  assert.strictEqual(units.VOLUME_TO_ML.floz, 29.5735295625);
});

test('plain weights', () => {
  const a = quantity.parseQuantity('Purina ONE Dog Food, 31.1 lb Bag');
  assert.strictEqual(a.dimension, 'mass');
  close(a.amount, 31.1 * LB);

  const b = quantity.parseQuantity('Chicken Breast 3lb');
  close(b.amount, 3 * LB);

  const c = quantity.parseQuantity('Organic Basmati Rice 10 kg');
  close(c.amount, 10 * KG);

  const d = quantity.parseQuantity('Purina Dog Chow 30-lb Bag');
  close(d.amount, 30 * LB);
});

test('fluid ounces are volume, never mass', () => {
  const a = quantity.parseQuantity('Tide Liquid Laundry Detergent, 92 fl oz');
  assert.strictEqual(a.dimension, 'volume');
  close(a.amount, 92 * FLOZ);

  const b = quantity.parseQuantity('Dish Soap, 25 Fluid Ounces');
  assert.strictEqual(b.dimension, 'volume');
  close(b.amount, 25 * FLOZ);

  const c = quantity.parseQuantity('Sea Salt, 25 Ounces');
  assert.strictEqual(c.dimension, 'mass');
  close(c.amount, 25 * OZ);
});

test('volumes', () => {
  const a = quantity.parseQuantity('Whole Milk 1 gal');
  assert.strictEqual(a.dimension, 'volume');
  close(a.amount, GAL);

  const b = quantity.parseQuantity('Olive Oil 16.9 fl oz (500 ml)');
  assert.strictEqual(b.dimension, 'volume');
  close(b.amount, 500, 1);
  assert.ok(b.flags.includes('restated-size'));
});

test('milligram dosages are not net weight', () => {
  assert.strictEqual(quantity.parseQuantity('Vitamin C 1000 mg, 250 Tablets'), null);
  assert.strictEqual(quantity.parseQuantity('Fish Oil 1200mg Softgels'), null);
});

test('explicit multipacks are multiplied', () => {
  const a = quantity.parseQuantity('Starbucks Ground Coffee, 2 x 12 oz');
  close(a.amount, 24 * OZ);
  assert.ok(a.flags.includes('explicit-multipack'));

  const b = quantity.parseQuantity('Protein Bars 1.76 oz x 12');
  close(b.amount, 12 * 1.76 * OZ);

  const c = quantity.parseQuantity('Bottled Water, 6 Pack, 16.9 fl oz each');
  close(c.amount, 6 * 16.9 * FLOZ, 0.1);
  assert.ok(c.flags.includes('multiplied-by-pack'));
});

test('ambiguous multipacks are NOT multiplied and are flagged', () => {
  const a = quantity.parseQuantity('(6-Pack) Granola Bars 16 oz');
  close(a.amount, 16 * OZ);
  assert.ok(a.flags.includes('pack-ambiguous'));
  assert.ok(a.confidence <= 0.45, `confidence was ${a.confidence}`);
});

test('a size restated in another unit is high confidence', () => {
  const a = quantity.parseQuantity('Optimum Nutrition Whey 5 lb (2.27 kg)');
  close(a.amount, 5 * LB, 3);
  assert.ok(a.confidence >= 0.85);
});

test('conflicting sizes use the smallest and drop confidence', () => {
  const a = quantity.parseQuantity('Coffee Sampler 12 oz bag with 2 lb tin');
  close(a.amount, 12 * OZ);
  assert.ok(a.flags.includes('multiple-sizes'));
  assert.ok(a.confidence <= 0.5);
});

test('an explicit net weight label wins', () => {
  const a = quantity.parseQuantity('Trail Mix Sampler 3 oz servings, Net Wt 12 oz');
  close(a.amount, 12 * OZ);
});

test('fractions', () => {
  close(quantity.parseQuantity('Ground Beef 1/2 lb').amount, 0.5 * LB);
  close(quantity.parseQuantity('Brisket 1-1/2 lb').amount, 1.5 * LB);
  close(quantity.parseQuantity('Butter 1 1/4 lb').amount, 1.25 * LB);
});

test('size ranges are low confidence', () => {
  const a = quantity.parseQuantity('Assorted Dumbbells 10-20 lb');
  assert.ok(a.flags.includes('size-range'));
  assert.ok(a.confidence <= 0.4);
});

test('thousands separators', () => {
  close(quantity.parseQuantity('Flour 1,000 g').amount, 1000);
});

test('non-grocery listings do not produce phantom sizes', () => {
  assert.strictEqual(quantity.parseQuantity('Apple iPhone 15 Pro 256GB Blue'), null);
  assert.strictEqual(quantity.parseQuantity('Samsung 65" QLED 4K TV'), null);
  assert.strictEqual(quantity.parseQuantity('Nike Air Max Size 10.5 Mens'), null);
  assert.strictEqual(quantity.parseQuantity('Unlocked 5G Phone, 128GB'), null);
});

test('prices inside the text are not read as sizes', () => {
  const a = quantity.parseQuantity('Cheese Wheel $16 oz special, 24 oz');
  close(a.amount, 24 * OZ);
});

test('formatQuantity', () => {
  assert.strictEqual(quantity.formatQuantity(5 * LB, 'mass'), '5 lb');
  assert.strictEqual(quantity.formatQuantity(8 * OZ, 'mass'), '8 oz');
  assert.strictEqual(quantity.formatQuantity(2000, 'volume'), '2 L');
});

test('empty and junk input', () => {
  assert.strictEqual(quantity.parseQuantity(''), null);
  assert.strictEqual(quantity.parseQuantity(null), null);
  assert.strictEqual(quantity.parseQuantity('Just a product name'), null);
});

test('the denominator of a unit price is not the pack size', () => {
  // "£0.83/100 g" prices the product per 100 g; it says nothing about the tin.
  assert.strictEqual(quantity.parseQuantity('Heinz Beans £2.50 £0.83/100 g'), null);
  assert.strictEqual(quantity.parseQuantity('Milk $3.49 9.3\u00a2 per 100 ml'), null);
  const tin = quantity.parseQuantity('Heinz Beans 415g £2.50 £0.83/100 g');
  close(tin.amount, 415);
  assert.strictEqual(tin.flags.indexOf('multiple-sizes'), -1);
});

test('decimal commas and dropped leading zeros', () => {
  close(quantity.parseQuantity('Riz basmati 1,5 kg').amount, 1.5 * KG);
  close(quantity.parseQuantity('Eau 6 x 1,5 l').amount, 9000);
  close(quantity.parseQuantity('Water .5 L bottle').amount, 500);
  close(quantity.parseQuantity('Spice (.75 oz)').amount, 0.75 * OZ);
  // Grouping commas and lists are untouched.
  close(quantity.parseQuantity('Rice 1,500 g').amount, 1500);
  close(quantity.parseQuantity('Pack of 3, 12 oz').amount, 12 * OZ);
});

test('nutrition claims in card copy are not pack sizes', () => {
  // Live Amazon tile: the claims made "5 lb" look like one of three sizes.
  const tub = quantity.parseQuantity('Dymatize ISO100, 25g of Protein, 5.5g BCAAs, 5 lb');
  close(tub.amount, 5 * LB);
  assert.strictEqual(tub.flags.indexOf('multiple-sizes'), -1);
  close(quantity.parseQuantity('Granola 10g fiber 12 oz bag').amount, 12 * OZ);
  assert.strictEqual(quantity.parseQuantity('Shake, 30g protein, 0g sugar'), null);
  // Product names, and gram figures too large to be a claim, still count.
  close(quantity.parseQuantity('MyProtein 500g Protein Powder').amount, 500);
  close(quantity.parseQuantity('Bars 12 x 60g Protein Bars').amount, 720);
  close(quantity.parseQuantity('Isolate 1kg protein').amount, KG);
});
