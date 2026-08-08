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
