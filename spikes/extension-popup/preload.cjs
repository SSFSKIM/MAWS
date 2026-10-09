// A frame preload registered on the spike's session the way MAWS registers its browser preload (view.ts
// registerBrowserPreload): it reports every document it runs in, so the spike can tell whether extension pages run it.
const { ipcRenderer } = require('electron');
ipcRenderer.send('spike:preload', location.href);
