'use strict';

/**
 * Site profile selection.
 *
 * These cases exist because getting host matching wrong fails in two
 * asymmetric ways. Matching too narrowly means the extension silently does
 * nothing on a page the user expects it to work on. Matching too broadly is
 * worse: it would badge numbers on pages that are not product results at all.
 */

const test = require('node:test');
const assert = require('node:assert');

const sites = require('../src/content/sites.js');

/** Minimal stand-in for `location`. */
function loc(href) {
  const u = new URL(href);
  return { hostname: u.hostname, pathname: u.pathname, search: u.search };
}

test('each storefront is recognised from its host', () => {
  assert.strictEqual(sites.forLocation(loc('https://www.google.com/search?q=x')).id, 'google');
  assert.strictEqual(sites.forLocation(loc('https://www.amazon.com/s?k=x')).id, 'amazon');
  assert.strictEqual(sites.forLocation(loc('https://www.amazon.co.uk/s?k=x')).id, 'amazon');
  assert.strictEqual(sites.forLocation(loc('https://www.walmart.com/search?q=x')).id, 'walmart');
  assert.strictEqual(sites.forLocation(loc('https://www.walmart.ca/search?q=x')).id, 'walmart');
});

test('an unknown host falls back to the generic profile', () => {
  const site = sites.forLocation(loc('https://example.com/store?q=x'));
  assert.strictEqual(site.id, 'generic');
  // Generic never auto-activates: guessing wrong would badge unrelated numbers.
  assert.strictEqual(site.isResultsPage(loc('https://example.com/store?q=x')), false);
});

test('lookalike hosts are not mistaken for the real store', () => {
  // "amazon.com.evil.example" must not match: the regex is anchored to the end
  // of the hostname precisely so a suffix attack cannot activate the extension.
  for (const href of [
    'https://amazon.com.evil.example/s?k=x',
    'https://notamazon.com/s?k=x',
    'https://walmart.com.phish.example/search?q=x',
    'https://mywalmart.com/search?q=x'
  ]) {
    assert.strictEqual(sites.forLocation(loc(href)).id, 'generic', href);
  }
});

test('a subdomain of a real store still matches', () => {
  assert.strictEqual(sites.forLocation(loc('https://smile.amazon.com/s?k=x')).id, 'amazon');
});

test('results pages are told apart from the rest of each store', () => {
  const yes = [
    'https://www.google.com/search?q=whey&udm=28',
    'https://www.google.com/search?q=whey&tbm=shop',
    'https://www.google.com/shopping/product/1',
    'https://www.amazon.com/s?k=whey+protein',
    'https://www.amazon.com/gp/search?keywords=whey',
    'https://www.walmart.com/search?q=whey',
    'https://www.walmart.com/browse/food/protein/1234'
  ];
  const no = [
    'https://www.google.com/search?q=whey',
    'https://www.google.com/',
    'https://www.amazon.com/dp/B072M8GTXW',
    'https://www.amazon.com/gp/cart/view.html',
    'https://www.walmart.com/ip/Some-Product/12345',
    'https://www.walmart.com/cart'
  ];
  for (const href of yes) assert.strictEqual(sites.isResultsPage(loc(href)), true, href);
  for (const href of no) assert.strictEqual(sites.isResultsPage(loc(href)), false, href);
});

test('only sites with stable markup declare a card selector', () => {
  const byId = Object.fromEntries(sites.SITES.map((s) => [s.id, s]));
  // Google rotates its class names, so it must stay purely structural.
  assert.strictEqual(byId.google.cardSelector, null);
  // Amazon and Walmart expose semantic attributes their own tooling relies on.
  assert.strictEqual(byId.amazon.cardSelector, '[data-component-type="s-search-result"]');
  assert.strictEqual(byId.walmart.cardSelector, '[data-item-id]');
});

test('every profile is structurally complete', () => {
  for (const site of sites.SITES.concat([sites.GENERIC])) {
    assert.ok(site.id && site.label, 'id and label');
    assert.strictEqual(typeof site.matchesHost, 'function', site.id);
    assert.strictEqual(typeof site.isResultsPage, 'function', site.id);
    assert.ok(Array.isArray(site.scanRoots) && site.scanRoots.length, site.id);
    assert.ok(Array.isArray(site.titleSelectors), site.id);
  }
});

test('a missing location never throws', () => {
  assert.strictEqual(sites.forLocation(null).id, 'generic');
  assert.strictEqual(sites.isResultsPage(null), false);
});
