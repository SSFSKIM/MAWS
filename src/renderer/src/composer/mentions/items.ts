// The `@` menu's and the `/` palette's items (C7 execution document, "Mentions, palette and the "+" menu"). The palette
// is the union of three sources, each item badged by origin: the engine's catalogue (Engine: built in with no `:`;
// Skills: a name in `skills`; Plugins: a name with `:`; Custom: the rest), the declared widget catalogue for every
// name the engine does not list (Widget), and MAWS's own actions (C5's action table: the menu actions and the app-scoped
// ones, run through `runAction`). One dispatch rule for every item: a registered widget opens for its name; otherwise a
// catalogue command the engine can run headless is inserted as text; otherwise the item is listed and unavailable: an
// engine command the engine runs only in its terminal (`terminalOnly`: /doctor, /color, /focus, /reload-plugins in
// pass2/real-settings) reads Terminal only, and a declared widget no host registered reads Not available here (W2).
// The `@` menu's non-file groups come from the catalogue too: agents insert an agent mention, skills their invocation.
import { fuzzyScore } from '@shared/composer/fuzzy';
import { ACTIONS, type ActionId } from '@shared/keymap/actions';
import type { SessionCatalog } from '../../stores/catalog';
import { WIDGET_COMMANDS } from './widgets';

export type SlashOrigin = 'engine' | 'skills' | 'plugins' | 'custom' | 'widget' | 'maws';
export const ORIGIN_ORDER: readonly SlashOrigin[] = ['engine', 'skills', 'plugins', 'custom', 'widget', 'maws'];
export const ORIGIN_LABEL: Record<SlashOrigin, string> = { engine: 'Engine', skills: 'Skills', plugins: 'Plugins', custom: 'Custom', widget: 'Widget', maws: 'MAWS' };
export const UNAVAILABLE_HINT = 'Not available here';
export const TERMINAL_ONLY_HINT = 'Terminal only'; // W2

export type SlashAction = { kind: 'widget' } | { kind: 'text' } | { kind: 'maws'; id: ActionId } | { kind: 'unavailable'; hint: string };

export interface SlashItem {
  name: string;
  title: string; // what the row shows: `/name` for commands, the action's title for MAWS items
  description: string;
  argumentHint: string | null;
  origin: SlashOrigin;
  action: SlashAction;
}

// MAWS's palette entries: the name typed after `/` and the words the row shows. Only actions the table lists as menu
// actions or app-scoped appear (the composer's own keys excluded); `tab.select` needs an argument and is left out.
const MAWS_PALETTE: Partial<Record<ActionId, { name: string; title: string; description: string }>> = {
  'session.new': { name: 'new-chat', title: 'New chat', description: 'Start a new chat in this project' }, // New chat (2026-10-01)
  'tab.close': { name: 'close-tab', title: 'Close tab', description: 'Close the current tab' },
  'tab.reopen': { name: 'reopen-tab', title: 'Reopen closed tab', description: 'Bring back the tab closed last' },
  'tab.overview': { name: 'overview', title: 'Open Overview', description: 'Move to the Overview of every session' },
  'pane.split': { name: 'split', title: 'Split / send to other pane', description: 'Split the view, or send this tab to the other pane' },
  'pane.focusOther': { name: 'focus-other-pane', title: 'Focus other pane', description: 'Put the keyboard in the other pane' },
  'sidebar.toggle': { name: 'sidebar', title: 'Toggle sidebar', description: 'Show or hide the sidebar' },
  'panel.toggle': { name: 'panel', title: 'Toggle right panel', description: 'Show or hide the right panel' },
  'panel.maximize': { name: 'maximize-panel', title: 'Maximize right panel', description: 'Give the right panel the whole window' },
  'theme.light': { name: 'light', title: 'Appearance: Light', description: 'Use the light theme' },
  'theme.dark': { name: 'dark', title: 'Appearance: Dark', description: 'Use the dark theme' },
  'theme.system': { name: 'system-theme', title: 'Appearance: System', description: "Follow the system's appearance" },
  'palette.open': { name: 'palette', title: 'Command palette', description: 'Open the command palette' },
  'attention.next': { name: 'next-needs-you', title: 'Next Needs-you', description: 'Go to the next session waiting for you' },
  'diagnostics.open': { name: 'diagnostics', title: 'Diagnostics', description: 'Open the Diagnostics tab' },
};

export function mawsItems(enabled: (id: ActionId) => boolean): SlashItem[] {
  return (Object.keys(MAWS_PALETTE) as ActionId[]).flatMap((id) => {
    const spec = ACTIONS[id];
    const entry = MAWS_PALETTE[id];
    if (!entry || (spec.sink !== 'menu' && spec.scope !== 'app')) return [];
    return [{ ...entry, argumentHint: null, origin: 'maws' as const, action: enabled(id) ? { kind: 'maws' as const, id } : { kind: 'unavailable' as const, hint: UNAVAILABLE_HINT } }];
  });
}

function originOf(command: SessionCatalog['commands'][number], skills: ReadonlySet<string>): SlashOrigin {
  if (command.builtin && !command.name.includes(':')) return 'engine';
  if (skills.has(command.name)) return 'skills';
  if (command.name.includes(':')) return 'plugins';
  return 'custom';
}

export function slashItems(catalog: SessionCatalog, widgets: ReadonlySet<string>, maws: SlashItem[]): SlashItem[] {
  const skills = new Set(catalog.skills);
  const terminalOnly = new Set(catalog.terminalOnly);
  const listed = new Set(catalog.commands.map((c) => c.name));
  const dispatch = (name: string, headless: boolean, hint: string): SlashAction => (widgets.has(name) ? { kind: 'widget' } : headless ? { kind: 'text' } : { kind: 'unavailable', hint });
  const engine = catalog.commands.map(
    (c): SlashItem => ({ name: c.name, title: `/${c.name}`, description: c.description, argumentHint: c.argumentHint, origin: originOf(c, skills), action: dispatch(c.name, !terminalOnly.has(c.name), TERMINAL_ONLY_HINT) }),
  );
  const declared = WIDGET_COMMANDS.filter((w) => !listed.has(w.name)).map(
    (w): SlashItem => ({ name: w.name, title: `/${w.name}`, description: w.description, argumentHint: null, origin: 'widget', action: dispatch(w.name, false, UNAVAILABLE_HINT) }),
  );
  return [...engine, ...declared, ...maws];
}

export type AtItem =
  | { group: 'files'; name: string; path: string; directory: boolean }
  | { group: 'agents'; name: string; description: string }
  | { group: 'skills'; name: string; description: string };

// The catalogue's agents and skills matching `query` (a subsequence of the name), best first; files come from main.
export function atItems(catalog: SessionCatalog, query: string): AtItem[] {
  const ranked = <T extends { name: string }>(items: T[]) =>
    items
      .map((item) => ({ item, score: fuzzyScore(query, item.name) }))
      .filter((s): s is { item: T; score: number } => s.score !== null)
      .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length || (a.item.name < b.item.name ? -1 : 1))
      .map((s) => s.item);
  const skillDescription = new Map(catalog.commands.map((c) => [c.name, c.description]));
  return [
    ...ranked(catalog.agents).map((a): AtItem => ({ group: 'agents', name: a.name, description: a.description })),
    ...ranked(catalog.skills.map((name) => ({ name }))).map((s): AtItem => ({ group: 'skills', name: s.name, description: skillDescription.get(s.name) ?? '' })),
  ];
}
