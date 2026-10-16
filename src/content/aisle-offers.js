/**
 * Aisle offers filter (discover.gotoaisle.com/offers).
 *
 * Hides every offer that is not an outright free item - BOGO, "Buy 2, Get $7",
 * "$X off", and wording that promises nothing specific ("Get Rewarded!") -
 * leaving "FREE Olipop" and "Get 2 FREE" style offers. The wording is judged
 * by PPP.offers; this file only finds the cards and shows a small control bar.
 *
 * Aisle's markup is not a contract, so nothing here names its classes. A card
 * is found structurally: start at a piece of offer wording ("FREE", "$2 off",
 * "Buy 1 Get 1") and walk up to the first box that sits in a row of similar
 * boxes (same tag and class) that also carry offer wording, and that looks
 * like a card (has an image, link or button and more than a word of text).
 */
;(function (root) {
  'use strict';

  var PPP = root.PPP;
  var offers = PPP.offers;

  var STORAGE_KEY = 'ppp.aisle.v1';
  var DEFAULTS = { freeOnly: true, barVisible: true };
  var CARD_ATTR = 'data-ppp-aisle-card';
  var HIDDEN_ATTR = 'data-ppp-aisle-hidden';
  var UI_ATTR = 'data-ppp-aisle-ui';
  var SCAN_DELAY_MS = 250;
  /** Longer than any one offer card; stops the walk at page sections. */
  var MAX_CARD_TEXT = 1500;
  var MIN_CARD_TEXT = 12;
  var MAX_HEADLINE_TEXT = 120;
  /** Filter chips and menus can say "Free" or "BOGO" too; they are not offers. */
  var SKIP_SELECTOR =
    'script,style,noscript,template,textarea,select,nav,[role="navigation"],[role="tablist"],[role="menu"],[' +
    UI_ATTR +
    ']';

  var state = {
    prefs: { freeOnly: DEFAULTS.freeOnly, barVisible: DEFAULTS.barVisible },
    cards: [],
    kinds: new WeakMap(),
    timer: 0,
    href: '',
    badge: null,
    bar: null
  };

  function isOffersPage(loc) {
    return /^\/offers(?:\/|$)/i.test(String((loc || location).pathname || ''));
  }

  function contextAlive() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (error) {
      return false;
    }
  }

  function send(message) {
    if (!contextAlive()) return;
    try {
      var result = chrome.runtime.sendMessage(message);
      if (result && typeof result.catch === 'function') result.catch(function () {});
    } catch (error) {
      /* the extension was reloaded under this page */
    }
  }

  function loadPrefs() {
    return new Promise(function (resolve) {
      if (!contextAlive() || !chrome.storage || !chrome.storage.sync) return resolve(state.prefs);
      chrome.storage.sync.get(STORAGE_KEY, function (result) {
        var raw = !chrome.runtime.lastError && result ? result[STORAGE_KEY] : null;
        resolve(sanitize(raw));
      });
    });
  }

  function sanitize(raw) {
    var out = { freeOnly: DEFAULTS.freeOnly, barVisible: DEFAULTS.barVisible };
    if (raw && typeof raw === 'object') {
      if (typeof raw.freeOnly === 'boolean') out.freeOnly = raw.freeOnly;
      if (typeof raw.barVisible === 'boolean') out.barVisible = raw.barVisible;
    }
    return out;
  }

  function savePrefs() {
    if (!contextAlive() || !chrome.storage || !chrome.storage.sync) return;
    var payload = {};
    payload[STORAGE_KEY] = state.prefs;
    try {
      chrome.storage.sync.set(payload, function () {
        void chrome.runtime.lastError;
      });
    } catch (error) {
      /* the extension was reloaded under this page */
    }
  }

  /* ---------- card detection ---------- */

  /**
   * An element's text with a space between every text node. textContent runs
   * blocks together ("$2 OFFAny chips"), which defeats word boundaries.
   */
  function textOf(el) {
    var parts = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) parts.push(node.nodeValue);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Elements holding offer wording. A price is often split across spans
   * ("$2" + "OFF"), so a text node that says nothing on its own is retried
   * with its parent's and grandparent's text while that is headline-sized.
   */
  function findSignals(scope) {
    var out = [];
    var seen = new Set();
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.nodeValue;
      if (!text || !/\S/.test(text) || text.length > 300) continue;
      var el = node.parentElement;
      if (!el || seen.has(el) || el.closest(SKIP_SELECTOR)) continue;
      if (offers.classify(text) === 'none' && !headlineAround(el)) continue;
      seen.add(el);
      out.push(el);
    }
    return out;
  }

  function headlineAround(el) {
    for (var up = el.parentElement, depth = 0; up && depth < 2; up = up.parentElement, depth++) {
      var text = textOf(up);
      if (text.length > MAX_HEADLINE_TEXT) return false;
      if (offers.classify(text) !== 'none') return true;
    }
    return false;
  }

  function containsAny(el, signals) {
    for (var i = 0; i < signals.length; i++) {
      if (el.contains(signals[i])) return true;
    }
    return false;
  }

  /**
   * A card has a picture, or at least a sentence and something to click.
   * Short image-less buttons are the page's own filter chips ("Free", "BOGO").
   */
  function looksLikeCard(el) {
    var length = (el.textContent || '').length;
    if (length > MAX_CARD_TEXT * 2) return false;
    length = textOf(el).length;
    if (!length || length > MAX_CARD_TEXT) return false;
    if (el.matches('img,picture') || el.querySelector('img,picture,[style*="background-image"]')) return true;
    if (length < MIN_CARD_TEXT) return false;
    return el.matches('a[href],button,[role="button"]') || !!el.querySelector('a[href],button,[role="button"]');
  }

  function hasSimilarSibling(el, signals) {
    var parent = el.parentElement;
    if (!parent) return false;
    var kids = parent.children;
    for (var i = 0; i < kids.length; i++) {
      var sib = kids[i];
      if (sib === el || sib.tagName !== el.tagName) continue;
      if (String(sib.className) !== String(el.className)) continue;
      if (containsAny(sib, signals)) return true;
    }
    return false;
  }

  function cardFor(signal, signals) {
    var el = signal;
    while (el && el !== document.body && el !== document.documentElement) {
      if (looksLikeCard(el) && hasSimilarSibling(el, signals)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function findCards(scope) {
    var signals = findSignals(scope || document.body);
    var cards = [];
    var seen = new Set();
    for (var i = 0; i < signals.length; i++) {
      var card = cardFor(signals[i], signals);
      if (!card || seen.has(card)) continue;
      seen.add(card);
      cards.push(card);
    }
    // Some offers carry no offer wording at all ("Redeem To Unlock More
    // Offers!"), so they leave no signal to start from. They are still cards:
    // the same box, in the same grid, as the ones that do.
    cards.slice().forEach(function (card) {
      var kids = card.parentElement ? card.parentElement.children : [];
      for (var k = 0; k < kids.length; k++) {
        var sib = kids[k];
        if (seen.has(sib) || sib.tagName !== card.tagName || String(sib.className) !== String(card.className)) continue;
        if (sib.closest(SKIP_SELECTOR) || !looksLikeCard(sib)) continue;
        seen.add(sib);
        cards.push(sib);
      }
    });
    // A card nested in another card (a "more like this" strip inside an offer)
    // would be judged twice; keep the outermost.
    return cards.filter(function (card) {
      return !cards.some(function (other) {
        return other !== card && other.contains(card);
      });
    });
  }

  /**
   * The card's offer kind, from its rendered lines. innerText of a hidden
   * element has no line breaks, so a card this script hid is briefly shown to
   * be read; the result is cached until the card's text changes. A card the
   * site itself hides (an inactive tab) is read as one spaced-out line.
   */
  function kindOf(card) {
    var text = card.textContent || '';
    var cached = state.kinds.get(card);
    if (cached && cached.text === text) return cached.kind;
    var wasHidden = card.getAttribute(HIDDEN_ATTR) === 'true';
    if (wasHidden) card.removeAttribute(HIDDEN_ATTR);
    var rendered = typeof card.innerText === 'string' ? card.innerText : '';
    if (wasHidden) card.setAttribute(HIDDEN_ATTR, 'true');
    var lines = rendered
      .split(/\n+/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
    if (lines.length < 2) lines = [textOf(card)];
    var kind = offers.classifyLines(lines);
    state.kinds.set(card, { text: text, kind: kind });
    return kind;
  }

  /* ---------- applying ---------- */

  function clearAll() {
    var marked = document.querySelectorAll('[' + CARD_ATTR + ']');
    for (var i = 0; i < marked.length; i++) {
      marked[i].removeAttribute(CARD_ATTR);
      marked[i].removeAttribute(HIDDEN_ATTR);
    }
    state.cards = [];
  }

  function scan() {
    state.timer = 0;
    state.href = location.href;
    if (!isOffersPage(location) || !document.body) {
      clearAll();
      renderBar(null);
      setBadge('');
      return;
    }
    var cards = findCards(document.body);
    var keep = new Set(cards);
    state.cards.forEach(function (old) {
      if (!keep.has(old)) {
        old.removeAttribute(CARD_ATTR);
        old.removeAttribute(HIDDEN_ATTR);
      }
    });
    state.cards = cards;

    var stats = { total: cards.length, free: 0, hidden: 0 };
    cards.forEach(function (card) {
      var kind = kindOf(card);
      card.setAttribute(CARD_ATTR, kind);
      if (kind === 'free') stats.free++;
      var hide = state.prefs.freeOnly && kind !== 'free';
      if (hide) {
        stats.hidden++;
        if (card.getAttribute(HIDDEN_ATTR) !== 'true') card.setAttribute(HIDDEN_ATTR, 'true');
      } else if (card.hasAttribute(HIDDEN_ATTR)) {
        card.removeAttribute(HIDDEN_ATTR);
      }
    });
    renderBar(stats);
    setBadge(stats.hidden > 999 ? '999+' : stats.hidden > 0 ? String(stats.hidden) : '');
  }

  function scheduleScan() {
    if (state.timer) return;
    state.timer = setTimeout(scan, SCAN_DELAY_MS);
  }

  function setBadge(text) {
    if (text === state.badge) return;
    state.badge = text;
    send({ type: 'ppp:badge', text: text });
  }

  /* ---------- control bar ---------- */

  var BAR_CSS =
    ':host{all:initial}' +
    '.bar{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:10px;' +
    'padding:8px 10px 8px 14px;border-radius:999px;background:#202124;color:#fff;' +
    'font:500 13px/1.3 Roboto,Arial,system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3)}' +
    'button{font:inherit;cursor:pointer;border:0;border-radius:999px;padding:5px 12px;background:#fff;color:#202124}' +
    'button.close{background:transparent;color:#bbb;padding:2px 6px;font-size:16px;line-height:1}' +
    'button:focus-visible{outline:2px solid #8ab4f8;outline-offset:2px}';

  function ensureBar() {
    if (state.bar) return state.bar;
    var host = document.createElement('div');
    host.setAttribute(UI_ATTR, '');
    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = BAR_CSS;
    var bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Free offers filter');
    var label = document.createElement('span');
    label.setAttribute('aria-live', 'polite');
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.addEventListener('click', function () {
      state.prefs.freeOnly = !state.prefs.freeOnly;
      savePrefs();
      scan();
    });
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = '\u00d7';
    close.title = 'Hide this bar (the toolbar button brings it back)';
    close.setAttribute('aria-label', 'Hide the free offers bar');
    close.addEventListener('click', function () {
      state.prefs.barVisible = false;
      savePrefs();
      scan();
    });
    bar.appendChild(label);
    bar.appendChild(toggle);
    bar.appendChild(close);
    shadow.appendChild(style);
    shadow.appendChild(bar);
    document.documentElement.appendChild(host);
    state.bar = { host: host, label: label, toggle: toggle };
    return state.bar;
  }

  function renderBar(stats) {
    if (!stats || !state.prefs.barVisible) {
      if (state.bar) state.bar.host.hidden = true;
      return;
    }
    var bar = ensureBar();
    bar.host.hidden = false;
    if (!stats.total) {
      bar.label.textContent = 'Looking for offers\u2026';
    } else if (state.prefs.freeOnly) {
      bar.label.textContent =
        'Free offers only: ' + stats.free + ' shown, ' + stats.hidden + ' hidden';
    } else {
      bar.label.textContent = stats.free + ' of ' + stats.total + ' offers are free';
    }
    bar.toggle.textContent = state.prefs.freeOnly ? 'Show all' : 'Free only';
    bar.toggle.setAttribute('aria-pressed', String(state.prefs.freeOnly));
  }

  /* ---------- wiring ---------- */

  function init(prefs) {
    state.prefs = prefs;
    var observer = new MutationObserver(function () {
      // The site is a single-page app: a route change shows up as DOM churn.
      if (location.href !== state.href) clearAll();
      scheduleScan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener('popstate', scheduleScan);

    if (contextAlive() && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'sync' || !changes[STORAGE_KEY]) return;
        state.prefs = sanitize(changes[STORAGE_KEY].newValue);
        scan();
      });
    }
    scan();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== 'ppp:toggle-panel') return;
      state.prefs.barVisible = !(state.prefs.barVisible && isOffersPage(location));
      savePrefs();
      scan();
    });
  }

  PPP.aisle = {
    findCards: findCards,
    kindOf: kindOf,
    isOffersPage: isOffersPage,
    scan: scan
  };

  loadPrefs().then(init);
})(typeof globalThis !== 'undefined' ? globalThis : this);
