/**
 * Unit definitions and conversion tables.
 *
 * Two dimensions are supported:
 *   - mass   -> canonical internal unit is the GRAM
 *   - volume -> canonical internal unit is the MILLILITRE
 *
 * All factors are the internationally defined exact values where one exists
 * (e.g. 1 lb === 453.59237 g exactly). US customary volumes are used, which is
 * the correct choice for google.com; see README for the UK caveat.
 *
 * Loaded as a plain script in the extension (attaches to `globalThis.PPP`) and
 * as a CommonJS module in tests. No build step, no dependencies.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});

  /** Canonical unit key -> grams. */
  var MASS_TO_GRAMS = {
    mg: 0.001,
    g: 1,
    kg: 1000,
    oz: 28.349523125,
    lb: 453.59237
  };

  /** Canonical unit key -> millilitres. */
  var VOLUME_TO_ML = {
    ml: 1,
    cl: 10,
    dl: 100,
    l: 1000,
    floz: 29.5735295625,
    cup: 236.5882365,
    pt: 473.176473,
    qt: 946.352946,
    gal: 3785.411784
  };

  /**
   * Bases the user can filter on. `perBase` is how many canonical units make
   * up one of these, e.g. one pound is 453.59237 grams.
   *
   * `counterpart` is the base used to show an item measured the other way:
   * filtering per pound, a bottle sold by volume is shown per litre. Each is
   * the natural pair from the same system, so a per-100 g shopper sees drinks
   * per 100 ml rather than per US fluid ounce.
   *
   * The per-100 bases are how UK, Canadian and Australian shelves quote unit
   * prices, and what Amazon prints on those storefronts.
   */
  var BASES = {
    lb: { key: 'lb', label: 'lb', dimension: 'mass', perBase: MASS_TO_GRAMS.lb, counterpart: 'l' },
    kg: { key: 'kg', label: 'kg', dimension: 'mass', perBase: MASS_TO_GRAMS.kg, counterpart: 'l' },
    oz: { key: 'oz', label: 'oz', dimension: 'mass', perBase: MASS_TO_GRAMS.oz, counterpart: 'floz' },
    g100: { key: 'g100', label: '100 g', dimension: 'mass', perBase: 100, counterpart: 'ml100' },
    l: { key: 'l', label: 'L', dimension: 'volume', perBase: VOLUME_TO_ML.l, counterpart: 'kg' },
    floz: { key: 'floz', label: 'fl oz', dimension: 'volume', perBase: VOLUME_TO_ML.floz, counterpart: 'oz' },
    ml100: { key: 'ml100', label: '100 ml', dimension: 'volume', perBase: 100, counterpart: 'g100' }
  };

  /**
   * Regex fragment matching any spelling of any supported unit.
   *
   * Ordering is significant: JavaScript alternation is first-match-wins, so
   * longer spellings must precede their prefixes ("grams" before "gr" before
   * "g", "gallons" before "gal", "litres" before "l").
   *
   * Fluid-ounce spellings come first of all so that "fl oz" is never parsed as
   * the mass unit "oz" -- that single confusion is the most damaging error this
   * parser can make.
   */
  var UNIT_PATTERN = [
    'fl(?:uid)?\\.?\\s*(?:ounces?|oz)\\.?',
    'milligrams?',
    'milli(?:lit(?:er|re)s?)',
    'kilogram(?:me)?s?',
    'kilos?',
    'gallons?',
    'quarts?',
    'pints?',
    'cups?',
    'lit(?:er|re)s?',
    'ounces?',
    'pounds?',
    'grams?',
    'lbs?\\.?',
    'ozs?\\.?',
    'kgs?\\.?',
    'mgs?\\.?',
    'mls?\\.?',
    'gals?\\.?',
    'qts?\\.?',
    'pts?\\.?',
    'gr\\.?',
    'g\\.?',
    'l\\.?'
  ].join('|');

  /**
   * Units of COUNT, not of mass or volume. Google frequently prints these in
   * its own unit-price line ("$3.00/ct"). They are recognised purely so they
   * can be reported honestly and never compared against a per-pound threshold.
   * Longer spellings precede their prefixes, as above.
   */
  var COUNT_UNIT_PATTERN = [
    'counts?',
    'cts?',
    'pieces?',
    'servings?',
    'capsules?',
    'tablets?',
    'softgels?',
    'gummies',
    'diapers?',
    'bottles?',
    'batteries',
    'packets?',
    'sheets?',
    'wipes?',
    'loads?',
    'items?',
    'units?',
    'rolls?',
    'bags?',
    'bars?',
    'cans?',
    'pods?',
    'boxes',
    'each',
    'pcs?',
    'ea'
  ].join('|');

  /**
   * Normalise a matched unit string to a canonical key.
   * @param {string} raw
   * @returns {{key: string, dimension: 'mass'|'volume', factor: number}|null}
   */
  function resolveUnit(raw) {
    if (!raw) return null;
    var s = String(raw).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

    // Fluid ounces, in all their spellings, before anything else.
    if (/^fl(uid)?\s*(oz|ounce|ounces)$/.test(s)) return unit('floz');

    if (/^(mg|mgs|milligram|milligrams)$/.test(s)) return unit('mg');
    if (/^(g|gr|gm|gms|gram|grams)$/.test(s)) return unit('g');
    if (/^(kg|kgs|kilo|kilos|kilogram|kilograms|kilogramme|kilogrammes)$/.test(s)) return unit('kg');
    if (/^(oz|ozs|ounce|ounces)$/.test(s)) return unit('oz');
    if (/^(lb|lbs|pound|pounds)$/.test(s)) return unit('lb');

    if (/^(ml|mls|milliliter|milliliters|millilitre|millilitres)$/.test(s)) return unit('ml');
    if (/^(cl)$/.test(s)) return unit('cl');
    if (/^(dl)$/.test(s)) return unit('dl');
    if (/^(l|liter|liters|litre|litres)$/.test(s)) return unit('l');
    if (/^(cup|cups)$/.test(s)) return unit('cup');
    if (/^(pt|pts|pint|pints)$/.test(s)) return unit('pt');
    if (/^(qt|qts|quart|quarts)$/.test(s)) return unit('qt');
    if (/^(gal|gals|gallon|gallons)$/.test(s)) return unit('gal');

    return null;
  }

  function unit(key) {
    if (Object.prototype.hasOwnProperty.call(MASS_TO_GRAMS, key)) {
      return { key: key, dimension: 'mass', factor: MASS_TO_GRAMS[key] };
    }
    if (Object.prototype.hasOwnProperty.call(VOLUME_TO_ML, key)) {
      return { key: key, dimension: 'volume', factor: VOLUME_TO_ML[key] };
    }
    return null;
  }

  /**
   * Convert a canonical amount (grams or millilitres) into "number of bases".
   * @param {number} amount canonical amount
   * @param {string} baseKey key of BASES
   * @returns {number|null}
   */
  function toBaseCount(amount, baseKey) {
    var base = BASES[baseKey];
    if (!base || !isFinite(amount) || amount <= 0) return null;
    return amount / base.perBase;
  }

  PPP.units = {
    MASS_TO_GRAMS: MASS_TO_GRAMS,
    VOLUME_TO_ML: VOLUME_TO_ML,
    BASES: BASES,
    UNIT_PATTERN: UNIT_PATTERN,
    COUNT_UNIT_PATTERN: COUNT_UNIT_PATTERN,
    resolveUnit: resolveUnit,
    toBaseCount: toBaseCount
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.units;
}
