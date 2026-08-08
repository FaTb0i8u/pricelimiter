"use strict";

/**
 * Writes the fixture page to disk with the real extension sources inlined, so
 * the whole content-script pipeline can be exercised in a real browser engine.
 *
 *   node tools/build-fixture.js
 *   open the printed file:// URL
 *
 * The scripts are taken from manifest.json in the order the manifest injects
 * them, so this cannot drift from what Chrome actually loads. Only two things
 * are faked:
 *
 *   - `chrome` is absent, so settings.js falls back to its defaults, which it
 *     already handles deliberately (see hasStorage());
 *   - `isShoppingSurface()` is forced true, because a file:// URL is obviously
 *     not google.com/shopping.
 *
 * Everything else -- card detection, parsing, badges, the highlight, the panel
 * -- is the shipping code.
 */

const fs = require("node:fs");
const path = require("node:path");
const { html } = require("../test/fixtures/shopping-fixture.js");

const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

const manifest = JSON.parse(read("manifest.json"));
const scripts = manifest.content_scripts[0].js;
const css = manifest.content_scripts[0].css.map(read).join("\n");

/** Forces the adapter to treat this page as a Shopping surface. */
const ACTIVATE_SHIM = `
/* ===== test shim ===== */
PPP.adapter.isShoppingSurface = function () { return true; };
`;

/** Reads back what the real pipeline wrote, and drives the real panel UI. */
const INSPECTOR = `
/* ===== test inspector ===== */
window.__pppInspect = function () {
  var cards = [].slice.call(document.querySelectorAll('[data-ppp-card]'));
  var host = document.querySelector('[data-ppp-ui="panel"]');
  var shadow = host && host.shadowRoot;
  return {
    cards: cards.map(function (c) {
      var badge = c.querySelector(':scope > .ppp-badge');
      var style = getComputedStyle(c);
      var titleEl = c.querySelector('.title');
      return {
        title: titleEl ? titleEl.textContent : '',
        state: c.getAttribute('data-ppp-state'),
        hidden: c.hasAttribute('data-ppp-hidden'),
        best: c.getAttribute('data-ppp-best') === 'true',
        flash: c.getAttribute('data-ppp-flash') === 'true',
        tabindex: c.getAttribute('tabindex'),
        badgeText: badge ? badge.textContent.replace(/\\s+/g, ' ').trim() : null,
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
        width: Math.round(c.getBoundingClientRect().width)
      };
    }),
    panel: shadow ? {
      stats: shadow.querySelector('[data-role="stats"]').textContent,
      bestButton: shadow.querySelector('[data-action="best"]').hidden
        ? null
        : shadow.querySelector('[data-action="best"]').textContent.trim()
    } : null
  };
};

/** Drives the real panel controls, exactly as a user would. */
window.__pppSet = function (opts) {
  var shadow = document.querySelector('[data-ppp-ui="panel"]').shadowRoot;
  if ('threshold' in opts) {
    var input = shadow.getElementById('ppp-threshold');
    input.value = String(opts.threshold);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if ('basis' in opts) {
    var select = shadow.getElementById('ppp-basis');
    select.value = opts.basis;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if ('filterEnabled' in opts) {
    var toggle = shadow.getElementById('ppp-enabled');
    toggle.checked = opts.filterEnabled;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  }
};

window.__pppJump = function () {
  document.querySelector('[data-ppp-ui="panel"]').shadowRoot
    .querySelector('[data-action="best"]').click();
};
`;

const inlined = scripts
  .map((file) => {
    const source = `/* ===== ${file} ===== */\n${read(file)}`;
    // The shim must land after the adapter defines the function it replaces,
    // but before main.js reads it.
    return file.endsWith("site-adapter.js") ? source + "\n" + ACTIVATE_SHIM : source;
  })
  .join("\n");

// A FUNCTION replacement is required, not a string: string replacements treat
// "$'", "$&" and "$`" as substitution patterns, and the currency table in
// parse-price.js literally contains  '$': 'USD'  -- the "$'" in there would
// splice the rest of the document into the middle of the script.
const page = html
  .replace("</head>", () => `<style>${css}</style>\n</head>`)
  .replace("</body>", () => `<script>\n${inlined}\n${INSPECTOR}\n</script>\n</body>`);

const outFile = path.join(root, "test", "fixtures", "generated-page.html");
fs.writeFileSync(outFile, page);
process.stdout.write(`file://${outFile}\n`);
