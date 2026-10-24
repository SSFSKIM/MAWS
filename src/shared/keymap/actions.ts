// The one action table (C5 execution document, Interfaces "Keymap and action table"; residue *Keyboard map*). It drives
// the application menu, the renderer's key dispatcher, the ⌘K palette and every tooltip. `menu` actions are registered
// as accelerators of the macOS application menu, which dispatches them as `layout.action`; `renderer` actions are
// matched by the renderer's dispatcher. The split is forced by Electron: `registerAccelerator: false` is Windows and
// Linux only, so a chord shown in the macOS menu is always registered there. The focused page sees the keydown first and
// the menu acts on it only when the page did not prevent it (cua #90's ⌘⇧B relies on that in the browser chrome), so a
// renderer handler would have to prevent every such chord itself; a chord that must know the focused element therefore
// stays out of the menu. Defaults are §5.8's; overrides live in
// `settings.keymap`.

export type Sink = 'menu' | 'renderer';
export interface ActionSpec {
  title: string;
  chord: string | null;
  sink: Sink;
  menu: 'app' | 'file' | 'view' | 'go' | 'help' | null; // 'app' is the application menu (MAWS › Settings… ⌘,), for C11's settings.open
  scope: 'app' | 'pane' | 'composer';
  // E9: a hold action: its binding runs on the accepted keydown and is told when the hold ends (the key or a modifier
  // of its chord let go, or the window losing the keyboard); `keymap/dispatcher.ts`, "Hold semantics"
  hold?: true;
}

