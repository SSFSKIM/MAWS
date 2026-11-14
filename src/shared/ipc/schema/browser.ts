// X2 `browser.*` (P1 interface ledger §5; E4a execution document, Interfaces "IPC `browser.*`"): MAWS's own browser
// tabs. Owner `main` for every command and event: main owns the tabs, their views and partitions; the renderer draws
// the chrome and tells main the two things only it knows, where a pane is (`browser.view.place`) and when a layer
// covers the window (`browser.view.cover`). Every URL a command carries is http or https before a handler runs, and a
// page in a view can never invoke any of these (the router's `isAppSender`).
import * as z from 'zod';
import { AppSessionIdSchema } from '../../graph/ids';
import {
  BROWSER_PLACEHOLDER_MAX_BYTES,
  BROWSER_SUGGESTIONS_MAX,
  BrowserControlSchema,
  BrowserOpenPageSchema, // U12a
  BrowserPartitionSchema,
  BrowserTabIdSchema,
  BrowserTabSchema,
  BrowserViewportSchema, // U12a
} from '../../browser/tab';
import { validateBrowserUrl } from '../../browser/url';
// E4c start
import { BROWSER_DIALOG_EXCERPT_MAX_CHARS } from '../../browser/dialog';
// E4c end
// E13 start
import { BROWSER_ACTIVITIES_KEPT, BrowserAgentActivitySchema } from '../../browser/activity';
// E13 end
import type { CommandSpec } from './common';
// P5 O17 M9b start
import { BROWSER_LIMITS, BrowserFrameMetaSchema, BrowserInputSchema, BrowserSeqSchema } from '../../browser/screencast';
import { EngineInventorySchema } from './browser-engine';
// P5 O17 M9b end
import { CaptureAnswerSchema } from '../../markup/image'; // P3-G
// E4d start
import { AnchorSchema } from '../../anchor/anchor';
import { CommentDisarmReasonSchema } from '../../browser/comment';
// E4d end
// E4b start
import {
  ChromeProfileDirSchema,
  ChromeProfileSchema,
  ExtensionCandidateSchema,
  ExtensionIdSchema,
  IMPORT_TEXT_MAX,
  ImportCategoriesSchema,
  ImportCountSchema,
  ImportedExtensionSchema,
  ImportPhaseSchema,
  ImportReportSchema,
  ImportTextSchema,
} from '../../browser/import';
import { ImportedProfileSchema } from '../../browser/profiles';
import { AbsolutePathSchema } from './settings';
// E4b end
// cua #90 start
import { BOOKMARK_FAVICON_ORIGINS_MAX, BookmarkSyncErrorSchema, BookmarkTreeSchema } from '../../browser/bookmarks';
import { BrowserProfileListItemSchema } from '../../browser/profiles';
import { ExtensionActionSchema } from '../../browser/extensions';

const BookmarkNodeIdSchema = z.number().int().min(1); // an index row's id (the empty tree's roots, 0, are never acted on)
// A control's box in CSS px of the window's content area, rounded by the renderer: where a popup or a menu anchors.
const ControlRectSchema = z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(0), height: z.number().int().min(0) });
// cua #90 end

// An address a command may load: what `validateBrowserUrl` admits (http or https, parseable), and with no whitespace,
// which a typed or agent-given string loses through that check's `url`. A refinement over the shared rule rather than
// zod's `z.url()`, which trims its input (a transform) and would make the schema and main's check two rules.
export const BrowserUrlSchema = z.string().refine((url) => !/\s/.test(url) && validateBrowserUrl(url).ok, { message: 'not an http or https URL' });

const PLACEHOLDER_PREFIX = 'data:image/jpeg;base64,';
const PLACEHOLDER_MAX_LENGTH = PLACEHOLDER_PREFIX.length + Math.ceil(BROWSER_PLACEHOLDER_MAX_BYTES / 3) * 4;

// A pane's rect in CSS px of the window's content area, rounded by the renderer; a pane under 1 px sends null instead.
const PaneRectSchema = z.strictObject({ x: z.number().int(), y: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1) });
export const BrowserSurfaceSchema = z.enum(['panel', 'main']);
const TabOnly = z.strictObject({ tabId: BrowserTabIdSchema });

