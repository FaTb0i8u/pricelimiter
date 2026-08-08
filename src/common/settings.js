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
    /** Maximum acceptable price per base unit, in the page's currency. */
    threshold: 3,
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
    /** Panel chrome state. */
    panelVisible: true,
    panelCollapsed: false,
    /** Outline detected cards for adapter debugging. */
    debug: false
  };

  function hasStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
  }

  function sanitize(raw) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      out[key] = DEFAULTS[key];
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
    out.threshold = Math.min(Math.max(out.threshold, 0), 1e6);
    out.minConfidence = Math.min(Math.max(out.minConfidence, 0), 1);
    return out;
  }

  function load() {
    if (!hasStorage()) return Promise.resolve(sanitize(null));
    return new Promise(function (resolve) {
      chrome.storage.sync.get(STORAGE_KEY, function (result) {
        if (chrome.runtime.lastError) {
          resolve(sanitize(null));
          return;
        }
        resolve(sanitize(result && result[STORAGE_KEY]));
      });
    });
  }

  function save(settings) {
    if (!hasStorage()) return Promise.resolve();
    var payload = {};
    payload[STORAGE_KEY] = sanitize(settings);
    return new Promise(function (resolve) {
      chrome.storage.sync.set(payload, function () {
        void chrome.runtime.lastError;
        resolve();
      });
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
    STORAGE_KEY: STORAGE_KEY,
    sanitize: sanitize,
    load: load,
    save: save,
    subscribe: subscribe
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.settings;
}
