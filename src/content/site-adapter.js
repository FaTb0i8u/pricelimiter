/**
 * Storefront DOM adapter.
 *
 * Cards are located by whichever strategy the active site profile calls for
 * (see sites.js):
 *
 *   - an explicit `cardSelector`, where the store ships stable semantic markup;
 *   - otherwise a structural walk that contains ZERO hard-coded selectors for
 *     store markup:
 *       1. find text nodes that look like a price;
 *       2. for each, walk up while the parent still contains at most one
 *          product-sized image;
 *       3. the highest such ancestor is the product card - the largest box that
 *          wraps exactly one product photo and this price.
 *
 * Both strategies degrade safely: if they stop matching we find zero cards and
 * the UI says so, rather than corrupting the page. A `cardSelector` that
 * matches nothing falls back to the structural walk.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});
  var price = PPP.price;
  var sites = PPP.sites;

  var MAX_ASCENT = 30;
  var MAX_PRICE_TEXT_LENGTH = 60;
  var MAX_CARD_TEXT_LENGTH = 1200;
  var MIN_CARD_SIZE_PX = 60;

  /**
   * Minimum rendered edge for an image to count as the product photo.
   *
   * Real Google Shopping cards contain several images besides the product:
   * a merchant logo (Walmart / Target / GNC ...), a "Nearby" map pin, badge
   * glyphs. Those are all small. Counting every <img> made the card detector
   * stop inside the card and find almost nothing, so only images at least this
   * big on each edge are treated as product photos.
   */
  var MIN_PRODUCT_IMAGE_PX = 40;

  /** Money strings inside a card that are NOT the item price. */
  var NON_PRICE_CONTEXT_RE =
    /(delivery|shipping|\/\s*mo\b|per month|monthly|was\s|save\s|\d+%\s*off|used\s|refurb|cashback|coupon|rrp|list price|orig(inal)?\s*price)/i;

  /**
   * A price ceiling in promotional copy - "Find yummy fall faves under $3" -
   * names no product's price. Walmart drops banners like that into the grid,
   * and reading one as a card added an unpriceable "result" to every page.
   */
  var PRICE_CEILING_RE = new RegExp(
    '\\b(?:under|below|less than|up to)\\s*[' + price.SYMBOL_CHARS + ']\\s?\\d', 'i');

  /** The profile for the current page. */
  function currentSite() {
    return sites.forLocation(typeof location !== 'undefined' ? location : null);
  }

  function isShoppingSurface(loc) {
    return sites.isResultsPage(loc || (typeof location !== 'undefined' ? location : null));
  }

  function getScanRoot() {
    var roots = currentSite().scanRoots;
    for (var i = 0; i < roots.length; i++) {
      var found = document.querySelector(roots[i]);
      if (found) return found;
    }
    return document.body;
  }

  function isVisible(el) {
    var rect = el.getBoundingClientRect();
    return rect.width >= MIN_CARD_SIZE_PX && rect.height >= MIN_CARD_SIZE_PX;
  }

  /**
   * Rendered size of an image, falling back to its intrinsic or declared size
   * while it is still lazy-loading and has no layout box yet.
   * @returns {{width: number, height: number}}
   */
  function imageSize(img) {
    var rect = img.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { width: rect.width, height: rect.height };
    }
    return {
      width: img.naturalWidth || parseInt(img.getAttribute('width'), 10) || 0,
      height: img.naturalHeight || parseInt(img.getAttribute('height'), 10) || 0
    };
  }

  function isProductImage(img) {
    var size = imageSize(img);
    return size.width >= MIN_PRODUCT_IMAGE_PX && size.height >= MIN_PRODUCT_IMAGE_PX;
  }

  /** Elements holding a price-looking text node, in document order. */
  function collectPriceElements(scanRoot) {
    var walker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var value = node.nodeValue;
        if (!value || value.length > MAX_PRICE_TEXT_LENGTH) return NodeFilter.FILTER_REJECT;
        if (!price.looksLikePrice(value)) return NodeFilter.FILTER_REJECT;
        if (PRICE_CEILING_RE.test(value)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    var out = [];
    var seen = new Set();
    var node;
    while ((node = walker.nextNode())) {
      var el = node.parentElement;
      if (!el || seen.has(el)) continue;
      if (el.closest('[data-ppp-ui]')) continue; // never read our own badges
      seen.add(el);
      out.push(el);
    }
    return out;
  }

  /** Map of ancestor element -> number of descendant PRODUCT images. */
  function buildImageCounts(scanRoot) {
    var counts = new Map();
    var images = scanRoot.querySelectorAll('img');
    for (var i = 0; i < images.length; i++) {
      if (!isProductImage(images[i])) continue;
      var el = images[i];
      var guard = 0;
      while (el && el !== scanRoot.parentElement && guard++ < MAX_ASCENT + 20) {
        counts.set(el, (counts.get(el) || 0) + 1);
        el = el.parentElement;
      }
    }
    return counts;
  }

  /**
   * Selectors that mark an element as user-activatable.
   *
   * Sponsored PLA units are real anchors, but Google's organic Shopping tiles
   * are plain `<div role="listitem">` that open a side panel through JS. They
   * expose no href at all, so an anchor-only test silently rejected every
   * organic result and only the ad carousel was ever filtered. These are the
   * hooks such a tile does carry.
   */
  var INTERACTIVE_SELECTOR =
    'a[href], button, [role="button"], [role="link"], [jsaction], [tabindex], [onclick]';

  /**
   * A product card must be activatable, but the hook may sit on the card, on
   * an ancestor (anchor-wrapped layouts) or on a descendant (JS-driven tiles),
   * so all three directions are accepted.
   */
  function isInteractive(el) {
    return (
      el.matches(INTERACTIVE_SELECTOR) ||
      !!el.querySelector(INTERACTIVE_SELECTOR) ||
      !!el.closest('a[href]')
    );
  }

  /**
   * Walk up from a price to the element that best represents the whole card.
   *
   * The ascent stops when a parent holds more than one product image, which
   * means the grid row has been reached. That rule alone is not enough: Google
   * wraps each organic tile in several single-child containers, and the
   * outermost of those can be a ZERO-SIZE layout wrapper. Testing only the
   * final element therefore threw the whole card away - measured on live
   * Google Shopping, 25 of 40 organic results were lost this way, which is
   * exactly the "only sponsored results get filtered" symptom.
   *
   * So every acceptable element on the path is remembered, and the highest
   * VISIBLE one wins. The walk still climbs as far as it legitimately can, but
   * overshooting into a wrapper with no layout box no longer costs the card.
   */
  function findCardForPrice(priceEl, counts, scanRoot) {
    var el = priceEl;
    var guard = 0;
    var card = null;

    while (el.parentElement && el !== scanRoot && guard++ < MAX_ASCENT) {
      var parent = el.parentElement;
      if (parent === scanRoot || parent === document.body) break;
      if ((counts.get(parent) || 0) > 1) break;
      el = parent;
      if ((counts.get(el) || 0) === 1 && isVisible(el)) card = el;
    }

    if (!card) return null;
    if (!isInteractive(card)) return null;
    if (card.textContent.length > MAX_CARD_TEXT_LENGTH) return null;
    return card;
  }

  /**
   * Cards from the site's own markup.
   *
   * Nested matches are dropped: Amazon and Walmart both sometimes render a
   * result inside another matching container, and keeping both would badge the
   * same product twice and let one card hide its own parent.
   *
   * @returns {HTMLElement[]}
   */
  function findCardsBySelector(scanRoot, selector) {
    var matched = scanRoot.querySelectorAll(selector);
    var kept = [];
    for (var i = 0; i < matched.length; i++) {
      var el = matched[i];
      if (el.closest('[data-ppp-ui]')) continue;
      if (!isVisible(el)) continue;
      // A card with no price is not a product tile (Walmart tags banners and
      // placeholders with the same attribute).
      if (!price.looksLikePrice(el.textContent)) continue;
      var outer = el.parentElement && el.parentElement.closest(selector);
      if (outer && outer !== scanRoot && scanRoot.contains(outer)) continue;
      kept.push(el);
    }
    return kept;
  }

  /** Cards found structurally, for sites with no stable markup. */
  function findCardsStructurally(scanRoot) {
    var counts = buildImageCounts(scanRoot);
    var priceElements = collectPriceElements(scanRoot);
    var cards = [];
    var seen = new Set();

    for (var i = 0; i < priceElements.length; i++) {
      var card = findCardForPrice(priceElements[i], counts, scanRoot);
      if (!card || seen.has(card)) continue;
      seen.add(card);
      cards.push(card);
    }
    return cards;
  }

  /**
   * Both detection strategies against one root, unioned.
   *
   * The selector strategy used to win outright whenever it matched anything.
   * That is wrong on every store tested, because a store's card attribute only
   * tags its MAIN result grid: Amazon's `[data-component-type="s-search-result"]`
   * does not tag the sponsored carousels above and beside it. Matching 59 main
   * results therefore suppressed the structural walk entirely, and the carousel
   * tiles - which carry real prices like "$44.99 ($1.41 / ounce)", $22.56/lb
   * against an $8/lb limit - were never scanned, never badged, and never
   * hidden. To the user that reads exactly as "the filter ignores some rows".
   *
   * Running both and merging costs one extra walk and keeps the selector's
   * precision where it applies. Selector hits are added first so that they win
   * ties, and any structural result that sits inside or around a selector hit
   * is dropped rather than double-counted.
   */
  function findCardsIn(scanRoot) {
    var selector = currentSite().cardSelector;
    var cards = selector ? findCardsBySelector(scanRoot, selector) : [];
    var structural = findCardsStructurally(scanRoot);
    if (!structural.length) return cards;

    // Every accepted card and all of its ancestors: a later hit found in this
    // set is equal to, or wraps, a card already taken.
    var covered = new Set();
    var chosen = new Set(cards);
    function accept(card) {
      chosen.add(card);
      for (var up = card; up && !covered.has(up); up = up.parentElement) covered.add(up);
    }
    for (var i = 0; i < cards.length; i++) accept(cards[i]);

    for (var j = 0; j < structural.length; j++) {
      var el = structural[j];
      if (covered.has(el) || insideAny(el, chosen)) continue;
      cards.push(el);
      accept(el);
    }
    return cards;
  }

  function insideAny(el, set) {
    if (!set.size) return false;
    for (var up = el.parentElement; up; up = up.parentElement) {
      if (set.has(up)) return true;
    }
    return false;
  }

  /** @returns {HTMLElement[]} product cards currently rendered on the page. */
  function findCards() {
    var scanRoot = getScanRoot();
    if (!scanRoot) return [];

    var cards = findCardsIn(scanRoot);

    // `getScanRoot` returns the first selector that MATCHES, which is not the
    // same as the one that CONTAINS the grid. If a store keeps a `role="main"`
    // wrapper but moves results out of it, the chosen root is real, empty, and
    // wrong - and the walk above quietly returns nothing. Google is the most
    // exposed, being the only site with no card selector to fall back on.
    // Retrying from the body costs one extra walk on a page that was about to
    // show zero results anyway.
    if (!cards.length && scanRoot !== document.body && document.body) {
      cards = findCardsIn(document.body);
    }
    return cards;
  }

  function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * An element's text with element boundaries preserved as spaces.
   *
   * `textContent` welds adjacent elements together, because the markup carries
   * no whitespace between them: Google's tile yields `"$33.43$1.67/ctWalmart"`.
   * The unit-price tail is then read as `"ct"` immediately followed by a
   * letter, which the parser rejects as a truncated unit -- so a card that
   * visibly reads "$1.67/ct" was reported as having no size at all. Measured
   * live, 44 tiles carried a merchant unit price that was thrown away this way.
   *
   * Joining on the node boundary restores the separation the user actually
   * sees. Prices that stores split ACROSS nodes still parse, because the tail
   * pattern tolerates whitespace: Amazon's `"$1.41"` + `"/ ounce)"` becomes
   * `"$1.41 / ounce)"` and reads correctly.
   */
  function spacedText(el) {
    if (!el) return '';
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var parts = [];
    var node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest('[data-ppp-ui]')) continue;
      var value = cleanText(node.nodeValue);
      if (value) parts.push(value);
    }
    return parts.join(' ');
  }

  /**
   * Where a whole-card aria-label stops being the product name.
   *
   * Organic tiles expose no heading; the product name is only available as the
   * opening sentence of a summary label:
   *
   *   "Dymatize ISO 100 Protein.  Nearby, 9 mi. Current Price: $139.99. $28/lb."
   *
   * Everything after that first sentence is metadata. The size parser already
   * refuses to read "$28/lb" as a 28 lb pack, so this is defence in depth
   * rather than a fix for a known miscalculation: it keeps unrelated numbers in
   * the metadata away from the parser, and keeps the name shown in the badge
   * tooltip readable instead of a paragraph of delivery and rating text.
   *
   * Google separates the name with a period plus TWO spaces; the explicit
   * phrases are a fallback in case that spacing changes. A single space after a
   * period is deliberately not a cut point, so "Dr. Pepper" and sizes like
   * "5.15 lbs" survive intact.
   */
  var ARIA_TITLE_CUT_RE =
    /\.\s{2,}|\.\s+(?=Current Price|Nearby,|Rated\b|Free delivery|Same-day|Was\b|\$)/i;

  function titleFromAriaLabel(value) {
    return cleanText(String(value || '').split(ARIA_TITLE_CUT_RE)[0]);
  }

  /** Money, including any "/lb"-style tail, for stripping out of raw text. */
  var PRICE_TOKEN_RE = new RegExp(
    '[' + price.SYMBOL_CHARS + ']\\s?[\\d.,]+(?:\\s*/\\s*[a-z ]{1,6})?',
    'gi'
  );

  /**
   * The longest aria-label inside a card, which is the one describing the whole
   * card rather than an icon button such as "Add to list".
   */
  function longestAriaLabel(card) {
    var labelled = card.querySelectorAll('[aria-label]');
    var best = '';
    for (var i = 0; i < labelled.length; i++) {
      var value = labelled[i].getAttribute('aria-label') || '';
      if (value.length > best.length) best = value;
    }
    return best;
  }

  /**
   * Best-effort product title. Ordered by how much the store is willing to
   * guarantee about each source, most reliable first.
   */
  function extractTitle(card) {
    var candidates = [];
    var i;

    // The site's own title element, where it has a dependable one.
    var selectors = currentSite().titleSelectors || [];
    for (i = 0; i < selectors.length; i++) {
      var owned = card.querySelector(selectors[i]);
      if (owned) candidates.push(spacedText(owned));
    }

    var heading = card.querySelector('[role="heading"], h1, h2, h3, h4');
    if (heading) candidates.push(spacedText(heading));

    var labelled = card.querySelector('a[aria-label]');
    if (labelled) candidates.push(titleFromAriaLabel(labelled.getAttribute('aria-label')));

    candidates.push(titleFromAriaLabel(longestAriaLabel(card)));

    var image = card.querySelector('img[alt]');
    if (image) candidates.push(cleanText(image.getAttribute('alt')));

    var link = card.querySelector('a[href]');
    if (link) candidates.push(spacedText(link));

    for (i = 0; i < candidates.length; i++) {
      if (candidates[i] && candidates[i].length >= 8) return candidates[i];
    }
    // Last resort: the raw card text. Money is stripped first so that a price
    // sitting flush against the name cannot leak into the size parser.
    //
    // `spacedText` rather than `textContent` for the same reason as everywhere
    // else: a size chip in its own element welds onto the sentence before it,
    // giving "...Grass-Fed Cows.1 KG". The parser rejects that, correctly - a
    // digit glued to a full stop is not safely a quantity - so the card lost
    // its only size and could not be filtered.
    return spacedText(card).replace(PRICE_TOKEN_RE, ' ').slice(0, 300);
  }

  /**
   * A struck-through original price, e.g. "Was $51.97", "List price $89".
   *
   * These are removed from the text before parsing rather than used to reject
   * the whole text node, because stores commonly put the current price and the
   * old price in the SAME node. Walmart's accessible price label reads
   * "current price Now $46.72, Was $51.97"; rejecting it outright threw away
   * the only node that contained the real price.
   */
  var WAS_PRICE_RE = new RegExp(
    '\\b(?:was|list price|orig(?:inal)?\\s*price|reg(?:ular)?\\s*price|compare at)\\b\\s*:?\\s*' +
      '[' + price.SYMBOL_CHARS + ']\\s?[\\d.,]+',
    'gi'
  );

  function stripWasPrices(text) {
    return String(text || '').replace(WAS_PRICE_RE, ' ');
  }

  /**
   * Whether an element is rendered with a line through it.
   *
   * Computed style is checked rather than just `s`/`del`/`strike` tags because
   * Walmart marks its pre-discount price with `class="strike"` on a plain
   * `<span>`. A tag-only test missed it and the extension reported $51.97 for
   * an item actually selling at $46.72 -- i.e. it hid the discount it exists to
   * find. The decoration is painted by an ancestor, so a few levels are walked.
   */
  function isStruckThrough(el) {
    if (el.closest('s, del, strike')) return true;
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 4) {
      var style = window.getComputedStyle(node);
      var line = style.textDecorationLine || style.textDecoration || '';
      if (line.indexOf('line-through') !== -1) return true;
      node = node.parentElement;
    }
    return false;
  }

  /** How much text either side of a price counts as describing it. */
  var CONTEXT_RADIUS = 40;

  /**
   * The words around a price, for telling "+$5.99 delivery" from the item
   * price. Normally the parent's text, which holds a label like "delivery" in
   * a sibling node.
   *
   * But on Walmart the price's parent is the whole card, and every card says
   * "Free shipping" or "Delivery today" somewhere. Reading all of it rejected
   * the real price on every such card, leaving cards with no item price at
   * all. So a long parent contributes only the text near the price.
   */
  function priceContext(el, own) {
    var parent = el.parentElement;
    var text = cleanText((parent ? parent.textContent : own) || '');
    if (text.length <= CONTEXT_RADIUS * 3) return text;
    var needle = cleanText(own);
    var at = needle ? text.indexOf(needle) : -1;
    if (at === -1) return needle;
    return text.slice(Math.max(0, at - CONTEXT_RADIUS), at + needle.length + CONTEXT_RADIUS);
  }

  /**
   * The item's own price, ignoring delivery fees, struck-through originals and
   * financing figures.
   */
  function extractPrice(card) {
    var walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var value = node.nodeValue;
        if (!value || value.length > MAX_PRICE_TEXT_LENGTH) return NodeFilter.FILTER_REJECT;
        return price.looksLikePrice(value) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    var node;
    while ((node = walker.nextNode())) {
      var el = node.parentElement;
      if (!el || el.closest('[data-ppp-ui]')) continue;
      if (isStruckThrough(el)) continue;

      var text = stripWasPrices(node.nodeValue);
      if (!price.looksLikePrice(text)) continue;

      if (NON_PRICE_CONTEXT_RE.test(stripWasPrices(priceContext(el, node.nodeValue)))) continue;

      var parsed = price.parsePrice(text);
      if (parsed) return parsed;
    }
    return null;
  }

  /**
   * The unit price the store itself prints on the card ("$28/lb", "$1.22/oz",
   * "($1.41/ounce)", "$3.00/ct").
   *
   * This is authoritative -- the merchant declared it -- so it always beats a
   * size inferred from the title. Reading the card's combined text rather than
   * individual nodes is deliberate: every store tested splits the number and
   * the unit across sibling elements at least some of the time. Amazon is the
   * worst case, putting "$1.41" in a visually-hidden span and "/ ounce)" in a
   * separate text node.
   */
  function extractUnitPrice(card) {
    return price.parseUnitPrice(spacedText(card));
  }

  /*
   * Merchants spell the pack size out in their own product path:
   * "/p/optimum-nutrition-100-whey-gold-standard-french-vanilla-creme-2-lb-powder/op-2054".
   * Google renders no size on that card at all, so the outgoing link is the
   * only place the weight exists short of opening the listing. Measured on a
   * live search, 9 of 46 otherwise unsized cards carried a readable size here.
   *
   * The path is normalised into ordinary prose and handed to the usual
   * quantity parser rather than being matched directly, so the serving-size
   * and multipack rules apply to it too.
   */
  var URL_UNIT = 'lbs?|pounds?|oz|ounces?|kgs?|kilograms?|g|grams?|ml|l|liters?|litres?';
  // "1-98-lb" and "2-27-kg" are decimals written with the slug separator.
  var URL_DECIMAL_RE = new RegExp('(\\d+)-(\\d+)(?=-(?:' + URL_UNIT + ')(?:[-/.]|$))', 'gi');
  // "24-g-protein" is a nutrition claim, not a pack size.
  var URL_NUTRIENT_RE =
    /\b\d+(?:\.\d+)?\s*m?c?g\s+(?:of\s+)?(?:protein|carbs?|carbohydrates?|sugars?|fat|fibre|fiber|sodium|bcaas?|eaas?|creatine|collagen|caffeine)\b/gi;
  var GOOGLE_HOST_RE = /(^|\.)google\.[a-z.]+$/i;
  var MAX_URL_TOKEN_LENGTH = 15;

  /**
   * A pack size is always a plain number beside a plain word. Anything mixing
   * letters and digits is an identifier - an ASIN, a SKU, a base64 ad token -
   * and anything long is not a word at all.
   *
   * This is what stops Amazon's ad tracker,
   * "aax-us-east-retail-direct.amazon.com/x/c/JHrsSGNLByjPTyZ4KDRtFtkAAAGf42__lAEAAA...",
   * from splitting into "42" and "l" and being read as 42 litres. It cost
   * three real products a correct size on the first live run.
   */
  function isReadableToken(token) {
    if (!token || token.length > MAX_URL_TOKEN_LENGTH) return false;
    return !(/\d/.test(token) && /[a-z]/i.test(token));
  }

  /**
   * Normalise one absolute merchant URL into prose a quantity parser can read.
   * Returns '' for relative links, non-http schemes and Google's own redirect
   * wrappers, none of which describe a product.
   *
   * Path segments are kept apart by a pipe so a number at the end of one
   * segment can never pair with a unit at the start of the next.
   */
  function sizeTextFromUrl(href) {
    if (!href || href.charAt(0) === '/' || href.indexOf('//') === 0) return '';

    var parsed;
    try {
      parsed = new URL(href);
    } catch (e) {
      return '';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (GOOGLE_HOST_RE.test(parsed.hostname)) return '';

    var path = parsed.pathname;
    try {
      path = decodeURIComponent(path);
    } catch (e) {
      /* a stray percent sign; the raw path is still worth reading */
    }

    var segments = path.split('/');
    var readable = [];
    for (var i = 0; i < segments.length; i++) {
      var tokens = segments[i]
        .replace(URL_DECIMAL_RE, '$1.$2')
        .replace(/[_+-]+/g, ' ')
        .split(/\s+/);

      var kept = [];
      for (var j = 0; j < tokens.length; j++) {
        if (isReadableToken(tokens[j])) kept.push(tokens[j]);
      }
      if (kept.length) readable.push(kept.join(' '));
    }

    return readable.join(' | ').replace(URL_NUTRIENT_RE, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Store ad trackers that wrap the real product link, and the parameter
   * holding it: Walmart's sponsored tiles go through
   * "/sp/track?...&rd=https://www.walmart.com/ip/...", Amazon's through
   * "/sspa/click?...&url=/Product-Name/dp/...". Read as-is, the tracker's own
   * path ("sp | track") looked like a URL with nothing in it, and the product
   * page behind it was never reached - 4 of the 5 unsized cards on a live
   * Walmart search were sponsored tiles like this.
   */
  var TRACKER_PATH_RE = /^\/(?:sp\/track|sspa\/click)(?:\/|$)/i;
  /** Walmart "/ip/<slug>/<id>" and Amazon "/<slug>/dp/<ASIN>" product pages. */
  var STORE_PRODUCT_PATH_RE = /^\/(?:ip\/|[^/]+\/dp\/|dp\/|gp\/product\/|gp\/aw\/d\/)/i;

  /**
   * The URL a redirect wrapper points at, resolved against the wrapper's own
   * origin (Amazon's is relative). The input itself when it is not a
   * wrapper; null when it is one but carries no usable http(s) target.
   * @param {URL} parsed
   * @returns {URL|null}
   */
  function unwrapRedirect(parsed) {
    var params;
    var google = GOOGLE_HOST_RE.test(parsed.hostname);
    if (google) params = ['adurl', 'url', 'q'];
    else if (TRACKER_PATH_RE.test(parsed.pathname)) params = ['rd', 'url'];
    else return parsed;

    for (var i = 0; i < params.length; i++) {
      var inner = parsed.searchParams.get(params[i]);
      if (!inner) continue;
      try {
        // Only a store tracker's target may be relative (Amazon's is). On
        // Google, `q` is usually the search text: resolved against google.com,
        // "whey protein" became a plausible-looking product URL and hid the
        // real merchant link that came after it.
        var target = google ? new URL(inner) : new URL(inner, parsed.origin);
        if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
        if (google && GOOGLE_HOST_RE.test(target.hostname)) continue;
        return target;
      } catch (e) {
        /* not a URL; try the next parameter */
      }
    }
    return null;
  }

  /** Merchant URLs reachable from a card, unwrapping ad redirects. */
  function extractUrlSizeText(card) {
    var links = card.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      var text;

      var resolved = null;
      try {
        resolved = new URL(href, location.href);
      } catch (e) {
        /* unparseable; the raw-string checks below still apply */
      }
      // A wrapper is never read as if it were the product, even when it turns
      // out to point nowhere usable.
      var unwrapped = resolved ? unwrapRedirect(resolved) : null;
      if (resolved && unwrapped !== resolved) {
        text = unwrapped ? sizeTextFromUrl(unwrapped.href) : '';
        if (text) return text;
        continue;
      }

      // A store's own relative product link names the product:
      // "/ip/PEScience-Select-Protein-...-Vanilla-1-85-lb/123". Other relative
      // links (Google's "/shopping/...", "/search?q=") do not, so only these
      // product paths are read.
      if (resolved && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) && STORE_PRODUCT_PATH_RE.test(resolved.pathname)) {
        text = sizeTextFromUrl(resolved.href);
        if (text) return text;
      }

      text = sizeTextFromUrl(href);
      if (text) return text;

      var wrapped = href.match(/[?&](?:adurl|url|q|rd)=([^&]+)/);
      if (!wrapped) continue;
      var inner;
      try {
        inner = decodeURIComponent(wrapped[1]);
      } catch (e) {
        continue;
      }
      text = sizeTextFromUrl(inner);
      if (text) return text;
    }
    return '';
  }

  /**
   * The first product-detail URL represented by a card. This deliberately
   * returns only http(s) URLs: callers may hand it to the extension service
   * worker for a user-requested lookup, so data: and javascript: URLs must
   * never escape the page.
   */
  function extractProductUrl(card) {
    var links = card.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].href || links[i].getAttribute('href') || '';
      var parsed;
      try {
        parsed = new URL(href, location.href);
      } catch (e) {
        continue;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;

      // Google wraps merchant URLs in `adurl`, `url` or `q`, and Walmart and
      // Amazon wrap sponsored results in click trackers. Unwrap them so the
      // background makes a permission-scoped request for the product page
      // itself, rather than fetching a redirect (or registering an ad click).
      parsed = unwrapRedirect(parsed);
      if (!parsed) continue;
      return parsed.href;
    }
    return '';
  }

  /** Text used for size extraction: title first, whole card as a fallback. */
  function extractSizeText(card, title) {
    var full = spacedText(card);
    return { primary: title, secondary: full.length > title.length ? full : '' };
  }

  PPP.adapter = {
    isShoppingSurface: isShoppingSurface,
    currentSite: currentSite,
    getScanRoot: getScanRoot,
    findCards: findCards,
    extractTitle: extractTitle,
    extractPrice: extractPrice,
    extractUnitPrice: extractUnitPrice,
    extractSizeText: extractSizeText,
    extractUrlSizeText: extractUrlSizeText,
    extractProductUrl: extractProductUrl,
    sizeTextFromUrl: sizeTextFromUrl,
    unwrapRedirect: unwrapRedirect,
    isProductImage: isProductImage,
    cleanText: cleanText,
    titleFromAriaLabel: titleFromAriaLabel,
    stripWasPrices: stripWasPrices
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.adapter;
}
