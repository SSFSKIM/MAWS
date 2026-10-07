// The browser view's preload (E4a execution document, Design §11 and §14; Interfaces "The preload"): loaded into every
// page a browser tab shows, sandboxed with context isolation. In E4a it exposes nothing to the page and sends nothing;
// E4c's agent cursor and E4d's hover UI add their channels here, and main accepts a `browser:preload:*` message only from
// a webContents that is a loaded tab's. Attribution of input is main's, never this file's (A-33).
//
// It is built as its own preload entry (`electron.vite.config.ts`, out/preload/browser.js). A sandboxed preload can
// `require` no file of its own, so it must never share a module with the app's preload (`index.ts`): Rollup would split
// the shared module into a chunk both would fail to load (`bundle.test.ts` checks the build).
export {};