export const ACTIONS = {
  'session.new':          { title: 'New chat',                    chord: 'Cmd+N',        sink: 'menu', menu: 'file', scope: 'app' },   // New chat (2026-10-01): registered with the session creator; disabled until one exists
  'tab.close':            { title: 'Close tab',                   chord: 'Cmd+W',        sink: 'menu', menu: 'file', scope: 'app' },
  'tab.reopen':           { title: 'Reopen closed tab',           chord: 'Cmd+Shift+T',  sink: 'menu', menu: 'file', scope: 'app' },
  'tab.overview':         { title: 'Overview',                    chord: 'Cmd+0',        sink: 'menu', menu: 'view', scope: 'app' },
  'artifacts.open':       { title: 'Artifacts',                   chord: null,           sink: 'menu', menu: 'view', scope: 'app' },   // P3-G (§D5): opens or activates the Artifacts tab, as the sidebar's row does
  'tab.select':           { title: 'Select tab 1–9',              chord: 'Cmd+1',        sink: 'menu', menu: 'view', scope: 'app' },   // the menu expands this to nine items Cmd+1 … Cmd+9 with arg 1..9
  'tab.next':             { title: 'Next tab',                    chord: 'Ctrl+Tab',     sink: 'renderer', menu: 'view', scope: 'pane' },
  'tab.previous':         { title: 'Previous tab',                chord: 'Ctrl+Shift+Tab', sink: 'renderer', menu: 'view', scope: 'pane' },
  'tab.stripNext':        { title: 'Next tab in strip',           chord: 'Cmd+Alt+]',    sink: 'menu', menu: 'go', scope: 'app' },
  'tab.stripPrevious':    { title: 'Previous tab in strip',       chord: 'Cmd+Alt+[',    sink: 'menu', menu: 'go', scope: 'app' },
  'region.focusNext':     { title: 'Focus next region',           chord: 'F6',           sink: 'menu', menu: 'go', scope: 'app' },
  'region.focusPrevious': { title: 'Focus previous region',       chord: 'Shift+F6',     sink: 'menu', menu: 'go', scope: 'app' },
  'sidebar.focus':        { title: 'Focus sidebar',               chord: null,           sink: 'menu', menu: 'go', scope: 'app' },
  'pane.split':           { title: 'Split / move to other pane',  chord: 'Cmd+\\',       sink: 'menu', menu: 'view', scope: 'app' },
  'pane.focusOther':      { title: 'Focus other pane',            chord: 'Cmd+Shift+\\', sink: 'menu', menu: 'view', scope: 'app' },
  'sidebar.toggle':       { title: 'Toggle sidebar',              chord: 'Cmd+B',        sink: 'menu', menu: 'view', scope: 'app' },
  'panel.toggle':         { title: 'Toggle session cards',          chord: 'Cmd+Shift+B',  sink: 'menu', menu: 'view', scope: 'app' },
  'surface.terminal': { title: 'Toggle Terminal surface', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'surface.review': { title: 'Toggle Review surface', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'surface.browser': { title: 'Toggle Browser surface', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'surface.files': { title: 'Toggle Files surface', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'surface.source-control': { title: 'Toggle Source control surface', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'surface.subagents': { title: 'Toggle Subagents surface', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'surface.background': { title: 'Toggle Background work surface', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'surface.session-info': { title: 'Toggle Session info surface', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'surface.ask-sheet': { title: 'Toggle Questions surface', chord: null, sink: 'menu', menu: 'view', scope: 'app' },
  'panel.maximize':       { title: 'Expand surface',        chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  // P3-G (§D1.7): the panel's floating state, the third region state of the B family (⌘B the sidebar, ⇧⌘B the panel); a
  // page in the browser passes every ⌥⌘ chord to the menu, so it works with a page focused
  'panel.float':          { title: 'Float conversation over surface',    chord: 'Cmd+Alt+B',    sink: 'menu', menu: 'view', scope: 'app' },
  // P4-B3 (X32 amendment; its Decision Log 12): the focused pane takes the main area and the session beside it floats in
  // the split's card, as the editor header's Expand does; on a floating split it restores the split. No default chord.
  // P4-B3x (P4 Decision Log 40): it also folds an open right panel, which restoring the split opens again
  'main.expandArtifactPane': { title: 'Expand pane',              chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  // P4-B3 (X38; its Decision Log 21): the focused main artifact tab into the panel ("Show in panel"), and the shown
  // panel's Artifacts record into a main tab ("Move to tab"), as a drag does; refused with the drag's reason. No chords
  'artifact.moveToPanel':    { title: 'Move to side surface',            chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'artifact.moveToTab':      { title: 'Move to tab',              chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'theme.light':          { title: 'Appearance: Light',           chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'theme.dark':           { title: 'Appearance: Dark',            chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'theme.system':         { title: 'Appearance: System',          chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'palette.open':         { title: 'Command palette',             chord: 'Cmd+K',        sink: 'menu', menu: 'go',   scope: 'app' },
  'session.previous':    { title: 'Previous session', chord: 'Cmd+Shift+[', sink: 'menu', menu: 'go', scope: 'app' },
  'session.next':        { title: 'Next session', chord: 'Cmd+Shift+]', sink: 'menu', menu: 'go', scope: 'app' },
  'session.markUnread':  { title: 'Mark session unread', chord: 'Cmd+Alt+U', sink: 'menu', menu: 'go', scope: 'app' },
  'attention.next':       { title: 'Next Needs-you',              chord: 'Cmd+Shift+J',  sink: 'menu', menu: 'go',   scope: 'app' },
  'shortcuts.open':       { title: 'Keyboard shortcuts',          chord: 'Cmd+/',        sink: 'menu', menu: 'help', scope: 'app' },
  'diagnostics.open':     { title: 'Diagnostics',                 chord: null,           sink: 'menu', menu: 'help', scope: 'app' },
  'request.accept':       { title: 'Approve / answer the docked request', chord: 'Enter', sink: 'renderer', menu: null, scope: 'pane' },     // C7's card subscribes through useKeyChord
  'request.decline':      { title: 'Decline the docked request', chord: 'Escape',       sink: 'renderer', menu: null, scope: 'pane' },
  'composer.send':        { title: 'Send (multi-line editor)',    chord: 'Cmd+Enter',    sink: 'renderer', menu: null, scope: 'composer' },  // C7 consumes
  'composer.cycleMode':   { title: 'Cycle permission mode',       chord: 'Shift+Tab',    sink: 'renderer', menu: null, scope: 'composer' },  // C7 consumes
  // C7 start: the composer's own actions (C7 execution document, Keymap additions). Stop and Focus are app-scoped
  // because ⌘. is pressed while typing, where C5's dispatcher refuses every pane-scoped action, and are registered once
  // (ComposerAppKeys), resolving the focused pane. W10 (charter §4.2 as amended 2026-10-01): `composer.steer` (⌥Enter,
  // W1's hold until the turn ends) is gone with the hold; a saved override of it is dropped on read (RETIRED_ACTION_IDS).
  'composer.stop':        { title: 'Stop, holding waiting messages', chord: 'Cmd+.',     sink: 'renderer', menu: null, scope: 'app' }, // W1: nothing runs after it
  'composer.focus':       { title: 'Focus the composer',          chord: 'Cmd+L',        sink: 'renderer', menu: null, scope: 'app' },
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
  // P4-B1 start (2026-10-20; the P4 spec §4.3, Docs' View › Comments): every document's comment view, per user
  // (settings.artifacts.commentsView): Expand draws the cards in the margin, Minimize the icons at the anchors, Hide an
  // empty margin. Three flat items (the table has no submenu or checked state); unbound by default
  'comments.expand':         { title: 'Expand comments',          chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'comments.minimize':       { title: 'Minimize comments',        chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'comments.hide':           { title: 'Hide comments',            chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  // P4-B1 end
} as const satisfies Record<string, ActionSpec>;

export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as [ActionId, ...ActionId[]];

// Ids an earlier version had, which a settings file may still carry as overrides: the keymap's schema names only the
// current ids, so a read drops these first rather than refusing the whole file (W10: ⌥Enter's hold).
export const RETIRED_ACTION_IDS: readonly string[] = ['composer.steer'];

// `settings.keymap`: overrides only; null unbinds; absent means the default.
export type KeymapOverrides = Partial<Record<ActionId, string | null>>;

export function effectiveChord(id: ActionId, overrides: KeymapOverrides): string | null {
  const override = overrides[id];
  return override === undefined ? ACTIONS[id].chord : override;
}
