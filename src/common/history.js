/**
 * Price history: the lowest unit price the user has seen for each product.
 *
 * Kept in chrome.storage.local, never sync: it is derived from what the user
 * browsed, it never leaves the device, and it would not fit the sync quota.
 * Prices are stored per gram or per millilitre so a change of basis does not
 * invalidate them, and keyed by currency so pounds never compare with dollars.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});

  var STORAGE_KEY = 'ppp.history.v1';
  /** Least recently seen products are dropped beyond this; about 300 KB. */
  var MAX_ENTRIES = 2000;
  /** Re-stamping "last seen" more often than this would write on every scan. */
  var TOUCH_INTERVAL_MS = 60 * 60 * 1000;
  /** Rounding noise between listings is not a new low. */
  var NEW_LOW_MARGIN = 0.01;

  function normalizeTitle(title) {
    return String(title || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9.]+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  /** @returns {string|null} null when the product is not identifiable enough */
  function keyFor(title, currency, dimension) {
    var name = normalizeTitle(title);
    if (name.length < 8) return null;
    if (!/^[A-Z]{3}$/.test(currency || '')) return null;
    if (dimension !== 'mass' && dimension !== 'volume') return null;
    return currency + '|' + dimension + '|' + name;
  }

  function isEntry(e) {
    return !!e && typeof e === 'object' && typeof e.s === 'string' &&
      isFinite(e.p) && e.p > 0 && isFinite(e.t) && isFinite(e.l);
  }

  /** Storage is ours, but a shape change between releases must not throw. */
  function sanitize(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      var e = raw[key];
      if (isEntry(e)) out[key] = { p: Number(e.p), t: Number(e.t), s: e.s.slice(0, 40), l: Number(e.l) };
    });
    return out;
  }

  function prune(store, max) {
    var keys = Object.keys(store);
    if (keys.length <= max) return store;
    keys.sort(function (a, b) { return store[b].l - store[a].l; });
    var out = {};
    for (var i = 0; i < max; i++) out[keys[i]] = store[keys[i]];
    return out;
  }

  /**
   * Fold new sightings into a store without mutating it.
   * @param {object} store
   * @param {Array<{key: string, price: number, site: string}>} observations
   * @param {number} now epoch ms
   * @returns {{store: object, changed: boolean}}
   */
  function merge(store, observations, now) {
    var next = Object.assign({}, store);
    var changed = false;
    for (var i = 0; i < observations.length; i++) {
      var o = observations[i];
      if (!o || !o.key || !isFinite(o.price) || o.price <= 0) continue;
      var e = next[o.key];
      if (!e || o.price < e.p) {
        next[o.key] = { p: o.price, t: now, s: String(o.site || '').slice(0, 40), l: now };
        changed = true;
      } else if (now - e.l >= TOUCH_INTERVAL_MS) {
        next[o.key] = { p: e.p, t: e.t, s: e.s, l: now };
        changed = true;
      }
    }
    return { store: prune(next, MAX_ENTRIES), changed: changed };
  }

  /**
   * How a price seen now compares with the lowest recorded BEFORE this visit.
   * @returns {{lowest: number, since: number, site: string, isNewLow: boolean}|null}
   */
  function compare(entry, price) {
    if (!isEntry(entry) || !isFinite(price)) return null;
    return {
      lowest: entry.p,
      since: entry.t,
      site: entry.s,
      isNewLow: price < entry.p * (1 - NEW_LOW_MARGIN)
    };
  }

  /** "3 days ago", "yesterday", "just now" in the user's language. */
  function describeAge(then, now, locale) {
    var seconds = Math.round((then - now) / 1000);
    if (Math.abs(seconds) < 60) return 'just now';
    var units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(seconds) >= units[i][1]) {
        var value = Math.round(seconds / units[i][1]);
        try {
          return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, units[i][0]);
        } catch (error) {
          return Math.abs(value) + ' ' + units[i][0] + (Math.abs(value) === 1 ? '' : 's') + ' ago';
        }
      }
    }
    return 'just now';
  }

  /* ---------------------------------------------------------------- storage */

  /** Null without storage, or once the extension context has been invalidated. */
  function area() {
    try {
      return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local &&
        chrome.runtime && chrome.runtime.id
        ? chrome.storage.local
        : null;
    } catch (error) {
      return null;
    }
  }

  function read() {
    var local = area();
    if (!local) return Promise.resolve({});
    return new Promise(function (resolve) {
      try {
        local.get(STORAGE_KEY, function (result) {
          resolve(chrome.runtime.lastError ? {} : sanitize(result && result[STORAGE_KEY]));
        });
      } catch (error) {
        resolve({});
      }
    });
  }

  function write(store) {
    var local = area();
    if (!local) return Promise.resolve();
    var payload = {};
    payload[STORAGE_KEY] = store;
    return new Promise(function (resolve) {
      try {
        local.set(payload, function () {
          void chrome.runtime.lastError;
          resolve();
        });
      } catch (error) {
        resolve();
      }
    });
  }

  // Serialised so two flushes from one tab cannot interleave read and write.
  var queue = Promise.resolve();

  /**
   * Read, merge and write back, so sightings from another tab written in the
   * meantime are kept rather than overwritten.
   */
  function record(observations, now) {
    queue = queue.then(function () {
      return read().then(function (store) {
        var result = merge(store, observations, now || Date.now());
        return result.changed ? write(result.store) : undefined;
      });
    }).catch(function () {
      // One failed write must not reject every later one chained behind it.
    });
    return queue;
  }

  function clear() {
    var local = area();
    if (!local) return Promise.resolve();
    queue = queue.then(function () {
      return new Promise(function (resolve) {
        try {
          local.remove(STORAGE_KEY, function () {
            void chrome.runtime.lastError;
            resolve();
          });
        } catch (error) {
          resolve();
        }
      });
    });
    return queue;
  }

  PPP.history = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_ENTRIES: MAX_ENTRIES,
    normalizeTitle: normalizeTitle,
    keyFor: keyFor,
    sanitize: sanitize,
    merge: merge,
    compare: compare,
    describeAge: describeAge,
    load: read,
    record: record,
    clear: clear
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.history;
}
