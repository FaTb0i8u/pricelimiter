"use strict";

/**
 * Offline harness for the content pipeline.
 *
 * Google serves a CAPTCHA to automated browsers, so the adapter cannot be
 * exercised against the live site from CI. This fixture instead reproduces the
 * DOM patterns observed on real Google Shopping results:
 *
 *   - a product photo PLUS a small merchant logo and a "Nearby" pin icon,
 *     which is what broke the original one-image-per-card assumption;
 *   - the merchant unit price Google prints itself ("$28/lb", "$1.22/oz");
 *   - per-count unit prices ("$3.00/ct") that must never be compared with a
 *     per-pound threshold;
 *   - struck-through original prices next to the current price;
 *   - BOTH card shapes Google ships: sponsored units, which are real anchors
 *     with a heading, and organic tiles, which are anchorless
 *     `div[role="listitem"]` opened by JS and whose only title is the opening
 *     sentence of a whole-card aria-label;
 *   - Walmart's discount block, where the visible price is split into separate
 *     digit spans, the only parseable price sits in an accessible label that
 *     names BOTH prices ("current price Now $46.72, Was $51.97"), and the old
 *     price is struck through with `class="strike"` rather than an `<s>` tag.
 *
 * Open with tools/verify.js, which loads the real extension sources into it.
 */

const CARDS = [
  // title, price, google unit price, merchant, expected badge, expected state
  { title: "Clean Simple Eats Protein Powder Variety Pack", price: "$29.97", unit: "$3.00/ct", merchant: "Walmart" },
  { title: "Body Fortress Super Advanced Whey Protein", price: "$29.98", unit: "$17/lb", merchant: "Walmart" },
  { title: "Orgain Organic Plant Based Protein Powder", price: "$19.99", unit: "$1.22/oz", merchant: "Target" },
  { title: "Gold Standard 100% Whey Protein Powder", price: "$74.49", unit: "$37/lb", merchant: "Optimum" },
  { title: "Isopure Low Carb Protein Powder", price: "$34.99", unit: "$34/lb", merchant: "Ulta Beauty" },
  { title: "GHOST WHEY Protein Powder", price: "$54.99", unit: "$2.12/ct", merchant: "GNC" },
  { title: "Dymatize ISO100 Protein Powder", price: "$42.49", unit: "$30/lb", merchant: "Target" },
  { title: "Sweet Whey Powder - 5 lbs", price: "$10.24", unit: "", merchant: "Great American", was: "$37" },
  { title: "BulkSupplements Grass-Fed Whey Protein", price: "$46.97", unit: "", merchant: "BulkSupplements" },
  { title: "Transparent Labs Grass Fed Whey Isolate", price: "$59.99", unit: "$2.00/ct", merchant: "Transparent" },
  { title: "Tide Liquid Laundry Detergent, 92 fl oz", price: "$11.99", unit: "", merchant: "Target" },
  { title: "Apple iPhone 15 Pro 256GB Blue", price: "$999.00", unit: "", merchant: "Best Buy" },

  // Organic tiles: no anchor, no heading, title only in the aria-label.
  {
    title: "Dymatize ISO 100 Protein", price: "$139.99", unit: "$28/lb",
    merchant: "GNC", organic: true, nearby: "Nearby, 9 mi"
  },
  {
    title: "Naked Whey Protein Powder 5 lb", price: "$89.99", unit: "",
    merchant: "Naked Nutrition", organic: true
  },

  // Discounted tile: split digits, both prices in one accessible label, and a
  // class-based (not <s>) strikethrough on the old price.
  {
    title: "Nutricost Whey Protein Concentrate 5 lb", price: "$19.08", was: "$22.47",
    unit: "", merchant: "Walmart", rollback: true
  },

  // Organic tile buried under zero-size layout wrappers. See `zeroWrapCard`.
  {
    title: "Levels Grass Fed Whey Protein Isolate", price: "$44.99", unit: "",
    merchant: "Levels", organic: true, zeroWrap: true
  },

  // Tile whose markup carries no whitespace between elements. See `weldedCard`.
  {
    title: "Ascent Native Fuel Whey Protein", price: "$33.43", unit: "$1.67/ct",
    merchant: "Walmart", welded: true
  },

  // Merchant unit price is PER COUNT, which cannot be compared with a per-lb
  // threshold - but the title states a real weight. Returning "unknown" here
  // and stopping is what left most of a results page unfiltered, so this must
  // fall through to the title: $44.99 / 5 lb = $9.00/lb.
  {
    title: "Nutricost Whey Protein Isolate 5 lb", price: "$44.99", unit: "$1.87/ct",
    merchant: "Nutricost"
  },

  // Walmart grid tile. See `walmartGridCard`. Expected: $5.92 read as the
  // price, and 14.8 cents/oz as the unit price, i.e. $2.37/lb.
  {
    title: "SKIPPY Creamy Peanut Butter, 40 oz", price: "$5.92", was: "$7.17",
    unit: "14.8 \u00a2/oz", merchant: "Walmart", walmartGrid: true
  }
];

