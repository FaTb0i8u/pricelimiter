# Unit Price Filter

A Chrome extension (Manifest V3) that annotates every search result on **Google
Shopping, Amazon and Walmart** with its **price per pound / kilogram / litre /
fluid ounce**, and hides the ones above a threshold you set.

Every one of these stores lets you filter by price, but not by size — so a 5 lb
bag at \$18 and a 12 oz bag at \$9 look comparable when they are not. This
computes the number they will not show you, and ranks the page by it.

No build step. No dependencies. No server. Nothing to install.

---

## Install (unpacked, free)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Search for something sold by weight on any supported store, e.g.
   `coffee beans` on Google Shopping (`google.com` → Shopping tab),
   `amazon.com/s?k=coffee+beans`, or `walmart.com/search?q=coffee+beans`

The panel appears bottom-right. The toolbar button hides/shows it.

> Publishing to the Chrome Web Store requires a **one-time \$5 developer
> registration fee**. Loading unpacked, as above, is free forever.

## Run the tests

Node 18+ only — the suite uses the built-in `node:test` runner, so there is
nothing to `npm install`:

```
node --test 'test/*.test.js'
```

### Package-size lookup

When a result does not list a package size, the panel can offer **Find package
sizes**. This is an explicit, bounded lookup (at most eight cards per click),
not background crawling. It requests only a linked product page that is already
within the extension's existing site permissions, sends no retailer cookies,
and accepts only explicit structured product metadata such as Schema.org
`weight` or `net weight`. It therefore helps most on Amazon and Walmart; Google
Shopping links to third-party merchants that are intentionally outside the
extension's permissions are left untouched.

Price limits are saved separately for each detected currency. A limit set on a
US storefront is not silently reused for Canadian dollars, pounds, or Australian
dollars.

### Verifying the DOM adapter

Google serves a CAPTCHA to automated browsers, so the adapter cannot be driven
against the live site from a script. Instead there is an offline harness that
reproduces the DOM patterns observed on real store results — product photo
*plus* merchant logo *plus* map pin, merchant unit prices, both of Google's card
shapes, and Walmart's discount block with its split-digit price and
class-based strikethrough:

```
node tools/build-fixture.js     # prints a file:// URL
```

Open that URL and run `__pppReport({ basis: 'lb', threshold: 8 })` in the
console. It returns exactly what the real adapter and parsers detected on each
card, so regressions in card detection are visible immediately.

Regenerate the icons after changing the artwork in `tools/make-icons.js`:

```
node tools/make-icons.js
```

---

## How it works

```
price text node  ──▶  walk up to the card  ──▶  merchant unit price?  ──▶ use it
                                                      │ no
                                              parse size from title
                                                      │
                                        price ÷ size ──▶ per lb / kg / L / fl oz
                                                      │
                                      badge the card, hide if over threshold
```

| File | Responsibility |
| --- | --- |
| `src/common/units.js` | Unit tables, exact conversion factors, filter bases |
| `src/common/parse-quantity.js` | Net weight / volume extraction from titles |
| `src/common/parse-price.js` | Currency parsing incl. non-US decimal conventions |
| `src/common/settings.js` | `chrome.storage.sync` persistence + input sanitising |
| `src/content/sites.js` | Per-store profiles: host match, results-page test, selectors |
| `src/content/site-adapter.js` | Locating product cards in each store's DOM |
| `src/content/panel.js` | Shadow-DOM control panel |
| `src/content/main.js` | Scan → analyse → annotate → filter pipeline |
| `src/background/service-worker.js` | Relays toolbar clicks to the page |

### Three decisions worth knowing about

**1. The store's own unit price wins whenever it exists.** All three stores
already print a unit price on many cards — `$28/lb` on Google, `($1.41/ounce)`
on Amazon, `$3.82/lb` on Walmart. That figure is *declared by the seller*, so it
beats anything inferred from a title and is used in preference. Title parsing is
the fallback for the cards that lack it.

This is also why supporting three stores needed **no parser changes at all**.
Every format above, plus `($0.61/Ounce)`, `($2.50/Fl Oz)`, `($0.33/Count)` and
Amazon's `$44.99$44.99($1.41/ounce)` run-on, already parsed correctly. The work
was entirely in *finding the cards*.

A `/ct` (per-count) price is recognised and displayed but **never** compared
against a per-pound threshold — those are different dimensions, and pretending
otherwise would silently mis-rank results.

