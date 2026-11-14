// The one action table (C5 execution document, Interfaces "Keymap and action table"; residue *Keyboard map*). It drives
// the application menu, the renderer's key dispatcher, the ⌘K palette and every tooltip. `menu` actions are registered
// as accelerators of the macOS application menu, which dispatches them as `layout.action`; `renderer` actions are
// matched by the renderer's dispatcher. The split is forced by Electron: `registerAccelerator: false` is Windows and
// Linux only, so a chord shown in the macOS menu is always registered there. The focused page sees the keydown first and
// the menu acts on it only when the page did not prevent it (cua #90's ⌘⇧B relies on that in the browser chrome), so a
// renderer handler would have to prevent every such chord itself; a chord that must know the focused element therefore
// stays out of the menu. Defaults are §5.8's; overrides live in
// `settings.keymap`.
// U6a (the UX wave's UC-6): the table's order is the menus' order. A row placed in a menu sits where it stands among
// that menu's rows, or in the submenu it names, which the menu folds in where the submenu's first row stands; the shortcut
// sheet and Settings › Keyboard group the rows the same way. A `fixed` row is a key its own editing surface handles:
// listed in the sheet and Settings under its scope, never dispatched, never in the palette, never rebound. A child adds
// a key by adding its row here and nowhere else.
import { parseChord } from './chord';
import { BUILD_F_ACTION_IDS } from './build-f';

export type Sink = 'menu' | 'renderer';
export interface ActionSpec {
  title: string;
  chord: string | null;
  sink: Sink;
  // 'app' is the application menu (MAWS › Settings… ⌘,), for C11's settings.open; U6a: 'edit' is placed after the Edit
  // menu's own items
  menu: 'app' | 'file' | 'edit' | 'view' | 'go' | 'help' | null;
  submenu?: string; // U6a: the submenu of its menu the row sits in
  scope: 'app' | 'pane' | 'composer';
  // E9: a hold action: its binding runs on the accepted keydown and is told when the hold ends (the key or a modifier
  // of its chord let go, or the window losing the keyboard); `keymap/dispatcher.ts`, "Hold semantics"
  hold?: true;
  // U6a: a key its own editing surface handles (Enter in the composer): `renderer`, no menu, with a chord; listed, never
  // dispatched, not rebindable
  fixed?: true;
}

