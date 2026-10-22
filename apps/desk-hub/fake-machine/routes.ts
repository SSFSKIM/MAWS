// The bridge's route table as the fake machine applies it (the desk control surface spec, 2026-10-22, §2 and
// Interfaces, "The route table"): the 2.1.307 table vendored beside the DX4 vectors (`dx4/routes-2.1.307.json`, which
// doperpowers owns and its bridge loads), and the check a `command` op makes before anything runs — the route a
// (name, args) takes, or the refusal and its reason. The web never decides a class; this is the machine's word, as the
// bridge's `routeOf` is.
import { fileURLToPath } from 'node:url';
import type { Catalog, Route } from '../src/protocol/session';
// Imported, not read from beside the module: the fake machine's command runs bundled from a temporary directory.
import vendored from './dx4/routes-2.1.307.json' with { type: 'json' };

export type RouteEntry = { name: string; bare: Route; withArgs?: Route };
export type RouteTable = { catalog?: Catalog; engine: string; entries: RouteEntry[]; pluginExceptions: Array<RouteEntry & { plugin: string }> };

/** Where the vendored 2.1.307 table lives (dx4/README.md says where it comes from, and its hash). */
export const ROUTES_2_1_307 = fileURLToPath(new URL('./dx4/routes-2.1.307.json', import.meta.url));

/** The vendored 2.1.307 table, its plugin exceptions defaulted. */
export function loadRoutes(): RouteTable {
  const table = vendored as unknown as Partial<RouteTable> & Pick<RouteTable, 'engine' | 'entries'>;
  return { catalog: table.catalog, engine: table.engine, entries: table.entries, pluginExceptions: table.pluginExceptions ?? [] };
}

/** A `$.command.list()` entry, as far as routing reads it. */
export type Listed = { name: string; source: string; plugin?: string };

/** The bridge's refusal codes for a `command` (DX5's `command` op), `stopped` and `turn-unknown` the engine's. */
export type CommandRefusalCode = 'unknown-builtin' | 'panel' | 'routed' | 'follow' | 'drop' | 'local' | 'bad-args' | 'disabled' | 'self' | 'stopped' | 'turn-unknown';

export type RouteCheck = { ok: true; route: Route } | { ok: false; code: CommandRefusalCode; reason: string };

/**
 * What the fake's sessions list: every built-in the table names, every plugin exception under its bare name and its
 * plugin (the engine lists cc-plugin-diff's `/diff` so), and a `<plugin>:<command>` as a plugin's (a skill, a plugin
 * command); anything else is no command the session knows.
 */
export function listedOf(table: RouteTable, name: string): Listed | null {
  if (table.entries.some((e) => e.name === name)) return { name, source: 'builtin' };
  const exception = table.pluginExceptions.find((e) => e.name === name);
  if (exception) return { name, source: 'plugin', plugin: exception.plugin };
  const colon = name.indexOf(':');
  if (colon > 0) return { name, source: 'plugin', plugin: name.slice(0, colon) };
  return null;
}

const PANEL = "opens a panel in the terminal; it would hold the session's queue";

/**
 * The route `name` with `args` takes, or why it is refused: the bare route when the trimmed args are empty, else the
 * with-args one (the bare one when there is none); args its `forms` forbid or require, or that miss its pattern, are
 * `bad-args` unless it has an `otherwise`. A non-built-in is `run-prompt` unless it is a plugin exception or the
 * bridge's own plugin's. `machine` fills a reason's `<machine>`.
 */
export function routeOf(table: RouteTable, listed: Listed | null, name: string, args: string, machine: string): RouteCheck {
  if (listed === null) return { ok: false, code: 'unknown-builtin', reason: 'not a command this session knows' };
  let entry: RouteEntry | undefined;
  if (listed.source === 'builtin') {
    entry = table.entries.find((e) => e.name === name);
    if (!entry) return { ok: false, code: 'unknown-builtin', reason: `not measured on ${table.engine}` };
  } else {
    if (listed.plugin === 'sminos') return { ok: false, code: 'self', reason: 'run it from the terminal' };
    entry = table.pluginExceptions.find((e) => e.name === name && e.plugin === listed.plugin) ?? { name, bare: { class: 'run-prompt', enabled: true, measured: 'M' } };
  }
  const trimmed = args.trim();
  let route = trimmed === '' ? entry.bare : (entry.withArgs ?? entry.bare);
  const forms = route.forms;
  const fits = !forms || ((forms.args !== 'required' || trimmed !== '') && (forms.args !== 'none' || trimmed === '') && (!forms.pattern || trimmed === '' || new RegExp(`^(?:${forms.pattern})$`).test(trimmed)));
  if (!fits) {
    if (route.otherwise) route = route.otherwise;
    else return { ok: false, code: 'bad-args', reason: forms?.hint ?? badArgs(forms!) };
  }
  const said = (reason: string) => reason.replaceAll('<machine>', machine);
  switch (route.class) {
    case 'panel':
      return { ok: false, code: 'panel', reason: PANEL };
    case 'routed':
      return { ok: false, code: 'routed', reason: said(route.reason ?? `the desk's ${route.to ?? 'own control'} does this`) };
    case 'follow':
      return { ok: false, code: 'follow', reason: 'changes the session id; following comes with M4' };
    case 'drop':
      return { ok: false, code: 'drop', reason: said(route.reason ?? 'not available from the desk') };
    case 'local':
      return { ok: false, code: 'local', reason: "the desk's own: nothing is sent to the session" };
    default:
      if (!route.enabled) return { ok: false, code: 'disabled', reason: said(route.reason ?? `not measured on ${table.engine}`) };
      return { ok: true, route };
  }
}

function badArgs(forms: NonNullable<Route['forms']>): string {
  if (forms.args === 'none') return 'it takes no arguments';
  if (forms.args === 'required' && !forms.pattern) return 'it needs arguments';
  return `its arguments are ${forms.pattern}`;
}
