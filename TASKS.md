# Backlog

Reviewed at v0.2.0. Everything below was read in source and, where marked
*verified*, reproduced. Ordered by priority: P0 items are user-visible
correctness or security, P1 is performance and durability, P2 is product work.

**Status at v0.4.0:** every item is **[done]**. DOM-free logic shipped with
tests (`test/settings.test.js`, `test/verdict.test.js`,
`test/history.test.js`); the rest was verified in a browser against the
offline fixture.

---

## P0 — correctness and security

### 1. [done] The threshold box does nothing when no currency is detected — *verified*
`setThreshold(settings, currency, value)` returns the settings **unchanged**
when `currency` is falsy, and `applySettings` has already `delete`d
`patch.threshold` by then, so nothing else applies it. `state.currency` comes
from `pageCurrency()`, which returns `dominantCurrency()` — `null` when no card
yielded a parseable currency (a page of "no size" cards, a slow first paint, a
storefront printing bare numbers).

Reproduced:

```js
settings.setThreshold(settings.sanitize({}), null, 7).threshold  // => 3
```

The user types a limit, the panel re-renders it back to the old value, and
there is no error anywhere. Fix: fall back to a `'*'` bucket (or the page's
storefront default) rather than dropping the write, and make `render` show that
the limit is un-scoped.

### 2. [done] `subscribe` scans dormant pages
`init()` wires `settingsApi.subscribe(next => { state.settings = next; scan(); })`
with no `isActive()` guard. Changing settings in another tab therefore badges
and hides cards on ordinary `google.com/search` pages, which the activation
logic is otherwise careful never to do. Route it through `scheduleScan()`.

### 3. [done] `applySettings` mutates its argument
`delete patch.threshold` edits the object the panel owns. The panel currently
discards each patch after emitting, so it is latent — but `emit()` keeps
`pendingPatch` alive across a debounce window and the next `flush()` would
replay a patch that has been silently edited. Copy before mutating.

### 4. [done] The toolbar button force-activates even when hiding the panel
`chrome.runtime.onMessage` sets `state.forced = true` unconditionally, then
toggles `panelVisible`. Clicking the icon to *dismiss* the panel therefore also
opts the page into annotation permanently. Only set `forced` when turning the
panel on.

### 5. [done] Money regexes disagree about which currencies exist
`parse-price.js` `SYMBOLS` covers 16 symbols; `PRICE_TOKEN_RE` and
`WAS_PRICE_RE` in `site-adapter.js` and `CURRENCY_BEFORE_RE` in
`parse-quantity.js` each hard-code a different, shorter subset (`[$€£]`,
`[$£€¥₹]`). On a ¥ or ₹ storefront a price leaks into the size parser and a
struck-through original is never stripped. Export one symbol class from
`units.js` and use it everywhere.

### 6. [done] European thousands separators misparse — *verified*, latent
`normalizeNumber('1.234')` returns `1.234`, not `1234`. No `.de`/`.fr`
storefront is in the manifest yet, so this is only a trap for the next store
added. Resolved by the price's own currency: a lone dot before exactly three
digits is grouping for EUR, BRL, JPY and the other comma-decimal or
zero-decimal currencies.

---

## P1 — performance and durability

### 7. [done] The analysis cache saves almost nothing
`analyzeCard` calls `extractTitle`, `extractPrice` **and** `extractUnitPrice`
to build the cache key, then checks the cache. `extractUnitPrice` alone runs a
full `TreeWalker` over the card via `spacedText`. Only `parseQuantity` is
actually memoised. Key on something cheap (a text-length plus first-price
probe) or invalidate from the MutationObserver instead.

### 8. [done] Two O(n²) scans over the card set
`findCardsBySelector` compares every match against every other match to drop
nested ones, and `findCardsIn` compares every structural hit against every
selector hit. On a 150-card Walmart page that is ~45,000 `contains()` calls per
scan. Both reduce to a single pass with a `Set` and `closest()`.

### 9. [done] Layout thrashing during `decorate`
Each card interleaves reads (`getBoundingClientRect`, `getComputedStyle`) with
writes (`card.style.position`, attribute changes), forcing a synchronous
reflow per card. Batch: measure every card, then mutate every card.

