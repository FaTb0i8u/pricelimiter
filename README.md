# Unit Price Filter

A Chrome extension (Manifest V3) that annotates every search result on **Google
Shopping, Amazon and Walmart** with its **price per pound / kilogram / ounce /
100 g / litre / fluid ounce / 100 ml**, and hides the ones above a threshold
you set.

Every one of these stores lets you filter by price, but not by size — so a 5 lb
bag at \$18 and a 12 oz bag at \$9 look comparable when they are not. This
computes the number they will not show you, and ranks the page by it.

No build step. No runtime dependencies. No server. Nothing to install.

---

## Install (unpacked, free)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Search for something sold by weight on any supported store, e.g.
   `coffee beans` on Google Shopping (`google.com` → Shopping tab),
   `amazon.com/s?k=coffee+beans`, or `walmart.com/search?q=coffee+beans`

The panel appears bottom-right; drag it by its title bar and it snaps to the
nearest corner. The toolbar button, or **Alt+Shift+U**, hides/shows it; on a
tab where the extension cannot run, the button opens a page explaining where it
works. While hiding is on, the toolbar icon shows how many results are hidden
on that tab. Every setting, including per-currency limits, is also on the
options page (right-click the toolbar button → **Options**, or **Settings** in
the panel).

### Choosing which sites it runs on

The **Sites** section at the top of the options page has a switch for each
site: **Google Shopping**, **Amazon**, **Walmart** and **Aisle**. All start on.
Switch one off and the extension leaves that site exactly as the store serves
it — no badges, no panel, no hidden results, no product-page lookups, no
toolbar count. For example, with Google Shopping and Amazon off and Aisle on,
only the Aisle offers page is filtered.

Changes apply straight away, including to tabs already open. The switches are
saved with the rest of the settings (`sites` in `chrome.storage.sync`), and
**Reset to defaults** turns every site back on. The toolbar button never
overrides a switch: clicked on a site that is switched off, it opens the
options page with a note saying so and the focus on that site's switch.

> Publishing to the Chrome Web Store requires a **one-time \$5 developer
> registration fee**. Loading unpacked, as above, is free forever.

## Run the tests

Node 20+ only — the suite uses the built-in `node:test` runner and the
extension has no runtime dependencies, so tests and checks need no install:

```
npm test          # unit tests
npm run check     # syntax, manifest paths, content-script load order
npm run lint      # ESLint (after a one-time `npm ci` for the dev tooling)
```

All three run in CI on every push (`.github/workflows/test.yml`).

### Free offers on Aisle

