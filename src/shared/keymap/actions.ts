// The one action table (C5 execution document, Interfaces "Keymap and action table"; residue *Keyboard map*). It drives
// the application menu, the renderer's key dispatcher, the ⌘K palette and every tooltip. `menu` actions are registered
// as accelerators of the macOS application menu, which dispatches them as `layout.action`; `renderer` actions are
// matched by the renderer's dispatcher. The split is forced by Electron: `registerAccelerator: false` is Windows and
// Linux only, so a chord shown in the macOS menu is always registered there and the page never sees its keydown; a
// chord that must know the focused element therefore stays out of the menu. Defaults are §5.8's; overrides live in
// `settings.keymap`.

export type Sink = 'menu' | 'renderer';
export interface ActionSpec {
  title: string;
  chord: string | null;
  sink: Sink;
  menu: 'app' | 'file' | 'view' | 'go' | 'help' | null; // 'app' is the application menu (MAWS › Settings… ⌘,), for C11's settings.open
  scope: 'app' | 'pane' | 'composer';
}

export const ACTIONS = {
  'session.new':          { title: 'New session',                 chord: 'Cmd+N',        sink: 'menu', menu: 'file', scope: 'app' },   // handler registered by C10; disabled until then
  'tab.close':            { title: 'Close tab',                   chord: 'Cmd+W',        sink: 'menu', menu: 'file', scope: 'app' },
  'tab.reopen':           { title: 'Reopen closed tab',           chord: 'Cmd+Shift+T',  sink: 'menu', menu: 'file', scope: 'app' },
  'tab.overview':         { title: 'Overview',                    chord: 'Cmd+0',        sink: 'menu', menu: 'view', scope: 'app' },
  'tab.select':           { title: 'Select tab 1–9',              chord: 'Cmd+1',        sink: 'menu', menu: 'view', scope: 'app' },   // the menu expands this to nine items Cmd+1 … Cmd+9 with arg 1..9
  'tab.next':             { title: 'Next tab',                    chord: 'Ctrl+Tab',     sink: 'renderer', menu: 'view', scope: 'pane' },
  'tab.previous':         { title: 'Previous tab',                chord: 'Ctrl+Shift+Tab', sink: 'renderer', menu: 'view', scope: 'pane' },
  'pane.split':           { title: 'Split / move to other pane',  chord: 'Cmd+\\',       sink: 'menu', menu: 'view', scope: 'app' },
  'pane.focusOther':      { title: 'Focus other pane',            chord: 'Cmd+Shift+\\', sink: 'menu', menu: 'view', scope: 'app' },
  'sidebar.toggle':       { title: 'Toggle sidebar',              chord: 'Cmd+B',        sink: 'menu', menu: 'view', scope: 'app' },
  'panel.toggle':         { title: 'Toggle right panel',          chord: 'Cmd+Shift+B',  sink: 'menu', menu: 'view', scope: 'app' },
  'panel.maximize':       { title: 'Maximize right panel',        chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'theme.light':          { title: 'Appearance: Light',           chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'theme.dark':           { title: 'Appearance: Dark',            chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'theme.system':         { title: 'Appearance: System',          chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'palette.open':         { title: 'Command palette',             chord: 'Cmd+K',        sink: 'menu', menu: 'go',   scope: 'app' },
  'attention.next':       { title: 'Next Needs-you',              chord: 'Cmd+Shift+J',  sink: 'menu', menu: 'go',   scope: 'app' },
  'diagnostics.open':     { title: 'Diagnostics',                 chord: null,           sink: 'menu', menu: 'help', scope: 'app' },
  'request.accept':       { title: 'Approve / answer the docked request', chord: 'Enter', sink: 'renderer', menu: null, scope: 'pane' },     // C7's card subscribes through useKeyChord
  'request.decline':      { title: 'Decline the docked request', chord: 'Escape',       sink: 'renderer', menu: null, scope: 'pane' },
  'composer.send':        { title: 'Send (multi-line editor)',    chord: 'Cmd+Enter',    sink: 'renderer', menu: null, scope: 'composer' },  // C7 consumes
  'composer.cycleMode':   { title: 'Cycle permission mode',       chord: 'Shift+Tab',    sink: 'renderer', menu: null, scope: 'composer' },  // C7 consumes
  // C7 start: the composer's own actions (C7 execution document, Keymap additions). Hold is delivered only inside the
  // editor's `data-key-sink="composer"`; Stop and Focus are app-scoped because ⌘. is pressed while typing, where C5's
  // dispatcher refuses every pane-scoped action, and are registered once (ComposerAppKeys), resolving the focused pane.
  // W1 (charter §4.2 as amended 2026-10-01): ⌥Enter now holds the message until the turn ends (Enter while a turn runs
  // is the `next` steer, and Esc in the editor interrupts and sends the held head now); the id stays `composer.steer`
  // because the settings' keymap overrides are keyed by it.
  'composer.steer':       { title: 'Hold until the turn ends',    chord: 'Alt+Enter',    sink: 'renderer', menu: null, scope: 'composer' },
  'composer.stop':        { title: 'Stop, holding waiting messages', chord: 'Cmd+.',     sink: 'renderer', menu: null, scope: 'app' }, // W1: nothing runs after it
  'composer.focus':       { title: 'Focus the composer',          chord: 'Cmd+L',        sink: 'renderer', menu: null, scope: 'app' },
  // C7 end
  // C11 start: the Settings and Accounts tabs and the ClaudeUsage hand-off (C11 execution document, Keymap and action
  // entries). settings.open's arg, when given, is the index of a Settings section; the relay card runs the hand-off.
  'settings.open':           { title: 'Settings…',                chord: 'Cmd+,',        sink: 'menu', menu: 'app',  scope: 'app' },
  'accounts.open':           { title: 'Accounts',                 chord: null,           sink: 'menu', menu: 'view', scope: 'app' },
  'gateway.openClaudeUsage': { title: 'Open ClaudeUsage',         chord: null,           sink: 'renderer', menu: null, scope: 'app' },
  // C11 end
} as const satisfies Record<string, ActionSpec>;

export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as [ActionId, ...ActionId[]];

// `settings.keymap`: overrides only; null unbinds; absent means the default.
export type KeymapOverrides = Partial<Record<ActionId, string | null>>;

export function effectiveChord(id: ActionId, overrides: KeymapOverrides): string | null {
  const override = overrides[id];
  return override === undefined ? ACTIONS[id].chord : override;
}