export const ACTIONS = {
  'session.new':          { title: 'New chat',                    chord: 'Cmd+N',        sink: 'menu', menu: 'file', scope: 'app' },   // New chat (2026-10-01): registered with the session creator; disabled until one exists
  'tab.close':            { title: 'Close tab',                   chord: 'Cmd+W',        sink: 'menu', menu: 'file', scope: 'app' },
  'tab.reopen':           { title: 'Reopen closed tab',           chord: 'Cmd+Shift+T',  sink: 'menu', menu: 'file', scope: 'app' },
  // View, in its order (U6a; l7-shell-07): Overview, Artifacts, Tabs ▸, Project channel (U11a), the panes, the regions,
  // the side surfaces and More surfaces ▸, the moves between them, then Comments ▸, Appearance ▸ and Usage (accounts.open,
  // in C11's block below)
  'tab.overview':         { title: 'Overview',                    chord: 'Cmd+0',        sink: 'menu', menu: 'view', scope: 'app' },
  'artifacts.open':       { title: 'Artifacts',                   chord: null,           sink: 'menu', menu: 'view', scope: 'app' },   // P3-G (§D5): opens or activates the Artifacts tab, as the sidebar's row does
  'tab.select':           { title: 'Select tab 1–9',              chord: 'Cmd+1',        sink: 'menu', menu: 'view', submenu: 'Tabs', scope: 'app' },   // the menu expands this to nine items Cmd+1 … Cmd+9 with arg 1..9
  'tab.next':             { title: 'Next tab',                    chord: 'Ctrl+Tab',     sink: 'renderer', menu: 'view', submenu: 'Tabs', scope: 'pane' },
  'tab.previous':         { title: 'Previous tab',                chord: 'Ctrl+Shift+Tab', sink: 'renderer', menu: 'view', submenu: 'Tabs', scope: 'pane' },
  // U11a (S-10; its execution document's Interfaces §F): the Channel of the focused tab's project; registered while that
  // project has one. No default chord, and no rebinding while build F stands (`isRebindable`)
  'channel.open':         { title: 'Project channel',             chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'pane.split':           { title: 'Split / move to other pane',  chord: 'Cmd+\\',       sink: 'menu', menu: 'view', scope: 'app' },
  'pane.focusOther':      { title: 'Focus other pane',            chord: 'Cmd+Shift+\\', sink: 'menu', menu: 'view', scope: 'app' },
  // P4-B3 (X32 amendment; its Decision Log 12): the focused pane takes the main area and the session beside it floats in
  // the split's card, as the editor header's Expand does; on a floating split it restores the split. No default chord.
  // P4-B3x (P4 Decision Log 40): it also folds an open right panel, which restoring the split opens again
  'main.expandArtifactPane': { title: 'Expand pane',              chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'sidebar.toggle':       { title: 'Toggle sidebar',              chord: 'Cmd+B',        sink: 'menu', menu: 'view', scope: 'app' },
  'panel.toggle':         { title: 'Toggle session cards',          chord: 'Cmd+Shift+B',  sink: 'menu', menu: 'view', scope: 'app' },
  'panel.maximize':       { title: 'Expand surface',        chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  // P3-G (§D1.7): the panel's floating state, the third region state of the B family (⌘B the sidebar, ⇧⌘B the panel); a
  // page in the browser passes every ⌥⌘ chord to the menu, so it works with a page focused
  'panel.float':          { title: 'Float conversation over surface',    chord: 'Cmd+Alt+B',    sink: 'menu', menu: 'view', scope: 'app' },
  // U6a (l5-code-08): ⌘J, ⇧⌘D and ⇧⌘F show and hide Terminal, Review and Files, Claude Desktop's chords for the same acts;
  // the other surfaces stay unbound, the rarer ones in More surfaces ▸. Each row is titled by its surface's name.
  'surface.terminal': { title: 'Terminal', chord: 'Cmd+J', sink: 'menu', menu: 'view', scope: 'app' },
  'surface.review': { title: 'Review', chord: 'Cmd+Shift+D', sink: 'menu', menu: 'view', scope: 'app' },
  'surface.files': { title: 'Files', chord: 'Cmd+Shift+F', sink: 'menu', menu: 'view', scope: 'app' },
  'surface.browser': { title: 'Browser', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'surface.source-control': { title: 'Source control', chord: null, sink: 'menu', menu: 'view', submenu: 'More surfaces', scope: 'app' },
  'surface.subagents': { title: 'Subagents', chord: null, sink: 'menu', menu: 'view', submenu: 'More surfaces', scope: 'app' },
  'surface.background': { title: 'Background tasks', chord: null, sink: 'menu', menu: 'view', submenu: 'More surfaces', scope: 'app' },
  'surface.session-info': { title: 'Session info', chord: null, sink: 'menu', menu: 'view', submenu: 'More surfaces', scope: 'app' },
  'surface.ask-sheet': { title: 'Questions', chord: null, sink: 'menu', menu: 'view', submenu: 'More surfaces', scope: 'app' },
  // P4-B3 (X38; its Decision Log 21): the focused main artifact tab into the panel ("Show in panel"), and the shown
  // panel's Artifacts record into a main tab ("Move to tab"), as a drag does; refused with the drag's reason. No chords
  'artifact.moveToPanel':    { title: 'Move to side surface',            chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'artifact.moveToTab':      { title: 'Move to tab',              chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  // P4-B1 start (2026-10-20; the P4 spec §4.3, Docs' View › Comments): every document's comment view, per user
  // (settings.artifacts.commentsView): Expand draws the cards in the margin, Minimize the icons at the anchors, Hide an
  // empty margin. Unbound by default; U6a: in View › Comments
  'comments.expand':         { title: 'Expand comments',          chord: null,           sink: 'menu', menu: 'view', submenu: 'Comments', scope: 'app' },
  'comments.minimize':       { title: 'Minimize comments',        chord: null,           sink: 'menu', menu: 'view', submenu: 'Comments', scope: 'app' },
  'comments.hide':           { title: 'Hide comments',            chord: null,           sink: 'menu', menu: 'view', submenu: 'Comments', scope: 'app' },
  // P4-B1 end
  'theme.light':          { title: 'Appearance: Light',           chord: null,           sink: 'menu', menu: 'view', submenu: 'Appearance', scope: 'app' },
  'theme.dark':           { title: 'Appearance: Dark',            chord: null,           sink: 'menu', menu: 'view', submenu: 'Appearance', scope: 'app' },
  'theme.system':         { title: 'Appearance: System',          chord: null,           sink: 'menu', menu: 'view', submenu: 'Appearance', scope: 'app' },
  // Go, in its order (U6a; l7-shell-07): the palette, the session steps, the tab steps, the region steps
  'palette.open':         { title: 'Command palette',             chord: 'Cmd+K',        sink: 'menu', menu: 'go',   scope: 'app' },
  'session.previous':    { title: 'Previous session', chord: 'Cmd+Shift+[', sink: 'menu', menu: 'go', scope: 'app' },
  'session.next':        { title: 'Next session', chord: 'Cmd+Shift+]', sink: 'menu', menu: 'go', scope: 'app' },
  'session.markUnread':  { title: 'Mark session unread', chord: 'Cmd+Alt+U', sink: 'menu', menu: 'go', scope: 'app' },
  'attention.next':       { title: 'Next Needs-you',              chord: 'Cmd+Shift+J',  sink: 'menu', menu: 'go',   scope: 'app' },
  'tab.stripNext':        { title: 'Next tab in strip',           chord: 'Cmd+Alt+]',    sink: 'menu', menu: 'go', scope: 'app' },
  'tab.stripPrevious':    { title: 'Previous tab in strip',       chord: 'Cmd+Alt+[',    sink: 'menu', menu: 'go', scope: 'app' },
  'region.focusNext':     { title: 'Focus next region',           chord: 'F6',           sink: 'menu', menu: 'go', scope: 'app' },
  'region.focusPrevious': { title: 'Focus previous region',       chord: 'Shift+F6',     sink: 'menu', menu: 'go', scope: 'app' },
  'sidebar.focus':        { title: 'Focus sidebar',               chord: null,           sink: 'menu', menu: 'go', scope: 'app' },
  'shortcuts.open':       { title: 'Keyboard shortcuts',          chord: 'Cmd+/',        sink: 'menu', menu: 'help', scope: 'app' },
  'diagnostics.open':     { title: 'Diagnostics',                 chord: null,           sink: 'menu', menu: 'help', scope: 'app' },
  'request.accept':       { title: 'Next or Submit on a question; Implement on a plan', chord: 'Enter', sink: 'renderer', menu: null, scope: 'pane' },     // C7's card subscribes through useKeyChord
  'request.decline':      { title: 'Deny a prompt, or decline a question', chord: 'Escape', sink: 'renderer', menu: null, scope: 'pane' },
  // UX wave U1a (UC-6; its §D): a permission prompt's two allows, beside the rows they extend. ⌘↩ is also composer.send's
  // default; the pane scope and the composer scope never meet on one target (decision 8's sharing rule)
  'request.allowOnce':    { title: 'Allow once',                  chord: 'Cmd+Enter',    sink: 'renderer', menu: null, scope: 'pane' },
  'request.allowLasting': { title: 'Allow with the lasting scope the prompt names', chord: 'Cmd+Shift+Enter', sink: 'renderer', menu: null, scope: 'pane' },
  // UX wave U4a (UC-6; its Interfaces H): the composer's own keys, which its editor handles (fixed: listed, never
  // dispatched or rebound): Enter always sends, Shift+Enter and ⌥Enter break the line. ⌘Enter in the main editor is
  // composer.queue, which keeps the message for after the running turn; composer.send keeps the chord for the reply
  // fields (the peer reply and the two subagent relays), where Enter breaks the line. The dispatcher tries the two in
  // this order and delivers each only to a binding whose element holds the focus.
  'composer.submit':      { title: 'Send',                        chord: 'Enter',        sink: 'renderer', menu: null, scope: 'composer', fixed: true },
  'composer.newLine':     { title: 'New line',                    chord: 'Shift+Enter',  sink: 'renderer', menu: null, scope: 'composer', fixed: true },
  'composer.newLineOption': { title: 'New line',                  chord: 'Alt+Enter',    sink: 'renderer', menu: null, scope: 'composer', fixed: true },
  'composer.queue':       { title: 'Queue for after the turn',    chord: 'Cmd+Enter',    sink: 'renderer', menu: null, scope: 'composer' },
  'composer.send':        { title: 'Send (reply fields)',         chord: 'Cmd+Enter',    sink: 'renderer', menu: null, scope: 'composer' },  // C7 consumes
  'composer.takeBack':    { title: 'Take back the newest waiting message', chord: 'Up', sink: 'renderer', menu: null, scope: 'composer', fixed: true }, // UX wave U4a M3: the editor's ↑ in an empty box
  'composer.sendNowOrStop': { title: 'Send the first waiting message now, or stop', chord: 'Escape', sink: 'renderer', menu: null, scope: 'composer', fixed: true }, // UX wave U4a M3: the editor's Esc while a turn runs
  'composer.cycleMode':   { title: 'Cycle permission mode',       chord: 'Shift+Tab',    sink: 'renderer', menu: null, scope: 'composer' },  // C7 consumes
  'composer.historySearch': { title: 'Search prompt history',     chord: 'Ctrl+R',       sink: 'renderer', menu: null, scope: 'composer' }, // UX wave U4a M6: the focused composer's search of the history ↑ walks
  // C7 start: the composer's own actions (C7 execution document, Keymap additions). Stop and Focus are app-scoped
  // because ⌘. is pressed while typing, where C5's dispatcher refuses every pane-scoped action, and are registered once
  // (ComposerAppKeys), resolving the focused pane. W10 (charter §4.2 as amended 2026-10-01): `composer.steer` (⌥Enter,
  // W1's hold until the turn ends) is gone with the hold; a saved override of it is dropped on read (RETIRED_ACTION_IDS).
  'composer.stop':        { title: 'Stop, holding waiting messages', chord: 'Cmd+.',     sink: 'renderer', menu: null, scope: 'app' }, // W1: nothing runs after it
  'composer.focus':       { title: 'Focus the composer',          chord: 'Cmd+L',        sink: 'renderer', menu: null, scope: 'app' },
  // UX wave U4a M5 (Interfaces H; decision 21): the composer chips' menus of the focused pane's session, registered once
  // beside Stop and Focus (ComposerAppKeys); ⇧⌘E's effort view puts the keyboard on the slider
  'composer.modelMenu':   { title: 'Model menu',                  chord: 'Cmd+Shift+I',  sink: 'renderer', menu: null, scope: 'app' },
  'composer.effortMenu':  { title: 'Effort',                      chord: 'Cmd+Shift+E',  sink: 'renderer', menu: null, scope: 'app' },
  'composer.modeMenu':    { title: 'Permission mode menu',        chord: 'Cmd+Shift+M',  sink: 'renderer', menu: null, scope: 'app' },
  // C7 end
  // C11 start: the Settings tab and the ClaudeUsage hand-off (C11 execution document, Keymap and action entries).
  // settings.open's arg, when given, is the index of a Settings section; the relay card runs the hand-off. W6: the
  // Accounts tab retired; `accounts.open` keeps its id, which the settings' keymap overrides are keyed by, and opens the
  // top bar's usage popover.
  'settings.open':           { title: 'Settings…',                chord: 'Cmd+,',        sink: 'menu', menu: 'app',  scope: 'app' },
  'accounts.open':           { title: 'Usage',                    chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'gateway.openClaudeUsage': { title: 'Open ClaudeUsage',         chord: null,           sink: 'renderer', menu: null, scope: 'app' },
  // C11 end
  // E9 start: push-to-talk dictation into the focused pane's composer (E9 execution document, Design §5): app-scoped like
  // ⌘L, so it works wherever focus is. Unbound by default (the owner's ruling, 2026-10-06): the composer toolbar's
  // microphone is the primary control; a chord bound in Settings › Keyboard holds to dictate (⌥Space suits; ⌃Space
  // switches input sources on a multi-language Mac)
  'composer.dictate':        { title: 'Hold to dictate',          chord: null,           sink: 'renderer', menu: null, scope: 'app', hold: true },
  // E9 end
  // E5 start: the editor's save (E5 execution document, Interfaces *The close guard and the action*). A menu action
  // because macOS registers ⌘S in the menu and the page never sees it (as ⌘W); it saves the focused pane's file tab.
  'file.save':               { title: 'Save file',                chord: 'Cmd+S',        sink: 'menu', menu: 'file', scope: 'app' },
  // E5 end
  // E11 start (W-C; the comment gutter's keyboard and screen-reader path): opens the comment composer for the cursor's
  // line of the focused pane's file tab, as the gutter's mark does for its line. A menu action, so it reaches the
  // editor's cursor from the palette, File ▸ Comment on this line and a chord bound in Settings ▸ Keyboard alike;
  // unbound by default
  'file.commentLine':        { title: 'Comment on this line',     chord: null,           sink: 'menu', menu: 'file', scope: 'app' },
  // E11 end
  // P2-C start (2026-10-09; the parent's Decision Log 19): the focused pane's session tab between its report and its
  // full transcript while the owner channel's lane is on, as the pane header's toggle does; unbound by default
  'transcript.toggleReport': { title: 'Toggle report and transcript', chord: null,         sink: 'renderer', menu: null, scope: 'app' },
  // P2-C end
  // P3-G (§D4.4): Mark up over the selected panel tab's surface, as the panel header's button does; unbound by default
  'markup.start':            { title: 'Mark up',                  chord: null,           sink: 'renderer', menu: null, scope: 'app' },
} as const satisfies Record<string, ActionSpec>;

export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as [ActionId, ...ActionId[]];

// A table of rows: `ACTIONS`, or (in a test) `ACTIONS` with rows shaped as a later child will add them.
export type ActionTable = Readonly<Record<ActionId, ActionSpec>>;
export const idsOf = (table: ActionTable): ActionId[] => Object.keys(table) as ActionId[];

// Ids an earlier version had, which a settings file may still carry as overrides: the keymap's schema names only the
// ids it knows (U6a: build F's, `./build-f.ts`), so a read drops these first rather than refusing the whole file (W10:
// ⌥Enter's hold).
export const RETIRED_ACTION_IDS: readonly string[] = ['composer.steer'];

// `settings.keymap`: overrides only; null unbinds; absent means the default.
export type KeymapOverrides = Partial<Record<ActionId, string | null>>;

// The nine chords Select tab 1–9 numbers `chord` into, or null when it does not: only a chord whose key (the token after
// its last `+`) is the digit 1 numbers through 9, so F11 or F21 is one chord, never F12 … F19 or F22 … F29 (the panel's
// finding of 2026-11-12, "tab-chord expansion past F24"). The one statement of the rule: the menu's nine items, the
// chords a row holds and the shown chord all read it.
export function tabChords(chord: string): string[] | null {
  const tokens = chord.split('+');
  if (tokens.at(-1) !== '1') return null;
  const mods = tokens.slice(0, -1).map((token) => `${token}+`).join('');
  return Array.from({ length: 9 }, (_, i) => `${mods}${i + 1}`);
}

// The chords a row holds with `chord`: Select tab 1–9 the nine the menu numbers it into.
export function heldChords(id: ActionId, chord: string): string[] {
  return (id === 'tab.select' ? tabChords(chord) : null) ?? [chord];
}

// U6a (UC-14; the U6a execution document, decision 11): while build F may run on the same profile, a row takes a
// rebinding only if it is not fixed and F knows its id; the settings' schema stores no other (`./build-f.ts`).
const BUILD_F_IDS: ReadonlySet<string> = new Set(BUILD_F_ACTION_IDS);
export function isRebindable(id: ActionId, table: ActionTable = ACTIONS): boolean {
  const spec = table[id] as ActionSpec | undefined;
  return spec !== undefined && !spec.fixed && BUILD_F_IDS.has(id);
}

const sameChord = (a: string, b: string) => {
  const x = parseChord(a);
  const y = parseChord(b);
  return x.meta === y.meta && x.ctrl === y.ctrl && x.alt === y.alt && x.shift === y.shift && x.key === y.key;
};

// The chord a row answers to (U6a, the U6a execution document's Interfaces A), in this order:
// 1. a fixed row answers its default, always: it takes no override and yields to none;
// 2. a rebindable row with an override of its own answers that override (null unbinds); an override of a row that is
//    not rebindable is never read;
// 3. every other row answers its default, or null while another rebindable row's own override holds that chord
//    (decision 10: a rebinding the person stored wins over a default a later build gives another action, and nothing
//    stored is rewritten; freeing the chord restores the default). Select tab counts its nine chords on either side.
export function effectiveChord(id: ActionId, overrides: KeymapOverrides, table: ActionTable = ACTIONS): string | null {
  const spec = table[id];
  if (spec.fixed) return spec.chord;
  const own = overrides[id];
  if (own !== undefined && isRebindable(id, table)) return own;
  if (spec.chord === null) return null;
  const mine = heldChords(id, spec.chord);
  const taken = (Object.entries(overrides) as [ActionId, string | null | undefined][]).some(
    ([other, chord]) => other !== id && typeof chord === 'string' && isRebindable(other, table) && heldChords(other, chord).some((held) => mine.some((c) => sameChord(c, held))),
  );
  return taken ? null : spec.chord;
}
