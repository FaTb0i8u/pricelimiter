/**
 * Offer-text classifier for rebate/coupon listings such as Aisle's offers page.
 *
 * Every offer is put in one of five buckets from its visible wording alone, so
 * nothing here depends on a site's markup:
 *
 *   'free'     - the item itself is free: "FREE Olipop", "Get 2 FREE cans",
 *                "Try it for FREE", "100% cash back", "on us".
 *   'bogo'     - free only alongside a paid item: "Buy 1 Get 1 FREE", "BOGO",
 *                "B2G1", "2 for 1", "Free dip with purchase of chips".
 *   'purchase' - anything else that says "buy": "Buy 2, Get $7",
 *                "Get Rewarded For Buying C2O!", "Buy More, Earn More".
 *   'discount' - money or percent off: "$2 off", "Save $1.50", "Try For $8".
 *   'none'     - no offer wording ("Loyalty Pass", "A Good Deal").
 *
 * Only 'free' is an outright free item. A product's own name often says
 * "free" too ("Kudos Chlorine Free Diapers", "Gluten Free Chips"), so "free"
 * counts only where an offer would put it: opening the line, after
 * punctuation, or after a word like "get", "try", "for" or a count.
 *
 * `classifyLines` lets a BOGO or "buy" phrase anywhere on a card win, and
 * otherwise takes the first line that says anything at all - the headline -
 * so fine print such as "up to $2.99 back" cannot turn a free offer into a
 * discount.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});

  var NUM = '(?:\\d+|one|two|three|four|five|six)';

  var BOGO_PATTERNS = [
    /\bb\s*o\s*g\s*o\b/,
    /\bb\d+\s*g\d+\b/,
    // "Buy 2, get 1 free", "buy one get one 50% off".
    new RegExp('\\bbuy\\s+(?:any\\s+)?(?:' + NUM + '|a|an)\\b[^.!?]*?\\bget\\s+(?:' + NUM + '|another|a\\s+second|the\\s+(?:2nd|second))\\b'),
    new RegExp('\\b' + NUM + '\\s+for\\s+(?:the\\s+price\\s+of\\s+)?' + NUM + '\\b(?!\\s*(?:\\.|¢|\\$))'),
    // Free only alongside some other paid item.
    /\bfree\b[^.!?]*?\b(?:with\s+(?:the\s+|any\s+)?purchase\s+of|when\s+you\s+(?:buy|purchase))\b/,
    /\b(?:second|2nd)\s+(?:one\s+|item\s+)?(?:free|half|50%)/
  ];

  /** Every Aisle offer that names a purchase is a rebate on spending money. */
  var PURCHASE_RE = /\bbuy(?:s|ing)?\b/;

  /**
   * "Buy" wording that still describes the bought item itself coming back
   * free - the one exception to PURCHASE_RE: "Buy 1, get it FREE".
   */
  var SAME_ITEM_FREE_RE = /\bget\s+(?:it|them|yours|this|that)\s+(?:for\s+)?free\b/;

  var DISCOUNT_PATTERNS = [
    /\$\s*\d+(?:\.\d{1,2})?\s*(?:off|back|cash\s*back|rebate|savings?|reward)\b/,
    /\b\d+(?:\.\d+)?\s*(?:¢|c|cents?)\s*(?:off|back)\b/,
    /\bsave\s+(?:up\s+to\s+)?(?:\$|\d)/,
    /\b(?:\d{1,2}(?:\.\d+)?)\s*%\s*(?:off|back|cash\s*back|discount)\b/,
    /\bhalf\s+(?:off|price)\b/,
    /\bcash\s*back\b/,
    /\bdiscount\b/,
    // "Get $7", "Try For $8": money back, or a reduced price that is not $0.
    /\bget\s+\$\s*\d/,
    /\bfor\s+(?:just\s+|only\s+)?\$\s*(?:0*[1-9]|0*\.\d*[1-9])/
  ];

  var FULLY_FREE_PATTERNS = [
    /\b100\s*%\s*(?:off|back|cash\s*back|free|refund|rebate)\b/,
    /\bon\s+us\b/,
    /\bfor\s+\$\s*0(?:\.00)?(?![.\d])/
  ];

  /** Words after which "free" is the offer, not part of a product's name. */
  var OFFER_WORD_BEFORE_FREE = new RegExp(
    '(?:^|[\\s:;,.!?|()\\[\\]/+&*\u2022\u00b7-])(?:' +
      'get|gets|getting|got|try|tried|for|grab|claim|score|snag|enjoy|redeem|unlock|a|an|your|yours|it|them|' +
      'is|are|be|totally|absolutely|completely|100%|\\d+|one|two|three|four|five|six' +
      ')\\s*$'
  );
  /** Opening the line, or straight after punctuation, "free" is an offer. */
  var LINE_START_BEFORE_FREE = /(?:^|[:;,.!?|()[\]/+&*\u2022\u00b7\u2013\u2014]|\s-)\s*$/;
  var ATTRIBUTE_AFTER = /^\s*(?:range|from|shipping|delivery|returns?|standing|flowing|style|form)\b/;

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function mentionsFree(text) {
    var re = /(^|[^\w-])free\b(?!-)/g;
    var m;
    while ((m = re.exec(text))) {
      var start = m.index + m[1].length;
      var before = text.slice(0, start);
      if (ATTRIBUTE_AFTER.test(text.slice(start + 4))) continue;
      if (LINE_START_BEFORE_FREE.test(before) || OFFER_WORD_BEFORE_FREE.test(before)) return true;
    }
    return FULLY_FREE_PATTERNS.some(function (p) {
      return p.test(text);
    });
  }

  function any(patterns, text) {
    for (var i = 0; i < patterns.length; i++) {
      if (patterns[i].test(text)) return true;
    }
    return false;
  }

  /**
   * @param {string} text one line or one headline of offer copy
   * @returns {'free'|'bogo'|'purchase'|'discount'|'none'}
   */
  function classify(text) {
    var t = normalize(text);
    if (!t) return 'none';
    if (any(BOGO_PATTERNS, t)) return 'bogo';
    if (PURCHASE_RE.test(t) && !SAME_ITEM_FREE_RE.test(t)) return 'purchase';
    // Free beats money: "FREE Olipop (up to $2.99 back)" is a free offer with
    // a reimbursement cap, not a discount.
    if (mentionsFree(t)) return 'free';
    if (any(DISCOUNT_PATTERNS, t)) return 'discount';
    return 'none';
  }

  /**
   * Classify a whole card from its lines of text, headline first.
   *
   * @param {string[]|string} lines a card's rendered text, split into lines
   * @returns {'free'|'bogo'|'purchase'|'discount'|'none'}
   */
  function classifyLines(lines) {
    if (typeof lines === 'string') lines = lines.split(/\n+/);
    if (!lines || !lines.length) return 'none';
    var first = 'none';
    var paid = null;
    for (var i = 0; i < lines.length; i++) {
      var kind = classify(lines[i]);
      if (kind === 'bogo') return 'bogo';
      if (kind === 'purchase') paid = kind;
      if (first === 'none' && kind !== 'none') first = kind;
    }
    // Split across lines, a BOGO headline can read "Buy 1," / "Get 1 FREE".
    for (var j = 0; j + 1 < lines.length; j++) {
      if (classify(lines[j] + ' ' + lines[j + 1]) === 'bogo') return 'bogo';
    }
    return paid || first;
  }

  /** @returns {boolean} whether the card's offer is an outright free item. */
  function isFree(lines) {
    return classifyLines(lines) === 'free';
  }

  PPP.offers = {
    classify: classify,
    classifyLines: classifyLines,
    isFree: isFree
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.offers;
}
