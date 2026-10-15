/**
 * Verdicts: how one analysed card compares with the user's limit, and how that
 * is written on its badge.
 *
 * Kept free of the DOM so the rules that decide what a shopper actually sees
 * can be tested directly.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});
  var BASES = PPP.units.BASES;

  /**
   * Classify one card against the current settings.
   * `pass`    - priced, in the selected dimension, at or under the threshold
   * `fail`    - priced, in the selected dimension, over the threshold
   * `na`      - priced, but sold in the other dimension (weight vs volume)
   * `unknown` - no usable price or no trustworthy size
   */
  function evaluate(data, settings) {
    var base = BASES[settings.basis] || BASES.lb;

    // The store's own unit price is preferred - it is declared rather than
    // inferred - but ONLY when it can actually be compared with the threshold.
    //
    // It often cannot. Google prints "$1.67/ct" (per capsule, per serving) on a
    // large share of its tiles, and a per-item price has no relationship to a
    // per-pound limit. Treating that as the final answer marked the card
    // `unknown` and stopped there, even when its own title said "5 lb" - so the
    // card was never filtered and whole sections looked ignored. Measured on a
    // live results page, 82 of 161 cards ended up unsized this way.
    //
    // So a declared price that cannot be compared no longer ends the
    // evaluation: the title-derived size is tried next, and the declared value
    // is only reported when nothing comparable was found.
    var declared = evaluateDeclared(data, base, settings);
    if (declared && declared.state !== 'unknown' && declared.state !== 'na') return declared;

    var inferred = evaluateInferred(data, base, settings);
    if (inferred.state !== 'unknown' && inferred.state !== 'na') return inferred;

    // Nothing was directly comparable. A declared "sold by the other dimension"
    // reading still beats a guess, so it wins over the inferred equivalent.
    if (declared && declared.state === 'na') return declared;
    if (inferred.state === 'na') return inferred;
    return declared || inferred;
  }

  /** The base an item measured the other way is shown in, e.g. litres beside pounds. */
  function counterpartOf(base) {
    var other = BASES[base.counterpart];
    if (other && other.dimension !== base.dimension) return other;
    return base.dimension === 'mass' ? BASES.l : BASES.lb;
  }

  /** Verdict from the merchant's own unit price, or null if it printed none. */
  function evaluateDeclared(data, base, settings) {
    var declared = data.unitPrice;
    if (!declared || !declared.perUnit) return null;

    if (declared.perUnit.dimension === 'count') {
      // A per-item price cannot be compared with a per-pound threshold.
      return { state: 'unknown', reason: 'per ' + declared.perUnit.label, source: 'site' };
    }
    var perCanonical = declared.amount / declared.perUnit.factor;
    if (declared.perUnit.dimension !== base.dimension) {
      var other = counterpartOf(base);
      return {
        state: 'na',
        altBase: other,
        unitPrice: perCanonical * other.perBase,
        source: 'site'
      };
    }
    var declaredUnitPrice = perCanonical * base.perBase;
    return {
      state: declaredUnitPrice <= settings.threshold ? 'pass' : 'fail',
      unitPrice: declaredUnitPrice,
      base: base,
      source: 'site'
    };
  }

  /** Verdict from the item price divided by a size parsed from the title. */
  function evaluateInferred(data, base, settings) {
    if (!data.price) return { state: 'unknown', reason: 'no price' };
    if (!data.quantity || data.pricePerCanonical === null) {
      return { state: 'unknown', reason: 'no size' };
    }
    if (data.quantity.confidence < settings.minConfidence) {
      return { state: 'unknown', reason: 'size unclear' };
    }

    if (data.quantity.dimension !== base.dimension) {
      var altBase = counterpartOf(base);
      return {
        state: 'na',
        altBase: altBase,
        unitPrice: data.pricePerCanonical * altBase.perBase,
        source: data.quantitySource || 'title'
      };
    }

    var unitPrice = data.pricePerCanonical * base.perBase;
    return {
      state: unitPrice <= settings.threshold ? 'pass' : 'fail',
      unitPrice: unitPrice,
      base: base,
      source: data.quantitySource || 'title'
    };
  }

  /** A merchant-declared unit price is never uncertain; only inferred ones are. */
  function isUncertain(verdict, data) {
    if (verdict.state === 'unknown' || verdict.source === 'site' || !data.quantity) return false;
    return data.quantity.confidence < 0.6 || data.quantity.flags.indexOf('pack-ambiguous') > -1;
  }

  /**
   * The verdict's price per gram or per millilitre, independent of the basis
   * the user happens to be viewing in.
   * @returns {{value: number, dimension: string, base: object}|null}
   */
  function canonicalPrice(verdict) {
    var base = verdict.base || verdict.altBase;
    if (verdict.state === 'unknown' || !base || !isFinite(verdict.unitPrice)) return null;
    return { value: verdict.unitPrice / base.perBase, dimension: base.dimension, base: base };
  }

  /* ------------------------------------------------------------ formatting */

  var formatters = {};

  /** Fewer decimals as values grow, so a badge never reads "$1234.57/lb". */
  function fractionDigits(value) {
    if (value >= 1000) return 0;
    if (value >= 100) return 1;
    return 2;
  }

  function formatter(currency, digits, locale) {
    var key = currency + '|' + digits + '|' + (locale || '');
    if (!Object.prototype.hasOwnProperty.call(formatters, key)) {
      try {
        formatters[key] = new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: currency,
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        });
      } catch (error) {
        formatters[key] = null; // not an ISO code this engine knows
      }
    }
    return formatters[key];
  }

  /**
   * Money in the user's own locale conventions: "CA$2.05" for a Canadian page
   * read in en-US, "2,05 €" in de-DE. A bare "$" used to stand in for six
   * different currencies.
   *
   * @param {number} value
   * @param {string|null} currency ISO 4217 code; null prints the number alone
   * @param {string} [locale] defaults to the browser's
   */
  function formatMoney(value, currency, locale) {
    if (!isFinite(value)) return '';
    var digits = fractionDigits(value);
    var f = currency ? formatter(currency, digits, locale) : null;
    return f ? f.format(value) : value.toFixed(digits);
  }

  /** The symbol a locale writes for `currency`, e.g. "$", "CA$", "£". */
  function currencySymbol(currency, locale) {
    var f = currency ? formatter(currency, 0, locale) : null;
    if (!f || typeof f.formatToParts !== 'function') return '';
    var parts = f.formatToParts(0);
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'currency') return parts[i].value;
    }
    return '';
  }

  function badgeText(verdict, data, currency, locale) {
    if (verdict.state === 'unknown') {
      // A merchant per-item price is still worth showing even though it cannot
      // be compared against a per-weight threshold.
      if (verdict.source === 'site' && data.unitPrice && data.unitPrice.perUnit) {
        return formatMoney(data.unitPrice.amount, currency, locale) + '/' + data.unitPrice.perUnit.label;
      }
      return verdict.reason || 'no size';
    }
    var base = verdict.base || verdict.altBase;
    return formatMoney(verdict.unitPrice, currency, locale) + '/' + base.label;
  }

  /* ---------------------------------------------------------------- sorting */

  /**
   * Sort key for a verdict: comparable prices first, cheapest first; then
   * items sold in the other dimension; then everything unsized. Ties keep
   * page order because Array.prototype.sort is stable.
   */
  function sortKey(verdict) {
    if (verdict.state === 'pass' || verdict.state === 'fail') return [0, verdict.unitPrice];
    if (verdict.state === 'na') return [1, verdict.unitPrice];
    return [2, 0];
  }

  function compareVerdicts(a, b) {
    var ka = sortKey(a);
    var kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  }

  PPP.verdict = {
    evaluate: evaluate,
    isUncertain: isUncertain,
    canonicalPrice: canonicalPrice,
    formatMoney: formatMoney,
    currencySymbol: currencySymbol,
    badgeText: badgeText,
    compareVerdicts: compareVerdicts
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.verdict;
}