**2. Card detection is per-store, because the stores are not alike.** Google's
class names are obfuscated and rotate, so hard-coding a selector there would
break within weeks. Amazon and Walmart instead expose stable semantic attributes
that their own tooling depends on. Using one strategy everywhere would mean
accepting the weaker one twice over, so `src/content/sites.js` records a profile
per store and the adapter picks accordingly:

| Store | Strategy | Hook |
| --- | --- | --- |
| Google | structural | none — classes rotate |
| Amazon | selector | `[data-component-type="s-search-result"]` |
| Walmart | selector | `[data-item-id]` |

When a selector returns **zero** cards the adapter falls back to the structural
walk, so a store redesign degrades to Google's slower-but-selector-free path
instead of the extension simply going blank. The scan root gets the same
treatment: `getScanRoot` returns the first selector that *matches*, which is not
necessarily the one that *contains* the grid, so a root that yields no cards is
retried from `document.body`.

Host matching is anchored — `/(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/` — so a
lookalike domain such as `amazon.com.evil.example` does **not** match. An
unknown host falls through to a generic profile whose results-page test always
returns false, so the extension never activates somewhere it has not been
taught about.

Adding a store is a profile in `sites.js` plus a match pattern in
`manifest.json`. The alternative — requesting `<all_urls>` and sniffing every
page — would be a far worse trade: a much harder Web Store review, and a
permission prompt that truthfully says the extension can read every site you
visit.

The structural walk, used on Google, finds a text node that looks like a price,
then walks up while the parent still contains at most one **product-sized**
image.

That size qualifier matters enormously. Real cards contain a product photo *and*
a merchant logo (Walmart / Target / GNC …) *and* often a "Nearby" map pin — three
images, not one. An earlier version counted every `<img>`, so the walk aborted
inside the card and detected **0 of 12** cards in the test fixture. Counting only
images at least 40×40 px detects **12 of 12**.

Google ships **two different card shapes**, and they must both be handled:

| | Sponsored (PLA) | Organic |
| --- | --- | --- |
| Element | `<a href>` | `<div role="listitem">` |
| Activated by | navigation | JavaScript |
| Title | `<h3>` heading | first sentence of a whole-card `aria-label` |

An earlier version required every card to contain or sit inside an `<a href>`.
Organic tiles have no anchor at all, so **every organic result was rejected** and
only the ad carousel was ever filtered. Measured on a live query: 40 sponsored
cards found, **0 organic**. Accepting any activation hook — `role="button"`,
`jsaction`, `tabindex` — brings that to 40 sponsored and **15 organic**.

Organic tiles also have no heading, so the title is taken from the opening
sentence of the tile's `aria-label`:

```
"Dymatize ISO 100 Protein.  Nearby, 9 mi. Current Price: $139.99. $28/lb."
 └────── product name ─────┘└──────────────── metadata ─────────────────┘
```

The cut is on a period followed by **two** spaces, never one, so `"Dr. Pepper"`
and sizes like `"5.15 lbs"` survive intact.

**3. Pack sizes are never multiplied unless the listing says so.**
`"(6-Pack) 16 oz"` is genuinely ambiguous: it may be 16 oz total or 96 oz total.
Guessing high makes a bad deal *look cheap*, which actively misleads you.
Guessing low makes a good deal look expensive, which only means you miss it. So
the parser guesses low, flags the result `pack-ambiguous`, and marks the badge
with `?`. `"2 x 5 lb"` and `"16 oz each"` are explicit and *are* multiplied.

### Deliberate parser behaviours

| Input | Result | Why |
| --- | --- | --- |
| `$139.99  $28/lb` | item \$139.99, unit \$28/lb | The `/lb` figure is a unit price, not the item price |
| `$3.00/ct` | shown, never filtered | Per-count is not per-weight; comparing them would mislead |
| `92 fl oz` | volume, not mass | `fl oz` ≠ `oz`; conflating them is the most damaging possible error |
| `Vitamin C 1000 mg, 250 Tablets` | unknown | `mg` on a shopping title is a dose, not net weight |
| `30 g per serving` | unknown | A serving is a dose; it says nothing about pack size |
| `5 lb (2.27 kg)` | 5 lb, high confidence | Same size restated — agreement raises confidence |
| `12 oz bag with 2 lb tin` | 12 oz, low confidence | Conflicting sizes → take the smallest |
| `Net Wt 12 oz` | 12 oz, highest confidence | An explicit label beats every heuristic |
| `10-20 lb` | flagged `size-range` | Not a single size; confidence capped at 0.4 |
| `iPhone 15 Pro 256GB` | unknown | `GB` is not a unit; no phantom sizes |

