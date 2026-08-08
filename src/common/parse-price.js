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

  var SYMBOL_PATTERN = '(?:US\\s?\\$|CA\\s?\\$|NZ\\s?\\$|HK\\s?\\$|A\\s?\\$|R\\$|[$\u00a3\u20ac\u00a5\u20b9\u20a9\u20aa\u20ba\u20ab\u0e3f])';
  var CODE_PATTERN =
    '(?:USD|CAD|AUD|NZD|GBP|EUR|JPY|INR|MXN|BRL|CHF|SEK|NOK|DKK|PLN|ZAR|SGD|HKD|KRW)';
  var NUMBER_PATTERN = '\\d[\\d.,\\u00a0\u2009]*\\d|\\d';

  var PRICE_RE = new RegExp(
    '(' + SYMBOL_PATTERN + '|' + CODE_PATTERN + ')\\s?(' + NUMBER_PATTERN + ')' +
      '|(' + NUMBER_PATTERN + ')\\s?(' + SYMBOL_PATTERN + '|' + CODE_PATTERN + ')',
    'gi'
  );

  /** Cheap pre-filter used when walking thousands of text nodes. */
  var LOOKS_LIKE_PRICE_RE = new RegExp(
    SYMBOL_PATTERN + '\\s?\\d|\\d\\s?' + SYMBOL_PATTERN + '|\\d\\s?' + CODE_PATTERN + '\\b',
    'i'
  );

  /**
   * Matches the "per unit" tail that Google appends to its own unit-price line,
   * e.g. the "/lb" of "$28/lb" or the "/ct" of "$3.00/ct".
   *
   * Anchored at the start because it is only ever tested against the text that
   * immediately follows a price match.
   */
  var PER_UNIT_TAIL_RE = new RegExp(
    '^\\s*(?:/|per\\b)\\s*(' +
      units.UNIT_PATTERN +
      '|' +
      units.COUNT_UNIT_PATTERN +
      ')(?![a-z])',
    'i'
  );

  /**
   * Convert a localised numeric string to a Number.
   *
   * The rule that resolves nearly every real case: whichever of "." or ","
   * appears LAST is the decimal separator, the other is a grouping separator.
   */
  function normalizeNumber(str) {
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
      // "12,99" is a decimal comma; "1,234" and "1,234,567" are groupings.
      s = /^\d{1,3},\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    } else if (lastDot > -1) {
      // Multiple dots can only be grouping separators ("1.234.567").
      if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
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
      var amount = normalizeNumber(m[2] || m[3]);
      if (amount === null || amount <= 0 || amount > 1e7) continue;

      var tail = PER_UNIT_TAIL_RE.exec(text.slice(m.index + m[0].length));
      out.push({
        amount: amount,
        currency: currencyFor(token),
        raw: m[0].trim() + (tail ? tail[0].replace(/\s+/g, '') : ''),
        index: m.index,
        perUnit: tail ? describeUnit(tail[1]) : null
      });
    }
    return out;
  }

  /**
   * @returns {{key: string, dimension: 'mass'|'volume'|'count',
   *            factor: number|null, label: string}}
   */
  function describeUnit(raw) {
    var resolved = units.resolveUnit(raw);
    if (resolved) {
      return {
        key: resolved.key,
        dimension: resolved.dimension,
        factor: resolved.factor,
        label: String(raw).trim()
      };
    }
    // Recognised spelling, but a unit of count rather than of mass or volume.
    return { key: 'count', dimension: 'count', factor: null, label: String(raw).trim() };
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
    normalizeNumber: normalizeNumber
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.price;
}
