/**
 * Settings persistence. Uses chrome.storage.sync so preferences follow the
 * user across signed-in Chrome profiles; the payload is a few dozen bytes,
 * well inside the sync quota.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});

  var STORAGE_KEY = 'ppp.settings.v1';

  var DEFAULTS = {
    /** Master switch for hiding results. Badges are shown either way. */
    filterEnabled: false,
    /** Legacy default and migration source for per-currency thresholds. */
    threshold: 3,
    /** ISO currency code -> maximum acceptable price per base unit. */
    thresholds: {},
    /** One of PPP.units.BASES: 'lb' | 'kg' | 'oz' | 'l' | 'floz'. */
    basis: 'lb',
    /** Hide cards whose size could not be determined. Off by default: the
     *  cheapest item may well be in that bucket, so silently hiding is unsafe. */
    hideUnknown: false,
    /** Hide cards measured in the other dimension (e.g. litres while filtering
     *  per pound). Off by default for the same reason. */
    hideOtherDimension: false,
    /** Treat results below this parse confidence as "unknown". */
    minConfidence: 0.4,
    /** Reorder the results grid by unit price, cheapest first. */
    sortByUnitPrice: false,
    /** Read product pages for results the card alone cannot price, without
     *  being asked. Off by default: it makes requests the shopper did not
     *  click for. */
    autoLookup: false,
    /** Remember the lowest unit price seen per product, on this device only. */
    rememberPrices: true,
    /** Whether the badge guide has been dismissed. */
    onboarded: false,
    /** Panel chrome state. */
    panelVisible: true,
    panelCollapsed: false,
    /** One of PANEL_CORNERS. */
    panelCorner: 'bottom-right',
    /** Outline detected cards for adapter debugging. */
    debug: false
  };

  var PANEL_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

  /** Strictness presets for `minConfidence`, loosest first. */
  var CONFIDENCE_PRESETS = [
    { value: 0.25, label: 'Lenient' },
    { value: 0.4, label: 'Balanced' },
    { value: 0.6, label: 'Strict' }
  ];

  /**
   * False once the extension has been updated, reloaded or removed while this
   * page stayed open. The old content script keeps running, but every
   * chrome.* call from it throws "Extension context invalidated".
   */
  function contextAlive() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (error) {
      return false;
    }
  }

  function hasStorage() {
    return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.sync && contextAlive();
  }

  function sanitize(raw) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      out[key] = key === 'thresholds' ? {} : DEFAULTS[key];
    });
    if (!raw || typeof raw !== 'object') return out;

    Object.keys(DEFAULTS).forEach(function (key) {
      var value = raw[key];
      if (value === undefined || value === null) return;
      if (typeof DEFAULTS[key] === 'boolean') {
        out[key] = !!value;
      } else if (typeof DEFAULTS[key] === 'number') {
        var n = Number(value);
        if (isFinite(n) && n >= 0) out[key] = n;
      } else if (typeof DEFAULTS[key] === 'string') {
        if (typeof value === 'string') out[key] = value;
      }
    });

    if (!PPP.units.BASES[out.basis]) out.basis = DEFAULTS.basis;
    if (PANEL_CORNERS.indexOf(out.panelCorner) === -1) out.panelCorner = DEFAULTS.panelCorner;
    out.threshold = Math.min(Math.max(out.threshold, 0), 1e6);
    out.minConfidence = Math.min(Math.max(out.minConfidence, 0), 1);
    if (raw.thresholds && typeof raw.thresholds === 'object') {
      Object.keys(raw.thresholds).forEach(function (currency) {
        var value = Number(raw.thresholds[currency]);
        if (isCurrencyCode(currency) && isFinite(value) && value >= 0) {
          out.thresholds[currency] = Math.min(value, 1e6);
        }
      });
    } else if (raw.threshold !== undefined && raw.threshold !== null) {
      // Older releases stored one unqualified amount. Preserve that user's
      // choice for the original USD storefront instead of applying it to a
      // different currency without consent.
      out.thresholds.USD = out.threshold;
    }
    return out;
  }

  function isCurrencyCode(currency) {
    return typeof currency === 'string' && /^[A-Z]{3}$/.test(currency);
  }

  /**
   * The limit for `currency`. With no currency (nothing on the page carried
   * one) the unscoped `threshold` is used, so the box still does something.
   */
  function thresholdFor(settings, currency) {
    var clean = sanitize(settings);
    if (!currency) return clean.threshold;
    return Object.prototype.hasOwnProperty.call(clean.thresholds, currency)
      ? clean.thresholds[currency]
      : defaultThreshold(clean.basis);
  }

  /** Four significant figures: enough for $0.1875/oz, without float noise. */
  function roundLimit(value) {
    return value > 0 ? Math.min(Number(value.toPrecision(4)), 1e6) : 0;
  }

  /**
   * The same limit expressed per another unit: $3/lb is $6.614/kg. A limit
   * has no meaning across dimensions, so a switch from weight to volume keeps
   * the number as it is.
   */
  function convertLimit(value, fromBasis, toBasis) {
    var from = PPP.units.BASES[fromBasis];
    var to = PPP.units.BASES[toBasis];
    if (!from || !to || from === to || from.dimension !== to.dimension) return value;
    return roundLimit((value * to.perBase) / from.perBase);
  }

  /**
   * The starting limit for a currency with none saved. `DEFAULTS.threshold`
   * is per pound; a per-volume basis starts from the same figure per litre,
   * since $3 per fluid ounce ($101/L) would let almost anything through.
   */
  function defaultThreshold(basis) {
    var base = PPP.units.BASES[basis];
    if (!base) return DEFAULTS.threshold;
    return convertLimit(DEFAULTS.threshold, base.dimension === 'volume' ? 'l' : 'lb', basis);
  }

  /**
   * Change the unit limits are compared per, re-expressing every saved limit
   * in it. Saved limits are numbers in the CURRENT basis; switching from
   * pounds to kilograms without converting silently turned "$3/lb" into
   * "$3/kg" - a limit 2.2 times stricter that hid results nobody chose to
   * hide.
   */
  function setBasis(settings, basis) {
    var clean = sanitize(settings);
    if (!PPP.units.BASES[basis] || basis === clean.basis) return clean;
    var from = clean.basis;
    clean.threshold = convertLimit(clean.threshold, from, basis);
    Object.keys(clean.thresholds).forEach(function (currency) {
      clean.thresholds[currency] = convertLimit(clean.thresholds[currency], from, basis);
    });
    clean.basis = basis;
    return clean;
  }

  function withCurrency(settings, currency) {
    var clean = sanitize(settings);
    clean.threshold = thresholdFor(clean, currency);
    return clean;
  }

  function setThreshold(settings, currency, value) {
    var clean = sanitize(settings);
    var amount = Number(value);
    if (!isFinite(amount) || amount < 0) return clean;
    amount = Math.min(amount, 1e6);
    if (currency && !isCurrencyCode(currency)) return clean;
    if (currency) clean.thresholds[currency] = amount;
    clean.threshold = amount;
    return clean;
  }

  function load() {
    if (!hasStorage()) return Promise.resolve(sanitize(null));
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.get(STORAGE_KEY, function (result) {
          if (chrome.runtime.lastError) {
            resolve(sanitize(null));
            return;
          }
          resolve(sanitize(result && result[STORAGE_KEY]));
        });
      } catch (error) {
        resolve(sanitize(null)); // context lost between the check and the call
      }
    });
  }

  function save(settings) {
    if (!hasStorage()) return Promise.resolve();
    var payload = {};
    payload[STORAGE_KEY] = sanitize(settings);
    return new Promise(function (resolve) {
      try {
        chrome.storage.sync.set(payload, function () {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (error) {
        resolve();
      }
    });
  }

  /** Fires when the same settings are changed in another tab. */
  function subscribe(callback) {
    if (!hasStorage() || !chrome.storage.onChanged) return function () {};
    var handler = function (changes, area) {
      if (area !== 'sync' || !changes[STORAGE_KEY]) return;
      callback(sanitize(changes[STORAGE_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(handler);
    return function () {
      chrome.storage.onChanged.removeListener(handler);
    };
  }

  PPP.settings = {
    DEFAULTS: DEFAULTS,
    PANEL_CORNERS: PANEL_CORNERS,
    CONFIDENCE_PRESETS: CONFIDENCE_PRESETS,
    STORAGE_KEY: STORAGE_KEY,
    sanitize: sanitize,
    thresholdFor: thresholdFor,
    defaultThreshold: defaultThreshold,
    convertLimit: convertLimit,
    setBasis: setBasis,
    withCurrency: withCurrency,
    setThreshold: setThreshold,
    contextAlive: contextAlive,
    load: load,
    save: save,
    subscribe: subscribe
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.settings;
}
