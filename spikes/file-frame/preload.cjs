// The window's preload, as the app's is one: nothing the spike reads goes through it (main drives the page with
// executeJavaScript), and the frames never get it.
require('electron').contextBridge.exposeInMainWorld('maws', { spike: true });