### 10. [done] `findCards()` runs twice on unrecognised pages
`looksLikeResultsByContent()` calls `findCards()` and throws the result away,
then `scan()` calls it again. Return the cards from the probe.

### 11. [done] Every keystroke triggers a full DOM re-scan
`applySettings` calls `scan()`, which re-walks the document. Changing a
threshold cannot change which cards exist — only how they are classified. Split
`scan()` into `collect()` and `classify()`, and call only `classify()` for
settings changes.

### 12. [done] `scan()` probes product URLs for every unsized card, every scan
The `detailLookup` count loop calls `adapter.extractProductUrl` per unsized
card per scan, each a `querySelectorAll('a[href]')` plus `new URL()`. Cache the
result on the card.

### 13. [done] Package-size lookups are strictly sequential
`findPackageSizes` awaits eight fetches one at a time. With the new 8s timeout
that is a 64s worst case. Run them with a concurrency of 3–4.

---

## P2 — product, UX and process

### 14. [done] No options page and no popup
Every setting lives in an in-page panel that only appears on a results page. A
user who dismisses the panel has no way to change anything from
`chrome://extensions`. Add an options page sharing `settings.js`.

### 15. [done] Two settings are unreachable from the UI
`minConfidence` and `debug` are sanitised, persisted and honoured, but no
control exists for either. Either expose them (an "how strict?" slider is
genuinely useful) or drop them.

### 16. [done] Sort by unit price
The single highest-value missing feature. The extension already computes the
number the store refuses to rank by; reordering the grid by it — rather than
only hiding and badging — is the obvious next step.

### 17. [done] The panel cannot be moved
Fixed bottom-right, where Walmart puts its chat launcher and Amazon its
back-to-top control. Add a drag handle, or at least a corner toggle, persisted
in settings.

### 18. [done] No price history, no comparison across tabs
Nothing remembers that the same product was $2.05/lb yesterday. A small
`chrome.storage.local` ring buffer keyed by normalised title would enable
"cheaper than you've seen" without any server.

### 19. [done] Currency display is approximate
`CURRENCY_SYMBOLS` maps CAD, AUD, SGD and HKD all to a bare `$`. Use
`Intl.NumberFormat(locale, { style: 'currency', currency })` so a Canadian page
reads `CA$` and formatting follows the user's locale.

### 20. [done] Onboarding is invisible
First run shows a panel with a `$3/lb` default and no explanation of where that
number came from or what the badge colours mean. A one-time inline legend,
dismissible, would carry most of it.

