/**
 * Currency price parsing.
 *
 * Google Shopping cards mix several money-ish strings into one card: the
 * current price, a struck-through original, "+$5.99 delivery", "$10 - $20",
 * "$34/mo". The card adapter is responsible for choosing which element to read;
 * this module is responsible for turning one string into a number correctly,
 * including non-US decimal conventions.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});
  var units = PPP.units;

  var SYMBOLS = {
    '$': 'USD',
    'us$': 'USD',
    'ca$': 'CAD',
    'a$': 'AUD',
    'nz$': 'NZD',
    'hk$': 'HKD',
    'r$': 'BRL',
    '£': 'GBP',
    '€': 'EUR',
    '¥': 'JPY',
    '₹': 'INR',
    '₩': 'KRW',
    '₪': 'ILS',
    '₺': 'TRY',
    '₫': 'VND',
    '฿': 'THB'
  };

  /** Every currency symbol recognised anywhere; other modules build on this. */
  var SYMBOL_CHARS = '$\u00a3\u20ac\u00a5\u20b9\u20a9\u20aa\u20ba\u20ab\u0e3f';

  var SYMBOL_PATTERN = '(?:US\\s?\\$|CA\\s?\\$|NZ\\s?\\$|HK\\s?\\$|A\\s?\\$|R\\$|[' + SYMBOL_CHARS + '])';
  var CODE_PATTERN =
    '(?:USD|CAD|AUD|NZD|GBP|EUR|JPY|INR|MXN|BRL|CHF|SEK|NOK|DKK|PLN|ZAR|SGD|HKD|KRW)';
  // U+202F is the grouping space Intl itself writes for French and other
  // locales ("1 234,56 €"); without it only "234,56" was read.
  var NUMBER_PATTERN = '\\d[\\d.,\\u00a0\\u2009\\u202f]*\\d|\\d';
  /**
   * The cent sign. Walmart prints cheap unit prices as "11.2 ¢/oz" rather than
   * "$0.112/oz", and sub-dollar items as "88¢". It names no currency of its
   * own, so these amounts carry none and never sway the page's currency.
   */
  var CENT = '\u00a2';

  var PRICE_RE = new RegExp(
    '(' + SYMBOL_PATTERN + '|' + CODE_PATTERN + ')\\s?(' + NUMBER_PATTERN + ')' +
      '|(' + NUMBER_PATTERN + ')\\s?(' + SYMBOL_PATTERN + '|' + CODE_PATTERN + ')' +
      '|(' + NUMBER_PATTERN + ')\\s?' + CENT,
    'gi'
  );

  /** Cheap pre-filter used when walking thousands of text nodes. */
  var LOOKS_LIKE_PRICE_RE = new RegExp(
    SYMBOL_PATTERN + '\\s?\\d|\\d\\s?' + SYMBOL_PATTERN + '|\\d\\s?' + CODE_PATTERN + '\\b' +
      '|\\d\\s?' + CENT,
    'i'
  );

  /**
   * Matches the "per unit" tail that Google appends to its own unit-price line,
   * e.g. the "/lb" of "$28/lb" or the "/ct" of "$3.00/ct".
   *
   * The unit may carry its own quantity: Amazon's UK, Canadian and Australian
   * storefronts print "(£0.83/100 g)", and Amazon US prints "($0.13/100 Count)".
   * Without the optional number the tail did not match at all, so £0.83 was
   * taken for the ITEM price - the lowest candidate wins there - and a £2.50 bag
   * was priced at a third of its cost. Group 1 is that quantity, group 2 the
   * unit.
   *
   * Anchored at the start because it is only ever tested against the text that
   * immediately follows a price match.
   */
  var PER_UNIT_TAIL_RE = new RegExp(
    '^\\s*(?:/|per\\b)\\s*(?:(\\d+(?:\\.\\d+)?)\\s*)?(' +
      units.UNIT_PATTERN +
      '|' +
      units.COUNT_UNIT_PATTERN +
      ')(?![a-z])',
    'i'
  );

  /**
   * Currencies where a lone "1.234" means one thousand two hundred and
   * thirty-four: those written with a decimal comma, and those with no minor
   * unit at all.
   */
  var DOT_GROUPING_CURRENCIES = {
    EUR: true, BRL: true, TRY: true, DKK: true, NOK: true, SEK: true, PLN: true,
    JPY: true, KRW: true, VND: true
  };

  /**
   * Convert a localised numeric string to a Number.
   *
   * The rule that resolves nearly every real case: whichever of "." or ","
   * appears LAST is the decimal separator, the other is a grouping separator.
   * A single dot followed by exactly three digits is the one shape that rule
   * cannot settle, so `currency` decides it.
   *
   * @param {string} str
   * @param {string|null} [currency] ISO code the number is priced in
   */
  function normalizeNumber(str, currency) {
    var s = String(str).replace(/[\s\u00a0\u2009']/g, '');
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    var value;

    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) {
        s = s.replace(/\./g, '').replace(/,/g, '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (lastComma > -1) {
      // "12,99" and "1234,56" are decimal commas (the latter is what is left
      // of "1 234,56" once its grouping space is gone); "1,234" and
      // "1,234,567" are groupings.
      s = /^\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    } else if (lastDot > -1) {
      // Multiple dots can only be grouping separators ("1.234.567").
      if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
      else if (currency && DOT_GROUPING_CURRENCIES[currency] && /^\d{1,3}\.\d{3}$/.test(s)) {
        s = s.replace('.', '');
      }
    }

    value = parseFloat(s);
    return isFinite(value) ? value : null;
  }

  function currencyFor(token) {
    if (!token) return null;
    var t = String(token).toLowerCase().replace(/\s+/g, '');
    if (Object.prototype.hasOwnProperty.call(SYMBOLS, t)) return SYMBOLS[t];
    return t.toUpperCase();
  }

  /**
   * Every price-looking substring in `text`, in document order.
   *
   * Candidates carry a `perUnit` field when the price is followed by a unit,
   * which is how a merchant-supplied unit price ("$28/lb") is distinguished
   * from the item price it sits next to.
   *
   * @returns {Array<{amount: number, currency: string|null, raw: string,
   *                  index: number, perUnit: object|null}>}
   */
  function parsePriceCandidates(text) {
    var out = [];
    if (!text) return out;

    PRICE_RE.lastIndex = 0;
    var m;
    while ((m = PRICE_RE.exec(text)) !== null) {
      if (m[0].length === 0) {
        PRICE_RE.lastIndex++;
        continue;
      }
      var token = m[1] || m[4];
      var currency = currencyFor(token);
      var amount;
      if (m[5]) {
        amount = normalizeNumber(m[5], null);
        // Cents to whole units without float noise: 11.2¢ is 0.112, not 0.11199...
        if (amount !== null) amount = Math.round(amount * 1e4) / 1e6;
      } else {
        amount = normalizeNumber(m[2] || m[3], currency);
      }
      if (amount === null || amount <= 0 || amount > 1e7) continue;

      var tail = PER_UNIT_TAIL_RE.exec(text.slice(m.index + m[0].length));
      var perUnit = tail ? describeUnit(tail[2], tail[1]) : null;
      if (tail && !perUnit) continue; // "/0 g": not a price of anything
      out.push({
        amount: amount,
        currency: currency,
        raw: m[0].trim() + (tail ? tidyTail(tail[0]) : ''),
        index: m.index,
        perUnit: perUnit
      });
    }
    return out;
  }

  /** "/ 100  g" -> "/100 g", " per fl oz" -> " per fl oz", for display. */
  function tidyTail(tail) {
    var t = tail.trim().replace(/^\/\s*/, '/').replace(/\s+/g, ' ');
    return t.charAt(0) === '/' ? t : ' ' + t;
  }

  /**
   * @param {string} raw the unit as written
   * @param {string} [count] the quantity written before it, as in "/100 g"
   * @returns {{key: string, dimension: 'mass'|'volume'|'count',
   *            factor: number|null, label: string}|null} `factor` covers the
   *            whole quantity, so "/100 g" is 100 grams. Null for a zero
   *            quantity.
   */
  function describeUnit(raw, count) {
    var per = count ? parseFloat(count) : 1;
    if (!isFinite(per) || per <= 0) return null;
    var name = String(raw).trim();
    var label = count ? count + ' ' + name : name;
    var resolved = units.resolveUnit(raw);
    if (resolved) {
      return {
        key: resolved.key,
        dimension: resolved.dimension,
        factor: resolved.factor * per,
        label: label
      };
    }
    // Recognised spelling, but a unit of count rather than of mass or volume.
    return { key: 'count', dimension: 'count', factor: null, label: label };
  }

  /**
   * The single most likely ITEM price in a string.
   *
   * Unit prices are skipped: on a card reading "$139.99 $28/lb" the item costs
   * $139.99, and returning $28 would be badly wrong.
   *
   * For a range ("$10 - $20" / "from $9.99") the lowest value is returned,
   * matching what the shopper is actually being offered as an entry price.
   */
  function parsePrice(text) {
    var candidates = parsePriceCandidates(text);
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].perUnit) continue;
      if (!best || candidates[i].amount < best.amount) best = candidates[i];
    }
    return best;
  }

  /**
   * A merchant-supplied unit price, if the text contains one.
   * Where several are present the first wins, matching reading order.
   */
  function parseUnitPrice(text) {
    var candidates = parsePriceCandidates(text);
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].perUnit) return candidates[i];
    }
    return null;
  }

  function looksLikePrice(text) {
    return !!text && LOOKS_LIKE_PRICE_RE.test(text);
  }

  PPP.price = {
    parsePrice: parsePrice,
    parseUnitPrice: parseUnitPrice,
    parsePriceCandidates: parsePriceCandidates,
    looksLikePrice: looksLikePrice,
    normalizeNumber: normalizeNumber,
    SYMBOL_CHARS: SYMBOL_CHARS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.price;
}
