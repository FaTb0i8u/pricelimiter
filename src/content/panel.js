/**
 * In-page control panel.
 *
 * Rendered inside a closed-ish shadow root so that Google's stylesheets cannot
 * affect it and ours cannot affect Google. Positioned bottom-right, collapsible
 * and dismissible, and fully keyboard operable.
 */
;(function (root) {
  'use strict';

  var PPP = (root.PPP = root.PPP || {});
  var BASES = PPP.units.BASES;

  /**
   * Inline SVG rather than text glyphs or CSS-drawn shapes.
   *
   * The close control used to be the character U+2715, which renders in
   * whatever the user's fallback font happens to supply and sits on a
   * different baseline in every one of them; the collapse chevron was two
   * CSS borders on a rotated box, which smears at fractional device pixel
   * ratios. Both are geometry, so they are expressed as geometry.
   */
  var ICONS = {
    tag:
      '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" fill-rule="evenodd" d="M3 1.4h5.6c.42 0 .83.17 1.13.47l5 5' +
      'a1.6 1.6 0 0 1 0 2.26l-5.6 5.6a1.6 1.6 0 0 1-2.26 0l-5-5A1.6 1.6 0 0 1 1.4 8.6V3' +
      'A1.6 1.6 0 0 1 3 1.4Zm1.9 4.7a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z"/></svg>',
    chevron:
      '<svg class="icon chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
      ' stroke-linejoin="round" d="m4.5 6.25 3.5 3.5 3.5-3.5"/></svg>',
    close:
      '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
      ' d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
    target:
      '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="5.4"/>' +
      '<circle cx="8" cy="8" r="1.5"/></g></svg>',
    search:
      '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
      '<circle cx="7" cy="7" r="4.3"/><path d="m10.4 10.4 3.1 3.1"/></g></svg>',
    help:
      '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
      '<circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"' +
      ' d="M6.2 6.4a1.85 1.85 0 1 1 2.55 1.7c-.47.2-.75.55-.75 1.05v.35"/>' +
      '<circle cx="8" cy="11.4" r=".9" fill="currentColor"/></svg>'
  };

  var TEMPLATE = [
    '<div class="panel" part="panel" data-corner="bottom-right">',
    '  <div class="header" data-role="drag-handle" title="Drag to move">',
    '    <span class="mark" aria-hidden="true">' + ICONS.tag + '</span>',
    '    <h2 class="title">Unit price filter</h2>',
    '    <button class="icon-btn" data-action="help" type="button"',
    '            aria-expanded="false" aria-controls="ppp-legend" title="How to read the badges">',
    ICONS.help,
    '      <span class="sr-only">How to read the badges</span>',
    '    </button>',
    '    <button class="icon-btn" data-action="collapse" type="button"',
    '            aria-expanded="true" aria-controls="ppp-body" title="Collapse panel">',
    ICONS.chevron,
    '      <span class="sr-only">Collapse panel</span>',
    '    </button>',
    '    <button class="icon-btn" data-action="close" type="button" title="Hide panel">',
    ICONS.close,
    '      <span class="sr-only">Hide panel</span>',
    '    </button>',
    '  </div>',
    '  <div class="body" id="ppp-body">',
    '    <section class="legend" id="ppp-legend" aria-labelledby="ppp-legend-title" hidden>',
    '      <h3 class="legend-title" id="ppp-legend-title">Reading the badges</h3>',
    '      <ul class="legend-list">',
    '        <li><span class="chip chip-pass">$2.05/lb</span> within your limit</li>',
    '        <li><span class="chip chip-fail">$9.00/lb</span> over your limit</li>',
    '        <li><span class="chip chip-best">Best value</span> cheapest result you can see</li>',
    '        <li><span class="chip chip-muted">no size</span> size not listed \u2013 never hidden unless you ask</li>',
    '        <li><span class="chip chip-muted">$4.10/lb <span class="chip-flag">?</span></span> size guessed from the title</li>',
    '        <li><span class="chip chip-note">New low</span> cheaper than you\u2019ve seen it before</li>',
    '      </ul>',
    '      <p class="legend-hint" data-role="legend-hint"></p>',
    '      <button class="legend-dismiss" data-action="dismiss-legend" type="button">Got it</button>',
    '    </section>',
    '    <div class="field">',
    '      <label class="label" for="ppp-threshold">Max price per unit</label>',
    '      <div class="input-row">',
    '        <div class="money">',
    '          <span class="prefix" data-role="currency">$</span>',
    '          <input id="ppp-threshold" class="number" type="number" inputmode="decimal"',
    '                 min="0" step="0.01" autocomplete="off">',
    '        </div>',
    '        <label class="sr-only" for="ppp-basis">Unit</label>',
    '        <select id="ppp-basis" class="select"></select>',
    '      </div>',
    '    </div>',
    '    <label class="switch">',
    '      <input id="ppp-enabled" type="checkbox">',
    '      <span class="track" aria-hidden="true"><span class="thumb"></span></span>',
    '      <span class="switch-label">Hide results above this price</span>',
    '    </label>',
    '    <div class="checks">',
    '      <label class="check">',
    '        <input id="ppp-hide-unknown" type="checkbox">',
    '        <span>Also hide items with no listed size</span>',
    '      </label>',
    '      <label class="check">',
    '        <input id="ppp-hide-other" type="checkbox">',
    '        <span data-role="other-dimension-label">Also hide items sold by volume</span>',
    '      </label>',
    '    </div>',
    '    <label class="check">',
    '      <input id="ppp-sort" type="checkbox">',
    '      <span>Sort results by unit price</span>',
    '    </label>',
    '    <p class="stats" data-role="stats" role="status" aria-live="polite"></p>',
    '    <p class="unsized-note" data-role="unsized-note" hidden>',
    '      <span data-role="unsized-text"></span>',
    '      <button class="link" data-action="hide-unsized" type="button">Hide them too</button>',
    '    </p>',
    '    <button class="best" data-action="best" type="button" hidden>',
    ICONS.target,
    '      <span data-role="best-label"></span>',
    '    </button>',
    '    <button class="detail" data-action="detail" type="button" hidden>',
    ICONS.search,
    '      <span data-role="detail-label"></span>',
    '    </button>',
    '    <p class="detail-result" data-role="detail-result" role="status" hidden></p>',
    '    <div class="footer">',
    '      <span class="links">',
    '        <button class="link" data-action="rescan" type="button">Rescan page</button>',
    '        <button class="link" data-action="options" type="button">Settings</button>',
    '      </span>',
    '      <span class="hint" data-role="hint"></span>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');

  var STYLES = [
    // `all: initial` shields the panel from Google's stylesheets, but it also
    // beats the UA rule for [hidden], so display is restored explicitly.
    // The host is appended directly to <html>. Keep that otherwise invisible
    // box out of hit testing: some retailer layouts give it a page-width box,
    // which can sit above result links even though the fixed panel is small.
    ':host { all: initial; display: block; pointer-events: none; }',
    ':host([hidden]) { display: none; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    '.panel {',
    '  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;',
    '  pointer-events: auto;',
    '  width: 292px; max-width: calc(100vw - 32px);',
    // With the guide open the panel is ~730px tall. On a short window it ran
    // off the top, taking the close button with it; now the body scrolls.
    '  display: flex; flex-direction: column; max-height: calc(100vh - 32px);',
    '  font: 400 13px/1.5 Roboto, Arial, system-ui, sans-serif; color: #202124;',
    '  background: #fff; border: 1px solid #dadce0; border-radius: 12px;',
    '  box-shadow: 0 6px 20px rgba(60,64,67,.28); overflow: hidden;',
    '}',
    '.panel[data-corner="bottom-left"] { right: auto; left: 16px; }',
    '.panel[data-corner="top-right"] { bottom: auto; top: 16px; }',
    '.panel[data-corner="top-left"] { bottom: auto; top: 16px; right: auto; left: 16px; }',
    '.panel[data-dragging="true"] { box-shadow: 0 12px 32px rgba(60,64,67,.38); user-select: none; }',
    '.header { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 8px 10px 12px;',
    '  background: #f8f9fa; border-bottom: 1px solid #e8eaed; cursor: grab; touch-action: none; }',
    '.panel[data-dragging="true"] .header { cursor: grabbing; }',
    '.mark { flex: none; display: grid; place-items: center; color: #1e8e3e; }',
    '.icon { width: 16px; height: 16px; display: block; }',
    '.title { flex: 1; margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .1px; }',
    '.icon-btn { flex: none; width: 26px; height: 26px; display: grid; place-items: center;',
    '  border: 0; border-radius: 6px; background: transparent; color: #5f6368; cursor: pointer;',
    '  padding: 0; }',
    '.icon-btn:hover { background: #e8eaed; color: #202124; }',
    '.icon-btn:focus-visible { outline: 2px solid #1a73e8; outline-offset: 1px; }',
    '.chevron { transition: transform 120ms ease; }',
    '.panel[data-collapsed="true"] .chevron { transform: rotate(180deg); }',
    '.panel[data-collapsed="true"] .body { display: none; }',
    '.body { padding: 12px; display: flex; flex-direction: column; gap: 12px;',
    '  min-height: 0; overflow-y: auto; overscroll-behavior: contain; }',
    '.body > * { flex: none; }',
    '.field { display: flex; flex-direction: column; gap: 6px; }',
    '.label { font-size: 12px; font-weight: 600; color: #3c4043; }',
    '.input-row { display: flex; gap: 8px; }',
    '.money { flex: 1 1 auto; min-width: 0; height: 34px; display: flex; align-items: center;',
    '  gap: 4px; padding: 0 8px; background: #fff; border: 1px solid #dadce0; border-radius: 8px; }',
    '.prefix { flex: none; color: #5f6368; font-size: 13px; }',
    '.number { flex: 1 1 auto; min-width: 0; width: 100%; height: 100%; padding: 0; font: inherit;',
    '  color: inherit; background: transparent; border: 0; outline: none; }',
    '.select { flex: 0 0 100px; height: 34px; padding: 0 6px; font: inherit; color: inherit;',
    '  background: #fff; border: 1px solid #dadce0; border-radius: 8px; }',
    '.money:focus-within, .select:focus-visible { outline: 2px solid #1a73e8; outline-offset: 0;',
    '  border-color: #1a73e8; }',
    '.switch { display: flex; align-items: center; gap: 10px; cursor: pointer; }',
    '.switch input { position: absolute; opacity: 0; width: 0; height: 0; }',
    '.track { position: relative; flex: none; width: 34px; height: 18px; border-radius: 999px;',
    '  background: #bdc1c6; transition: background 120ms ease; }',
    '.thumb { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;',
    '  border-radius: 50%; background: #fff; transition: transform 120ms ease; }',
    '.switch input:checked + .track { background: #1e8e3e; }',
    '.switch input:checked + .track .thumb { transform: translateX(16px); }',
    '.switch input:focus-visible + .track { outline: 2px solid #1a73e8; outline-offset: 2px; }',
    '.switch-label { font-size: 13px; }',
    '.checks { display: flex; flex-direction: column; gap: 6px; }',
    '.check { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: #3c4043;',
    '  cursor: pointer; }',
    '.check input { margin: 2px 0 0; accent-color: #1a73e8; }',
    '.check input:focus-visible { outline: 2px solid #1a73e8; outline-offset: 1px; }',
    '.stats { margin: 0; font-size: 12px; color: #5f6368; min-height: 18px; }',
    '.unsized-note { margin: 0; padding: 7px 10px; font-size: 12px; color: #3c4043;',
    '  background: #fef7e0; border: 1px solid #fce8b2; border-radius: 8px; }',
    '.unsized-note[hidden] { display: none; }',
    '.best { width: 100%; padding: 8px 10px; display: flex; align-items: center; gap: 8px;',
    '  text-align: left; font: inherit; font-size: 12px;',
    '  color: #0d652d; background: #e6f4ea; border: 1px solid #a8dab5; border-radius: 8px;',
    '  cursor: pointer; }',
    '.best:hover { background: #ceead6; }',
    '.best:focus-visible { outline: 2px solid #1a73e8; outline-offset: 1px; }',
    '.detail { width: 100%; padding: 7px 10px; display: flex; align-items: center; gap: 8px;',
    '  text-align: left; font: inherit; font-size: 12px;',
    '  color: #1a73e8; background: #f8f9fa; border: 1px solid #dadce0; border-radius: 8px; cursor: pointer; }',
    '.detail:hover:not(:disabled) { background: #e8f0fe; } .detail:disabled { color: #80868b; cursor: wait; }',
    '.detail:focus-visible { outline: 2px solid #1a73e8; outline-offset: 1px; }',
    '.detail-result { margin: -6px 0 0; font-size: 12px; color: #5f6368; }',
    '.best[hidden], .detail[hidden], .detail-result[hidden] { display: none; }',
    '.footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
    '.links { display: flex; gap: 12px; }',
    '.link { padding: 0; font: inherit; font-size: 12px; color: #1a73e8; background: none;',
    '  border: 0; cursor: pointer; text-decoration: underline; }',
    '.link:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }',
    '.hint { font-size: 11px; color: #80868b; }',
    '.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;',
    '  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
    '.legend { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;',
    '  background: #f8f9fa; border: 1px solid #e8eaed; border-radius: 8px; }',
    '.legend[hidden] { display: none; }',
    '.legend-title { margin: 0; font-size: 12px; font-weight: 600; }',
    '.legend-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column;',
    '  gap: 5px; font-size: 12px; color: #3c4043; }',
    '.legend-list li { display: flex; align-items: center; gap: 8px; }',
    '.chip { flex: none; display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px;',
    '  border: 1px solid #dadce0; border-radius: 999px; font-size: 11px; font-weight: 600;',
    '  background: #f1f3f4; color: #5f6368; white-space: nowrap; }',
    '.chip-pass { background: #e6f4ea; border-color: #a8dab5; color: #0d652d; }',
    '.chip-fail { background: #fce8e6; border-color: #f5b5ae; color: #a50e0e; }',
    '.chip-best { background: #0d652d; border-color: #0d652d; color: #fff;',
    '  font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }',
    '.chip-note { background: #fff; color: #1967d2;',
    '  font-size: 10px; text-transform: uppercase; letter-spacing: .4px; }',
    '.chip-flag { display: inline-grid; place-items: center; width: 12px; height: 12px;',
    '  border: 1px solid currentColor; border-radius: 50%; font-size: 9px; line-height: 1; }',
    '.legend-hint { margin: 0; font-size: 12px; color: #5f6368; }',
    '.legend-dismiss { align-self: flex-start; padding: 5px 12px; font: inherit; font-size: 12px;',
    '  font-weight: 600; color: #fff; background: #1e8e3e; border: 0; border-radius: 6px; cursor: pointer; }',
    '.legend-dismiss:hover { background: #188038; }',
    '.legend-dismiss:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }',
    '.icon-btn[aria-expanded="true"][data-action="help"] { background: #e8eaed; color: #202124; }',
    '@media (prefers-color-scheme: dark) {',
    '  .legend { background: #292a2d; border-color: #3c4043; }',
    '  .legend-list, .legend-hint { color: #bdc1c6; }',
    '  .chip { background: #303134; border-color: #5f6368; color: #bdc1c6; }',
    '  .chip-pass { background: #12351f; border-color: #1e8e3e; color: #81c995; }',
    '  .chip-fail { background: #3b1512; border-color: #b3261e; color: #f28b82; }',
    '  .chip-best { background: #1e8e3e; border-color: #1e8e3e; color: #fff; }',
    '  .chip-note { background: #202124; color: #8ab4f8; }',
    '  .icon-btn[aria-expanded="true"][data-action="help"] { background: #3c4043; color: #e8eaed; }',
    '  .panel { background: #202124; border-color: #3c4043; color: #e8eaed; }',
    '  .header { background: #292a2d; border-bottom-color: #3c4043; }',
    '  .mark { color: #81c995; }',
    '  .icon-btn { color: #9aa0a6; } .icon-btn:hover { background: #3c4043; color: #e8eaed; }',
    '  .label { color: #bdc1c6; } .check { color: #bdc1c6; } .stats, .detail-result { color: #9aa0a6; }',
    '  .unsized-note { background: #3a3000; border-color: #5c4a00; color: #fde293; }',
    '  .money, .select { background: #202124; border-color: #5f6368; color: #e8eaed; }',
    '  .prefix { color: #9aa0a6; }',
    '  .best { background: #12351f; border-color: #1e8e3e; color: #81c995; }',
    '  .detail { background: #292a2d; border-color: #5f6368; color: #8ab4f8; }',
    '  .link { color: #8ab4f8; } .hint { color: #80868b; }',
    '}',
    '@media (prefers-reduced-motion: reduce) { .track, .thumb, .chevron { transition: none; } }'
  ].join('\n');

  function createPanel(handlers) {
    var host = document.createElement('div');
    host.setAttribute('data-ppp-ui', 'panel');
    host.style.position = 'static';
    host.hidden = true; // the first render decides whether to show it
    var shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    var wrapper = document.createElement('div');
    wrapper.innerHTML = TEMPLATE;
    shadow.appendChild(wrapper);

    var refs = {
      panel: shadow.querySelector('.panel'),
      threshold: shadow.getElementById('ppp-threshold'),
      basis: shadow.getElementById('ppp-basis'),
      enabled: shadow.getElementById('ppp-enabled'),
      hideUnknown: shadow.getElementById('ppp-hide-unknown'),
      hideOther: shadow.getElementById('ppp-hide-other'),
      sort: shadow.getElementById('ppp-sort'),
      dragHandle: shadow.querySelector('[data-role="drag-handle"]'),
      currency: shadow.querySelector('[data-role="currency"]'),
      otherLabel: shadow.querySelector('[data-role="other-dimension-label"]'),
      stats: shadow.querySelector('[data-role="stats"]'),
      unsizedNote: shadow.querySelector('[data-role="unsized-note"]'),
      unsizedText: shadow.querySelector('[data-role="unsized-text"]'),
      hideUnsized: shadow.querySelector('[data-action="hide-unsized"]'),
      hint: shadow.querySelector('[data-role="hint"]'),
      best: shadow.querySelector('[data-action="best"]'),
      bestLabel: shadow.querySelector('[data-role="best-label"]'),
      detail: shadow.querySelector('[data-action="detail"]'),
      detailLabel: shadow.querySelector('[data-role="detail-label"]'),
      detailResult: shadow.querySelector('[data-role="detail-result"]'),
      collapse: shadow.querySelector('[data-action="collapse"]'),
      close: shadow.querySelector('[data-action="close"]'),
      help: shadow.querySelector('[data-action="help"]'),
      legend: shadow.getElementById('ppp-legend'),
      legendHint: shadow.querySelector('[data-role="legend-hint"]'),
      dismissLegend: shadow.querySelector('[data-action="dismiss-legend"]'),
      rescan: shadow.querySelector('[data-action="rescan"]'),
      options: shadow.querySelector('[data-action="options"]')
    };

    Object.keys(BASES).forEach(function (key) {
      var option = document.createElement('option');
      option.value = key;
      option.textContent = 'per ' + BASES[key].label;
      refs.basis.appendChild(option);
    });

    var debounceTimer = null;
    var pendingPatch = null;

    /** Apply a debounced edit right now, if one is waiting. */
    function flush() {
      if (!debounceTimer) return;
      clearTimeout(debounceTimer);
      debounceTimer = null;
      var patch = pendingPatch;
      pendingPatch = null;
      if (patch) handlers.onChange(patch);
    }

    /**
     * `immediate` changes (toggles, selects) flush any pending typed edit
     * first. Without this, the re-render they trigger would momentarily revert
     * the threshold box to its old value before the debounce caught up.
     */
    function emit(patch, immediate) {
      if (immediate) {
        flush();
        handlers.onChange(patch);
        return;
      }
      pendingPatch = patch;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        pendingPatch = null;
        handlers.onChange(patch);
      }, 180);
    }

    refs.threshold.addEventListener('input', function () {
      var value = parseFloat(refs.threshold.value);
      if (!isFinite(value) || value < 0) return;
      emit({ threshold: value });
    });
    // Commit immediately when the field is left or Enter is pressed, rather
    // than waiting out the debounce.
    refs.threshold.addEventListener('change', flush);
    refs.threshold.addEventListener('blur', function () {
      flush();
      // A cleared or invalid entry was never applied, so put the limit that
      // is actually in force back rather than leave the box blank.
      var value = parseFloat(refs.threshold.value);
      if (!isFinite(value) || value < 0) rerender();
    });
    refs.basis.addEventListener('change', function () {
      emit({ basis: refs.basis.value }, true);
    });
    refs.enabled.addEventListener('change', function () {
      emit({ filterEnabled: refs.enabled.checked }, true);
    });
    refs.hideUnknown.addEventListener('change', function () {
      emit({ hideUnknown: refs.hideUnknown.checked }, true);
    });
    refs.hideOther.addEventListener('change', function () {
      emit({ hideOtherDimension: refs.hideOther.checked }, true);
    });
    refs.hideUnsized.addEventListener('click', function () {
      emit({ hideUnknown: true }, true);
      refs.hideUnknown.focus();
    });
    refs.sort.addEventListener('change', function () {
      emit({ sortByUnitPrice: refs.sort.checked }, true);
    });
    refs.options.addEventListener('click', function () {
      handlers.onOpenOptions();
    });
    refs.collapse.addEventListener('click', function () {
      var collapsed = refs.panel.getAttribute('data-collapsed') === 'true';
      emit({ panelCollapsed: !collapsed }, true);
    });
    refs.close.addEventListener('click', function () {
      emit({ panelVisible: false }, true);
    });
    refs.rescan.addEventListener('click', function () {
      handlers.onRescan();
    });
    refs.best.addEventListener('click', function () {
      handlers.onJumpToBest();
    });
    refs.detail.addEventListener('click', function () {
      handlers.onFindSizes();
    });

    /*
     * Drag by the header, then snap to the nearest corner, so the panel can be
     * moved off a store's chat launcher but never parked over the results.
     * Keyboard users choose the corner on the options page.
     */
    var drag = null;

    function clamp(n, lo, hi) {
      return Math.max(lo, Math.min(hi, n));
    }

    function clearDragPosition() {
      var s = refs.panel.style;
      s.left = s.top = s.right = s.bottom = '';
      refs.panel.removeAttribute('data-dragging');
    }

    refs.dragHandle.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || event.target.closest('button')) return;
      var rect = refs.panel.getBoundingClientRect();
      drag = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        moved: false
      };
      refs.dragHandle.setPointerCapture(event.pointerId);
    });

    refs.dragHandle.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.id) return;
      // A few pixels of slop, so a click on the title is not a drag.
      if (!drag.moved &&
          Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < 4) {
        return;
      }
      drag.moved = true;
      refs.panel.setAttribute('data-dragging', 'true');
      var s = refs.panel.style;
      s.right = s.bottom = 'auto';
      s.left = clamp(event.clientX - drag.dx, 0, window.innerWidth - refs.panel.offsetWidth) + 'px';
      s.top = clamp(event.clientY - drag.dy, 0, window.innerHeight - refs.panel.offsetHeight) + 'px';
    });

    function endDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      var moved = drag.moved;
      drag = null;
      if (!moved) return;
      var rect = refs.panel.getBoundingClientRect();
      var corner =
        (rect.top + rect.height / 2 < window.innerHeight / 2 ? 'top' : 'bottom') + '-' +
        (rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right');
      clearDragPosition();
      refs.panel.setAttribute('data-corner', corner);
      emit({ panelCorner: corner }, true);
    }
    refs.dragHandle.addEventListener('pointerup', endDrag);
    refs.dragHandle.addEventListener('pointercancel', endDrag);

    // The guide opens by itself until dismissed once, then only on request.
    var legendOpen = false;
    var lastRender = null;

    function rerender() {
      if (lastRender) render(lastRender.settings, lastRender.stats);
    }

    function legendShowing() {
      return legendOpen || !!(lastRender && !lastRender.settings.onboarded);
    }

    function closeLegend() {
      legendOpen = false;
      if (lastRender && !lastRender.settings.onboarded) emit({ onboarded: true }, true);
      else rerender();
    }

    refs.help.addEventListener('click', function () {
      if (legendShowing()) {
        closeLegend();
        return;
      }
      legendOpen = true;
      if (lastRender && lastRender.settings.panelCollapsed) emit({ panelCollapsed: false }, true);
      else rerender();
    });

    refs.dismissLegend.addEventListener('click', function () {
      closeLegend();
      refs.help.focus();
    });

    function render(settings, stats) {
      var base = BASES[settings.basis] || BASES.lb;
      lastRender = { settings: settings, stats: stats };

      var showLegend = legendOpen || !settings.onboarded;
      refs.legend.hidden = !showLegend;
      refs.help.setAttribute('aria-expanded', showLegend ? 'true' : 'false');
      refs.legendHint.textContent =
        'Your limit is ' + (stats.limitLabel || (stats.currencySymbol || '') + settings.threshold) +
        ' per ' + base.label +
        '. Change it below, then turn on hiding to clear out the rest.';

      host.hidden = !settings.panelVisible;
      refs.panel.setAttribute('data-collapsed', settings.panelCollapsed ? 'true' : 'false');
      if (!drag) refs.panel.setAttribute('data-corner', settings.panelCorner || 'bottom-right');
      refs.collapse.setAttribute('aria-expanded', settings.panelCollapsed ? 'false' : 'true');

      // Never clobber the field while the user is typing in it.
      if (shadow.activeElement !== refs.threshold &&
          String(settings.threshold) !== refs.threshold.value) {
        refs.threshold.value = String(settings.threshold);
      }
      refs.basis.value = settings.basis;
      refs.enabled.checked = settings.filterEnabled;
      refs.hideUnknown.checked = settings.hideUnknown;
      refs.hideOther.checked = settings.hideOtherDimension;
      refs.sort.checked = settings.sortByUnitPrice;
      refs.currency.textContent = stats.currencySymbol || '';
      refs.otherLabel.textContent =
        base.dimension === 'mass'
          ? 'Also hide items sold by volume'
          : 'Also hide items sold by weight';

      refs.threshold.setAttribute(
        'aria-label',
        'Maximum price per ' + base.label
      );

      if (!stats.total) {
        refs.stats.textContent = 'No product cards found on this page yet.';
      } else {
        refs.stats.textContent =
          stats.shown +
          ' of ' +
          stats.total +
          ' shown \u00b7 ' +
          stats.priced +
          ' priced per ' +
          base.label +
          ' \u00b7 ' +
          stats.unknown +
          ' unsized' +
          (stats.newLows ? ' \u00b7 ' + stats.newLows + ' new low' + (stats.newLows === 1 ? '' : 's') : '');
      }

      if (stats.best) {
        refs.best.hidden = false;
        refs.bestLabel.textContent =
          'Best value: ' + stats.best.label + ' \u2014 jump to it';
      } else {
        refs.best.hidden = true;
        refs.bestLabel.textContent = '';
      }

      var lookup = stats.detailLookup;
      if (lookup && (lookup.busy || lookup.count > 0)) {
        refs.detail.hidden = false;
        refs.detail.disabled = !!lookup.busy;
        refs.detailLabel.textContent = lookup.busy
          ? 'Looking for package sizes\u2026'
          : 'Find package sizes for up to ' + lookup.count + (lookup.count === 1 ? ' result' : ' results');
      } else {
        refs.detail.hidden = true;
      }
      var result = lookup && !lookup.busy ? lookup.result : null;
      refs.detailResult.hidden = !result;
      refs.detailResult.textContent = result ? describeLookup(result) : '';

      // With hiding on, visible results that could not be priced read as the
      // filter failing. Say why they are there and offer the fix in place.
      var unsizedShown = settings.filterEnabled && !settings.hideUnknown ? stats.unsizedShown || 0 : 0;
      refs.unsizedNote.hidden = !unsizedShown;
      refs.unsizedText.textContent = unsizedShown === 1
        ? '1 result is still showing because it doesn\u2019t list its size.'
        : unsizedShown + ' results are still showing because they don\u2019t list their size.';

      refs.hint.textContent = stats.hint || '';
    }

    function describeLookup(result) {
      var pages = result.tried + (result.tried === 1 ? ' product page' : ' product pages');
      if (!result.found) return 'No package sizes found on ' + pages + '.';
      return 'Found ' + result.found + (result.found === 1 ? ' package size' : ' package sizes') +
        ' on ' + pages + '.';
    }

    function mount() {
      if (!host.isConnected) document.documentElement.appendChild(host);
    }

    return {
      host: host,
      mount: mount,
      render: render,
      destroy: function () {
        if (host.parentNode) host.parentNode.removeChild(host);
      }
    };
  }

  PPP.panel = { createPanel: createPanel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