### 21. [done] Test coverage has two holes
71 tests, none covering `settings.js` (where bug #1 lives) or the `evaluate()` /
`evaluateDeclared()` / `evaluateInferred()` verdict logic — the code that
decides what the user actually sees. Both are pure functions and trivially
testable.

### 22. [done] No `package.json`, lint config or CI
Tests are run by remembering to quote a glob. Add a `package.json` with a
`test` script, an ESLint config (it would have caught the duplicate `var i` in
`extractTitle`), and a GitHub Actions workflow.

`package.json`, CI, a dependency-free `tools/check.js` (syntax, manifest
paths, content-script load order) and ESLint 10 (dev-only, `npm run lint`)
are in. The first lint run found one issue, a dead initial assignment in
`extractUrlSizeText`.

### 23. [done] `extractTitle` redeclares `var i`
Declared at the top of the function and again in the final `for`. Harmless
under `var` hoisting, but it is exactly the class of thing a linter exists for.

---

## Done in this pass

- **Extension icon redrawn.** The old chevron-over-a-bar read as "collapse" or
  "download" in the toolbar. Replaced with a price-tag mark rendered from
  signed-distance fields, so 16px keeps its antialiased edges. See the
  commentary in `tools/make-icons.js` for the two rejected alternatives.
- **Panel glyphs are now inline SVG.** The close control was the character
  U+2715 — whatever the user's fallback font supplied — and the chevron was two
  CSS borders on a rotated box, which smears at fractional DPR. The decorative
  green dot is now the product's own tag mark, and the two action buttons
  carry icons.
- **Badge tooltips were unreachable.** `.ppp-badge` had `pointer-events: none`
  while `main.js` set a `title` on it explaining which price and size were read
  and at what confidence. None of it could ever be shown. The badge now accepts
  hover.
- **Uncertainty flag restyled** from a loose trailing `?` (which read as part
  of the price) to a ringed mark.
- **Redirect-based permission bypass in the service worker.** The host
  permission was checked against the *requested* URL, then `redirect: 'follow'`
  let the response come from an origin nobody had approved. The origin that
  actually answered is now re-checked.
- **Product-page fetch could hang forever.** No timeout, and the content script
  awaits each lookup in turn, so one unresponsive merchant wedged the panel on
  "Looking for package sizes…" for the life of the page. Added an 8s
  `AbortController` deadline and a `finally` that always clears the busy flag.

---

# Review at v0.4.0

A second full pass over source, tests and two live Walmart results pages
(walmart.com and walmart.ca, captured and replayed through the real content
scripts). Ordered by priority; every item is **[done]** with tests where the
logic is DOM-free, and verified in the fixture or the replayed pages otherwise.

## P0 — wrong numbers, or no numbers

### 24. [done] Unit prices quoted "per 100 g" were read as the item price — *verified live*
`PER_UNIT_TAIL_RE` allowed only a bare unit after the slash. Amazon UK/CA/AU and
walmart.ca print `£0.83/100 g` / `$4.16/100g`; Amazon US prints
`$0.13/100 Count`. The tail failed, the unit price became an ordinary price
candidate, and the lowest candidate wins — so a £2.50 tin was priced at £0.83.
Worse, `100 g` was then parsed from the card text as the *pack size*: a
walmart.ca card reading \$12.66/lb was badged **\$31.62/lb?**. The tail now
takes an optional quantity, and the quantity parser ignores a size that is the
denominator of a unit price.

### 25. [done] Changing the unit silently changed every limit
Limits are stored as bare numbers in the current basis. Switching lb → kg kept
`3`, turning \$3/lb into \$3/kg (2.2× stricter). `settings.setBasis` now
converts every saved limit within a dimension (4 significant figures, exact
round trip), and a currency with no saved limit starts from the default in the
current unit. Panel and options page both use it.

### 26. [done] walmart.ca never activated — *verified live*
walmart.ca 301-redirects `/search` to `/en/search`. Neither the manifest
matches nor `isResultsPage` allowed the language prefix, so one of the three
advertised stores silently did nothing. Walmart `/cp/` pages had the same
problem on walmart.com. A test now asserts every results URL a profile accepts
is also injected by the manifest.

### 27. [done] Walmart cards read "no price" — *verified live*
On Walmart the accessible price label's parent is the whole tile, and every tile
says "Free shipping" or "Delivery". The non-price context check read the whole
parent and rejected the real price: 6 of 10 cards on a live page. Context is
now the text near the price when the parent is long.

### 28. [done] Product-page lookup trusted "Weight Capacity"
`/^(?:net )?(?:weight|volume)|package (?:weight|size)$/` anchors only one side
of each alternative, so "Weight Capacity" and "Volume Discount" matched. Moved
to the testable `src/common/product-data.js` with full anchoring, depth and
count limits on untrusted JSON-LD, and microdata `QuantitativeValue` support.

## P1 — robustness and coverage

### 29. [done] Walmart's cent prices were invisible — *verified live*
`14.8 ¢/oz` (most Walmart grocery cards) and `88¢` matched no price pattern.
Cent amounts now parse, carry no currency of their own, and never sway the
page's currency.

### 30. [done] An extension update broke open tabs noisily
After an update the old content script's `chrome.*` calls throw "Extension
context invalidated". Storage and messaging now degrade quietly, the history
write queue survives a failed write, and the panel says to reload the page.

### 31. [done] The toolbar button did nothing on unsupported tabs
It now opens the options page with a note on where the extension works and a
hint to reload pages opened before install or update.

### 32. [done] The panel could run off a short window
With the guide open the panel is ~730 px tall and had no max height, so on a
laptop the header — and the close button — went off-screen. The body now
scrolls within the viewport.

### 33. [done] Finish the "unsized results still showing" note
The uncommitted work at the start of this pass (panel note with a one-click
fix, tooltip explanation, `isolation: isolate` on cards) was reviewed and
verified in the fixture.

## P2 — product and UX

### 34. [done] Per-100 g and per-100 ml bases
How UK, Canadian and Australian shelves quote unit prices. Items measured the
other way are now badged in a paired unit (100 ml beside 100 g, fl oz beside
oz, kg beside L) instead of always lb or L.

### 35. [done] Package-size lookup gave no result
The button just disappeared. The panel now reports "Found 2 package sizes on 4
product pages" / "No package sizes found…", and one failing page no longer
abandons the rest of the queue.

### 36. [done] Product pages were downloaded whole, then truncated
The service worker now streams the body and stops at 300 KB, and skips
non-HTML responses.

### 37. [done] Keyboard shortcut and toolbar count
`Alt+Shift+U` toggles the panel (shown, and changeable, on the options page).
While hiding is on, the toolbar icon shows how many results are hidden on that
tab.

### 38. [done] Small UX fixes
The options page says which unit limits are per; a cleared threshold box is
restored on blur instead of left blank; the guide formats the limit as money.

## P3 — latent parsing gaps

### 39. [done] `1,5 kg`, `.5 L` and `1 234,56 €`
Decimal-comma sizes (amazon.ca in French), dropped leading zeros, and a decimal
comma after a U+202F grouping space (read as 123456) all parse correctly.

---

# Product-page lookups (v0.4.0, follow-up)

Prompted by "a lot of products still show no price or no weight". Measured
first on live searches (Amazon 4, Walmart 3; Google serves automated
browsers a CAPTCHA, so it could not be measured).

### 40. [done] The size lookup could never succeed on Amazon or Walmart — *verified live*
It read only Schema.org `weight`. Walmart product pages have one ld+json
block, describing the WebPage; Amazon's have none. Both stores' pages are now
read for what they do contain: Walmart's Next.js state (`product.priceInfo`,
`idml.specifications`, read without building a DOM) and Amazon's title and
core price block (`.priceToPay`, `.pricePerUnit`). Amazon's "Item Weight" is
deliberately not read: it is the shipping weight, and a tub titled "5 LB"
listed "3 pounds". The readers live in `src/common/product-data.js`.

