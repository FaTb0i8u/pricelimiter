/**
 * Quantity (net weight / net volume) extraction from free-text product titles.
 *
 * This is the hardest and most important part of the extension: Google Shopping
 * exposes no structured size field on result cards, so the size has to be
 * recovered from strings such as:
 *
 *   "Purina ONE Dog Food, 31.1 lb Bag"          -> 31.1 lb
 *   "Tide Liquid Detergent, 92 fl oz"           -> 92 fl oz  (VOLUME, not mass)
 *   "Starbucks Coffee, 2 x 12 oz"               -> 24 oz
 *   "Vitamin C 1000 mg, 250 Tablets"            -> unknown    (dosage, not net weight)
 *   "Optimum Nutrition Whey 5 lb (2.27 kg)"     -> 5 lb
 *
 * DESIGN RULE - be conservative about pack multiplication.
 * Over-estimating weight makes a bad deal look cheap (actively misleading).
 * Under-estimating weight makes a good deal look expensive (you merely miss
 * it). So a size is only multiplied by a pack count when the text says so
 * explicitly ("2 x 5 lb", "16 oz each"). Otherwise the size is used as-is and
 * the result is flagged low-confidence.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});
  var units = PPP.units;

  var NUM = '(?:\\d+\\s*[-\\s]\\s*\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?)';
  var UNIT = units.UNIT_PATTERN;

  /**
   * Words that follow a bare "g" or "l" in non-grocery listings and prove the
   * letter was not a unit ("5 G phone", "8 G RAM").
   */
  var NOT_A_UNIT_AFTER =
    '(?!\\s*(?:phone|phones|network|networks|lte|wifi|wi-fi|ram|rom|hz|ghz|mhz|mbps|gbps|speed|modem|router|band|sim|coverage))';

  var QTY_RE = new RegExp(
    '(?<![\\d.,])(' + NUM + ')\\s*-?\\s*(' + UNIT + ')(?![a-z])' + NOT_A_UNIT_AFTER,
    'gi'
  );

  var MULTIPLY_LEADING_RE = new RegExp(
    '(\\d+)\\s*x\\s*(' + NUM + ')\\s*-?\\s*(' + UNIT + ')(?![a-z])' + NOT_A_UNIT_AFTER,
    'i'
  );
  var MULTIPLY_TRAILING_RE = new RegExp(
    '(' + NUM + ')\\s*-?\\s*(' + UNIT + ')(?![a-z])\\s*x\\s*(\\d+)\\b',
    'i'
  );

  var PACK_NOUNS =
    'packs?|pks?|packets?|counts?|cts?|pieces?|pcs|bottles?|cans?|bags?|boxes?|jars?|pouches?|bars?|sticks?|rolls?|tubs?|cartons?|containers?|tubes?|cases?';

  var PACK_RE = new RegExp(
    '(?:pack|case|box|set|bundle)\\s+of\\s+(\\d+)\\b|(\\d+)\\s*-?\\s*(?:' + PACK_NOUNS + ')\\b',
    'gi'
  );

  /** Proof that a stated size is per-item and must be multiplied by the pack. */
  var EACH_RE =
    /\b(?:each|apiece|per\s+(?:bag|bottle|can|box|jar|pouch|bar|stick|roll|tub|carton|item|unit|pack|packet|piece))\b/i;

  /**
   * A dose, not a pack size. "30 g per serving" says nothing about how much is
   * in the tub, and treating it as the net weight is catastrophic: a $24.99
   * protein powder was reported at $377.80/lb on live Google Shopping, because
   * the card body carried "Amino Acids . 30 g per serving" and 24.99/30 g is
   * indeed $377.80/lb.
   *
   * Serving sizes are rejected rather than multiplied. Multiplying would need a
   * trustworthy serving COUNT, and inferring one from the same loose card copy
   * is how the wrong number got here in the first place.
   */
  var SERVING_UNITS = 'servings?|scoops?|shakes?|doses?|capsules?|tablets?|softgels?|gummies|gummy';
  var SERVING_AFTER_RE = new RegExp(
    '^[^.,;|\\u00b7]{0,24}?\\bper\\s+(?:' + SERVING_UNITS + ')\\b',
    'i'
  );
  var SERVING_BEFORE_RE = new RegExp(
    '\\b(?:' + SERVING_UNITS + ')\\s*size\\s*:?\\s*(?:about|approx\\.?)?\\s*$',
    'i'
  );

  /**
   * A gram figure that is a nutrition claim, not a pack size: "25g of protein,
   * 5.5g BCAAs". Cards print these in bullet copy, and a live Amazon tile
   * reading "25g ... 5.5g ... 5 lb" was badged "size unclear" because the
   * claims looked like competing sizes. "Protein powder", "protein isolate"
   * and the like are product names, so a size before them still counts.
   */
  var NUTRIENT_AFTER_RE =
    /^\s*(?:of\s+)?(?:(?:whey|plant[- ]based|complete|clean|grass[- ]fed)\s+)?(?:protein(?!\s+(?:powder|isolate|concentrate|blend|bars?|shakes?|drink|mix|cookies?|chips?|pancake))|net\s+carbs?|carbs?|carbohydrates?|sugars?|added\s+sugars?|fat|fib(?:er|re)|sodium|bcaas?|eaas?|creatine|collagen|caffeine)\b/i;
  /** Above this a gram figure is too large to be a per-serving claim. */
  var MAX_NUTRIENT_GRAMS = 100;

  /** A size immediately preceded by one of these is an authoritative total. */
  var NET_LABEL_RE = /\b(?:net\s*(?:wt|weight)|total\s*(?:wt|weight|net)|net\s*(?:vol|volume))\b[\s.:()-]*$/i;

  var CURRENCY_BEFORE_RE = new RegExp('[' + PPP.price.SYMBOL_CHARS + ']\\s?$');

  /**
   * A quantity that is the denominator of a unit price: the "100 g" of
   * "£0.83/100 g". It is the size the price is quoted per, not the pack's.
   */
  var UNIT_PRICE_BEFORE_RE = new RegExp(
    '(?:[' + PPP.price.SYMBOL_CHARS + ']\\s?\\d[\\d.,]*|\\d[\\d.,]*\\s?[\\u00a2' + PPP.price.SYMBOL_CHARS + '])' +
      '\\s*(?:/|per\\b)\\s*$',
    'i'
  );

  /**
   * "1,5 kg" - a decimal comma, as amazon.ca prints in French. Only a short
   * number directly before a unit qualifies, so "1,500 g" (grouping, handled
   * first) and "Pack of 3, 12 oz" (a list) are left alone.
   */
  var DECIMAL_COMMA_RE = new RegExp(
    '(^|[^\\d.,])(\\d{1,3}),(\\d{1,2})(?=\\s*-?\\s*(?:' + UNIT + ')(?![a-z]))',
    'g'
  );

  function normalizeText(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[\u00d7\u2715\u2716]/g, 'x')
      .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
      .replace(DECIMAL_COMMA_RE, '$1$2.$3')
      // ".5 l" is half a litre; the leading zero is often dropped.
      .replace(/(^|[\s(])\.(\d)/g, function (all, lead, digit) { return lead + '0.' + digit; })
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** "12.5" | "1/2" | "1 1/2" | "1-1/2" -> Number */
  function parseNumberToken(token) {
    var s = String(token)
      .replace(/\s*\/\s*/g, '/')
      .replace(/\s*-\s*/g, ' ')
      .trim();
    var parts = s.split(' ');
    if (parts.length === 2) return toNumber(parts[0]) + toFraction(parts[1]);
    return s.indexOf('/') > -1 ? toFraction(s) : toNumber(s);
  }

  function toNumber(s) {
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  function toFraction(s) {
    var parts = s.split('/');
    var n = toNumber(parts[0]);
    var d = toNumber(parts[1]);
    if (!isFinite(n) || !isFinite(d) || d === 0) return NaN;
    return n / d;
  }

  /** All size mentions in normalised text, in order. */
  function collectMatches(text) {
    var out = [];
    var m;
    QTY_RE.lastIndex = 0;
    while ((m = QTY_RE.exec(text)) !== null) {
      if (m[0].length === 0) {
        QTY_RE.lastIndex++;
        continue;
      }
      var before = text.slice(0, m.index);
      if (CURRENCY_BEFORE_RE.test(before) || UNIT_PRICE_BEFORE_RE.test(before.slice(-40))) continue;

      // A serving/dose size is not the pack size. See SERVING_AFTER_RE.
      var after = text.slice(m.index + m[0].length);
      if (SERVING_AFTER_RE.test(after) || SERVING_BEFORE_RE.test(before)) continue;

      var value = parseNumberToken(m[1]);
      var unit = units.resolveUnit(m[2]);
      if (!isFinite(value) || value <= 0 || !unit) continue;
      if ((unit.key === 'g' || unit.key === 'mg') && value <= MAX_NUTRIENT_GRAMS && NUTRIENT_AFTER_RE.test(after)) continue;

      var flags = [];
      if (/\d\s*-\s*$/.test(before)) flags.push('range');
      if (m[2].replace(/\./g, '').length === 1) flags.push('single-letter-unit');
      if (NET_LABEL_RE.test(before)) flags.push('net-label');

      out.push({
        amount: value * unit.factor,
        dimension: unit.dimension,
        unitKey: unit.key,
        stated: value,
        raw: m[0].trim(),
        index: m.index,
        flags: flags
      });
    }
    return out;
  }

  function detectPackCount(text) {
    var best = null;
    var m;
    PACK_RE.lastIndex = 0;
    while ((m = PACK_RE.exec(text)) !== null) {
      var n = parseInt(m[1] || m[2], 10);
      if (!isFinite(n) || n < 2 || n > 500) continue;
      if (best === null || n > best) best = n;
    }
    return best;
  }

  function matchExplicitMultiply(text) {
    var m = MULTIPLY_LEADING_RE.exec(text);
    if (m) {
      return build(parseInt(m[1], 10), parseNumberToken(m[2]), m[3], m[0]);
    }
    m = MULTIPLY_TRAILING_RE.exec(text);
    if (m) {
      return build(parseInt(m[3], 10), parseNumberToken(m[1]), m[2], m[0]);
    }
    return null;

    function build(count, value, unitRaw, raw) {
      var unit = units.resolveUnit(unitRaw);
      if (!unit || !isFinite(count) || !isFinite(value) || count < 1 || value <= 0) return null;
      if (unit.key === 'mg') return null;
      return {
        amount: value * count * unit.factor,
        dimension: unit.dimension,
        unitKey: unit.key,
        packCount: count,
        raw: raw.trim()
      };
    }
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  /**
   * @param {string} text product title (or any descriptive text)
   * @param {{allowMilligrams?: boolean}} [options]
   * @returns {{dimension: 'mass'|'volume', amount: number, unitKey: string,
   *            confidence: number, flags: string[], packCount: number|null,
   *            raw: string}|null} `amount` is grams for mass, millilitres for
   *            volume. `null` means "size unknown" - never guess.
   */
  function parseQuantity(text, options) {
    options = options || {};
    var normalized = normalizeText(text);
    if (!normalized) return null;

    var explicit = matchExplicitMultiply(normalized);
    if (explicit) {
      return {
        dimension: explicit.dimension,
        amount: explicit.amount,
        unitKey: explicit.unitKey,
        confidence: 0.9,
        flags: ['explicit-multipack'],
        packCount: explicit.packCount,
        raw: explicit.raw
      };
    }

    var matches = collectMatches(normalized);
    if (!matches.length) return null;

    // Milligram figures on shopping titles are almost always dosage strengths,
    // not net weight. Pricing them per pound produces nonsense, so drop them.
    var usable = [];
    for (var i = 0; i < matches.length; i++) {
      if (options.allowMilligrams || matches[i].unitKey !== 'mg') usable.push(matches[i]);
    }
    if (!usable.length) return null;

    var flags = [];

    // An explicit "Net Wt" label overrides every other candidate.
    var labelled = usable.filter(function (m) {
      return m.flags.indexOf('net-label') > -1;
    });
    var pool = labelled.length ? labelled : usable;

    var mass = pool.filter(function (m) { return m.dimension === 'mass'; });
    var volume = pool.filter(function (m) { return m.dimension === 'volume'; });
    var chosen;
    if (mass.length && volume.length) {
      flags.push('mixed-dimensions');
      chosen = mass.length >= volume.length ? mass : volume;
    } else {
      chosen = mass.length ? mass : volume;
    }

    var amount = chosen[0].amount;
    var confidence = labelled.length ? 0.92 : 0.85;

    if (chosen.length > 1) {
      var min = amount;
      var max = amount;
      for (var j = 1; j < chosen.length; j++) {
        if (chosen[j].amount < min) min = chosen[j].amount;
        if (chosen[j].amount > max) max = chosen[j].amount;
      }
      if ((max - min) / max <= 0.02) {
        // Same size restated in another unit, e.g. "5 lb (2.27 kg)".
        amount = max;
        confidence = Math.max(confidence, 0.9);
        flags.push('restated-size');
      } else {
        // Genuinely different sizes. Take the smallest: see DESIGN RULE above.
        amount = min;
        confidence = 0.5;
        flags.push('multiple-sizes');
      }
    }

    var packCount = detectPackCount(normalized);
    if (packCount && packCount > 1) {
      if (EACH_RE.test(normalized)) {
        amount *= packCount;
        confidence = Math.min(confidence, 0.8);
        flags.push('multiplied-by-pack');
      } else {
        confidence = Math.min(confidence, 0.45);
        flags.push('pack-ambiguous');
      }
    }

    var allWeak = chosen.every(function (m) {
      return m.flags.indexOf('single-letter-unit') > -1;
    });
    if (allWeak) {
      confidence -= 0.25;
      flags.push('abbreviated-unit');
    }
    if (chosen.some(function (m) { return m.flags.indexOf('range') > -1; })) {
      confidence = Math.min(confidence, 0.4);
      flags.push('size-range');
    }

    return {
      dimension: chosen[0].dimension,
      amount: amount,
      unitKey: chosen[0].unitKey,
      confidence: clamp(confidence, 0.05, 0.95),
      flags: flags,
      packCount: packCount,
      raw: chosen.map(function (m) { return m.raw; }).join(', ')
    };
  }

  /** Human-readable size, e.g. formatQuantity(2267.96, 'mass') -> "5 lb". */
  function formatQuantity(amount, dimension) {
    if (!isFinite(amount) || amount <= 0) return '';
    if (dimension === 'mass') {
      if (amount >= units.MASS_TO_GRAMS.lb) return trim(amount / units.MASS_TO_GRAMS.lb) + ' lb';
      return trim(amount / units.MASS_TO_GRAMS.oz) + ' oz';
    }
    if (amount >= units.VOLUME_TO_ML.l) return trim(amount / units.VOLUME_TO_ML.l) + ' L';
    return trim(amount / units.VOLUME_TO_ML.floz) + ' fl oz';
  }

  function trim(n) {
    return String(Math.round(n * 100) / 100);
  }

  PPP.quantity = {
    parseQuantity: parseQuantity,
    formatQuantity: formatQuantity,
    normalizeText: normalizeText,
    parseNumberToken: parseNumberToken
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.quantity;
}