/** 1x1 transparent GIF, so nothing is fetched from the network. */
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function card(spec) {
  if (spec.walmartGrid) return walmartGridCard(spec);
  if (spec.welded) return weldedCard(spec);
  if (spec.zeroWrap) return zeroWrapCard(spec);
  if (spec.organic) return organicCard(spec);
  if (spec.rollback) return rollbackCard(spec);
  return sponsoredCard(spec);
}

/**
 * Tile written with NO whitespace between elements, exactly as Google ships it.
 *
 * `textContent` welds the siblings into `"$33.43$1.67/ctWalmart & more"`. The
 * unit-price tail is then `"ct"` followed immediately by a letter, which the
 * parser rejects as a truncated unit - so a card that visibly reads "$1.67/ct"
 * was reported as having no size at all. Reading the card by text node instead
 * of by `textContent` restores the separation the shopper actually sees.
 *
 * Keep this template on one line: reformatting it reintroduces the whitespace
 * that makes the bug disappear.
 */
function weldedCard(spec) {
  return `<div class="tile"><a href="/shopping/product/2"><img class="photo" src="${PIXEL}" width="180" height="180" alt="${spec.title}"></a><a href="/shopping/product/2" role="heading" aria-level="3" class="title">${spec.title}</a><div class="price"><span>${spec.price}</span><span class="unit">${spec.unit}</span></div><div class="merchant"><img class="icon" src="${PIXEL}" width="16" height="16" alt=""><span>${spec.merchant} &amp; more</span></div><div class="rating">4.5 (11K)</div></div>`;
}

/**
 * Walmart search tile, copied from a live results page.
 *
 * Two traps, both of which shipped as real bugs:
 *   - the accessible price label is a DIRECT child of the whole tile, so its
 *     "parent context" is every word on the card - including "Free shipping",
 *     which rejected the only parseable price as a delivery fee (6 of 10
 *     cards on a live page read "no price");
 *   - the unit price is written in cents, "14.8 ¢/oz", which no price pattern
 *     recognised.
 */
function walmartGridCard(spec) {
  const parts = spec.price.replace("$", "").split(".");
  return `
    <div class="tile">
      <a href="/ip/product/3">
        <img class="photo" src="${PIXEL}" width="180" height="180" alt="${spec.title}">
      </a>
      <span class="sr">Price Now ${spec.price} Was ${spec.was} ${spec.unit}</span>
      <div class="price" aria-hidden="true">
        <span class="f6">$</span><span class="f2">${parts[0]}</span><span class="f6">${parts[1]}</span>
        <span class="strike">${spec.was}</span>
        <span class="unit">${spec.unit}</span>
      </div>
      <a href="/ip/product/3" role="heading" aria-level="3" class="title">${spec.title}</a>
      <div class="rating">4.7 (10K)</div>
      Free shipping, arrives in 2 days
    </div>`;
}

/**
 * Organic tile buried under zero-size layout wrappers, copied from live Google
 * Shopping (the `I8iMf` / `Ez5pwe` containers).
 *
 * Each wrapper is a single-child container, so it holds exactly one product
 * image and does NOT stop the upward walk - but it has no layout box of its
 * own. Checking visibility only on the element the walk finally lands on threw
 * the entire card away: 25 of 40 organic results were lost on the live page,
 * which is why only sponsored tiles appeared to be filtered.
 */
function zeroWrapCard(spec) {
  return `
    <div class="zero-wrap">
      <div class="zero-wrap">
        ${organicCard(spec)}
      </div>
    </div>`;
}

/**
 * Discounted tile, copied from live Walmart markup.
 *
 * Three traps in one block, all of which shipped as real bugs:
 *   - the visible price is split into `$` / `19` / `08` spans, so no single
 *     text node is parseable;
 *   - the accessible label names the current AND the old price together, so
 *     rejecting any text mentioning "Was" discarded the only usable node;
 *   - the old price is struck through with `class="strike"`, which an
 *     `s, del, strike` selector does not match.
 */
