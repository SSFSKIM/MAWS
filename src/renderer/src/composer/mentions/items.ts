// The `@` menu's and the `/` palette's items (C7 execution document, "Mentions, palette and the "+" menu"; UX wave U4a,
// decision 17). The palette is the session's catalogue and the declared widget catalogue, each item of a kind: a
// panel MAWS draws (`widget`, whatever the engine calls the name), or the catalogue's built in (no `:`), skills (a name
// in `skills`), plugins (a name with `:`) and custom (the rest). The engine's flag is the only evidence of a kind, so
// its bundled skills, which it marks built in, read as built in. One dispatch rule for every item: a registered widget
// opens for its name; otherwise a catalogue command the engine can run headless is inserted as text; otherwise the item
// is unavailable, with its reason: an engine command the engine runs only in its terminal (`terminalOnly`: /doctor,
// /color, /focus, /reload-plugins in pass2/real-settings) reads Terminal only unless MAWS registers a widget for it
// (E11 §2.2: /reload-plugins), a declared widget no host registered reads Not available here (W2), and a name the
// session's port closes reads the port's reason. Never listed: a `__` name, an entry the engine marks "(removed)" that
// MAWS draws no panel for, and MAWS's window actions, which ⌘K lists.
// The `@` menu's non-file groups come from the catalogue too: agents insert an agent mention, skills their invocation.
import { fuzzyScore } from '@shared/composer/fuzzy';
import type { SessionCatalog } from '../../stores/catalog';
import { WIDGET_COMMANDS } from './widgets';

export type SlashOrigin = 'widget' | 'engine' | 'skills' | 'plugins' | 'custom';
// The order of the kinds in the list with nothing typed: MAWS's panels, then the catalogue's built in, skills, plugins, custom.
export const ORIGIN_ORDER: readonly SlashOrigin[] = ['widget', 'engine', 'skills', 'plugins', 'custom'];
export const UNAVAILABLE_HINT = 'Not available here';
export const TERMINAL_ONLY_HINT = 'Terminal only'; // W2

export type SlashAction = { kind: 'widget' } | { kind: 'text' } | { kind: 'unavailable'; hint: string };

export interface SlashItem {
  name: string;
  title: string; // what the row shows: `/name`
  description: string;
  argumentHint: string | null;
  origin: SlashOrigin;
  action: SlashAction;
}

function originOf(command: SessionCatalog['commands'][number], skills: ReadonlySet<string>): SlashOrigin {
  if (command.builtin && !command.name.includes(':')) return 'engine';
  if (skills.has(command.name)) return 'skills';
  if (command.name.includes(':')) return 'plugins';
  return 'custom';
}

// A declared panel's row, in the panel's own words whatever the catalogue says of the name.
const declaredItem = (w: (typeof WIDGET_COMMANDS)[number], action: SlashAction): SlashItem => ({ name: w.name, title: `/${w.name}`, description: w.description, argumentHint: 'argumentHint' in w ? w.argumentHint : null, origin: 'widget', action });

const hidden = (command: SessionCatalog['commands'][number]): boolean => command.name.startsWith('__') || command.description.startsWith('(removed)');

// UX wave U11a (§C, "Names"): the one name whose declared description wins over the engine's catalogue, so `/mcp` reads
// as the dialog it opens in a started chat too
const DECLARED_DESCRIPTION: ReadonlyMap<string, string> = new Map<string, string>(WIDGET_COMMANDS.filter((w) => w.name === 'mcp').map((w) => [w.name, w.description]));

// The palette's items in the order it reads with nothing typed (UX wave U4a, decision 17 h; the owner's answer to "/
// order"): first the panels this session has (`widgets`), in the order WIDGET_COMMANDS declares them, each once, whatever
// the catalogue calls the name; then the catalogue's other entries in its order, its built-in commands first, then
// skills, plugin commands and custom commands; then the declared names with no panel here. `refused` names a panel the
// session has but cannot act through from here, with the reason (`/fork` on another machine).
export function slashItems(catalog: SessionCatalog, widgets: ReadonlySet<string>, refused: Readonly<Record<string, string>> = {}): SlashItem[] {
  const skills = new Set(catalog.skills);
  const terminalOnly = new Set(catalog.terminalOnly);
  const listed = new Set(catalog.commands.map((c) => c.name));
  // P5 O9 M5: a command the session's port names as unavailable (lane A's bridge routes) is listed with its reason
  const closed = catalog.unavailable ?? {};
  const unavailable = (name: string, hint: string): SlashAction => ({ kind: 'unavailable', hint: closed[name] ?? hint });
  const panels = WIDGET_COMMANDS.filter((w) => widgets.has(w.name)).map((w) => declaredItem(w, refused[w.name] !== undefined ? { kind: 'unavailable', hint: refused[w.name] } : { kind: 'widget' }));
  const panelNames = new Set(panels.map((p) => p.name));
  const dispatch = (name: string): SlashAction => (widgets.has(name) ? { kind: 'widget' } : closed[name] === undefined && !terminalOnly.has(name) ? { kind: 'text' } : unavailable(name, TERMINAL_ONLY_HINT));
  const entries = catalog.commands
    .filter((c) => !panelNames.has(c.name) && !hidden(c))
    .map((c): SlashItem => ({ name: c.name, title: `/${c.name}`, description: DECLARED_DESCRIPTION.get(c.name) ?? c.description, argumentHint: c.argumentHint, origin: originOf(c, skills), action: dispatch(c.name) }));
  const byKind = ORIGIN_ORDER.flatMap((origin) => entries.filter((item) => item.origin === origin));
  const declared = WIDGET_COMMANDS.filter((w) => !widgets.has(w.name) && !listed.has(w.name)).map((w) => declaredItem(w, unavailable(w.name, UNAVAILABLE_HINT)));
  return [...panels, ...byKind, ...declared];
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
