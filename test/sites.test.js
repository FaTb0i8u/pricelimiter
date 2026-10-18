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
    'https://www.walmart.com/browse/food/protein/1234',
    'https://www.walmart.com/cp/coffee/1086446',
    // walmart.ca redirects "/search" to a language-prefixed path.
    'https://www.walmart.ca/en/search?q=coffee',
    'https://www.walmart.ca/fr/search?q=cafe',
    'https://www.walmart.ca/en/browse/grocery/drinks/10019_6000194326336',
    'https://www.walmart.ca/en/cp/grocery/10019'
  ];
  const no = [
    'https://www.google.com/search?q=whey',
    'https://www.google.com/',
    'https://www.amazon.com/dp/B072M8GTXW',
    'https://www.amazon.com/gp/cart/view.html',
    'https://www.walmart.com/ip/Some-Product/12345',
    'https://www.walmart.com/cart',
    'https://www.walmart.ca/en/ip/some-product/6000201',
    'https://www.walmart.ca/en/help'
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

test('page currency: country host, then observed prices, then USD', () => {
  const at = (href, observed) => sites.currencyFor(loc(href), observed || null);
  // A bare "$" on amazon.ca is Canadian, whatever the cards parsed as.
  assert.strictEqual(at('https://www.amazon.ca/s?k=x', 'USD'), 'CAD');
  assert.strictEqual(at('https://www.walmart.ca/search?q=x'), 'CAD');
  assert.strictEqual(at('https://www.amazon.co.uk/s?k=x'), 'GBP');
  assert.strictEqual(at('https://www.amazon.com.au/s?k=x'), 'AUD');
  // .com storefronts serve other currencies to travellers.
  assert.strictEqual(at('https://www.google.com/search?udm=28', 'EUR'), 'EUR');
  // Nothing observed: known stores still get a currency to save limits under.
  assert.strictEqual(at('https://www.amazon.com/s?k=x'), 'USD');
  assert.strictEqual(at('https://example.com/'), null);
});

/** A Chrome match pattern ("*://www.amazon.com/s*") as a RegExp over a URL. */
function matchPattern(pattern) {
  const [, scheme, host, path] = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  const escape = (text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + (scheme === '*' ? 'https?' : scheme) + '://' + escape(host) + escape(path) + '$');
}

test('the manifest injects on every page the profiles call a results page', () => {
  // Regression: walmart.ca moved search to "/en/search" and Walmart's "/cp/"
  // pages were profiled as results but never injected, so the extension
  // silently did nothing there.
  const manifest = require('../manifest.json');
  const patterns = manifest.content_scripts.flatMap((cs) => cs.matches).map(matchPattern);
  const pages = [
    'https://www.google.com/search?q=whey&udm=28',
    'https://www.google.com/shopping/product/1',
    'https://www.amazon.com/s?k=whey',
    'https://www.amazon.co.uk/s?k=beans',
    'https://www.amazon.ca/s?k=cafe',
    'https://www.amazon.com.au/s?k=coffee',
    'https://www.walmart.com/search?q=whey',
    'https://www.walmart.com/browse/food/1234',
    'https://www.walmart.com/shop/deals',
    'https://www.walmart.com/cp/coffee/1086446',
    'https://www.walmart.ca/en/search?q=coffee',
    'https://www.walmart.ca/fr/search?q=cafe',
    'https://www.walmart.ca/en/browse/grocery/10019',
    'https://www.walmart.ca/en/shop/flash-deals',
    'https://www.walmart.ca/en/cp/grocery/10019'
  ];
  for (const href of pages) {
    assert.strictEqual(sites.isResultsPage(loc(href)), true, `profile: ${href}`);
    assert.ok(patterns.some((re) => re.test(href)), `manifest: ${href}`);
  }
});

test('every site the extension runs on has an on/off switch, and the options page shows it', () => {
  // Regression guard: a store added to sites.js without a switch could never
  // be turned off, and a switch missing from the page could never be flipped.
  const settings = require('../src/common/settings.js');
  const switches = settings.SITES.map((s) => s.id);
  for (const site of sites.SITES) assert.ok(switches.includes(site.id), `switch for ${site.id}`);
  assert.ok(switches.includes('aisle'), 'switch for the Aisle offers page');

  const fs = require('node:fs');
  const path = require('node:path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'options', 'options.html'), 'utf8');
  for (const id of switches) {
    assert.match(page, new RegExp(`<input type="checkbox" id="site-${id}">`), `options checkbox for ${id}`);
  }
});

test('the Aisle content script can read the site switches', () => {
  const manifest = require('../manifest.json');
  const aisle = manifest.content_scripts.find((cs) => cs.js.includes('src/content/aisle-offers.js'));
  const order = aisle.js;
  assert.ok(order.indexOf('src/common/settings.js') > -1, 'settings.js is injected');
  assert.ok(order.indexOf('src/common/units.js') < order.indexOf('src/common/settings.js'), 'units.js first');
  assert.ok(order.indexOf('src/common/settings.js') < order.indexOf('src/content/aisle-offers.js'));
});