export const BrowserTabsChangedSchema = z.strictObject({ appSessionId: AppSessionIdSchema, tabs: z.array(BrowserTabSchema), selected: BrowserTabIdSchema.nullable() });
export type BrowserTabsChanged = z.infer<typeof BrowserTabsChangedSchema>;

// cua #90: `toggleBookmarksBar`, ⌘⇧B pressed inside the page (the chrome flips `browser.bookmarksBar`)
export const BrowserChromeCommandSchema = z.strictObject({ tabId: BrowserTabIdSchema, command: z.enum(['focusAddress', 'openFind', 'closeFind', 'toggleBookmarksBar']) });
export type BrowserChromeCommand = z.infer<typeof BrowserChromeCommandSchema>;

// A transient chrome notice (4 s), never an app toast (E4a Design §3 and Decision Log 28). `refusedScheme` is a page's
// own top-level navigation main refused (`name`: the scheme, such as `zoommtg:`), the chrome's refused-scheme line.
export const BrowserNoticeSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  tabId: BrowserTabIdSchema.nullable(),
  kind: z.enum([
    'tabsCap', 'profileMissing', 'partitionFallback', 'downloadRefusedAgent', 'tabsFileBroken', 'refusedScheme',
    // E4c start: a never-placed tab's page raised a dialog nobody could see; MAWS answered it with the page's default and
    // tells the person when they select the tab (A-42)
    'dialogAnswered',
    // E4c end
    // cua #90 (in place): an extension's popup that failed to load or crashed, closed; an extension's options tab closed
    // because the extension was unloaded (turned off, or its profile removed). `name`: the extension's.
    'extensionPopupFailed', 'extensionPageClosed',
  ]),
  name: z.string().optional(),
  count: z.number().int().min(0).optional(),
  // E4c start: `dialogAnswered`'s dialog kind and the start of its message, page text shown as plain text
  dialogType: z.enum(['alert', 'confirm']).optional(),
  excerpt: z.string().max(BROWSER_DIALOG_EXCERPT_MAX_CHARS).optional(),
  // E4c end
});
export type BrowserNotice = z.infer<typeof BrowserNoticeSchema>;

// E4d start: comment mode (E4d execution document, Design §2, §6, §8; Interfaces "IPC `browser.comment.*`"). The toggle
// arms one tab at a time; main answers `on: false` with the reason when it cannot (no error), and `arming` while it
// waits for the page's preload to confirm the shield is up (Decision Log 34): only `changed {on: true}` presses the
// toggle. The pick goes to the window whose pane owns the tab, as an anchor main built and validated (X10), with what
// became of its crop.
export const BrowserCommentSetResultSchema = z.strictObject({ on: z.boolean(), reason: z.enum(['ok', 'unknownTab', 'suspended', 'notPlaced', 'noPage', 'agent', 'arming']) });
export type BrowserCommentSetResult = z.infer<typeof BrowserCommentSetResultSchema>;
export const BrowserCommentChangedSchema = z.strictObject({ tabId: BrowserTabIdSchema, on: z.boolean(), reason: z.enum([...CommentDisarmReasonSchema.options, 'armed']) });
export type BrowserCommentChanged = z.infer<typeof BrowserCommentChangedSchema>;
export const BrowserCommentPickedSchema = z.strictObject({
  tabId: BrowserTabIdSchema,
  appSessionId: AppSessionIdSchema,
  anchor: AnchorSchema,
  crop: z.enum(['attached', 'none', 'tooLarge', 'failed']),
  position: z.strictObject({ x: z.number().nonnegative(), y: z.number().nonnegative() }).optional(), // P2-E2 (2026-10-09): the card's pin, `PickPosition` below
});
export type BrowserCommentPicked = z.infer<typeof BrowserCommentPickedSchema>;
// E4d end
// E4b start: the Chrome profile import (E4b execution document, Interfaces "IPC `browser.import.*`"). Main re-validates
// the Chrome folder and the profile directory against the disk and `Local State`; these schemas only keep a path out.
const ChromeFolderSchema = AbsolutePathSchema.max(IMPORT_TEXT_MAX);
const ImportIdSchema = z.uuid(); // main's randomUUID() for an inspection or a run
const StoreErrorSchema = z.strictObject({ error: ImportTextSchema }); // the category cannot be imported
export const BrowserImportInspectionSchema = z.strictObject({
  inspectionId: ImportIdSchema,
  profile: ChromeProfileSchema,
  chromeRunning: z.boolean(), // `SingletonLock` exists: a hint, never a block
  history: z.union([z.strictObject({ rows: ImportCountSchema }), StoreErrorSchema]),
  cookies: z.union([z.strictObject({ rows: ImportCountSchema, partitioned: ImportCountSchema, storeVersion: z.number().int() }), StoreErrorSchema]),
  extensions: z.array(ExtensionCandidateSchema),
  bookmarks: z.strictObject({ count: ImportCountSchema }).nullable(), // cua #90: the URL bookmarks found; null when no file could be read
});
export type BrowserImportInspection = z.infer<typeof BrowserImportInspectionSchema>;
// E4b end

