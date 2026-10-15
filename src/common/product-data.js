/**
 * Package sizes from a product page's structured data.
 *
 * Used only by the explicit "Find package sizes" lookup. The page is
 * untrusted, so only fields that NAME a weight or volume are read - never
 * free text - and the result is still handed to the ordinary quantity parser.
 * Kept free of the DOM so these rules can be tested directly.
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

  PPP.productData = {
    isSizePropertyName: isSizePropertyName,
    structuredSizeText: structuredSizeText,
    sizesFromJsonLd: sizesFromJsonLd
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.PPP.productData;
}
