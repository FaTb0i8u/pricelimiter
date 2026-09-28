/**
 * Site profiles.
 *
 * Every supported storefront is described by data here, and nothing else in the
 * codebase knows a site's name. Adding a store is a new entry plus a manifest
 * match, not a new code path.
 *
 * Two card-detection strategies exist, and the choice is per site rather than
 * global because the sites genuinely differ:
 *
 *   - Stores that ship STABLE SEMANTIC markup get an explicit `cardSelector`.
 *     Amazon exposes `[data-component-type="s-search-result"]` and Walmart
 *     exposes `[data-item-id]`. These are contract-ish attributes their own
 *     tooling depends on, so they are far more durable than any class name, and
 *     matching them directly is both exact and cheap.
 *
 *   - Stores that ship OBFUSCATED, ROTATING class names get no selector and
 *     fall back to structural detection (find a price, walk up to the box that
 *     wraps exactly one product image). Google is the motivating case: it has
 *     no stable hook of any kind.
 *
 * `cardSelector` is an optimisation, not a dependency. If it stops matching,
 * the adapter falls back to the structural walk, so a redesign at Amazon or
 * Walmart costs accuracy rather than function.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});

  /**
  * Amazon uses closely related markup across country domains. The matcher is
  * deliberately broad for shared parsing logic, while manifest.json limits
  * injection to the storefronts that have explicitly been validated.
   */
  var AMAZON_HOST_RE = /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/i;
  var WALMART_HOST_RE = /(^|\.)walmart\.(com|ca)$/i;
  var GOOGLE_HOST_RE = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/i;

  function param(loc, key) {
    return new URLSearchParams(loc.search || '').get(key);
  }

  function startsWith(value, prefix) {
    return String(value || '').indexOf(prefix) === 0;
  }

  var SITES = [
    {
      id: 'google',
      label: 'Google Shopping',
      matchesHost: function (loc) {
        return GOOGLE_HOST_RE.test(loc.hostname);
      },
      // `tbm=shop` is the classic Shopping tab, `udm=28` the current one. Both
      // are checked because Google runs them in parallel by region.
      isResultsPage: function (loc) {
        return (
          startsWith(loc.pathname, '/shopping') ||
          param(loc, 'tbm') === 'shop' ||
          param(loc, 'udm') === '28'
        );
      },
      scanRoots: ['div[role="main"]', '#center_col', '#search'],
      cardSelector: null,
      titleSelectors: []
    },
    {
      id: 'amazon',
      label: 'Amazon',
      matchesHost: function (loc) {
        return AMAZON_HOST_RE.test(loc.hostname);
      },
      isResultsPage: function (loc) {
        return (
          loc.pathname === '/s' ||
          startsWith(loc.pathname, '/s/') ||
          startsWith(loc.pathname, '/s?') ||
          startsWith(loc.pathname, '/gp/search') ||
          param(loc, 'k') !== null
        );
      },
      scanRoots: ['div[role="main"]', '.s-main-slot', '#search'],
      cardSelector: '[data-component-type="s-search-result"]',
      titleSelectors: ['h2 a span', 'h2 span', 'h2']
    },
    {
      id: 'walmart',
      label: 'Walmart',
      matchesHost: function (loc) {
        return WALMART_HOST_RE.test(loc.hostname);
      },
      isResultsPage: function (loc) {
        return (
          startsWith(loc.pathname, '/search') ||
          startsWith(loc.pathname, '/browse') ||
          startsWith(loc.pathname, '/shop') ||
          startsWith(loc.pathname, '/cp')
        );
      },
      scanRoots: ['div[role="main"]', '#maincontent', '#search'],
      cardSelector: '[data-item-id]',
      titleSelectors: ['[data-automation-id="product-title"]', '[link-identifier] span']
    }
  ];

  /**
   * Used when the host matches nothing known. Structural detection still works
   * on many storefronts, so an unknown site degrades to "generic" rather than
   * being refused outright - but it is never auto-activated, because guessing
   * wrong on a non-shopping page would badge unrelated numbers.
   */
  var GENERIC_SITE = {
    id: 'generic',
    label: 'this page',
    matchesHost: function () {
      return true;
    },
    isResultsPage: function () {
      return false;
    },
    scanRoots: ['div[role="main"]', '#search'],
    cardSelector: null,
    titleSelectors: []
  };

  /** @returns {object} the profile for `loc`, never null. */
  function forLocation(loc) {
    loc = loc || (typeof location !== 'undefined' ? location : null);
    if (!loc) return GENERIC_SITE;
    for (var i = 0; i < SITES.length; i++) {
      if (SITES[i].matchesHost(loc)) return SITES[i];
    }
    return GENERIC_SITE;
  }

  /** @returns {boolean} whether `loc` is a product-results page we support. */
  function isResultsPage(loc) {
    loc = loc || (typeof location !== 'undefined' ? location : null);
    if (!loc) return false;
    return forLocation(loc).isResultsPage(loc);
  }

  /** Storefronts whose host alone fixes the currency. */
  var HOST_CURRENCIES = [
    { re: /(^|\.)amazon\.co\.uk$/i, currency: 'GBP' },
    { re: /(^|\.)(amazon|walmart)\.ca$/i, currency: 'CAD' },
    { re: /(^|\.)amazon\.com\.au$/i, currency: 'AUD' }
  ];

  /**
   * Currency for a page, given the one most cards on it were priced in.
   *
   * A country storefront's host wins outright, because a bare "$" there is
   * not US dollars. Otherwise the page's own prices win, since google.com and
   * amazon.com both serve other currencies to travellers. Only when nothing on
   * the page carried a currency does a known store fall back to USD - without
   * that, the threshold box had no currency to save under and silently did
   * nothing.
   *
   * @param {object} loc
   * @param {string|null} observed dominant currency among the page's cards
   * @returns {string|null} ISO 4217 code, or null on an unknown site
   */
  function currencyFor(loc, observed) {
    var host = loc && loc.hostname ? String(loc.hostname) : '';
    for (var i = 0; i < HOST_CURRENCIES.length; i++) {
      if (HOST_CURRENCIES[i].re.test(host)) return HOST_CURRENCIES[i].currency;
    }
    if (observed) return observed;
    return forLocation(loc).id === 'generic' ? null : 'USD';
  }

  PPP.sites = {
    SITES: SITES,
    GENERIC: GENERIC_SITE,
    forLocation: forLocation,
    isResultsPage: isResultsPage,
    currencyFor: currencyFor
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.sites;
}
