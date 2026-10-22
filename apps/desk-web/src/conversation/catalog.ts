// Consume the bridge's advertised forms, never a web copy of its route table. Native desk controls win where built.
import type { Catalog, Route } from 'desk-hub/protocol';
export type SlashOrigin = 'engine' | 'skills' | 'plugins' | 'custom' | 'widget';
export const ORIGIN_ORDER: readonly SlashOrigin[] = ['engine', 'skills', 'plugins', 'custom', 'widget'];
export const ORIGIN_LABEL: Record<SlashOrigin, string> = { engine: 'Engine', skills: 'Skills', plugins: 'Plugins', custom: 'Custom', widget: 'Desk' };
export type SlashItem = { name: string; title: string; description: string; argumentHint: string | null; origin: SlashOrigin; note?: string; action: { kind: 'text' | 'widget' } | { kind: 'unavailable'; hint: string } };
export type CommandAction = { kind: 'command'; route: Route } | { kind: 'widget'; name: 'model' | 'compact' } | { kind: 'unavailable'; reason: string };
const PANEL = "opens a panel in the terminal; it would hold the session's queue";
const words = (text: string, machine: string) => text.replaceAll('<machine>', machine);
export function formRoute(entry: Catalog['commands'][number], args: string): Route | null {
  const trimmed = args.trim();
  let route = trimmed ? (entry.withArgs ?? entry.route) : entry.route;
  const forms = route.forms;
  if (forms) {
    if ((forms.args === 'required' && !trimmed) || (forms.args === 'none' && trimmed)) return null;
    if (forms.pattern && trimmed) {
      try {
        if (!new RegExp(`^(?:${forms.pattern})$`).test(trimmed)) {
          if (!route.otherwise) return null;
          route = route.otherwise;
        }
      } catch { return null; }
    }
  }
  return route;
}
function action(route: Route, machine: string): CommandAction {
  if (!route.enabled) return { kind: 'unavailable', reason: words(route.reason ?? 'not measured on this engine', machine) };
  if (route.class === 'routed' && (route.to === 'model' || route.to === 'compact')) return { kind: 'widget', name: route.to };
  if (route.class === 'run' || route.class === 'run-prompt') return { kind: 'command', route: { ...route, ...(route.outlives && { outlives: words(route.outlives, machine) }) } };
  return { kind: 'unavailable', reason: words(route.reason ?? (route.class === 'panel' ? PANEL : route.class === 'follow' ? 'changes the session id; following comes with M4' : route.class === 'routed' ? `use ${route.to ?? 'the dedicated control'} instead; comes with a later milestone` : route.class === 'local' ? 'not available in this desk yet' : 'run it from the terminal'), machine) };
}
export function commandRoute(catalog: Catalog | null, name: string, args: string, machine: string): CommandAction {
  // These are the desk's existing controls, including when there is no remote catalog.
  if (name === 'model' || name === 'effort') return args.trim()
    ? { kind: 'unavailable', reason: catalog?.commands.find((c) => c.name === name)?.route.reason ?? `use Model instead: /${name} saves a default for new sessions` }
    : { kind: 'widget', name: 'model' };
  if (name === 'compact') return args.trim()
    ? { kind: 'unavailable', reason: 'use Compact instead; compact instructions come with M2' }
    : { kind: 'widget', name: 'compact' };
  if (!catalog) return { kind: 'unavailable', reason: 'the command catalog has not arrived yet' };
  const entry = catalog.commands.find((c) => c.name === name);
  if (!entry) return { kind: 'unavailable', reason: 'not a command this session knows' };
  const route = formRoute(entry, args);
  if (!route) return { kind: 'unavailable', reason: words((args.trim() ? entry.withArgs ?? entry.route : entry.route).forms?.hint ?? 'this form needs different arguments', machine) };
  return action(route, machine);
}
function originOf(entry: Catalog['commands'][number], skills: ReadonlySet<string> | null): SlashOrigin {
  if (skills !== null) {
    // MAWS composer/mentions/items.ts: built-ins, skill membership, namespace, then custom.
    if (entry.source === 'builtin' && !entry.name.includes(':')) return 'engine';
    if (skills.has(entry.name)) return 'skills';
    return entry.name.includes(':') ? 'plugins' : 'custom';
  }
  // A 1.8.0 bridge (or its cache) has no membership field: keep its existing grouping.
  return entry.source === 'builtin' ? 'engine' : entry.source === 'skill' || entry.source === 'skills' ? 'skills' : entry.plugin || entry.name.includes(':') || entry.source === 'mcp' ? 'plugins' : 'custom';
}
export function slashItems(catalog: Catalog | null, machine: string, unavailable: string | null): SlashItem[] {
  const skills = catalog?.skills === undefined ? null : new Set(catalog.skills);
  const items = (catalog?.commands ?? []).map((entry): SlashItem => {
    // Offer the usable argument form, not a bare panel (mcp, goal, rename).
    const route = entry.withArgs && ['run', 'run-prompt'].includes(entry.withArgs.class) ? entry.withArgs : entry.route;
    let pick = action(route, machine);
    if (entry.name === 'model' || entry.name === 'effort') pick = { kind: 'widget', name: 'model' };
    if (entry.name === 'compact') pick = { kind: 'widget', name: 'compact' };
    if (pick.kind === 'command' && unavailable) pick = { kind: 'unavailable', reason: unavailable };
    const origin = originOf(entry, skills);
    return { name: entry.name, title: `/${entry.name}`, description: entry.description, origin,
      argumentHint: route.forms?.hint ?? (route.forms?.args === 'required' ? '<arguments>' : null),
      note: route.outlives ? words(route.outlives, machine) : undefined,
      action: pick.kind === 'unavailable' ? { kind: 'unavailable', hint: pick.reason } : { kind: pick.kind === 'command' ? 'text' : 'widget' } };
  });
  for (const name of ['model', 'compact']) if (!items.some((i) => i.name === name)) items.push({ name, title: `/${name}`, description: name === 'model' ? 'Model and effort for this session' : 'Compact this session', argumentHint: null, origin: 'widget', action: { kind: 'widget' } });
  return items;
}
