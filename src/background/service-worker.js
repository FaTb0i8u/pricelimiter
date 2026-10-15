/**
 * Background service worker.
 *
 * Relays toolbar-icon clicks to the content script, opens the options page on
 * its behalf, keeps the per-tab toolbar badge, and performs user-requested
 * product-page lookups. There is no default_popup, so chrome.action.onClicked
 * fires. Messaging a tab needs only the host permission we already hold - no
 * "tabs" permission is required.
 */

// First install only: an update must never open a tab the user did not ask for.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#welcome') });
});
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== 'number') return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'ppp:toggle-panel' });
  } catch (error) {
    // No content script answered: an unsupported page, a chrome:// URL, or a
    // results page opened before the extension was installed or updated.
    // Clicking used to do nothing at all, which reads as broken; the options
    // page says where the extension works and suggests a reload.
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#unsupported') });
  }
});

/*
 * Toolbar badge: how many results the filter is hiding on this tab, so the
 * effect stays visible with the panel closed. Per tab, set by the content
 * script, and cleared whenever the tab starts loading a new document so a
 * count never outlives the page it described.
 */
const BADGE_COLOR = '#5f6368';
const MAX_BADGE_TEXT = 4;

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});

function setTabBadge(tabId, text) {
  const clean = typeof text === 'string' ? text.slice(0, MAX_BADGE_TEXT) : '';
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: clean }).catch(() => {});
}

/**
 * Fetch a product page only after an explicit in-page user action. The URL
 * must be covered by an existing host permission; this avoids expanding the
 * extension's reach to every Google Shopping merchant and avoids sending
 * cookies to the retailer. Result text is capped before crossing the message
 * boundary so a malformed page cannot create a large memory spike.
 */

/** A merchant page that has not answered in this long is not worth waiting for. */
const FETCH_TIMEOUT_MS = 8000;
/** Characters of a product page kept; structured data sits near the top. */
const MAX_PAGE_CHARS = 300000;

/**
 * The first `limit` characters of a response body, without downloading the
 * rest. `response.text()` buffered whole multi-megabyte retailer pages only
 * for all but the first 300 KB to be thrown away.
 */
async function readCapped(response, limit) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    return (await response.text()).slice(0, limit);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return text.slice(0, limit);
}

function isPermitted(origin) {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [origin + '/*'] }, (allowed) => {
      resolve(!chrome.runtime.lastError && !!allowed);
    });
  });
}

async function fetchProductPage(url) {
  if (!(await isPermitted(url.origin))) return { ok: false, reason: 'permission-unavailable' };

  // Without a deadline a merchant that accepts the connection and then never
  // answers leaves this promise pending forever. The content script awaits
  // each lookup in turn, so one such host wedges the panel on "Looking for
  // package sizes..." with no way back short of a reload.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.href, {
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) return { ok: false, reason: 'http-' + response.status };

    // The permission check above only covered the URL we asked for. A redirect
    // moves the response to an origin nobody has approved, so the origin that
    // actually answered has to clear the same bar -- otherwise any merchant
    // link on the page is a one-hop redirect away from being read on the
    // extension's behalf.
    let finalOrigin;
    try {
      finalOrigin = new URL(response.url || url.href).origin;
    } catch (error) {
      return { ok: false, reason: 'unsupported-url' };
    }
    if (finalOrigin !== url.origin && !(await isPermitted(finalOrigin))) {
      return { ok: false, reason: 'redirected-off-origin' };
    }

    const type = response.headers.get('content-type') || '';
    if (type && !/html|xml/i.test(type)) return { ok: false, reason: 'not-html' };

    return { ok: true, html: await readCapped(response, MAX_PAGE_CHARS) };
  } catch (error) {
    return { ok: false, reason: 'fetch-failed' };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'ppp:badge') {
    if (sender && sender.tab && typeof sender.tab.id === 'number') setTabBadge(sender.tab.id, message.text);
    return undefined;
  }
  if (message && message.type === 'ppp:open-options') {
    chrome.runtime.openOptionsPage(() => {
      void chrome.runtime.lastError;
      sendResponse({ ok: true });
    });
    return true;
  }
  if (!message || message.type !== 'ppp:fetch-product-page' || typeof message.url !== 'string') {
    return undefined;
  }

  let url;
  try {
    url = new URL(message.url);
  } catch (error) {
    sendResponse({ ok: false, reason: 'invalid-url' });
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    sendResponse({ ok: false, reason: 'unsupported-url' });
    return undefined;
  }

  fetchProductPage(url).then(sendResponse);
  return true;
});