Items whose size cannot be determined are **shown by default**, greyed and
badged. Hiding them silently would be the wrong default — the cheapest item on
the page may well be one of them.

### Discounts, and why they are the dangerous case

A discounted card shows two prices. Reading the wrong one is not a symmetric
mistake: reporting the **old** price makes a reduced item look expensive, so the
filter hides precisely the bargains the extension exists to surface.

Walmart triggered exactly that. Three things went wrong at once on a rollback
card listed at \$46.72, reduced from \$51.97:

1. The visible price is split across separate spans — `$`, `46`, `72` — so no
   single text node parses.
2. The one node holding a complete price is an accessible label reading
   `"current price Now $46.72, Was $51.97"`, which was **rejected** because it
   mentions "Was".
3. The old price is struck through with `class="strike"` on a plain `<span>`,
   not an `<s>` / `<del>` / `<strike>` tag — so a tag-based test missed it and
   accepted \$51.97.

The fix is two store-agnostic rules: strip any `was` / `list price` /
`original price` / `regular price` / `compare at` clause **before** deciding
whether a node is usable, and detect strikethrough via the *computed*
`text-decoration-line` rather than by tag name. All five rollback items on a
live Walmart page now report the "Now" price exactly.

The fixture reproduces this card, including the real CSS rule, so the test would
fail again if either rule were removed.

### Two things that only live pages reveal

**The badge has to outrank the store's own layers.** The badge sat at
`z-index: 5`. Google's sponsored units put their product-image wrapper
(`.pla-unit-image`) at `z-index: 6`, so on every sponsored result the badge was
rendered, correctly positioned, fully opaque — and painted straight over by the
product photo. Card detection, parsing and the panel all reported success while
the user saw nothing. It is now `9999`: high enough to win inside a card,
without reaching for the 32-bit maximum and covering site menus and modals that
legitimately belong on top.

A warning about diagnosing this class of bug: `document.elementFromPoint` is
**useless** here, because the badge sets `pointer-events: none` so it never
blocks clicks on the card. Hit-testing therefore reports the element underneath
whether or not the badge is visible. The only trustworthy check is pixels —
screenshot the card, change one property, screenshot again.

**Card body text is not a product title.** Google prints spec chips under each
result: `Amino Acids · 30 g per serving · Muscle Gain · Powder`. Read as a size,
`30 g` turned a $24.99 tub into **$377.80/lb** — wrong by a factor of 75, and
visibly absurd next to the price. A single badge like that discredits every
other number on the page, so serving sizes are now rejected outright rather
than multiplied by a serving count guessed from the same loose copy.

**The walk up from a price can overshoot into a box that does not exist.**
The ascent stops when a parent holds more than one product image, on the theory
that reaching two images means reaching the grid row. Google wraps each organic
tile in several *single-child* containers (`I8iMf`, `Ez5pwe`), and each one
still holds exactly one image, so none of them stops the walk. The outermost of
them is `display: contents` — a zero-size box. Because only the element the
walk finally landed on was visibility-checked, the whole card was discarded.

Measured live: **25 of 40 organic tiles were lost**, while the sponsored units —
which are not wrapped this way — were detected normally. That asymmetry is
exactly what it looks like from the outside: the hide toggle appears to work on
sponsored products and ignore everything else. The fix is to remember every
acceptable element on the way up and keep the highest *visible* one, so
overshooting into a layout-less wrapper no longer costs the card. Organic
coverage on the live page went from 15/40 to 40/40.

Worth being blunt about how this was missed: earlier verification counted
badges against results **in the viewport**, and the wrapped tiles were all below
the fold. A count that never covers the whole page is not evidence.
`test/fixtures/shopping-fixture.js` now ships a `zeroWrap` tile so the shape is
exercised offline — the old ascent lands on its `0x0` wrapper and rejects it.

**`textContent` welds elements together, and that silently deletes data.**
Google's markup carries no whitespace between siblings, so a tile reading
"$33.43 $1.67/ct Walmart & more" has a `textContent` of
`"$33.43$1.67/ctWalmart & more"`. The unit-price tail then sees `ct` followed
immediately by a letter and rejects it as a truncated unit — the same guard
that correctly stops `lb` matching inside a longer word. The result: a card
that visibly prints its own unit price was reported as **"no size"**.

Measured live, this discarded the merchant unit price on **every single card of
the 180 on the page** — 45 of them had one — and left 84 tiles unsized. Because
unsized items are not filtered unless "also hide items with no listed size" is
ticked, whole sections looked untouched while the sponsored row (whose sizes
come from titles) filtered normally. Reading each card node by node and joining
on the element boundary drops the unsized count from 84 to 40, with zero cards
losing a unit price they previously had.

