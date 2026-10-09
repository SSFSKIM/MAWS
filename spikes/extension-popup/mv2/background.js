// MV2 background page: answers the popup's ping by message and by port.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  sendResponse({ pong: msg && msg.ping, from: 'background-page', fromTab: sender.tab ? sender.tab.id : null });
  return false;
});
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((msg) => port.postMessage({ pong: msg && msg.ping, from: 'background-page', via: 'port' }));
});
