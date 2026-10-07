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
  BrowserPartitionSchema,
  BrowserTabIdSchema,
  BrowserTabSchema,
} from '../../browser/tab';
import { validateBrowserUrl } from '../../browser/url';
import type { CommandSpec } from './common';
// E4b start
import {
  ChromeProfileDirSchema,
  ChromeProfileSchema,
  ExtensionCandidateSchema,
  ExtensionIdSchema,
  IMPORT_TEXT_MAX,
  ImportCategoriesSchema,
  ImportedExtensionSchema,
  ImportPhaseSchema,
  ImportReportSchema,
} from '../../browser/import';
import { ImportedProfileSchema } from '../../browser/profiles';
import { AbsolutePathSchema } from './settings';
// E4b end

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

export const BrowserChromeCommandSchema = z.strictObject({ tabId: BrowserTabIdSchema, command: z.enum(['focusAddress', 'openFind', 'closeFind']) });
export type BrowserChromeCommand = z.infer<typeof BrowserChromeCommandSchema>;

// A transient chrome notice (4 s), never an app toast (E4a Design §3 and Decision Log 28). `refusedScheme` is a page's
// own top-level navigation main refused (`name`: the scheme, such as `zoommtg:`), the chrome's refused-scheme line.
export const BrowserNoticeSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  tabId: BrowserTabIdSchema.nullable(),
  kind: z.enum(['tabsCap', 'profileMissing', 'partitionFallback', 'downloadRefusedAgent', 'tabsFileBroken', 'refusedScheme']),
  name: z.string().optional(),
  count: z.number().int().min(0).optional(),
});
export type BrowserNotice = z.infer<typeof BrowserNoticeSchema>;

// E4b start: the Chrome profile import (E4b execution document, Interfaces "IPC `browser.import.*`"). Main re-validates
// the Chrome folder and the profile directory against the disk and `Local State`; these schemas only keep a path out.
const ChromeFolderSchema = AbsolutePathSchema.max(IMPORT_TEXT_MAX);
const ImportIdSchema = z.uuid(); // main's randomUUID() for an inspection or a run
const ImportCount = z.number().int().min(0);
const StoreErrorSchema = z.strictObject({ error: z.string().max(IMPORT_TEXT_MAX) }); // the category cannot be imported
export const BrowserImportInspectionSchema = z.strictObject({
  inspectionId: ImportIdSchema,
  profile: ChromeProfileSchema,
  chromeRunning: z.boolean(), // `SingletonLock` exists: a hint, never a block
  history: z.union([z.strictObject({ rows: ImportCount }), StoreErrorSchema]),
  cookies: z.union([z.strictObject({ rows: ImportCount, partitioned: ImportCount, storeVersion: z.number().int() }), StoreErrorSchema]),
  extensions: z.array(ExtensionCandidateSchema),
});
export type BrowserImportInspection = z.infer<typeof BrowserImportInspectionSchema>;
// E4b end

export const commands = {
  // Every tab, or one session's, with each session's selected tab.
  'browser.tabs.list': {
    input: z.strictObject({ appSessionId: AppSessionIdSchema.optional() }),
    output: z.strictObject({ tabs: z.array(BrowserTabSchema), selected: z.record(AppSessionIdSchema, BrowserTabIdSchema.nullable()) }),
    owner: 'main',
  },
  // `url: null` opens an empty tab. `reuse: 'url'` selects the session's tab already at the same normalised URL (show_pane);
  // a `requestId` repeated within 10 s answers the first call's tab (two windows handling one `maws.pane.show`).
  'browser.tabs.open': {
    input: z.strictObject({
      appSessionId: AppSessionIdSchema,
      url: BrowserUrlSchema.nullable(),
      select: z.boolean(),
      reuse: z.literal('url').optional(),
      requestId: z.string().min(1).optional(),
    }),
    output: z.strictObject({ tab: BrowserTabSchema, reused: z.boolean() }),
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
    output: z.strictObject({ suggestions: z.array(z.strictObject({ url: z.string(), title: z.string().nullable() })).max(BROWSER_SUGGESTIONS_MAX) }),
    owner: 'main',
  },
  'browser.profiles.list': {
    input: z.void(),
    output: z.strictObject({ profiles: z.array(z.strictObject({ profileDir: z.string(), name: z.string() })) }),
    owner: 'main',
  },
  // E4b start: the import. One inspection and one run at a time, app-wide; `start` while one runs answers invalid_input.
  // `userDataDir: null` lists Chrome's default folder (under e2e, MAWS_E2E_CHROME_USER_DATA).
  'browser.import.profiles': {
    input: z.strictObject({ userDataDir: ChromeFolderSchema.nullable() }),
    output: z.strictObject({ userDataDir: ChromeFolderSchema, found: z.boolean(), chromeRunning: z.boolean(), profiles: z.array(ChromeProfileSchema), error: z.string().max(IMPORT_TEXT_MAX).nullable() }),
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
  'browser.import.list': { input: z.void(), output: z.strictObject({ profiles: z.array(ImportedProfileSchema), fileBroken: z.boolean() }), owner: 'main' },
  'browser.import.remove': {
    input: z.strictObject({ profileDir: ChromeProfileDirSchema }),
    output: z.strictObject({ removed: z.strictObject({ tabs: ImportCount, historyRows: ImportCount, extensions: ImportCount }) }),
    owner: 'main',
  },
  'browser.import.setExtension': {
    input: z.strictObject({ profileDir: ChromeProfileDirSchema, extensionId: ExtensionIdSchema, enabled: z.boolean() }),
    output: z.strictObject({ extension: ImportedExtensionSchema }),
    owner: 'main',
  },
  // E4b end
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
  // E4b start: a run's progress (at most every 100 ms per phase, plus each phase's first and last), its end, the records
  'browser.import.progress': z.strictObject({ importId: ImportIdSchema, phase: ImportPhaseSchema, done: ImportCount, total: ImportCount }),
  'browser.import.finished': z.strictObject({ importId: ImportIdSchema, report: ImportReportSchema }),
  'browser.import.changed': z.strictObject({ profiles: z.array(ImportedProfileSchema) }),
  // E4b end
} as const satisfies Record<`browser.${string}`, z.ZodType>;