The reason this is a boundary-restoring fix rather than a looser regex: prices
that stores split *across* nodes must still pair up. Amazon puts `$1.41` in a
visually-hidden span and `/ ounce)` in a separate node; joined with a space it
still reads correctly, so the guard against truncated units stays intact.

**A store's card attribute only tags its main grid.** The selector strategy
used to win outright whenever it matched anything, and the structural walk ran
only as a fallback for zero matches. But `[data-component-type="s-search-result"]`
tags Amazon's main results and *not* the sponsored carousels above and beside
them. Matching 60 main results therefore suppressed the structural walk
entirely, and the carousel tiles were never scanned, badged or hidden — while
carrying prices like "$44.99 ($1.41 / ounce)", which is **$22.56/lb** against an
$8/lb limit. Both strategies now run and are merged, which recovered 12 tiles
(60 → 72) on a live search, all 12 priced and all 12 above the limit.

**An incomparable unit price must not end the evaluation.** A merchant unit
price is preferred because it is declared rather than inferred — but a per-count
price ("$1.67/ct", per capsule, per serving) has no relationship to a per-pound
threshold. That case returned `unknown` and stopped, *even when the card's own
title said "5 lb"*. Google prints `/ct` on a large share of its tiles, so this
alone left 82 of 161 cards unsized and unfilterable. `evaluate` now tries the
declared price and the title-derived size in turn and takes whichever is
actually comparable, preferring the declared one when both are. A card reading
"$44.99, $1.87/ct, Nutricost Whey Protein Isolate 5 lb" now reports $9.00/lb
instead of nothing.

**When the card says nothing, the link often does.** Google renders a large
share of tiles with no size anywhere in the visible card; the weight only
appears in the size dropdown once you open the listing. That dropdown is not
worth chasing — the data is not in the page, so reaching it would mean
synthetically clicking every tile. The merchant's own link is already there and
costs nothing:

```
/p/optimum-nutrition-100-whey-gold-standard-french-vanilla-creme-2-lb-powder/op-2054
```

The path is normalised into prose and handed to the ordinary quantity parser,
so the serving-size and nutrition-claim rules apply to it too. On a live search
this read a size for 9 of 46 otherwise unsized cards. Three rules keep it
honest, and the first two were written only after the code got them wrong:

- **Only the path, never the query string.** Tracking parameters carry sizes
  belonging to other products (`utm_campaign=10-lb-sale`).
- **Path segments cannot pair with each other.** They are joined with a pipe so
  a number ending one segment can never bond to a unit starting the next.
- **Tokens mixing letters and digits are dropped.** A pack size is a plain
  number beside a plain word; anything else is an identifier. Without this,
  Amazon's ad tracker
  `aax-us-east-retail-direct.amazon.com/x/c/JHrsSGNLByjPTyZ4KDRtFtkAAAGf42__lAEAAA…`
  split into "42" and "l", was read as 42 litres, and gave three real products
  a wrong size — worse than leaving them unsized. It was caught by checking
  every card where both the text *and* the URL claimed a size and asking
  whether they agreed. Three of three disagreed. After the fix, none do.

### Finding the best value

The cheapest **visible** result gets a green border, and its badge reads
"BEST VALUE". The panel offers a *jump to it* button which scrolls the card into
view, moves keyboard focus to it, and pulses it briefly so it is obvious which
one you landed on.

Three details that matter:

- The highlight is an `outline`, not a `border`. A border participates in layout
  and would shift every card in Google's grid.
- The border is paired with the text "BEST VALUE" rather than relying on colour
  alone, which would fail WCAG 1.4.1 and tell a screen-reader user nothing.
- Only a **visible** card can be nominated. Offering to jump to a card the
  filter has hidden would scroll the user to nothing, so when everything is
  filtered out the button simply disappears.

### When the extension turns itself on

Activation used to depend only on the URL: the Shopping tab is `tbm=shop` or
`udm=28`, Amazon results are `/s`, and so on. That is cheap and exact, but it
fails badly. Stores rename these parameters without notice — Google has already
moved from `tbm=shop` to `udm=28` once — and when it happens the extension stays
mounted, dormant and **completely invisible**, with nothing to tell you it is
there. "It stopped working" and "it is working but found nothing" look identical.

