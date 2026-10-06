// The human's pick: an alt-click (option-click) on an element names it with the shared locator and reports it to main
// over IPC and to the page's main world through a contextBridge getter (so an external driver can read it too).
// The probe keeps the view's sandbox off (sandbox: false) only so this file can require the shared module; MAWS would
// bundle the preload and keep the sandbox.
const { ipcRenderer, contextBridge } = require('electron');
const path = require('node:path');
const locator = require(path.join(__dirname, 'shared', 'locator.cjs'));

let lastPick = null;

window.addEventListener(
  'click',
  (e) => {
    if (!e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    const picked = locator.describe(el);
    picked.point = { x: e.clientX, y: e.clientY };
    picked.url = location.href;
    picked.at = Date.now();
    lastPick = picked;
    ipcRenderer.send('probe:pick', picked);
  },
  { capture: true },
);

contextBridge.exposeInMainWorld('__mawsProbe', {
  lastPick: () => lastPick,
});
