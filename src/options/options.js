/**
 * Options page. Reads and writes the same chrome.storage.sync record as the
 * in-page panel, through the same sanitiser, so the two can never disagree
 * about what a valid setting is.
 */
;(function () {
  'use strict';

  var settingsApi = PPP.settings;
  var historyApi = PPP.history;
  var BASES = PPP.units.BASES;

  var CORNER_LABELS = {
    'bottom-right': 'Bottom right',
    'bottom-left': 'Bottom left',
    'top-right': 'Top right',
    'top-left': 'Top left'
  };
  /** Currencies of the storefronts the extension supports. */
  var ADDABLE_CURRENCIES = ['USD', 'CAD', 'GBP', 'AUD', 'EUR'];
  var TOGGLES = ['filterEnabled', 'hideUnknown', 'hideOtherDimension', 'sortByUnitPrice', 'panelVisible', 'rememberPrices', 'debug'];

  var current = null;
  var statusTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function currencyName(code) {
    try {
      return new Intl.DisplayNames(undefined, { type: 'currency' }).of(code) || code;
    } catch (error) {
      return code;
    }
  }

  function currencySymbol(code) {
    try {
      var parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'currency') return parts[i].value;
      }
    } catch (error) {
      /* unknown code: fall through */
    }
    return code;
  }

  function announce(message) {
    var status = byId('status');
    status.textContent = message;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      status.textContent = '';
    }, 2500);
  }

  function commit(next, message) {
    current = settingsApi.sanitize(next);
    render();
    settingsApi.save(current).then(function () {
      announce(message || 'Saved');
    });
  }

  function patch(key, value) {
    var next = settingsApi.sanitize(current);
    next[key] = value;
    commit(next);
  }

  function option(value, label) {
    var el = document.createElement('option');
    el.value = String(value);
    el.textContent = label;
    return el;
  }

  /* ------------------------------------------------------------- controls */

  function buildStaticControls() {
    var basis = byId('basis');
    Object.keys(BASES).forEach(function (key) {
      basis.appendChild(option(key, BASES[key].label));
    });
    basis.addEventListener('change', function () {
      patch('basis', basis.value);
    });

    var corner = byId('panelCorner');
    settingsApi.PANEL_CORNERS.forEach(function (key) {
      corner.appendChild(option(key, CORNER_LABELS[key] || key));
    });
    corner.addEventListener('change', function () {
      patch('panelCorner', corner.value);
    });

    byId('minConfidence').addEventListener('change', function (event) {
      patch('minConfidence', Number(event.target.value));
    });

    TOGGLES.forEach(function (key) {
      var input = byId(key);
      input.addEventListener('change', function () {
        patch(key, input.checked);
      });
    });

    byId('add-limit').addEventListener('submit', function (event) {
      event.preventDefault();
      var code = byId('add-currency').value;
      var amountInput = byId('add-amount');
      var amount = Number(amountInput.value);
      if (!code || amountInput.value === '' || !isFinite(amount) || amount < 0) {
        amountInput.setAttribute('aria-invalid', 'true');
        amountInput.focus();
        announce('Enter a limit of zero or more.');
        return;
      }
      amountInput.removeAttribute('aria-invalid');
      amountInput.value = '';
      commit(settingsApi.setThreshold(current, code, amount), 'Limit added');
    });

    byId('reset').addEventListener('click', function () {
      // Resetting discards every saved limit, which cannot be undone.
      if (!window.confirm('Reset all settings, including saved price limits?')) return;
      commit(settingsApi.sanitize(null), 'Settings reset');
    });

    byId('show-guide').addEventListener('click', function () {
      var next = settingsApi.sanitize(current);
      next.onboarded = false;
      commit(next, 'The guide will show in the panel on your next results page');
    });

    byId('clear-history').addEventListener('click', function () {
      if (!window.confirm('Forget every price you\u2019ve seen? This cannot be undone.')) return;
      historyApi.clear().then(function () {
        renderHistoryCount();
        announce('Price history cleared');
      });
    });
  }

  function renderHistoryCount() {
    historyApi.load().then(function (store) {
      var count = Object.keys(store).length;
      byId('history-count').textContent = count
        ? count + (count === 1 ? ' product' : ' products') + ' remembered.'
        : 'Nothing remembered yet.';
      byId('clear-history').disabled = !count;
    });
  }

  function renderConfidence() {
    var select = byId('minConfidence');
    var value = current.minConfidence;
    select.textContent = '';
    var matched = false;
    settingsApi.CONFIDENCE_PRESETS.forEach(function (preset) {
      select.appendChild(option(preset.value, preset.label));
      if (preset.value === value) matched = true;
    });
    // Keep a hand-edited value selectable instead of silently rounding it.
    if (!matched) select.appendChild(option(value, 'Custom (' + Math.round(value * 100) + '%)'));
    select.value = String(value);
  }

  function limitRow(code, amount) {
    var row = document.createElement('tr');

    var name = document.createElement('th');
    name.scope = 'row';
    name.innerHTML = '<span class="code"></span><span class="name"></span>';
    name.querySelector('.code').textContent = code;
    name.querySelector('.name').textContent = currencyName(code);
    row.appendChild(name);

    var cell = document.createElement('td');
    var field = document.createElement('span');
    field.className = 'money';
    var prefix = document.createElement('span');
    prefix.className = 'prefix';
    prefix.setAttribute('aria-hidden', 'true');
    prefix.textContent = currencySymbol(code);
    var input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.step = '0.01';
    input.value = String(amount);
    input.setAttribute('data-currency', code);
    input.setAttribute('aria-label', 'Maximum price per unit in ' + currencyName(code));
    input.addEventListener('change', function () {
      var value = Number(input.value);
      if (input.value === '' || !isFinite(value) || value < 0) {
        input.setAttribute('aria-invalid', 'true');
        announce('Enter a limit of zero or more.');
        return;
      }
      input.removeAttribute('aria-invalid');
      commit(settingsApi.setThreshold(current, code, value));
    });
    field.appendChild(prefix);
    field.appendChild(input);
    cell.appendChild(field);
    row.appendChild(cell);

    var actions = document.createElement('td');
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove the ' + currencyName(code) + ' limit');
    remove.addEventListener('click', function () {
      var next = settingsApi.sanitize(current);
      delete next.thresholds[code];
      commit(next, 'Limit removed');
    });
    actions.appendChild(remove);
    row.appendChild(actions);

    return row;
  }

  function renderLimits() {
    var body = byId('limits-body');
    var codes = Object.keys(current.thresholds).sort();
    var focused = document.activeElement;
    var editing = focused && body.contains(focused) ? focused.getAttribute('data-currency') : null;

    // Rebuilding while the user types in a row would throw their edit away.
    if (!editing) {
      body.textContent = '';
      codes.forEach(function (code) {
        body.appendChild(limitRow(code, current.thresholds[code]));
      });
    }
    byId('limits').hidden = !codes.length;
    byId('limits-empty').hidden = !!codes.length;

    var add = byId('add-currency');
    var chosen = add.value;
    add.textContent = '';
    ADDABLE_CURRENCIES.forEach(function (code) {
      if (codes.indexOf(code) === -1) add.appendChild(option(code, code + ' \u2013 ' + currencyName(code)));
    });
    if (chosen) add.value = chosen;
    byId('add-limit').hidden = !add.options.length;
  }

  function render() {
    byId('basis').value = current.basis;
    byId('panelCorner').value = current.panelCorner;
    TOGGLES.forEach(function (key) {
      byId(key).checked = !!current[key];
    });
    renderConfidence();
    renderLimits();
  }

  buildStaticControls();
  byId('welcome').hidden = location.hash !== '#welcome';
  renderHistoryCount();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName === 'local' && changes[historyApi.STORAGE_KEY]) renderHistoryCount();
    });
  }
  settingsApi.load().then(function (loaded) {
    current = loaded;
    render();
  });
  settingsApi.subscribe(function (next) {
    current = next;
    render();
  });
})();
