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

  var TEMPLATE = [
    '<div class="panel" part="panel">',
    '  <div class="header">',
    '    <span class="dot" aria-hidden="true"></span>',
    '    <h2 class="title">Unit price filter</h2>',
    '    <button class="icon-btn" data-action="collapse" type="button"',
    '            aria-expanded="true" title="Collapse panel">',
    '      <span class="chevron" aria-hidden="true"></span>',
    '      <span class="sr-only">Collapse panel</span>',
    '    </button>',
    '    <button class="icon-btn" data-action="close" type="button" title="Hide panel">',
    '      <span aria-hidden="true">&#10005;</span>',
    '      <span class="sr-only">Hide panel</span>',
    '    </button>',
    '  </div>',
    '  <div class="body" id="ppp-body">',
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
    '    <p class="stats" data-role="stats" role="status" aria-live="polite"></p>',
    '    <button class="best" data-action="best" type="button" hidden></button>',
    '    <div class="footer">',
    '      <button class="link" data-action="rescan" type="button">Rescan page</button>',
    '      <span class="hint" data-role="hint"></span>',
    '    </div>',
    '  </div>',
    '</div>'
  ].join('\n');

  var STYLES = [
    // `all: initial` shields the panel from Google's stylesheets, but it also
    // beats the UA rule for [hidden], so display is restored explicitly.
    ':host { all: initial; display: block; }',
    ':host([hidden]) { display: none; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    '.panel {',
    '  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;',
    '  width: 292px; max-width: calc(100vw - 32px);',
    '  font: 400 13px/1.5 Roboto, Arial, system-ui, sans-serif; color: #202124;',
    '  background: #fff; border: 1px solid #dadce0; border-radius: 12px;',
    '  box-shadow: 0 6px 20px rgba(60,64,67,.28); overflow: hidden;',
    '}',
    '.header { display: flex; align-items: center; gap: 8px; padding: 10px 8px 10px 12px;',
    '  background: #f8f9fa; border-bottom: 1px solid #e8eaed; }',
    '.dot { width: 8px; height: 8px; border-radius: 50%; background: #1e8e3e; flex: none; }',
    '.title { flex: 1; margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .1px; }',
    '.icon-btn { flex: none; width: 26px; height: 26px; display: grid; place-items: center;',
    '  border: 0; border-radius: 6px; background: transparent; color: #5f6368; cursor: pointer;',
    '  font-size: 12px; line-height: 1; }',
    '.icon-btn:hover { background: #e8eaed; color: #202124; }',
    '.icon-btn:focus-visible { outline: 2px solid #1a73e8; outline-offset: 1px; }',
    '.chevron { width: 8px; height: 8px; border-right: 2px solid currentColor;',
    '  border-bottom: 2px solid currentColor; transform: rotate(45deg) translate(-2px,-2px); }',
    '.panel[data-collapsed="true"] .chevron { transform: rotate(-135deg) translate(-1px,-1px); }',
    '.panel[data-collapsed="true"] .body { display: none; }',
    '.body { padding: 12px; display: flex; flex-direction: column; gap: 12px; }',
    '.field { display: flex; flex-direction: column; gap: 6px; }',
    '.label { font-size: 12px; font-weight: 600; color: #3c4043; }',
    '.input-row { display: flex; gap: 8px; }',
    '.money { position: relative; flex: 1 1 auto; min-width: 0; }',
    '.prefix { position: absolute; left: 9px; top: 50%; transform: translateY(-50%);',
    '  color: #5f6368; font-size: 13px; pointer-events: none; }',
    '.number { width: 100%; height: 34px; padding: 0 8px 0 24px; font: inherit; color: inherit;',
    '  background: #fff; border: 1px solid #dadce0; border-radius: 8px; }',
    '.select { flex: 0 0 88px; height: 34px; padding: 0 6px; font: inherit; color: inherit;',
    '  background: #fff; border: 1px solid #dadce0; border-radius: 8px; }',
    '.number:focus-visible, .select:focus-visible { outline: 2px solid #1a73e8; outline-offset: 0;',
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
    '.best { width: 100%; padding: 8px 10px; text-align: left; font: inherit; font-size: 12px;',
    '  color: #0d652d; background: #e6f4ea; border: 1px solid #a8dab5; border-radius: 8px;',
    '  cursor: pointer; }',
    '.best:hover { background: #ceead6; }',
    '.best:focus-visible { outline: 2px solid #1a73e8; outline-offset: 1px; }',
    '.footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
    '.link { padding: 0; font: inherit; font-size: 12px; color: #1a73e8; background: none;',
    '  border: 0; cursor: pointer; text-decoration: underline; }',
    '.link:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }',
    '.hint { font-size: 11px; color: #80868b; }',
    '.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;',
    '  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
    '@media (prefers-color-scheme: dark) {',
    '  .panel { background: #202124; border-color: #3c4043; color: #e8eaed; }',
    '  .header { background: #292a2d; border-bottom-color: #3c4043; }',
    '  .icon-btn { color: #9aa0a6; } .icon-btn:hover { background: #3c4043; color: #e8eaed; }',
    '  .label { color: #bdc1c6; } .check { color: #bdc1c6; } .stats { color: #9aa0a6; }',
    '  .number, .select { background: #202124; border-color: #5f6368; color: #e8eaed; }',
    '  .prefix { color: #9aa0a6; }',
    '  .best { background: #12351f; border-color: #1e8e3e; color: #81c995; }',
    '  .link { color: #8ab4f8; } .hint { color: #80868b; }',
    '}',
    '@media (prefers-reduced-motion: reduce) { .track, .thumb { transition: none; } }'
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
      currency: shadow.querySelector('[data-role="currency"]'),
      otherLabel: shadow.querySelector('[data-role="other-dimension-label"]'),
      stats: shadow.querySelector('[data-role="stats"]'),
      hint: shadow.querySelector('[data-role="hint"]'),
      best: shadow.querySelector('[data-action="best"]'),
      collapse: shadow.querySelector('[data-action="collapse"]'),
      close: shadow.querySelector('[data-action="close"]'),
      rescan: shadow.querySelector('[data-action="rescan"]')
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
    refs.threshold.addEventListener('blur', flush);
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

    function render(settings, stats) {
      var base = BASES[settings.basis] || BASES.lb;

      host.hidden = !settings.panelVisible;
      refs.panel.setAttribute('data-collapsed', settings.panelCollapsed ? 'true' : 'false');
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
      refs.currency.textContent = stats.currencySymbol || '$';
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
          ' unsized';
      }

      if (stats.best) {
        refs.best.hidden = false;
        refs.best.textContent =
          'Best value: ' + stats.best.label + ' \u2014 jump to it';
      } else {
        refs.best.hidden = true;
        refs.best.textContent = '';
      }

      refs.hint.textContent = stats.hint || '';
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
