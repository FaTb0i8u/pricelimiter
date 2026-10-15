/**
 * Content-script entry point: scan -> analyse -> annotate -> filter.
 *
 * Everything this file writes to the store's DOM is additive and reversible: a
 * `data-ppp-*` attribute, one absolutely-positioned badge element per card,
 * (only when the card is statically positioned) `position: relative`, and
 * (only while sorting) an inline CSS `order`. Calling `reset()` removes all of
 * it.
 */
;(function (root) {
  'use strict';

  var PPP = root.PPP;
  if (!PPP || !PPP.adapter) return;
  if (window.top !== window) return; // never run inside the store's iframes

  var adapter = PPP.adapter;
  var quantity = PPP.quantity;
  var settingsApi = PPP.settings;
  var verdicts = PPP.verdict;
  var sites = PPP.sites;
  var historyApi = PPP.history;
  var productData = PPP.productData;

  var RESCAN_DEBOUNCE_MS = 300;
  var MAX_DETAIL_LOOKUPS = 8;
  var DETAIL_LOOKUP_CONCURRENCY = 3;
  /** Kept in step with the ppp-flash animation in content.css. */
  var FLASH_DURATION_MS = 1600;
  /** How far above a card to look for the flex/grid item that can be reordered. */
  var MAX_SORT_ASCENT = 6;
  var HISTORY_FLUSH_MS = 1500;

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
    currency: null,
    detailLookupBusy: false,
    /** {tried, found} from the last package-size lookup on this page. */
    lastLookup: null,
    lastStats: null,
    // Set by each scan when the URL test fails but the page turns out to hold
    // a results grid anyway. See scan().
    contentActive: false,
    // History as it stood before this page, so a price seen here cannot be
    // compared with itself. Null while loading or when switched off.
    priceHistory: null,
    pendingPrices: new Map(),
    historyTimer: null,
    // Last text sent for the toolbar icon; '' is what a fresh tab shows.
    toolbarBadge: ''
  };

  /** Per-element memo of the expensive parse work. */
  var analysisCache = new WeakMap();
  var positionPatched = new WeakSet();
  var detailQuantities = new WeakMap();
  var detailAttempts = new WeakSet();

  /* ---------------------------------------------------------------- analyse */

  /**
   * A cheap fingerprint of what the analysis reads, so an unchanged card costs
   * one native `textContent` rather than three tree walks. The badge's own text
   * is removed, or every change of basis would look like a new product.
   */
  function cardSignature(card) {
    var text = card.textContent || '';
    var badge = card.querySelector(':scope > .ppp-badge');
    if (badge) {
      var own = badge.textContent;
      var at = own ? text.lastIndexOf(own) : -1;
      if (at > -1) text = text.slice(0, at) + text.slice(at + own.length);
    }
    var link = card.querySelector('a[href]');
    return text + '|' + (card.getAttribute('aria-label') || '') + '|' +
      (link ? link.getAttribute('href') : '');
  }

  function analyzeCard(card) {
    var signature = cardSignature(card);
    var cached = analysisCache.get(card);
    if (cached && cached.signature === signature) return cached.data;

    var title = adapter.extractTitle(card);
    var priceInfo = adapter.extractPrice(card);
    var unitPriceInfo = adapter.extractUnitPrice(card);

    var sizeText = adapter.extractSizeText(card, title);
    var parsed = quantity.parseQuantity(sizeText.primary);
    var quantitySource = parsed ? 'title' : '';
    if (!parsed && sizeText.secondary) {
      parsed = quantity.parseQuantity(sizeText.secondary);
      // Size found in surrounding card copy rather than the title is a weaker
      // signal - it may belong to a neighbouring line of text.
      if (parsed) parsed.confidence = Math.max(0.05, parsed.confidence - 0.15);
      if (parsed) quantitySource = 'card';
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
        if (parsed) quantitySource = 'url';
      }
    }
    if (!parsed && detailQuantities.has(card)) {
      parsed = detailQuantities.get(card);
      quantitySource = 'product page';
    }

    var data = {
      title: title,
      price: priceInfo,
      unitPrice: unitPriceInfo,
      quantity: parsed,
      quantitySource: quantitySource,
      pricePerCanonical:
        priceInfo && parsed && parsed.amount > 0 ? priceInfo.amount / parsed.amount : null,
      // Only unsized cards are candidates for a product-page lookup.
      productUrl: parsed ? '' : adapter.extractProductUrl(card)
    };

    analysisCache.set(card, { signature: signature, data: data });
    return data;
  }

  /* ----------------------------------------------------------------- layout */

  /**
   * Give each new card a containing block for its badge. Every read happens
   * before any write, so a page of 150 cards lays out once rather than 150
   * times.
   */
  function patchPositions(cards) {
    var pending = [];
    var i;
    for (i = 0; i < cards.length; i++) {
      if (positionPatched.has(cards[i])) continue;
      positionPatched.add(cards[i]);
      if (window.getComputedStyle(cards[i]).position === 'static') pending.push(cards[i]);
    }
    for (i = 0; i < pending.length; i++) {
      pending[i].style.position = 'relative';
      pending[i].setAttribute('data-ppp-pos', 'patched');
    }
  }

  function displayOf(el) {
    return window.getComputedStyle(el).display;
  }

  /**
   * The nearest ancestor that generates a box. Google wraps organic tiles in
   * `display: contents` layers, which are invisible to layout: `order` set on
   * one does nothing, and its children are the real flex items.
   */
  function layoutParent(el) {
    var parent = el.parentElement;
    while (parent && displayOf(parent) === 'contents') parent = parent.parentElement;
    return parent;
  }

  /** A container's flex or grid items, looking through `display: contents`. */
  function layoutItems(container) {
    var out = [];
    for (var i = 0; i < container.children.length; i++) {
      var child = container.children[i];
      if (displayOf(child) === 'contents') out.push.apply(out, layoutItems(child));
      else out.push(child);
    }
    return out;
  }

  /**
   * The element to reorder for a card: the card itself or the nearest
   * box-generating ancestor that is an item of a flex or grid container with
   * siblings, since CSS `order` affects nothing else.
   */
  function sortItemFor(card) {
    var el = card;
    for (var i = 0; i < MAX_SORT_ASCENT && el; i++) {
      var container = layoutParent(el);
      if (!container) return null;
      if (/flex|grid/.test(displayOf(container)) && layoutItems(container).length > 1) {
        return { item: el, container: container };
      }
      el = container;
    }
    return null;
  }

  /**
   * Every layout read sorting needs, done up front so applySort() only writes.
   * @returns {Map<Element, {items: Element[], entries: Array<{item: Element, index: number}>}>}
   */
  function planSort(cards) {
    var groups = new Map();
    var claimed = new Set();
    for (var i = 0; i < cards.length; i++) {
      var found = sortItemFor(cards[i]);
      if (!found || claimed.has(found.item)) continue;
      claimed.add(found.item);
      if (!groups.has(found.container)) {
        groups.set(found.container, { items: layoutItems(found.container), entries: [] });
      }
      groups.get(found.container).entries.push({ item: found.item, index: i });
    }
    return groups;
  }

  function setOrder(el, value) {
    if (!el.hasAttribute('data-ppp-order')) el.setAttribute('data-ppp-order', el.style.order || '');
    el.style.order = String(value);
  }

  function clearSort() {
    var ordered = document.querySelectorAll('[data-ppp-order]');
    for (var i = 0; i < ordered.length; i++) {
      ordered[i].style.order = ordered[i].getAttribute('data-ppp-order');
      ordered[i].removeAttribute('data-ppp-order');
    }
  }

  /**
   * Reorder cards by unit price using CSS `order` rather than moving nodes.
   * The stores render with React and similar frameworks, which break when
   * their nodes are moved behind their back; `order` is purely visual and
   * fully reversible.
   *
   * Cards are permuted only among the slots cards already occupy, so banners
   * and ads between them stay where the store put them.
   *
   * @returns {number} how many containers were reordered
   */
  function applySort(groups, cardVerdicts) {
    var sorted = 0;
    groups.forEach(function (group) {
      var entries = group.entries;
      if (entries.length < 2) return;
      var items = group.items;
      var slotOf = new Map();
      var s;
      for (s = 0; s < items.length; s++) slotOf.set(items[s], s);

      var slots = entries.map(function (e) { return slotOf.get(e.item); }).sort(function (a, b) { return a - b; });
      var ranked = entries.slice().sort(function (a, b) {
        return verdicts.compareVerdicts(cardVerdicts[a.index], cardVerdicts[b.index]) ||
          slotOf.get(a.item) - slotOf.get(b.item);
      });

      for (s = 0; s < items.length; s++) setOrder(items[s], s);
      for (s = 0; s < ranked.length; s++) setOrder(ranked[s].item, slots[s]);
      sorted++;
    });
    return sorted;
  }

  /* ----------------------------------------------------------------- render */

  function ensureBadge(card) {
    var badge = card.querySelector(':scope > .ppp-badge');
    if (badge) return badge;

    badge = document.createElement('span');
    badge.className = 'ppp-badge';
    badge.setAttribute('data-ppp-ui', 'badge');

    // Text label for the best-value card. The border alone would convey the
    // meaning by colour only, which fails WCAG 1.4.1 and is invisible to
    // screen readers.
    var best = document.createElement('span');
    best.className = 'ppp-badge-best';
    badge.appendChild(best);

    var note = document.createElement('span');
    note.className = 'ppp-badge-note';
    badge.appendChild(note);

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
    var note = badge.querySelector('.ppp-badge-note');
    // Shortened beside "New low" so both fit a narrow card without truncating.
    if (label) label.textContent = note && note.textContent ? 'Best' : 'Best value';
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

  function decorate(card, data, verdict, settings, currency, past) {
    var badge = ensureBadge(card);
    var value = badge.querySelector('.ppp-badge-value');
    var flag = badge.querySelector('.ppp-badge-flag');
    var note = badge.querySelector('.ppp-badge-note');

    value.textContent = verdicts.badgeText(verdict, data, currency);
    flag.textContent = verdicts.isUncertain(verdict, data) ? '?' : '';
    note.textContent = past && past.isNewLow ? 'New low' : '';

    badge.setAttribute('data-ppp-state', verdict.state);
    clearBest(card); // re-awarded below, once per scan
    badge.title = buildTooltip(data, verdict, past);
    if (verdict.state === 'unknown' && settings.filterEnabled && !settings.hideUnknown) {
      badge.title += '\nNot hidden: without a size it can\u2019t be priced per unit. ' +
        'Tick \u201cAlso hide items with no listed size\u201d to hide these.';
    }

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

  function buildTooltip(data, verdict, past) {
    var lines = [];
    if (verdict.source === 'site') {
      lines.push('Unit price listed by the merchant: ' + data.unitPrice.raw);
    }
    if (data.price) lines.push('Price read: ' + data.price.raw);
    if (verdict.source !== 'site' && data.quantity) {
      lines.push(
        'Size read: ' +
          quantity.formatQuantity(data.quantity.amount, data.quantity.dimension) +
          ' (from ' + (data.quantitySource || 'title') + ': "' + data.quantity.raw + '")'
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
    if (past) {
      lines.push(
        (past.isNewLow ? 'New low. Previous lowest you\u2019ve seen: ' : 'Lowest you\u2019ve seen: ') +
          past.lowestLabel + ' (' + past.site + ', ' + historyApi.describeAge(past.since, Date.now()) + ')'
      );
    }
    return lines.join('\n');
  }

  /* ---------------------------------------------------------------- history */

  /** Reload the stored history, or drop it when the user has switched it off. */
  function refreshHistory() {
    if (!state.settings || !state.settings.rememberPrices) {
      state.priceHistory = null;
      state.pendingPrices.clear();
      classify();
      return Promise.resolve();
    }
    return historyApi.load().then(function (store) {
      state.priceHistory = store;
      classify();
    });
  }

  function flushHistory() {
    if (state.historyTimer) {
      clearTimeout(state.historyTimer);
      state.historyTimer = null;
    }
    if (!state.pendingPrices.size) return Promise.resolve();
    var observations = Array.from(state.pendingPrices.values());
    state.pendingPrices.clear();
    return historyApi.record(observations);
  }

  /**
   * Compare one card with what was seen before, and queue it to be remembered.
   * Guessed sizes are left out entirely: one misread pack size stored as a
   * record low would make every later sighting of that product look dear.
   */
  function historyFor(data, verdict, currency) {
    if (!state.priceHistory || verdicts.isUncertain(verdict, data)) return null;
    var canonical = verdicts.canonicalPrice(verdict);
    if (!canonical) return null;
    var key = historyApi.keyFor(data.title, currency, canonical.dimension);
    if (!key) return null;

    var queued = state.pendingPrices.get(key);
    if (!queued || canonical.value < queued.price) {
      state.pendingPrices.set(key, { key: key, price: canonical.value, site: adapter.currentSite().label });
      if (!state.historyTimer) state.historyTimer = setTimeout(flushHistory, HISTORY_FLUSH_MS);
    }

    var past = historyApi.compare(state.priceHistory[key], canonical.value);
    if (past) {
      past.lowestLabel =
        verdicts.formatMoney(past.lowest * canonical.base.perBase, currency) + '/' + canonical.base.label;
    }
    return past;
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

  function pageCurrency(analyses) {
    return sites.currencyFor(location, dominantCurrency(analyses));
  }

  /* ------------------------------------------------------------------- scan */

  var EMPTY_STATS = { total: 0, shown: 0, priced: 0, unknown: 0, best: null, currencySymbol: '', hint: '' };

  /**
   * Settings as the panel should see them. Dormancy (not on a Shopping page)
   * hides the panel without touching the user's saved preference.
   */
  function panelView() {
    var view = {};
    Object.keys(state.settings).forEach(function (key) {
      view[key] = state.settings[key];
    });
    view = settingsApi.withCurrency(view, state.currency);
    view.panelVisible = state.settings.panelVisible && isActive();
    return view;
  }

  function renderPanel(stats) {
    if (state.panel && state.settings) state.panel.render(panelView(), stats);
  }

  /** The toolbar icon's count of hidden results; only sent when it changes. */
  function updateToolbarBadge(stats) {
    var hidden = state.settings && state.settings.filterEnabled && stats.total ? stats.total - stats.shown : 0;
    var text = hidden > 999 ? '999+' : hidden > 0 ? String(hidden) : '';
    if (text === state.toolbarBadge) return;
    state.toolbarBadge = text;
    sendToExtension({ type: 'ppp:badge', text: text });
  }

  /**
   * How many cards must be on the page before content alone is enough to
   * activate. A genuine results grid has dozens; a stray price or two on an
   * article or a product page must not be mistaken for one.
   */
  var MIN_CARDS_TO_AUTO_ACTIVATE = 5;

  /** Find the page's cards, then classify them. */
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

    // Activation fallback for when the URL test says no but the page plainly
    // is a results grid. Stores change their results URLs without notice -
    // Google alone has moved between `tbm=shop` and `udm=28` - and a URL-only
    // test then leaves the extension dormant and invisible. Restricted to
    // hosts we have a profile for, so an unknown site never auto-activates on
    // the strength of a few prices.
    var byUrl = state.forced || adapter.isShoppingSurface();
    state.contentActive = !byUrl && adapter.currentSite().id !== 'generic' &&
      cards.length >= MIN_CARDS_TO_AUTO_ACTIVATE;

    if (!isActive()) {
      reset();
      state.lastStats = EMPTY_STATS;
      renderPanel(EMPTY_STATS);
      updateToolbarBadge(EMPTY_STATS);
      return;
    }
    state.cards = cards;
    classify();
  }

  /**
   * Re-evaluate the cards already found. Settings changes land here rather
   * than in scan(): a new threshold cannot change which cards exist, only how
   * they are judged, so re-walking the document for it was wasted work on
   * every keystroke.
   */
  function classify() {
    if (!state.settings) return;
    if (!isActive()) {
      renderPanel(EMPTY_STATS);
      updateToolbarBadge(EMPTY_STATS);
      return;
    }

    var cards = state.cards.filter(function (card) { return card.isConnected; });
    state.cards = cards;

    var analyses = cards.map(analyzeCard);
    var currency = pageCurrency(analyses);
    var pageSettings = settingsApi.withCurrency(state.settings, currency);
    state.currency = currency;
    var cardVerdicts = analyses.map(function (data) {
      return verdicts.evaluate(data, pageSettings);
    });
    var histories = analyses.map(function (data, index) {
      return historyFor(data, cardVerdicts[index], currency);
    });

    // Layout reads, all before the first write below.
    var sortPlan = pageSettings.sortByUnitPrice ? planSort(cards) : null;
    patchPositions(cards);

    var stats = { total: cards.length, shown: 0, priced: 0, unknown: 0, unsizedShown: 0, newLows: 0, best: null };
    var bestVerdict = null;
    var i;
    state.bestCard = null;

    for (i = 0; i < cards.length; i++) {
      var verdict = cardVerdicts[i];
      var hidden = decorate(cards[i], analyses[i], verdict, pageSettings, currency, histories[i]);
      if (histories[i] && histories[i].isNewLow) stats.newLows++;

      if (!hidden) stats.shown++;
      if (!hidden && verdict.state === 'unknown') stats.unsizedShown++;
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
        label: verdicts.formatMoney(bestVerdict.unitPrice, currency) + '/' + bestVerdict.base.label
      };
    }

    clearSort();
    var sortedGroups = sortPlan ? applySort(sortPlan, cardVerdicts) : 0;

    stats.currencySymbol = verdicts.currencySymbol(currency);
    stats.limitLabel = verdicts.formatMoney(pageSettings.threshold, currency);
    if (orphaned()) {
      stats.hint = 'Extension updated \u2013 reload this page to save changes.';
    } else if (sortPlan && !sortedGroups && cards.length > 1) {
      stats.hint = 'This page\u2019s layout can\u2019t be reordered.';
    } else if (!adapter.isShoppingSurface()) {
      stats.hint = 'Not a recognised results page \u2013 results may be mixed.';
    } else {
      stats.hint = '';
    }

    var lookupCount = 0;
    for (i = 0; i < cards.length; i++) {
      if (analyses[i].productUrl && !detailAttempts.has(cards[i])) lookupCount++;
    }
    if (lookupCount || state.detailLookupBusy || state.lastLookup) {
      stats.detailLookup = {
        count: Math.min(lookupCount, MAX_DETAIL_LOOKUPS),
        busy: state.detailLookupBusy,
        result: state.lastLookup
      };
    }
    state.lastStats = stats;
    renderPanel(stats);
    updateToolbarBadge(stats);
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
    clearSort();
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
        // The toolbar override is an escape hatch for an unrecognised search
        // URL, not permission to annotate every subsequent SPA route.
        state.forced = false;
        state.lastLookup = null;
        // The service worker clears the toolbar count whenever the tab reports
        // "loading", which includes pushState navigations; always resend it.
        state.toolbarBadge = null;
        reset();
        // Products from the page just left become history for this one.
        flushHistory().then(refreshHistory);
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
   * Whether this script has outlived its extension (updated, reloaded or
   * removed while the page stayed open). Filtering still works from memory,
   * but nothing can be saved, so the user is told to reload. Only meaningful
   * where chrome.* exists at all.
   */
  function orphaned() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !settingsApi.contextAlive();
  }

  function isActive() {
    return state.forced || adapter.isShoppingSurface() || state.contentActive;
  }

  function applySettings(patch) {
    var wasRemembering = state.settings.rememberPrices;
    // Copied because the panel may still hold this object in its debounce.
    var changes = Object.assign({}, patch);
    if (Object.prototype.hasOwnProperty.call(changes, 'basis')) {
      // Converts the saved limits too, so "$3/lb" becomes "$6.614/kg" rather
      // than "$3/kg".
      state.settings = settingsApi.setBasis(state.settings, changes.basis);
      delete changes.basis;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'threshold')) {
      state.settings = settingsApi.setThreshold(state.settings, state.currency, changes.threshold);
      delete changes.threshold;
    }
    Object.keys(changes).forEach(function (key) {
      state.settings[key] = changes[key];
    });
    state.settings = settingsApi.sanitize(state.settings);
    settingsApi.save(state.settings);
    if (state.settings.rememberPrices !== wasRemembering) refreshHistory();
    else classify();
  }

  /**
   * Message the service worker. Resolves with its reply, or null when there is
   * no extension to talk to - including after an update has orphaned this
   * script, when sendMessage throws rather than failing politely.
   */
  function sendToExtension(message) {
    return new Promise(function (resolve) {
      if (!settingsApi.contextAlive() || !chrome.runtime.sendMessage) {
        resolve(null);
        return;
      }
      try {
        chrome.runtime.sendMessage(message, function (response) {
          resolve(chrome.runtime.lastError ? null : response);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  function openOptions() {
    // Content scripts cannot call openOptionsPage() themselves.
    sendToExtension({ type: 'ppp:open-options' }).then(function (response) {
      if (!response) classify(); // shows the "reload this page" hint
    });
  }

  function requestProductPage(url) {
    return sendToExtension({ type: 'ppp:fetch-product-page', url: url }).then(function (response) {
      return response && response.ok && typeof response.html === 'string' ? response.html : null;
    });
  }

  /** A microdata value, from its `content` attribute or its text. */
  function itemValue(el) {
    return el ? (el.getAttribute('content') || el.textContent || '').trim() : '';
  }

  /** Extract only explicit structured product fields from untrusted HTML. */
  function detailSizeCandidates(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var candidates = [];
    var nodes = doc.querySelectorAll('[itemprop="weight"], meta[name="product:weight"], meta[property="product:weight"]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      // A Schema.org QuantitativeValue in microdata keeps the number and the
      // unit in nested properties, not on the element itself.
      if (node.hasAttribute('itemscope')) {
        candidates.push(productData.structuredSizeText({
          value: itemValue(node.querySelector('[itemprop="value"]')),
          unitCode: itemValue(node.querySelector('[itemprop="unitCode"]')),
          unitText: itemValue(node.querySelector('[itemprop="unitText"]'))
        }));
      } else {
        candidates.push(itemValue(node));
      }
    }
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var s = 0; s < scripts.length; s++) {
      try {
        candidates.push.apply(candidates, productData.sizesFromJsonLd(JSON.parse(scripts[s].textContent)));
      } catch (error) {
        /* invalid vendor JSON */
      }
    }
    return candidates;
  }

  /** Fetch one card's product page and keep the first explicit size it declares. */
  /** @returns {Promise<boolean>} whether a size was found */
  async function lookUpPackageSize(candidate) {
    detailAttempts.add(candidate.card);
    var html = await requestProductPage(candidate.url);
    if (!html) return false;
    var values = detailSizeCandidates(html);
    for (var k = 0; k < values.length; k++) {
      var parsed = quantity.parseQuantity(values[k]);
      if (!parsed) continue;
      parsed.confidence = Math.min(parsed.confidence, 0.75);
      parsed.flags = parsed.flags.concat(['product-detail']);
      detailQuantities.set(candidate.card, parsed);
      analysisCache.delete(candidate.card);
      return true;
    }
    return false;
  }

  async function findPackageSizes() {
    if (state.detailLookupBusy) return;
    var queue = [];
    for (var i = 0; i < state.cards.length && queue.length < MAX_DETAIL_LOOKUPS; i++) {
      var card = state.cards[i];
      var data = analyzeCard(card);
      if (data.productUrl && !detailAttempts.has(card)) queue.push({ card: card, url: data.productUrl });
    }
    if (!queue.length) return;

    var result = { tried: queue.length, found: 0 };
    async function worker() {
      while (queue.length) {
        try {
          if (await lookUpPackageSize(queue.shift())) result.found++;
        } catch (error) {
          // One malformed page must not abandon the rest of the queue.
        }
      }
    }

    state.detailLookupBusy = true;
    state.lastLookup = null;
    // classify() rather than re-rendering the last stats, which predate the
    // busy flag and would leave the button enabled mid-lookup.
    classify();
    try {
      var workers = [];
      for (var w = 0; w < DETAIL_LOOKUP_CONCURRENCY; w++) workers.push(worker());
      await Promise.all(workers);
    } finally {
      // A throw anywhere above would otherwise leave the flag set, and the
      // panel would stay on "Looking for package sizes..." with the button
      // disabled for the rest of the page's life.
      state.detailLookupBusy = false;
      // Without a result the button simply vanished or came back, and a
      // lookup that found nothing was indistinguishable from one that failed.
      state.lastLookup = result;
      classify();
    }
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
      onJumpToBest: jumpToBest,
      onFindSizes: findPackageSizes,
      onOpenOptions: openOptions
    });
    state.panel.mount();

    settingsApi.subscribe(function (next) {
      // Our own saves echo back through onChanged; skip them.
      if (JSON.stringify(next) === JSON.stringify(settingsApi.sanitize(state.settings))) return;
      var wasRemembering = state.settings.rememberPrices;
      state.settings = next;
      if (next.rememberPrices !== wasRemembering) refreshHistory();
      else classify();
    });

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        // Cleared from the options page: stop citing prices that are gone.
        var change = changes[historyApi.STORAGE_KEY];
        if (areaName !== 'local' || !change || change.newValue) return;
        state.pendingPrices.clear();
        if (state.priceHistory) state.priceHistory = {};
        classify();
      });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushHistory();
    });
    // A page restored from the back/forward cache keeps this script's state,
    // but the service worker cleared the toolbar count when the tab moved on.
    window.addEventListener('pageshow', function (event) {
      if (!event.persisted) return;
      state.toolbarBadge = null;
      classify();
    });

    startObserver();
    window.addEventListener('popstate', scheduleScan);
    scheduleScan();
    refreshHistory();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== 'ppp:toggle-panel' || !state.settings) return;
      // Judge by what the user can see: on a dormant page the saved preference
      // may say "visible" while nothing is shown.
      var showing = panelView().panelVisible;
      if (showing) {
        applySettings({ panelVisible: false });
        return;
      }
      // Opening from the toolbar is also the escape hatch for when a store
      // changes its results URL patterns and auto-detection stops firing.
      // Closing must not opt the page in, so only this branch forces.
      state.forced = true;
      applySettings({ panelVisible: true });
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
