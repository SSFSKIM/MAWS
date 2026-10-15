/** The hub's sockets live on the app's own origin (the Worker serves both), over `wss` where the page is `https`. */
export const hubBase = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
