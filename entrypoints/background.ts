export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === 'object' && message !== null &&
      'type' in message && message.type === 'open-preview' &&
      'url' in message && typeof message.url === 'string'
    ) {
      return browser.tabs.create({ url: message.url }).then(() => undefined);
    }
  });
});