So the DOM is now believed as well as the URL. If the URL test fails but the
page holds **five or more** detected product cards, the extension activates
anyway. A parameter rename degrades to "still works" rather than "silently does
nothing".

The guard rails matter more than the rule:

- It only applies on hosts with a site profile. An unknown host can never
  auto-activate on the strength of a few prices.
- Five cards, not one. A stray price on an article or a product page is not a
  results grid.
- The probe only runs when the cheap URL test has already failed, so ordinary
  results pages still scan exactly once.

Verified both ways on the fixture: with the URL test forced to fail on a known
store the 15 badges survive, and on an unknown host the extension removes every
badge and hides the panel.

The toolbar button remains the manual override, and still forces the panel on
anywhere the content script runs.

---

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Remembers your threshold and unit |
| `*://*.google.com/*` | Content script runs on Google search/shopping only |
| `*://*.amazon.com/*` (+ `.co.uk`, `.ca`, `.com.au`) | Amazon search results |
| `*://*.walmart.com/*` (+ `.ca`) | Walmart search and browse pages |

Every host is declared explicitly. There is no `<all_urls>`, no `tabs`, no
network requests and no analytics. Nothing leaves the browser.

---

## Known limitations

- **Three stores only.** Google, Amazon and Walmart. Adding another means a
  profile in `src/content/sites.js` and a match pattern in `manifest.json`;
  match patterns cannot wildcard a TLD, so each national domain is listed
  individually.
- **It compares search results, not competing offers for one product.** The
  extension ranks the items *on the page* by unit price. It does not open
  Amazon's "Other Sellers on Amazon" box or Walmart's marketplace offers and
  compare those — that is a different feature, on a different page.
- **US customary volumes.** A UK fluid ounce is 28.41 ml, not 29.57 ml. Results
  on `google.co.uk` and `amazon.co.uk` will be ~4% off for `fl oz`.
- **Size comes from the visible card only.** Product detail pages are never
  fetched — that would be slow, rate-limited, and a privacy problem.
- **Many Google tiles state no total size at all.** Google frequently prints
  only "24 g per serving" or "$1.82/ct" and no net weight. Those are reported
  `no size` rather than guessed at, because multiplying a serving by an unstated
  serving count is how a $24.99 tub became "$377.80/lb". The merchant link
  recovers about one in five of them; the rest state the weight only in the
  product photo, or only in the size dropdown of the listing page, which is
  fetched on click and is not in the results page at all. Tick *also hide items
  with no listed size* to remove them.
- **Mixed currencies on one page are not converted.** The threshold is compared
  in whatever currency the page shows.
- **The card adapter needs live verification.** All three stores A/B test their
  layouts constantly; enable `debug` in storage to outline detected cards.
  Last measured on live pages with the filter on at $8/lb: Amazon 79 cards,
  77 over the limit, 77 hidden, 0 missed; Google 95 cards, 38 over the limit,
  38 hidden, 0 missed, and every priced tile covered in all three page
  regions (sponsored 20/20, organic list 16/16, other carousels 35/35).

## Backlog

Priority order, highest first.

1. **Verify the adapter against live Google Shopping** in several categories
   (bulk food, pet food, detergent, supplements, electronics) and tune. The
   fixture harness covers the known shapes, but only the live site proves it.
2. **Grow the title corpus.** Every mis-parse found in the wild becomes a test
   case in `test/parse-quantity.test.js`. This is where accuracy comes from.
3. **Sort by unit price.** Higher value than filtering, but requires reordering
   Google's grid; only safe when all cards share one flex/grid parent.
4. **Auto-activate on the All tab** when a page turns out to contain product
   cards. Today the extension stays dormant outside the Shopping tab and the
   toolbar button is the way in.
5. **National Google domains** behind an options page.

Coupon scanning is **out of scope** — decided, not deferred. See below.

### Why coupons are a separate extension

This was considered and ruled out for this codebase:

- The Chrome Web Store enforces a **single purpose** policy. "Unit price filter"
  plus "coupon auto-applier" is two purposes and a plausible rejection.
- Auto-applying codes means running on **every checkout page on the web**
  (`<all_urls>`), which is a far larger permission ask, a much harder review, and
  a much bigger security surface than this extension currently has.
- Honey's business model is affiliate-link attribution, not coupons. A coupon
  feature with no code database is a scraper of other people's coupon sites,
  which is fragile and legally murky.

So it ships as a **separate extension** if it ships at all. Keeping this one
small, permission-light and single-purpose is what makes it publishable — and it
means a security problem in coupon code can never reach the `storage` data or
the store pages this extension touches.