### 41. [done] The page was cut off before the data — *verified live*
The 300 KB cap ended every page before the parts read: Walmart's JSON runs from
~1 MB to the end of a 1.5–2 MB page; Amazon's title and price sit 520–720 KB
into a ~3 MB page. Now 3 MB (1.2 MB on Amazon), still streamed and stopped at
the cap.

### 42. [done] Lookups now fill price and unit price too, not just size
"No price" cards get the product page's price; cards with no comparable unit
price get the store's own. Results are keyed by product URL (ASIN on Amazon), so
a re-rendered card reuses them, and only gaps on the card are filled.

### 43. [done] Sponsored results linked to ad trackers — *verified live*
4 of 5 unsized cards on a live Walmart search linked through `/sp/track?rd=`;
Amazon uses `/sspa/click?url=`. They are now unwrapped, so a lookup fetches the
product rather than registering an ad click, and a size in the wrapped link
("…-19-0-oz-…") is read with no request at all. A wrapper is never itself read
as a product link. Store-relative product links (`/ip/…`, `/dp/…`) are now read
for sizes too.

### 44. [done] Automatic lookup, progress and back-off
Opt-in "Look up automatically" (panel and options page). Progress shows as
"Checking product pages… 4 of 7"; the result counts only pages that changed a
verdict. HTTP 429/503, a redirect to a bot-check path, or a bot-check page stops
the queue and the panel says the store stopped answering. Cards the store
prices per count or per load are not looked up: their pages say the same.

### 45. [done] Card-copy nutrition claims read as sizes — *verified live*
"25g of Protein, 5.5g BCAAs, 5 lb" was "size unclear" on Amazon. Gram figures up
to 100 g followed by a nutrient are now ignored; "500g Protein Powder" is not.

### 46. [done] Promotional price ceilings detected as results — *verified live*
Walmart's "Find yummy fall faves under $3" banner was badged as an unpriceable
result. "Under/below/less than/up to $X" is no longer read as a price.

### 47. [done] A literal `</script>` broke the fixture harness
`tools/build-fixture.js` inlines the sources into one script element; the new
reader's `'</script>'` ended it early. Now split as `'</' + 'script>'`, and
`npm run check` now rejects the literal in content scripts.
