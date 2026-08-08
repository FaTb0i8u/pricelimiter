/**
 * Content-script entry point: scan -> analyse -> annotate -> filter.
 *
 * Everything this file writes to the store's DOM is additive and reversible: a
 * `data-ppp-*` attribute, one absolutely-positioned badge element per card, and
 * (only when the card is statically positioned) `position: relative`. Calling
 * `reset()` removes all of it.
 */
;(function (root) {
  'use strict';

  var PPP = root.PPP;
  if (!PPP || !PPP.adapter) return;
  if (window.top !== window) return; // never run inside the store's iframes

  var adapter = PPP.adapter;
  var quantity = PPP.quantity;
  var settingsApi = PPP.settings;
  var BASES = PPP.units.BASES;

  var CURRENCY_SYMBOLS = {
    USD: '$', CAD: '$', AUD: '$', NZD: '$', SGD: '$', HKD: '$',
    GBP: '\u00a3', EUR: '\u20ac', JPY: '\u00a5', INR: '\u20b9',
    KRW: '\u20a9', BRL: 'R$', MXN: '$', CHF: 'CHF', SEK: 'kr',
    NOK: 'kr', DKK: 'kr', PLN: 'z\u0142', ZAR: 'R'
  };

  var RESCAN_DEBOUNCE_MS = 300;
  /** Kept in step with the ppp-flash animation in content.css. */
  var FLASH_DURATION_MS = 1600;

  var state = {
    settings: null,
    panel: null,
    cards: [],
    forced: false,
    observer: null,
    rescanTimer: null,
    flashTimer: null,
    lastUrl: location.href,
    bestCard: null,
    // Set once per scan cycle when the URL test fails but the page turns out
    // to hold a results grid anyway. See looksLikeResultsByContent().
    contentActive: false
  };

  /** Per-element memo of the expensive parse work. */
  var analysisCache = new WeakMap();
  var positionPatched = new WeakSet();

  /* ---------------------------------------------------------------- analyse */

  function analyzeCard(card) {
    var title = adapter.extractTitle(card);
    var priceInfo = adapter.extractPrice(card);
    var unitPriceInfo = adapter.extractUnitPrice(card);
    var signature =
      title + '|' + (priceInfo ? priceInfo.raw : '') + '|' + (unitPriceInfo ? unitPriceInfo.raw : '');

    var cached = analysisCache.get(card);
    if (cached && cached.signature === signature) return cached.data;

    var sizeText = adapter.extractSizeText(card, title);
    var parsed = quantity.parseQuantity(sizeText.primary);
    if (!parsed && sizeText.secondary) {
      parsed = quantity.parseQuantity(sizeText.secondary);
      // Size found in surrounding card copy rather than the title is a weaker
      // signal - it may belong to a neighbouring line of text.
      if (parsed) parsed.confidence = Math.max(0.05, parsed.confidence - 0.15);
    }
    if (!parsed) {
      // Last resort: the merchant's own product path, which often spells the
      // size out when the card itself never does. Read only when the visible
      // text has already come up empty, so most cards never touch it.
      var urlText = adapter.extractUrlSizeText(card);
      if (urlText) {
        parsed = quantity.parseQuantity(urlText);
        // A slug names this product rather than a neighbour, but it is not
        // prose, so it is trusted a little less than a title.
        if (parsed) parsed.confidence = Math.max(0.05, parsed.confidence - 0.2);
      }
    }

    var data = {
      title: title,
      price: priceInfo,
      unitPrice: unitPriceInfo,
      quantity: parsed,
      pricePerCanonical:
        priceInfo && parsed && parsed.amount > 0 ? priceInfo.amount / parsed.amount : null
    };

    analysisCache.set(card, { signature: signature, data: data });
    return data;
  }

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
      var other = declared.perUnit.dimension === 'mass' ? BASES.lb : BASES.l;
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
      var altBase = data.quantity.dimension === 'mass' ? BASES.lb : BASES.l;
      return {
        state: 'na',
        altBase: altBase,
        unitPrice: data.pricePerCanonical * altBase.perBase,
        source: 'title'
      };
    }

    var unitPrice = data.pricePerCanonical * base.perBase;
    return {
      state: unitPrice <= settings.threshold ? 'pass' : 'fail',
      unitPrice: unitPrice,
      base: base,
      source: 'title'
    };
  }

  /* ----------------------------------------------------------------- render */

  function formatMoney(value) {
    if (!isFinite(value)) return '';
    if (value >= 1000) return String(Math.round(value));
    if (value >= 100) return value.toFixed(1);
    return value.toFixed(2);
  }

  function badgeText(verdict, data, symbol) {
    if (verdict.state === 'unknown') {
      // A merchant per-item price is still worth showing even though it cannot
      // be compared against a per-weight threshold.
      if (verdict.source === 'site' && data.unitPrice && data.unitPrice.perUnit) {
        return symbol + formatMoney(data.unitPrice.amount) + '/' + data.unitPrice.perUnit.label;
      }
      return verdict.reason || 'no size';
    }
    var base = verdict.base || verdict.altBase;
    return symbol + formatMoney(verdict.unitPrice) + '/' + base.label;
  }

  function ensureBadge(card) {
    var badge = card.querySelector(':scope > .ppp-badge');
    if (badge) return badge;

    if (!positionPatched.has(card)) {
      positionPatched.add(card);
      if (window.getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
        card.setAttribute('data-ppp-pos', 'patched');
      }
    }

    badge = document.createElement('span');
    badge.className = 'ppp-badge';
    badge.setAttribute('data-ppp-ui', 'badge');

    // Text label for the best-value card. The border alone would convey the
    // meaning by colour only, which fails WCAG 1.4.1 and is invisible to
    // screen readers.
    var best = document.createElement('span');
    best.className = 'ppp-badge-best';
    badge.appendChild(best);

    var value = document.createElement('span');
    value.className = 'ppp-badge-value';
    badge.appendChild(value);

    var flag = document.createElement('span');
    flag.className = 'ppp-badge-flag';
    badge.appendChild(flag);

    card.appendChild(badge);
    return badge;
  }

  /** Highlight the cheapest visible card so the jump target is identifiable. */
  function markBest(card) {
    card.setAttribute('data-ppp-best', 'true');
    // Lets assistive technology land on the card when the panel jumps to it.
    if (!card.hasAttribute('tabindex')) {
      card.setAttribute('tabindex', '-1');
      card.setAttribute('data-ppp-tabindex', 'added');
    }
    var badge = card.querySelector(':scope > .ppp-badge');
    if (!badge) return;
    badge.setAttribute('data-ppp-best', 'true');
    var label = badge.querySelector('.ppp-badge-best');
    if (label) label.textContent = 'Best value';
  }

  function clearBest(card) {
    card.removeAttribute('data-ppp-best');
    card.removeAttribute('data-ppp-flash');
    if (card.getAttribute('data-ppp-tabindex') === 'added') {
      card.removeAttribute('tabindex');
      card.removeAttribute('data-ppp-tabindex');
    }
    var badge = card.querySelector(':scope > .ppp-badge');
    if (!badge) return;
    badge.removeAttribute('data-ppp-best');
    var label = badge.querySelector('.ppp-badge-best');
    if (label) label.textContent = '';
  }

  function decorate(card, data, verdict, settings, symbol) {
    var badge = ensureBadge(card);
    var value = badge.querySelector('.ppp-badge-value');
    var flag = badge.querySelector('.ppp-badge-flag');

    value.textContent = badgeText(verdict, data, symbol);

    // A merchant-declared unit price is never uncertain; only inferred ones are.
    var uncertain =
      verdict.source !== 'site' &&
      data.quantity &&
      (data.quantity.confidence < 0.6 ||
        data.quantity.flags.indexOf('pack-ambiguous') > -1);
    flag.textContent = verdict.state === 'unknown' || !uncertain ? '' : '\u00a0?';

    badge.setAttribute('data-ppp-state', verdict.state);
    clearBest(card); // re-awarded below, once per scan
    badge.title = buildTooltip(data, verdict);

    card.setAttribute('data-ppp-card', '');
    card.setAttribute('data-ppp-state', verdict.state);
    if (settings.debug) card.setAttribute('data-ppp-debug', 'true');
    else card.removeAttribute('data-ppp-debug');

    var hidden =
      settings.filterEnabled &&
      ((verdict.state === 'fail') ||
        (verdict.state === 'unknown' && settings.hideUnknown) ||
        (verdict.state === 'na' && settings.hideOtherDimension));

    if (hidden) card.setAttribute('data-ppp-hidden', 'true');
    else card.removeAttribute('data-ppp-hidden');

    return hidden;
  }

  function buildTooltip(data, verdict) {
    var lines = [];
    if (verdict.source === 'site') {
      lines.push('Unit price listed by the merchant: ' + data.unitPrice.raw);
    }
    if (data.price) lines.push('Price read: ' + data.price.raw);
    if (verdict.source !== 'site' && data.quantity) {
      lines.push(
        'Size read: ' +
          quantity.formatQuantity(data.quantity.amount, data.quantity.dimension) +
          ' (from "' + data.quantity.raw + '")'
      );
      lines.push('Confidence: ' + Math.round(data.quantity.confidence * 100) + '%');
      if (data.quantity.flags.indexOf('pack-ambiguous') > -1) {
        lines.push(
          'A pack count was found but the listing does not say the size is ' +
            'per item, so it was NOT multiplied.'
        );
      }
      if (data.quantity.flags.indexOf('multiple-sizes') > -1) {
        lines.push('Several different sizes were mentioned; the smallest was used.');
      }
    } else if (verdict.reason) {
      lines.push('Skipped: ' + verdict.reason);
    }
    return lines.join('\n');
  }

  function dominantCurrency(analyses) {
    var tally = {};
    var best = null;
    for (var i = 0; i < analyses.length; i++) {
      var currency = analyses[i].price && analyses[i].price.currency;
      if (!currency) continue;
      tally[currency] = (tally[currency] || 0) + 1;
      if (!best || tally[currency] > tally[best]) best = currency;
    }
    return best;
  }

  /* ------------------------------------------------------------------- scan */

  var EMPTY_STATS = { total: 0, shown: 0, priced: 0, unknown: 0, best: null, currencySymbol: '$', hint: '' };

  /**
   * Settings as the panel should see them. Dormancy (not on a Shopping page)
   * hides the panel without touching the user's saved preference.
   */
  function panelView() {
    var view = {};
    Object.keys(state.settings).forEach(function (key) {
      view[key] = state.settings[key];
    });
    view.panelVisible = state.settings.panelVisible && isActive();
    return view;
  }

  function renderPanel(stats) {
    if (state.panel && state.settings) state.panel.render(panelView(), stats);
  }

  function scan() {
    if (!state.settings) return;

    // Cards hidden by a previous scan have no layout box, so they would be
    // invisible to both the card finder and the product-image size test and
    // could never be restored when the threshold is relaxed. Clearing the
    // hidden state first makes every scan measure the true layout. This runs
    // synchronously through to re-applying below, so the browser never paints
    // the intermediate state and nothing flickers.
    unhideAll();

    var cards = adapter.findCards();
    state.cards = cards;

    var analyses = [];
    var i;
    for (i = 0; i < cards.length; i++) analyses.push(analyzeCard(cards[i]));

    var currency = dominantCurrency(analyses);
    var symbol = (currency && CURRENCY_SYMBOLS[currency]) || '$';

    var stats = { total: cards.length, shown: 0, priced: 0, unknown: 0, best: null };
    var bestVerdict = null;
    state.bestCard = null;

    for (i = 0; i < cards.length; i++) {
      var verdict = evaluate(analyses[i], state.settings);
      var hidden = decorate(cards[i], analyses[i], verdict, state.settings, symbol);

      if (!hidden) stats.shown++;
      if (verdict.state === 'unknown') stats.unknown++;
      if (verdict.state === 'pass' || verdict.state === 'fail') {
        stats.priced++;
        // Only a visible card may be nominated: offering to jump to something
        // the filter has hidden scrolls the user to nothing.
        if (!hidden && (!bestVerdict || verdict.unitPrice < bestVerdict.unitPrice)) {
          bestVerdict = verdict;
          state.bestCard = cards[i];
        }
      }
    }

    if (bestVerdict && state.bestCard) {
      markBest(state.bestCard);
      stats.best = {
        label: symbol + formatMoney(bestVerdict.unitPrice) + '/' + bestVerdict.base.label
      };
    }

    stats.currencySymbol = symbol;
    stats.hint = adapter.isShoppingSurface()
      ? ''
      : 'Not a recognised results page \u2013 results may be mixed.';

    renderPanel(stats);
  }

  /** Restore every card we hid, so the next scan measures the true layout. */
  function unhideAll() {
    var hidden = document.querySelectorAll('[data-ppp-hidden]');
    for (var i = 0; i < hidden.length; i++) {
      hidden[i].removeAttribute('data-ppp-hidden');
    }
  }

  /** Remove every trace of the extension from the page. */
  function reset() {
    unhideAll();
    if (state.flashTimer) {
      clearTimeout(state.flashTimer);
      state.flashTimer = null;
    }
    var marked = document.querySelectorAll('[data-ppp-card]');
    for (var i = 0; i < marked.length; i++) {
      var card = marked[i];
      clearBest(card);
      card.removeAttribute('data-ppp-card');
      card.removeAttribute('data-ppp-state');
      card.removeAttribute('data-ppp-debug');
      if (card.hasAttribute('data-ppp-pos')) {
        card.style.position = '';
        card.removeAttribute('data-ppp-pos');
        positionPatched.delete(card);
      }
      var badge = card.querySelector(':scope > .ppp-badge');
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
    }
    state.cards = [];
    state.bestCard = null;
  }

  function scheduleScan() {
    if (state.rescanTimer) clearTimeout(state.rescanTimer);
    state.rescanTimer = setTimeout(function () {
      state.rescanTimer = null;
      if (location.href !== state.lastUrl) {
        state.lastUrl = location.href;
        analysisCache = new WeakMap();
        state.contentActive = false;
        reset();
      }
      // Only pay for the content probe when the cheap tests have already
      // failed, so ordinary results pages scan exactly once as before.
      state.contentActive =
        !state.forced && !adapter.isShoppingSurface() ? looksLikeResultsByContent() : false;
      if (!isActive()) {
        reset();
        renderPanel(EMPTY_STATS);
        return;
      }
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(scan, { timeout: 500 });
      } else {
        scan();
      }
    }, RESCAN_DEBOUNCE_MS);
  }

  function isOurNode(node) {
    return (
      node.nodeType === 1 &&
      typeof node.hasAttribute === 'function' &&
      node.hasAttribute('data-ppp-ui')
    );
  }

  function isRelevantMutation(records) {
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.target && record.target.nodeType === 1 &&
          record.target.closest && record.target.closest('[data-ppp-ui]')) {
        continue;
      }
      var added = record.addedNodes;
      var j;
      var meaningful = false;
      for (j = 0; j < added.length; j++) {
        if (!isOurNode(added[j])) { meaningful = true; break; }
      }
      if (!meaningful) {
        for (j = 0; j < record.removedNodes.length; j++) {
          if (!isOurNode(record.removedNodes[j])) { meaningful = true; break; }
        }
      }
      if (meaningful) return true;
    }
    return false;
  }

  function startObserver() {
    if (state.observer) return;
    state.observer = new MutationObserver(function (records) {
      if (isRelevantMutation(records)) scheduleScan();
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------- glue */

  /**
   * How many cards must be on the page before content alone is enough to
   * activate. A genuine results grid has dozens; a stray price or two on an
   * article or a product page must not be mistaken for one.
   */
  var MIN_CARDS_TO_AUTO_ACTIVATE = 5;

  /**
   * Activation fallback for when the URL test says no but the page plainly is
   * a results grid.
   *
   * Stores change their results URLs without notice - Google alone has moved
   * between `tbm=shop` and `udm=28` - and when that happens a URL-only test
   * leaves the extension mounted, dormant and completely invisible, with no
   * hint to the user that anything is wrong. Believing the DOM as well as the
   * URL means a parameter rename degrades to "still works" instead of
   * "silently does nothing".
   *
   * Restricted to hosts we have a profile for, so an unknown site can never
   * auto-activate on the strength of a few prices.
   */
  function looksLikeResultsByContent() {
    if (adapter.currentSite().id === 'generic') return false;
    return adapter.findCards().length >= MIN_CARDS_TO_AUTO_ACTIVATE;
  }

  function isActive() {
    return state.forced || adapter.isShoppingSurface() || state.contentActive;
  }

  function applySettings(patch) {
    Object.keys(patch).forEach(function (key) {
      state.settings[key] = patch[key];
    });
    state.settings = settingsApi.sanitize(state.settings);
    settingsApi.save(state.settings);
    scan();
  }

  function jumpToBest() {
    if (!state.bestCard || !state.bestCard.isConnected) return;
    var card = state.bestCard;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });

    // Move focus so keyboard and screen-reader users also land on the card,
    // not just sighted ones. preventScroll avoids fighting the smooth scroll.
    try {
      card.focus({ preventScroll: true });
    } catch (error) {
      // Older engines reject the options object; focus is a nicety, not a
      // requirement, so a failure here is not worth surfacing.
    }

    // Restart the attention flash even if it is already running.
    if (state.flashTimer) clearTimeout(state.flashTimer);
    card.removeAttribute('data-ppp-flash');
    void card.offsetWidth; // force reflow so the animation replays
    card.setAttribute('data-ppp-flash', 'true');
    state.flashTimer = setTimeout(function () {
      state.flashTimer = null;
      card.removeAttribute('data-ppp-flash');
    }, FLASH_DURATION_MS);
  }

  function init(settings) {
    state.settings = settings;

    state.panel = PPP.panel.createPanel({
      onChange: applySettings,
      onRescan: function () {
        analysisCache = new WeakMap();
        scan();
      },
      onJumpToBest: jumpToBest
    });
    state.panel.mount();

    settingsApi.subscribe(function (next) {
      state.settings = next;
      scan();
    });

    startObserver();
    window.addEventListener('popstate', scheduleScan);
    scheduleScan();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== 'ppp:toggle-panel' || !state.settings) return;
      // Clicking the toolbar icon is also the escape hatch for when a store
      // changes its results URL patterns and auto-detection stops firing.
      state.forced = true;
      applySettings({ panelVisible: !state.settings.panelVisible });
      scheduleScan();
    });
  }

  settingsApi.load().then(function (settings) {
    // Initialise even on ordinary search pages: the panel stays hidden, but the
    // message listener remains available so the toolbar button can force it on
    // if a store ever changes its results URL patterns.
    init(settings);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
