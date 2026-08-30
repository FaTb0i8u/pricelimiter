/**
 * Background service worker.
 *
 * Its only job is to relay toolbar-icon clicks to the content script. There is
 * no default_popup, so chrome.action.onClicked fires. Messaging a tab needs
 * only the host permission we already hold - no "tabs" permission is required.
 */
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== 'number') return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'ppp:toggle-panel' });
  } catch (error) {
    // Expected when the content script is not present on this page (for
    // example a chrome:// URL or an unsupported tab). Nothing to do.
  }
});

/**
 * Fetch a product page only after an explicit in-page user action. The URL
 * must be covered by an existing host permission; this avoids expanding the
 * extension's reach to every Google Shopping merchant and avoids sending
 * cookies to the retailer. Result text is capped before crossing the message
 * boundary so a malformed page cannot create a large memory spike.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  chrome.permissions.contains({ origins: [url.origin + '/*'] }, (allowed) => {
    if (!allowed) {
      sendResponse({ ok: false, reason: 'permission-unavailable' });
      return;
    }
    fetch(url.href, { credentials: 'omit', redirect: 'follow' })
      .then((response) => {
        if (!response.ok) throw new Error('http-' + response.status);
        return response.text();
      })
      .then((html) => sendResponse({ ok: true, html: html.slice(0, 300000) }))
      .catch(() => sendResponse({ ok: false, reason: 'fetch-failed' }));
  });
  return true;
});
