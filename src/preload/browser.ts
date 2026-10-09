// The browser view's preload (E4a execution document, Design §11 and §14; Interfaces "The preload"): loaded into every
// page a browser tab shows, sandboxed with context isolation. In E4a it exposes nothing to the page and sends nothing;
// E4c's agent cursor and E4d's hover UI add their channels here, and main accepts a `browser:preload:*` message only from
// a webContents that is a loaded tab's. Attribution of input is main's, never this file's (A-33).
//
// It is the partition's, not the page's (Decision Log 56): main registers it once on each browser partition's session
// (view.ts `registerBrowserPreload`), which is the only way it reaches a tab adopted from a page's `window.open`, and no
// page names it in its own preferences, so it runs exactly once per document, in the main frame only (subframes run no
// preload while `nodeIntegrationInSubFrames` is off). A tab's DevTools front-end shares the partition and runs it too,
// so nothing here may act unless main addresses its tab. Each run counts itself on the isolated world's global, which
// the page cannot see; `e2e:browser` reads the count over CDP.
//
// It is built as its own preload entry (`electron.vite.config.ts`, out/preload/browser.js). A sandboxed preload can
// `require` no file of its own, so it must never share a module with the app's preload (`index.ts`): Rollup would split
// the shared module into a chunk both would fail to load (`bundle.test.ts` checks the build).
// cua #90 start: an extension's own document (its popup, options page, background page) gets nothing from this file
import { browserPreloadActs } from './browser-scope';

const acts = browserPreloadActs((globalThis as { location?: { protocol: string } }).location?.protocol ?? '');
// cua #90 end
const world = globalThis as { __mawsBrowserPreloadRuns?: number };
if (acts) world.__mawsBrowserPreloadRuns = (world.__mawsBrowserPreloadRuns ?? 0) + 1;

export {};
// E4d start: comment mode's hover UI and pick (E4d execution document, Design §3): one listener on main's
// `browser:preload:comment`, one report per arm on `browser:preload:pick`; nothing exposed to the page (no
// contextBridge). `browser-comment.ts` and the two shared modules it reads are imported from here alone, and are zod-free
// and outside `@shared/ipc/`, so Rollup inlines them and no chunk is shared with the app preload.
import { ipcRenderer } from 'electron';
import { installCommentMode } from './browser-comment';

if (acts) installCommentMode(ipcRenderer); // cua #90: the tab's pages only
// E4d end
// E4c start: the agent's cursor (E4c execution document, Design §9): one listener on main's `browser:cursor`, drawing
// `<maws-agent-cursor>`; nothing sent, nothing exposed. `browser-cursor.ts` and the zod-free `@shared/browser/cursor` it
// reads are imported from here alone, so Rollup inlines them and no chunk is shared with the app preload. It uses the
// `ipcRenderer` E4d's block imports above (a second import of it trips the duplicate-import rule).
import { installAgentCursor } from './browser-cursor';

if (acts) installAgentCursor(ipcRenderer); // cua #90: the tab's pages only
// E4c end
