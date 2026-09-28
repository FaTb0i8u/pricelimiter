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