function rollbackCard(spec) {
  const parts = spec.price.replace("$", "").split(".");
  return `
    <div class="tile">
      <a href="/ip/product/1">
        <img class="photo" src="${PIXEL}" width="180" height="180" alt="${spec.title}">
      </a>
      <span class="flag">Rollback</span>
      <a href="/ip/product/1" role="heading" aria-level="3" class="title">${spec.title}</a>
      <div class="price">
        <span class="f2">Now</span><span class="f6">$</span><span class="f2">${parts[0]}</span><span class="f6">${parts[1]}</span>
        <span class="sr">current price Now ${spec.price}, Was ${spec.was}</span>
        <span class="strike">${spec.was}</span>
      </div>
      <div class="merchant">
        <img class="icon" src="${PIXEL}" width="16" height="16" alt="${spec.merchant} logo">
        <span>${spec.merchant} &amp; more</span>
      </div>
      <div class="rating">4.4 (22K)</div>
    </div>`;
}

/**
 * Organic result tile, copied from live Google Shopping markup.
 *
 * Deliberately contains NO `<a href>` and no heading: the tile is activated
 * through JS, and the product name exists only as the first sentence of the
 * aria-label, ahead of delivery, rating and unit-price metadata.
 */
function organicCard(spec) {
  const label = [
    `${spec.title}.`,
    spec.nearby ? ` ${spec.nearby}.` : "",
    ` Current Price: ${spec.price}.`,
    spec.unit ? ` ${spec.unit}.` : "",
    ` ${spec.merchant} & more. Rated 4.5 out of 5. 19K reviews`
  ].join("");
  return `
    <div class="tile" role="listitem">
      <div class="wrap" role="button" tabindex="0" aria-label="${label.replace(/"/g, "&quot;")}">
        ${spec.nearby ? `<span class="pin-text">${spec.nearby}</span>` : ""}
        <img class="photo" src="${PIXEL}" width="180" height="180" alt="">
        <div class="title">${spec.title}</div>
        <div class="price">
          <span>${spec.price}</span>
          ${spec.unit ? `<div class="unit">${spec.unit}</div>` : ""}
        </div>
        <div class="merchant">
          <img class="icon" src="${PIXEL}" width="16" height="16" alt="${spec.merchant} logo">
          <span>${spec.merchant} &amp; more</span>
        </div>
        <div class="rating">4.5 (19K)</div>
      </div>
    </div>`;
}

function sponsoredCard(spec) {
  return `
    <div class="tile">
      <a href="/shopping/product/1">
        <img class="photo" src="${PIXEL}" width="180" height="180" alt="${spec.title}">
      </a>
      <span class="pin"><img class="icon" src="${PIXEL}" width="12" height="12" alt=""></span>
      <span class="pin-text">Nearby, 6 mi</span>
      <a href="/shopping/product/1" role="heading" aria-level="3" class="title">${spec.title}</a>
      <div class="price">
        <span>${spec.price}</span>
        ${spec.was ? `<s>${spec.was}</s>` : ""}
        ${spec.unit ? `<span class="unit">${spec.unit}</span>` : ""}
      </div>
      <div class="merchant">
        <img class="icon" src="${PIXEL}" width="16" height="16" alt="${spec.merchant} logo">
        <span>${spec.merchant} &amp; more</span>
      </div>
      <div class="ship">Free delivery on $35+</div>
      <div class="rating">4.4 (22K)</div>
    </div>`;
}

module.exports = {
  CARDS,
  html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fixture - Google Shopping shape</title>
<style>
  body { font: 13px Arial, sans-serif; margin: 0; padding: 16px; }
  .grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .tile { width: 190px; border: 1px solid #ddd; padding: 8px; }
  .photo { display: block; width: 180px; height: 180px; background: #eee; }
  .icon { width: 16px; height: 16px; vertical-align: middle; }
  .pin .icon { width: 12px; height: 12px; }
  .title { display: block; font-weight: 500; margin: 6px 0; color: #1a0dab; }
  .price span { font-weight: 700; }
  .price .unit { font-weight: 400; color: #5f6368; margin-left: 6px; }
  .merchant, .ship, .rating { color: #5f6368; font-size: 12px; }
  /* Class-based strikethrough, exactly as Walmart marks its old price. */
  .strike { text-decoration: line-through; color: #5f6368; margin-left: 6px; }
  /* No layout box at all, exactly like Google's organic tile wrappers. */
  .zero-wrap { display: contents; }
  .flag { color: #bf0a30; font-weight: 700; font-size: 11px; }
  .price .f2 { font-weight: 700; }
  /* Visually hidden accessible price label. */
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
</head>
<body>
  <div role="main">
    <h1>Popular products</h1>
    <div class="grid">${CARDS.map(card).join("\n")}</div>
  </div>
</body>
</html>`
};