On [discover.gotoaisle.com/offers](https://discover.gotoaisle.com/offers) the
extension hides every offer that is not an outright free item, leaving only
"FREE Olipop" or "Get 2 FREE" style offers. A bar bottom-right counts what is
shown and hidden, and **Show all** / **Free only** switches the filter (the
choice is remembered). The toolbar button shows or hides the bar, and the
toolbar icon counts the hidden offers.

| Offer wording | Kept? |
| --- | --- |
| `FREE Olipop`, `Get 2 FREE cans`, `Try For FREE`, `100% cash back`, `on us` | kept |
| `BOGO`, `Buy 1 Get 1 FREE`, `B2G1`, `2 for 1`, `Free dip with purchase of chips` | hidden |
| Anything with "buy": `Buy 2, Get $7`, `Get Rewarded For Buying C2O!`, `Buy More, Earn More` | hidden |
| `$2 off`, `Save $1.50`, `$3 back`, `Try For $8` | hidden |
| No offer stated: `Redeem To Unlock More Offers!`, `Loyalty Pass`, `A Good Deal` | hidden |

The wording rules live in `src/common/offer-classifier.js` (tested in
`test/offer-classifier.test.js`, including tags copied from the live page);
`src/content/aisle-offers.js` finds the cards. Neither depends on Aisle's class
names: a card is the box around the offer wording that repeats alongside
similar boxes, and every box in that row is judged, including ones whose tag
promises nothing. A card is judged by its headline, so fine print such as "up
to \$2.99 back" does not turn a free offer into a discount, while a BOGO or
"buy" phrase anywhere on a card always hides it. The one "buy" exception is the
bought item itself coming back free ("Buy 1, get it FREE"). "Free" in a product
name ("Chlorine Free Diapers", "gluten free") is not an offer: it only counts
opening the tag, after punctuation, or after a word such as "get", "try",
"for" or a count.

### Price history

With **Remember the lowest price I've seen** on (the default), each comparable
result's price per gram or millilitre is kept in `chrome.storage.local` — on
this device only, never synced or sent anywhere, capped at 2,000 products with
the least recently seen dropped first. A result that beats every earlier
sighting by more than 1% gets a **New low** label, and every badge's tooltip
names the lowest price seen, where, and how long ago.

Three rules keep it honest. Comparisons are against history as it stood
*before* the page loaded, so a price is never a new low against itself.
Currency and weight-versus-volume are part of the key, so pounds never compare
with dollars. And a size flagged as guessed (the `?` badge) is never recorded,
because one misread pack size saved as a record low would make every later
sighting of that product look dear. History can be cleared, or switched off,
from the options page.

### First run

Installing opens a short welcome page with one-click example searches. On the
first results page the panel opens a badge guide explaining each colour and
label; **Got it** dismisses it for good, and the **?** button in the panel
header brings it back.

### Sorting by unit price

**Sort results by unit price** reorders the grid cheapest first, then items
measured the other way, then unsized items. It uses CSS `order` rather than
moving nodes: the stores render with frameworks that break when their DOM is
rearranged behind their back, and `order` is purely visual and fully
reversible. Cards are only permuted among the slots cards already occupy, so
ads and banners stay where the store put them. Google's organic tiles sit
inside `display: contents` wrappers, which `order` cannot affect, so the sort
looks through those to the real flex items. Layouts that are neither flex nor
grid cannot be reordered this way, and the panel says so.

### Looking up missing prices and sizes

When a result shows no price or no size, the panel offers **Look up price and
size for N results**. It reads those products' own pages and fills in only what
the card lacks: the price, the store's unit price, or the package size. Tick
**Look up automatically** (in the panel or on the options page) to have it
happen on every results page without clicking.

What is read from each store, measured on live pages:

| Store | Source on the product page | Notes |
| --- | --- | --- |
| Walmart | The page's own JSON state: `product.priceInfo` (price, "10.5 ¢/oz") and `idml.specifications` ("Net content statement: 40 oz") | Its only Schema.org block describes the web page, so the old structured-data lookup found nothing here |
| Amazon | `#productTitle`, and the core price block's `.priceToPay` and `.pricePerUnit` | No Schema.org data at all. "Item Weight" is deliberately ignored: it is the shipping weight, and a tub titled "5 LB" listed "3 pounds" |
| Others | Schema.org `weight`, size properties and `Product` offers | Only stores the extension already has permission for |

The lookup is deliberately conservative:

- **No cookies, no new permissions.** Pages are fetched by the service worker
  with `credentials: 'omit'`, only on Amazon and Walmart hosts already in the
  manifest, and a redirect to any other origin is refused. Walmart prices can
  vary by store, and a cookie-less request sees the default store's, which is
  why the card's own price always wins when it has one.
- **Bounded.** Three requests at a time, at most 24 per click and 48
  automatic lookups per results page. Each product is looked up once per tab,
  however often the store re-renders its card.
- **Backs off.** If a store answers with "slow down" errors or a bot check, the
  remaining lookups are dropped and the panel says the store stopped answering.
  Carrying on would only make the store treat the shopper's own browsing as a
  bot.
- **Only where it can help.** Cards the store itself prices per count or per
  load ("$0.20/load") are skipped: they are sold by count, and their product
  pages say so too.
- **Sponsored results are unwrapped first.** Walmart's `/sp/track?rd=` and
  Amazon's `/sspa/click?url=` links are followed to the product they wrap, so a
  lookup never fetches (and registers a click on) an ad tracker. The same
  unwrapping lets the size in the product's link be read with no request at
  all, as in "…-Gusset-19-0-oz-20-Servings".
- **Honest about multipacks.** A declared size is read beside the page title,
  so "(2 pack) … 404 g" is flagged as an ambiguous multipack rather than
  priced as one pouch.

Measured on live searches: on Walmart "protein powder" a lookup took the
unpriced cards from 11 to 5, all of which genuinely state no size anywhere; on
Walmart "coffee", automatic lookup took them from 7 to 1 within five seconds,
and that one was a promotional banner ("…under $3"), which is no longer
mistaken for a result. Google Shopping links to thousands of third-party merchants,
which the extension has no permission to read, so Google results are not
looked up.

Price limits are saved separately for each detected currency. A limit set on a
US storefront is not silently reused for Canadian dollars, pounds, or Australian
dollars.

Limits are numbers *per the chosen unit*, so changing the unit converts them:
\$3/lb becomes \$6.614/kg or \$0.1875/oz, keeping exactly the same results
hidden. Switching between weight and volume leaves the number alone, since a
per-pound limit has no per-litre equivalent. Items measured the other way are
badged in the paired unit — litres beside pounds or kilograms, fluid ounces
beside ounces, 100 ml beside 100 g.

### After an update

Chrome does not re-inject content scripts into tabs that were already open, and
the old script loses its connection to storage. It keeps filtering from memory,
but the panel says **Extension updated – reload this page to save changes**
instead of silently dropping edits.

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
| `src/common/settings.js` | `chrome.storage.sync` persistence + input sanitising, including the per-site switches |
| `src/common/verdict.js` | Pass/fail/n.a. rules, sort order, locale-aware money formatting |
| `src/common/history.js` | Lowest-price-seen history in `chrome.storage.local` |
| `src/common/product-data.js` | Sizes from a product page's Schema.org data, for the size lookup |
| `src/content/sites.js` | Per-store profiles: host match, results-page test, selectors, currency |
| `src/content/site-adapter.js` | Locating product cards in each store's DOM |
| `src/content/panel.js` | Shadow-DOM control panel |
| `src/content/main.js` | Scan → analyse → annotate → filter → sort pipeline |
| `src/options/` | Options page, sharing `settings.js` with the panel |
| `src/background/service-worker.js` | Toolbar clicks, opening options, product-page lookups |

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
| `£2.50 (£0.83/100 g)` | item £2.50, unit £0.83 per 100 g | The denominator's number is part of the unit; without it £0.83 was read as the item price |
| `$3.98 14.8 ¢/oz` | unit \$0.148/oz | Walmart writes cheap unit prices in cents |
| `Beans 415g £0.83/100 g` | 415 g | "100 g" after a unit price is what it is quoted per, not the pack size |
| `Riz 1,5 kg`, `Water .5 L` | 1.5 kg, 0.5 L | Decimal commas and dropped leading zeros |
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

A warning about diagnosing this class of bug: `document.elementFromPoint` was
**useless** here, because the badge then set `pointer-events: none`, so
hit-testing reported the element underneath whether or not the badge was
visible. (The badge now accepts hover so its explanatory tooltip can appear.)
The only trustworthy check is pixels — screenshot the card, change one
property, screenshot again.

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
anywhere the content script runs — except on a site switched off on the
options page, which never activates by URL, by content or from the toolbar.

---

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Remembers your threshold and unit |
| `*://*.google.com/*` | Content script runs on Google search/shopping only |
| `*://*.amazon.com/*` (+ `.co.uk`, `.ca`, `.com.au`) | Amazon search results |
| `*://*.walmart.com/*` (+ `.ca`) | Walmart search, browse, shop and category pages (walmart.ca under its `/en/` and `/fr/` paths) |
| `*://discover.gotoaisle.com/*` | Content script that filters the Aisle offers page to free offers; it makes no network requests |

Every host is declared explicitly. There is no `<all_urls>`, no `tabs` and no
analytics. The only network requests are the product-page lookups described
above, made when you click **Look up** or turn on automatic lookup, to these
same hosts and without cookies.

---

## Known limitations

- **The Aisle filter reads wording, not markup.** Only offers that say they
  are free are shown, so a free offer phrased in a way the rules in
  `src/common/offer-classifier.js` do not recognise is hidden. Add the phrase
  to `test/offer-classifier.test.js` and the rules; **Show all** reveals
  everything meanwhile.
- **Three stores only.** Google, Amazon and Walmart. Adding another means a
  profile in `src/content/sites.js`, a match pattern in `manifest.json`, and a
  switch in `SITES` in `src/common/settings.js` plus `src/options/options.html`
  (`test/sites.test.js` fails until all of them exist); match patterns cannot
  wildcard a TLD, so each national domain is listed individually.
- **It compares search results, not competing offers for one product.** The
  extension ranks the items *on the page* by unit price. It does not open
  Amazon's "Other Sellers on Amazon" box or Walmart's marketplace offers and
  compare those — that is a different feature, on a different page.
- **US customary volumes.** A UK fluid ounce is 28.41 ml, not 29.57 ml. Results
  on `google.co.uk` and `amazon.co.uk` will be ~4% off for `fl oz`.
- **Some products state no size anywhere.** A lookup cannot find what the
  store never wrote down: some product pages give only a serving count
  ("Size: 27"). Those stay `no size`.
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
3. **National Google domains** behind an options page.
4. **A per-count basis** (price per 100 tablets, per sheet), now that
   `$0.13/100 Count` is parsed rather than misread.

Sorting and content-based activation, formerly items 3 and 4, have shipped.
See `TASKS.md` for the reviewed backlog and its status.

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
