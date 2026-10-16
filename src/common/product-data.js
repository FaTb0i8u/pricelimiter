/**
 * What a product page says about its own product: title, price, the store's
 * unit price and declared package sizes.
 *
 * Used only by the "Look up missing sizes" feature. The page is untrusted, so
 * only named fields are read - a size property, a store's own price element,
 * the product title - never arbitrary body text, and every value still goes
 * through the ordinary price and quantity parsers. The JSON readers are pure
 * and tested directly; readProductPage() takes an inert DOMParser document.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});

  /** UN/CEFACT codes Schema.org uses in `unitCode`. */
  var UNIT_CODES = { lbr: 'lb', onz: 'oz', grm: 'g', kgr: 'kg', mlt: 'ml', ltr: 'l', oza: 'fl oz' };

  /**
   * `additionalProperty` names that state the size of the contents. The whole
   * name must match: "Weight Capacity" (what a shelf holds) and "Volume
   * Discount" are not the size of anything in the box.
   */
  var SIZE_PROPERTY_RE = /^(?:(?:net )?(?:weight|volume)|package (?:weight|size))$/i;

  /** Generous for real vendor JSON, small enough that hostile nesting is cheap. */
  var MAX_DEPTH = 12;
  var MAX_CANDIDATES = 20;

  function isSizePropertyName(name) {
    return typeof name === 'string' && SIZE_PROPERTY_RE.test(name.trim());
  }

  /**
   * A Schema.org weight as prose: "5 lb" from
   * `{ value: 5, unitCode: "LBR" }`, or a plain string/number as given.
   */
  function structuredSizeText(value) {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (!value || typeof value !== 'object' || value.value === undefined || value.value === null) return '';
    if (typeof value.value === 'object') return '';
    var unit = String(value.unitText || value.unitCode || '').toLowerCase().trim();
    var name = UNIT_CODES[unit] || unit;
    return String(value.value) + (name ? ' ' + name : '');
  }

  /**
   * Every size a parsed JSON-LD document declares, in document order.
   * @param {*} json the result of JSON.parse on one ld+json script
   * @returns {string[]}
   */
  function sizesFromJsonLd(json) {
    var out = [];

    function visit(value, depth) {
      if (out.length >= MAX_CANDIDATES || depth > MAX_DEPTH) return;
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) visit(value[i], depth + 1);
        return;
      }
      if (value.weight) {
        var weight = structuredSizeText(value.weight);
        if (weight) out.push(weight);
      }
      var properties = value.additionalProperty;
      if (properties && !Array.isArray(properties)) properties = [properties];
      if (properties) {
        for (var k = 0; k < properties.length; k++) {
          var property = properties[k];
          if (!property || typeof property !== 'object' || !isSizePropertyName(property.name)) continue;
          var text = structuredSizeText(property.value);
          if (text) out.push(text);
        }
      }
      Object.keys(value).forEach(function (key) {
        if (key !== 'weight' && key !== 'additionalProperty') visit(value[key], depth + 1);
      });
    }

    visit(json, 0);
    return out.slice(0, MAX_CANDIDATES);
  }

  /* ------------------------------------------------------ whole product page */

  /**
   * Walmart specification names that state the net contents, best first.
   * "Size" alone is also used for clothing ("M"), which the quantity parser
   * rejects, so it is safe to offer.
   */
  var WALMART_SIZE_SPECS = ['net content statement', 'size', 'product net content parent', 'net content'];

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  /** "$47.97" for display when the source gave only a number. */
  function formatPlain(amount, currency) {
    if (currency) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency }).format(amount);
      } catch (error) {
        /* unknown code: fall through */
      }
    }
    return String(amount);
  }

  /** A price in the shape parse-price.js produces, or null if implausible. */
  function moneyFrom(amount, currency, raw) {
    var n = Number(amount);
    if (!isFinite(n) || n <= 0 || n > 1e7) return null;
    var code = /^[A-Z]{3}$/.test(currency || '') ? currency : null;
    var shown = typeof raw === 'string' ? cleanText(raw) : '';
    return { amount: n, currency: code, raw: shown || formatPlain(n, code), index: 0, perUnit: null };
  }

  /** A merchant unit price string ("10.5 ¢/oz") parsed, or null. */
  function unitPriceFrom(text) {
    var price = PPP.price;
    if (!text || !price) return null;
    var parsed = price.parseUnitPrice(cleanText(text));
    return parsed && parsed.perUnit ? parsed : null;
  }

  /**
   * Walmart's product page carries no Schema.org size at all - its only
   * ld+json block describes the WebPage. Everything is in the Next.js state
   * instead: `product.priceInfo` and `idml.specifications`.
   *
   * Only `data.product` and `data.idml` are read. The same JSON also holds
   * dozens of sponsored products in `contentLayout`, each with its own price
   * and unit price, and walking the whole tree would pick one of those up.
   *
   * @param {*} nextData the parsed `__NEXT_DATA__` script
   * @returns {{title: string, price: object|null, unitPrice: object|null, sizes: string[]}}
   */
  function fromWalmartNextData(nextData) {
    var out = { title: '', price: null, unitPrice: null, sizes: [] };
    var data = nextData && nextData.props && nextData.props.pageProps &&
      nextData.props.pageProps.initialData && nextData.props.pageProps.initialData.data;
    if (!isPlainObject(data)) return out;

    var product = isPlainObject(data.product) ? data.product : {};
    if (typeof product.name === 'string') out.title = cleanText(product.name).slice(0, 300);

    var info = isPlainObject(product.priceInfo) ? product.priceInfo : {};
    var current = isPlainObject(info.currentPrice) ? info.currentPrice : null;
    if (current) out.price = moneyFrom(current.price, current.currencyUnit, current.priceString);
    var unit = isPlainObject(info.unitPrice) ? info.unitPrice : null;
    if (unit && typeof unit.priceString === 'string') out.unitPrice = unitPriceFrom(unit.priceString);

    var specs = isPlainObject(data.idml) && Array.isArray(data.idml.specifications) ? data.idml.specifications : [];
    WALMART_SIZE_SPECS.forEach(function (wanted) {
      for (var i = 0; i < specs.length && out.sizes.length < MAX_CANDIDATES; i++) {
        var spec = specs[i];
        if (!isPlainObject(spec) || typeof spec.name !== 'string' || typeof spec.value !== 'string') continue;
        if (spec.name.trim().toLowerCase() === wanted) out.sizes.push(cleanText(spec.value).slice(0, 80));
      }
    });
    return out;
  }

  /** The first Schema.org Product in a JSON-LD graph: its name and offer price. */
  function productFromJsonLd(json) {
    var found = null;
    function isProduct(type) {
      return type === 'Product' || (Array.isArray(type) && type.indexOf('Product') > -1);
    }
    function visit(value, depth) {
      if (found || depth > MAX_DEPTH || !value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (var i = 0; i < value.length && !found; i++) visit(value[i], depth + 1);
        return;
      }
      if (isProduct(value['@type'])) {
        var offers = Array.isArray(value.offers) ? value.offers[0] : value.offers;
        var price = null;
        if (isPlainObject(offers)) {
          price = moneyFrom(offers.price !== undefined ? offers.price : offers.lowPrice, offers.priceCurrency,
            offers.price !== undefined ? offers.price : offers.lowPrice);
        }
        found = { title: typeof value.name === 'string' ? cleanText(value.name).slice(0, 300) : '', price: price };
        return;
      }
      Object.keys(value).forEach(function (key) { visit(value[key], depth + 1); });
    }
    visit(json, 0);
    return found;
  }

  function textOf(el) {
    return el ? cleanText(el.textContent) : '';
  }

  function first(doc, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = doc.querySelector(selectors[i]);
      if (el && textOf(el)) return el;
    }
    return null;
  }

  /**
   * Amazon product pages carry no structured data either. The title is
   * dependable and usually names the size ("…Vanilla Ice Cream, 5LB"); the
   * core price block holds the price and the per-ounce price.
   *
   * "Item Weight" in the product overview is deliberately NOT read: it is the
   * shipping weight, and on a live page a tub titled "5 LB" listed it as
   * "3 pounds".
   */
  function fromAmazonDocument(doc) {
    var out = { title: '', price: null, unitPrice: null, sizes: [] };
    out.title = textOf(doc.querySelector('#productTitle')).slice(0, 300);

    var core = ['#corePrice_feature_div', '#corePriceDisplay_desktop_feature_div', '#corePrice_desktop', '#apex_desktop'];
    var pay = first(doc, core.map(function (sel) { return sel + ' .priceToPay'; })
      .concat(['#priceblock_ourprice', '#priceblock_dealprice', '#price_inside_buybox']));
    if (pay && PPP.price) {
      var parsed = PPP.price.parsePrice(textOf(pay));
      if (parsed) out.price = parsed;
    }
    var perUnit = first(doc, core.map(function (sel) { return sel + ' .pricePerUnit'; }));
    if (perUnit) out.unitPrice = unitPriceFrom(textOf(perUnit));
    return out;
  }

  function fill(target, source) {
    if (!source) return;
    if (!target.title && source.title) target.title = source.title;
    if (!target.price && source.price) target.price = source.price;
    if (!target.unitPrice && source.unitPrice) target.unitPrice = source.unitPrice;
    if (source.sizes) target.sizes = target.sizes.concat(source.sizes).slice(0, MAX_CANDIDATES);
  }

  /** A microdata value, from its `content` attribute or its text. */
  function itemValue(el) {
    return el ? cleanText(el.getAttribute('content') || el.textContent) : '';
  }

  /**
   * Everything a product page states about its own product: title, price,
   * merchant unit price and declared sizes. Each source fills only what the
   * sources before it left empty, so the most specific reader wins.
   *
   * @param {Document} doc a parsed, inert document (DOMParser) - never live
   * @returns {{title: string, price: object|null, unitPrice: object|null, sizes: string[]}}
   */
  function readProductPage(doc) {
    var out = { title: '', price: null, unitPrice: null, sizes: [] };
    if (!doc || typeof doc.querySelector !== 'function') return out;

    var next = doc.getElementById ? doc.getElementById('__NEXT_DATA__') : null;
    if (next) {
      try {
        fill(out, fromWalmartNextData(JSON.parse(next.textContent)));
      } catch (error) {
        /* truncated or invalid vendor JSON */
      }
    }
    fill(out, fromAmazonDocument(doc));

    var nodes = doc.querySelectorAll('[itemprop="weight"], meta[name="product:weight"], meta[property="product:weight"]');
    for (var i = 0; i < nodes.length && out.sizes.length < MAX_CANDIDATES; i++) {
      var node = nodes[i];
      // A Schema.org QuantitativeValue in microdata keeps the number and the
      // unit in nested properties, not on the element itself.
      var text = node.hasAttribute('itemscope')
        ? structuredSizeText({
          value: itemValue(node.querySelector('[itemprop="value"]')),
          unitCode: itemValue(node.querySelector('[itemprop="unitCode"]')),
          unitText: itemValue(node.querySelector('[itemprop="unitText"]'))
        })
        : itemValue(node);
      if (text) out.sizes.push(text);
    }

    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var s = 0; s < scripts.length; s++) {
      var json;
      try {
        json = JSON.parse(scripts[s].textContent);
      } catch (error) {
        continue; // invalid vendor JSON
      }
      fill(out, { sizes: sizesFromJsonLd(json) });
      fill(out, productFromJsonLd(json));
    }
    return out;
  }

  /**
   * The Next.js state straight from the HTML string. Walmart's runs from
   * about 1 MB into a 2 MB page to its end, and it holds everything needed,
   * so reading it this way spares the results page a 2 MB HTML parse on its
   * main thread for every lookup.
   */
  function nextDataFromHtml(html) {
    var at = html.indexOf('id="__NEXT_DATA__"');
    if (at === -1) return null;
    var open = html.indexOf('>', at);
    // Split so this file can itself be inlined into a script element
    // (tools/build-fixture.js does) without the literal tag ending it early.
    var close = open === -1 ? -1 : html.indexOf('</' + 'script>', open);
    if (close === -1) return null;
    try {
      return JSON.parse(html.slice(open + 1, close));
    } catch (error) {
      return null; // truncated or invalid vendor JSON
    }
  }

  /**
   * Like readProductPage(), from raw HTML. The DOM is only built when the
   * page's JSON state did not already supply a title, a price and a size.
   *
   * @param {string} html
   * @param {function(string): Document} parse e.g. via DOMParser
   */
  function readProductHtml(html, parse) {
    var out = { title: '', price: null, unitPrice: null, sizes: [] };
    if (typeof html !== 'string' || !html) return out;
    var next = nextDataFromHtml(html);
    if (next) fill(out, fromWalmartNextData(next));
    if (out.title && out.price && (out.unitPrice || out.sizes.length)) return out;
    fill(out, readProductPage(parse(html)));
    return out;
  }

  PPP.productData = {
    isSizePropertyName: isSizePropertyName,
    structuredSizeText: structuredSizeText,
    sizesFromJsonLd: sizesFromJsonLd,
    productFromJsonLd: productFromJsonLd,
    fromWalmartNextData: fromWalmartNextData,
    readProductPage: readProductPage,
    readProductHtml: readProductHtml
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.productData;
}