// P5 O17 M9b: the remote view's (Interfaces §K): a view main mints, `mawsd`'s epoch, the inventory and frame as §G's
const RemoteViewIdSchema = z.string().min(1).max(64);
const BrowserEpochSchema = z.string().min(1).max(128);
export const BrowserInventorySchema = EngineInventorySchema.extend({ epoch: BrowserEpochSchema });
// What the window's view is, beside §G's inventory (which stays as the machine wrote it), so the window words it (M10's
// copy) by kind and never reads prose:
// - `live`: the machine's inventory, ready.
// - `connecting`: no channel to the machine is current yet, or it has not answered the open by its bound; the feed goes on.
// - `lost`: the connection went down past its grace; the feed resumes with it.
// - `unsupported`: the machine's endpoint offers no `browser.inventory` feed (an older MAWS there).
// - `ended`: the view will not go on (open it again), `end` saying why: `removed` (this device may no longer view the
//   session), `class` (this device's class cannot), `closed` (the link closed for good), `no-link` (no link reaches the
//   machine from here), `window` (the window closed during the open), `failed` (the feed ended with another word).
// - `unavailable`: the machine's own unavailable reading, its `inventory.reason` the machine's.
// The inventory's `reason` for the other unavailable kinds is main's English, for logs; the window does not show it.
export const RemoteViewStateSchema = z.union([
  z.strictObject({ kind: z.enum(['live', 'connecting', 'lost', 'unsupported', 'unavailable']) }),
  z.strictObject({ kind: z.literal('ended'), end: z.enum(['removed', 'class', 'closed', 'no-link', 'window', 'failed']) }),
]);
export type RemoteViewState = z.infer<typeof RemoteViewStateSchema>;
export const BrowserRemoteFrameSchema = BrowserFrameMetaSchema.extend({
  epoch: BrowserEpochSchema,
  // realm-local, as pty.data's; any buffer's view (§G's BrowserFrame.jpeg is a Uint8Array over whichever buffer)
  jpeg: z.custom<Uint8Array>((jpeg) => jpeg instanceof Uint8Array && jpeg.byteLength >= 1 && jpeg.byteLength <= BROWSER_LIMITS.frameBytes, `a JPEG of 1 to ${BROWSER_LIMITS.frameBytes} bytes`),
});

export const commands = {
  // Every tab, or one session's, with each session's selected tab.
  'browser.tabs.list': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema.optional() }),
    output: z.strictObject({ tabs: z.array(BrowserTabSchema), selected: z.record(AppSessionIdSchema, BrowserTabIdSchema.nullable()) }),
    owner: 'main',
  },
  // `url: null` opens an empty tab. `reuse: 'url'` selects the session's tab already at the same normalised URL (show_pane);
  // a `requestId` repeated within 10 s answers the first call's tab (two windows handling one `maws.pane.show`). U12a:
  // `reload`, which show_pane's path alone sets, loads that tab again unless the person is using it, and the answer's
  // `page` says what was done (present exactly when `reload` was asked; a repeated id answers the first call's).
  'browser.tabs.open': {
    input: z.strictObject({
      appSessionId: AppSessionIdSchema,
      url: BrowserUrlSchema.nullable(),
      select: z.boolean(),
      reuse: z.literal('url').optional(),
      requestId: z.string().min(1).optional(),
      reload: z.literal(true).optional(), // U12a
    }),
    output: z.strictObject({ tab: BrowserTabSchema, reused: z.boolean(), page: BrowserOpenPageSchema.optional() /* U12a */ }),
    owner: 'main',
  },
  'browser.tabs.close': { input: TabOnly, output: z.void(), owner: 'main' },
  'browser.tabs.select': { input: z.strictObject({ appSessionId: AppSessionIdSchema, tabId: BrowserTabIdSchema }), output: z.void(), owner: 'main' },
  // `typed`: the address field's own navigation, which the history row counts.
  'browser.tabs.navigate': {
    input: z.strictObject({
      tabId: BrowserTabIdSchema,
      to: z.union([z.strictObject({ url: BrowserUrlSchema, typed: z.boolean().optional() }), z.enum(['back', 'forward', 'reload', 'stop'])]),
    }),
    output: z.strictObject({ accepted: z.boolean() }),
    owner: 'main',
  },
  'browser.tabs.zoom': {
    input: z.strictObject({ tabId: BrowserTabIdSchema, action: z.enum(['in', 'out', 'reset']) }),
    output: z.strictObject({ zoom: z.number().positive() }),
    owner: 'main',
  },
  // `text: null` closes the find bar (main stops finding and clears the selection).
  'browser.tabs.find': {
    input: z.strictObject({
      tabId: BrowserTabIdSchema,
      text: z.string().nullable(),
      forward: z.boolean().optional(),
      findNext: z.boolean().optional(),
      matchCase: z.boolean().optional(),
    }),
    output: z.void(),
    owner: 'main',
  },
  'browser.tabs.dismiss': {
    input: z.strictObject({ tabId: BrowserTabIdSchema, notice: z.enum(['denied', 'download', 'unresponsive', 'popups', 'failed']) }),
    output: z.void(),
    owner: 'main',
  },
  'browser.tabs.devtools': { input: TabOnly, output: z.void(), owner: 'main' }, // the human's Inspect; detached DevTools
  'browser.tabs.revealDownload': { input: TabOnly, output: z.strictObject({ revealed: z.boolean() }), owner: 'main' },
  // From a pane, for the sender's window: ignored from a pane that does not own the tab unless `claim` (E4a Design §3).
  'browser.view.place': {
    input: z.strictObject({ tabId: BrowserTabIdSchema, paneId: z.string().min(1), surface: BrowserSurfaceSchema, rect: PaneRectSchema.nullable(), claim: z.boolean() }),
    output: z.void(),
    owner: 'main',
  },
  // A layer opened over (or closed from) the sender's window; main hides (or restores) every view placed in it.
  'browser.view.cover': { input: z.strictObject({ covered: z.boolean() }), output: z.void(), owner: 'main' },
  'browser.control.handBack': { input: TabOnly, output: z.void(), owner: 'main' },
  'browser.history.suggest': {
    input: z.strictObject({ partition: BrowserPartitionSchema, query: z.string() }),
    // cua #90: `kind`, a bookmark of the partition (at most 3, first) or a history row
    output: z.strictObject({
      suggestions: z.array(z.strictObject({ url: z.string(), title: z.string().nullable(), kind: z.enum(['history', 'bookmark']) })).max(BROWSER_SUGGESTIONS_MAX),
    }),
    owner: 'main',
  },
  'browser.profiles.list': {
    input: z.void(),
    output: z.strictObject({ profiles: z.array(BrowserProfileListItemSchema) }), // cua #90: the names and the avatar
    owner: 'main',
  },
  // E4d start
  'browser.comment.set': { input: z.strictObject({ tabId: BrowserTabIdSchema, on: z.boolean() }), output: BrowserCommentSetResultSchema, owner: 'main' },
  // UX wave U5a (X-216; docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, Interfaces §B.4 and §G): the tab's
  // comment card opened on a comment (`css`, the css of its element) or closed (null); main forwards it to the tab's own
  // page, and does nothing for a tab it does not hold or whose view is gone
  'browser.comment.card': {
    input: z.strictObject({ tabId: BrowserTabIdSchema, open: z.strictObject({ css: z.string().min(1).max(2000) }).nullable() }),
    output: z.void(),
    owner: 'main',
  },
  // E4d end
  // E4b start: the import. One inspection and one run at a time, app-wide; `start` while one runs answers invalid_input.
  // `userDataDir: null` lists Chrome's default folder (under e2e, MAWS_E2E_CHROME_USER_DATA).
  'browser.import.profiles': {
    input: z.strictObject({ userDataDir: ChromeFolderSchema.nullable() }),
    output: z.strictObject({ userDataDir: ChromeFolderSchema, found: z.boolean(), chromeRunning: z.boolean(), profiles: z.array(ChromeProfileSchema), error: ImportTextSchema.nullable() }),
    owner: 'main',
  },
  'browser.import.chooseUserData': { input: z.void(), output: z.strictObject({ userDataDir: ChromeFolderSchema.nullable() }), owner: 'main' }, // null: the dialog was cancelled
  // Stages the two stores and lists the extensions, for the consent sheet's counts; a second inspection discards the first.
  'browser.import.inspect': {
    input: z.strictObject({ userDataDir: ChromeFolderSchema, profileDir: ChromeProfileDirSchema }),
    output: BrowserImportInspectionSchema,
    owner: 'main',
  },
  'browser.import.discard': { input: z.strictObject({ inspectionId: ImportIdSchema }), output: z.void(), owner: 'main' },
  // `allowUnverifiedExtensions`: the owner checked the unverified-files acknowledgement; extensions are refused without it.
  'browser.import.start': {
    input: z.strictObject({ inspectionId: ImportIdSchema, categories: ImportCategoriesSchema, extensionIds: z.array(ExtensionIdSchema), allowUnverifiedExtensions: z.boolean() }),
    output: z.strictObject({ importId: ImportIdSchema }),
    owner: 'main',
  },
  'browser.import.cancel': { input: z.strictObject({ importId: ImportIdSchema }), output: z.void(), owner: 'main' },
  // `fileBroken`: this boot moved an unreadable profiles.json aside (Decision Log 35); the renderer raises one banner.
  // `running`: the run under way and the last phase it reported, so a window reloaded mid-run shows it (Decision Log 41).
  'browser.import.list': {
    input: z.void(),
    output: z.strictObject({
      profiles: z.array(ImportedProfileSchema),
      fileBroken: z.boolean(),
      running: z.strictObject({ importId: ImportIdSchema, profileDir: ChromeProfileDirSchema, phase: ImportPhaseSchema.nullable() }).nullable(),
    }),
    owner: 'main',
  },
  'browser.import.remove': {
    input: z.strictObject({ profileDir: ChromeProfileDirSchema }),
    output: z.strictObject({ removed: z.strictObject({ tabs: ImportCountSchema, historyRows: ImportCountSchema, extensions: ImportCountSchema }) }),
    owner: 'main',
  },
  'browser.import.setExtension': {
    input: z.strictObject({ profileDir: ChromeProfileDirSchema, extensionId: ExtensionIdSchema, enabled: z.boolean() }),
    output: z.strictObject({ extension: ImportedExtensionSchema }),
    owner: 'main',
  },
  // E4b end
  // E13 start: a session's agent activity main kept for the app's life (the last 500, oldest first), which a transcript
  // lists when it mounts and merges the live `browser.agent.activity` events after (the in-app browser spec of
  // 2026-10-08, "Action rows")
  'browser.agent.activities.list': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema }),
    output: z.strictObject({ activities: z.array(BrowserAgentActivitySchema).max(BROWSER_ACTIVITIES_KEPT) }),
    owner: 'main',
  },
  // E13 end
  // U12a (the UX wave's U12 execution document, Interfaces §C; ruling R2, and the branch review's ruling 7): a window
  // about to open the Browser by itself because the agent started acting asks main to bring the acting tab forward; main
  // reads the session from the tab's own record, selects the tab there unless the person uses the selected tab or a panel
  // shows a tab of the session, and answers with the session's selected tab then (null: none), whole, so the window can
  // list the selection before its panel mounts on it. Named by tab, as `browser.tabs.zoom` is. Between main and the
  // windows only: not on the engine host's wire.
  'browser.agent.show': { input: TabOnly, output: z.strictObject({ selected: BrowserTabSchema.nullable() }), owner: 'main' },
  // U12a (Interfaces §D, §K): the Browser options' Viewport, the tab's device size (null: Responsive), set by any window
  // by tab id as `browser.tabs.zoom` is and told back in the tab list; refused for an extension's options tab. Copy
  // screenshot: the view captured at device pixels and written to this Mac's clipboard whole, for the window the tab is
  // placed in only (as `browser.view.capture`); `copied: false` when no picture could be taken.
  'browser.tabs.setViewport': { input: z.strictObject({ tabId: BrowserTabIdSchema, viewport: BrowserViewportSchema.nullable() }), output: z.void(), owner: 'main' },
  'browser.view.copyScreenshot': { input: TabOnly, output: z.strictObject({ copied: z.boolean() }), owner: 'main' },
  // cua #90 start: an imported profile's bookmarks (cua board #90's spec, Interfaces "IPC"). `tree` answers the rows the
  // index holds for the partition (empty roots when none, or when the index is read-only); `sync` re-reads the profile's
  // `Bookmarks` file now and answers what it wrote, or why it wrote nothing (`refused`: an import or a removal is
  // running, or the profile has no consented bookmarks; `reason` says which).
  'browser.bookmarks.tree': { input: z.strictObject({ partition: BrowserPartitionSchema }), output: z.strictObject({ tree: BookmarkTreeSchema }), owner: 'main' },
  'browser.bookmarks.sync': {
    input: z.strictObject({ profileDir: ChromeProfileDirSchema }),
    output: z.union([
      z.strictObject({ syncedAt: z.iso.datetime(), count: ImportCountSchema }),
      z.strictObject({ error: z.union([BookmarkSyncErrorSchema, z.literal('refused')]), reason: ImportTextSchema.optional() }),
    ]),
    owner: 'main',
  },
  // The bar's commands name the tab they came from: main reads the partition and the session from it, so a node id is
  // looked up in that tab's partition only (a node of another partition is unknown) and every page opens in that
  // tab's session. `open`: a chip's click (`current`, as a link the person clicked) or ⌘-click and middle-click
  // (`newTab`, unselected). `menu`: a folder's native menu, or the » menu of the chips from `hiddenFrom` on and the
  // other roots, popped at `anchor` (CSS px of the window's content area) on the sender's window; the chosen item acts in
  // main. `favicons`: the icons the partition's favicon cache already holds for these page origins (no fetch).
  'browser.bookmarks.open': { input: z.strictObject({ tabId: BrowserTabIdSchema, nodeId: BookmarkNodeIdSchema, how: z.enum(['current', 'newTab']) }), output: z.void(), owner: 'main' },
  'browser.bookmarks.menu': {
    input: z.strictObject({
      tabId: BrowserTabIdSchema,
      request: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('folder'), nodeId: BookmarkNodeIdSchema }),
        z.strictObject({ kind: z.literal('overflow'), hiddenFrom: z.number().int().min(0) }),
      ]),
      anchor: z.strictObject({ x: z.number().int(), y: z.number().int() }),
    }),
    output: z.void(),
    owner: 'main',
  },
  'browser.bookmarks.favicons': {
    input: z.strictObject({ partition: BrowserPartitionSchema, origins: z.array(z.string().max(2048)).max(BOOKMARK_FAVICON_ORIGINS_MAX) }),
    output: z.strictObject({ icons: z.record(z.string(), z.string()) }),
    owner: 'main',
  },
  // The extensions action bar (Interfaces "Extensions"): `actions` lists the partition's loaded extensions as actions,
  // in Settings' order. The tab-scoped commands name the tab they came from, from which main reads the partition, the
  // session and the window, and an extension of another partition is unknown. `action.click` opens the action's popup
  // under `anchor` (a second click on the same action closes it); `action.options` opens its options page as a new
  // selected tab of the tab's session; `action.menu` pops the action's native context menu (its name, Options, Manage
  // extensions…) at `anchor`; `puzzle` pops the folded bar's native menu under the puzzle button (`anchor`), whose
  // actions anchor their popup there.
  'browser.extensions.actions': { input: z.strictObject({ partition: BrowserPartitionSchema }), output: z.strictObject({ actions: z.array(ExtensionActionSchema) }), owner: 'main' },
  'browser.extensions.action.click': { input: z.strictObject({ tabId: BrowserTabIdSchema, extensionId: ExtensionIdSchema, anchor: ControlRectSchema }), output: z.void(), owner: 'main' },
  'browser.extensions.action.options': { input: z.strictObject({ tabId: BrowserTabIdSchema, extensionId: ExtensionIdSchema }), output: z.void(), owner: 'main' },
  'browser.extensions.action.menu': {
    input: z.strictObject({ tabId: BrowserTabIdSchema, extensionId: ExtensionIdSchema, anchor: z.strictObject({ x: z.number().int(), y: z.number().int() }) }),
    output: z.void(),
    owner: 'main',
  },
  'browser.extensions.puzzle': { input: z.strictObject({ tabId: BrowserTabIdSchema, anchor: ControlRectSchema }), output: z.void(), owner: 'main' },
  // cua #90 end
  // P3-G start
  // P3-G (§D4.1): the still of the tab's page that Mark-up draws over (its view captured at device pixels, under the
  // crop's caps); refused for a tab not placed in the sender's window, `image: null` when no picture could be taken.
  'browser.view.capture': { input: TabOnly, output: CaptureAnswerSchema, owner: 'main' },
  // P3-G end
  // P5 O17 M9b start: the remote view's bridge (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §K, "The
  // app's bridge"; src/main/browser/remote-view.ts): a window's own viewers of the agent's tabs on another machine's
  // session, over that machine's RL2 link. `open` names the session by its address (the router lowers it, the machine
  // the handler's target) and answers the view and whether it is possible (its `view` kind, RemoteViewStateSchema); the rest
  // name the view, which only the window that opened it can.
  'browser.remote.open': { input: z.strictObject({ appSessionId: AppSessionIdSchema }), output: z.strictObject({ viewId: RemoteViewIdSchema, inventory: BrowserInventorySchema, view: RemoteViewStateSchema }), owner: 'main' },
  'browser.remote.select': { input: z.strictObject({ viewId: RemoteViewIdSchema, epoch: BrowserEpochSchema, tabId: BrowserTabIdSchema }), output: z.void(), owner: 'main' },
  'browser.remote.takeControl': { input: z.strictObject({ viewId: RemoteViewIdSchema }), output: z.strictObject({ control: z.boolean(), reason: z.string().max(1_024).optional() }), owner: 'main' },
  'browser.remote.releaseControl': { input: z.strictObject({ viewId: RemoteViewIdSchema }), output: z.void(), owner: 'main' },
  'browser.remote.input': { input: z.strictObject({ viewId: RemoteViewIdSchema, seq: BrowserSeqSchema, event: BrowserInputSchema }), output: z.void(), owner: 'main' },
  'browser.remote.ack': { input: z.strictObject({ viewId: RemoteViewIdSchema, seq: BrowserSeqSchema }), output: z.void(), owner: 'main' },
  'browser.remote.close': { input: z.strictObject({ viewId: RemoteViewIdSchema }), output: z.void(), owner: 'main' },
  // P5 O17 M9b end
} as const satisfies Record<`browser.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'browser.tabs.changed': BrowserTabsChangedSchema,
  // The page's picture while a layer covers it; null when the capture failed or came out larger than the bound.
  'browser.view.covered': z.strictObject({
    tabId: BrowserTabIdSchema,
    placeholder: z.string().startsWith(PLACEHOLDER_PREFIX).max(PLACEHOLDER_MAX_LENGTH).nullable(),
  }),
  'browser.control.changed': z.strictObject({ tabId: BrowserTabIdSchema, control: BrowserControlSchema, controlSince: z.string() }),
  'browser.chrome.command': BrowserChromeCommandSchema,
  'browser.download.refused': z.strictObject({ tabId: BrowserTabIdSchema, url: z.string(), filename: z.string() }), // an agent-started download, cancelled
  'browser.notice': BrowserNoticeSchema,
  // E4d start
  'browser.comment.changed': BrowserCommentChangedSchema,
  'browser.comment.picked': BrowserCommentPickedSchema, // to the owner window only (Design §8)
  // E4d end
  // E4b start: a run's progress (at most every 100 ms per phase, plus each phase's first and last), its end, the records
  'browser.import.progress': z.strictObject({ importId: ImportIdSchema, phase: ImportPhaseSchema, done: ImportCountSchema, total: ImportCountSchema }),
  'browser.import.finished': z.strictObject({ importId: ImportIdSchema, report: ImportReportSchema }),
  'browser.import.changed': z.strictObject({ profiles: z.array(ImportedProfileSchema) }),
  // E4b end
  // E4c start: an agent acts on this tab (E4c Design §6 step 1; since E13, a cua lease's first acting command, P1 A-54); a
  // window showing the session opens the Browser tool on it once per turn. `appSessionId` owns the tab; `actingSessionId`
  // acts (a side thread acting in its parent's tab, Decision Log 29; else the owner), so the once counts the turn that acts
  'browser.agent.acting': z.strictObject({ appSessionId: AppSessionIdSchema, tabId: BrowserTabIdSchema, actingSessionId: AppSessionIdSchema }),
  // E4c end
  // E13 start: what an agent did in a tab through cua (the in-app browser spec of 2026-10-08, "Action rows"), at most 20
  // per second per tab; the windows attach each to the session's cua_repl `js` call
  'browser.agent.activity': BrowserAgentActivitySchema,
  // E13 end
  // cua #90 start: a partition's bookmark rows were replaced (an import or a sync); a bar of that partition re-reads its tree
  'browser.bookmarks.changed': z.strictObject({ partition: BrowserPartitionSchema }),
  // the partition's actions changed (an extension loaded or unloaded): its bars read the list again
  'browser.extensions.actions.changed': z.strictObject({ partition: BrowserPartitionSchema }),
  // the popup open over the tab's window, for that tab's action button (pressed while its popup shows); null: none
  'browser.extensions.popup': z.strictObject({ tabId: BrowserTabIdSchema, extensionId: ExtensionIdSchema.nullable() }),
  // a menu's choice (in main) the chrome showing `tabId` carries on: show the options tab main opened (a main tab moves
  // to it; the panel shows the session's selected tab already), or open Settings › Browser (Manage extensions…); or
  // `replacement`: the options tab `tabId` left its extension's pages and closed, `tab` opened in its place (a main tab
  // showing it shows `tab` instead, in place)
  'browser.extensions.reveal': z.strictObject({
    tabId: BrowserTabIdSchema,
    show: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('tab'), tab: BrowserTabSchema }),
      z.strictObject({ kind: z.literal('settings') }),
      z.strictObject({ kind: z.literal('replacement'), tab: BrowserTabSchema }),
    ]),
  }),
  // cua #90 end
  // P5 O17 M9b start: to the window that opened the view only (remote-view.ts): its inventory at each change, each frame
  // (the next only after its `ack`), and the end of its stream with the endpoint's word (`tab-closed`, `engine-changed`,
  // `control-revoked`, `carrier`, `producer-failed`, …); the view itself goes on until `close`, or its feed's end, told
  // as an inventory whose `view` is `ended`
  'browser.remote.inventory': z.strictObject({ viewId: RemoteViewIdSchema, inventory: BrowserInventorySchema, view: RemoteViewStateSchema }),
  'browser.remote.frame': z.strictObject({ viewId: RemoteViewIdSchema, frame: BrowserRemoteFrameSchema }),
  'browser.remote.closed': z.strictObject({ viewId: RemoteViewIdSchema, reason: z.string().min(1).max(64) }),
  // P5 O17 M9b end
} as const satisfies Record<`browser.${string}`, z.ZodType>;

// P2-E2 start (2026-10-09): the comment card's pin on `browser.comment.picked` (P2 spec §4.7, X21; P2 interface ledger §1),
// its one marked line in E4d's strict object above: the picked element's point in the pane's viewport pixels (the page
// view's own box, whose top-left is the pane's page element's), main's from the preload's rect and the page's zoom (the
// centre of the element's visible span across, its bottom edge down, each clamped to the viewport). A pick without it
// docks a card with no pin.
export type PickPosition = NonNullable<BrowserCommentPicked['position']>;
// P2-E2 end
