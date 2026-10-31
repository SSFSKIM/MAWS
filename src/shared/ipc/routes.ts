// The route classes (P5 O6 M2, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Route classes"; OX2): which
// machine a command goes to, computed once per name from the registry's input schemas and O1's grades.
//
// - `client`: graded with the routing class `client` (O1 M4): the local app answers it. The machine its addressed ids name
//   reaches main's handler as `ctx.target`, and the router refuses one for another machine before any handler runs.
// - `addressed`: every valid input carries at least one of the four machine-bound ids (an `AppSessionId`, `ProjectId`,
//   `PtyId` or `AttentionId`): the command goes to the machine those addresses name.
// - `path`: some valid input carries none of the four, and the input carries a machine path (a key in `PATH_KEYS`) or the
//   engine's `SessionId`: the command names its machine explicitly (required at the type level from M4).
// - `machine-wide`: everything else. These default to the local machine until the child that spans their surface.
//
// `PATH_COMMANDS` is the zod-free list of the `path` class, so the bridge's types can require a machine of exactly those
// names; `routes.test.ts` pins it, and every class's list, against what this module computes.
import type * as z from 'zod';
import { SessionIdSchema } from '../graph/ids';
import { addressedKindOf } from '../machine/address';
import { gradeOf } from './grades';
import { REGISTRY } from './registry';
import type { CommandName } from './schema';

export type RouteClass = 'client' | 'addressed' | 'path' | 'machine-wide';

// The survey's path keys (research/org/headless-cut-survey.md §4.3).
export const PATH_KEYS: ReadonlySet<string> = new Set([
  'path', 'paths', 'cwd', 'directory', 'directories', 'additionalDirectories', 'repoRoot', 'root', 'projectPath', 'linkedDir',
  'binaryPath', 'files', 'filename', 'location',
]);
// The engine's session id, by identity (`SessionIdSchema`) or, where a field holds it as a plain string, by name.
const ENGINE_SESSION_KEYS: ReadonlySet<string> = new Set(['sessionId', 'sessionIds', 'engineSessionId', 'engineSessionIds']);

// A literal tuple, so its element union is the subset (a `readonly CommandName[]` annotation would widen it to every name).
export const PATH_COMMANDS = [
  'session.projects.add', 'session.replay.start', 'session.trust.check', 'session.create', 'session.revealPath', 'session.projects.addFolder',
  'engine.models', 'engine.configure',
  'fs.sessionText', 'fs.scan', 'fs.bind', 'fs.holders', 'fs.readSpill',
  'git.status', 'git.branches', 'git.diff', 'git.log', 'git.watch', 'git.unwatch', 'git.lsFiles', 'git.worktree.list', 'git.worktree.status', 'git.worktree.branch', 'git.worktree.add', 'git.worktree.remove', 'git.worktree.deleteBranch',
  'settings.set', 'settings.usage', 'settings.reveal',
  'plugins.list', 'plugins.available', 'plugins.install', 'plugins.update', 'plugins.uninstall', 'plugins.enable', 'plugins.disable', 'plugins.manifest', 'plugins.marketplaceManifest',
  'marketplaces.list', 'marketplaces.add', 'marketplaces.update', 'marketplaces.remove',
  'artifacts.create', 'artifacts.testWrite', 'artifacts.content',
  'spaces.create', 'spaces.update',
  'connectors.add', 'connectors.remove', 'connectors.directResolve', 'connectors.directStart', 'connectors.directDiscover', 'connectors.directSend',
  'customization.inventory', 'customization.serverEndpoints',
  'catalog.home', 'catalog.query', 'catalog.item', 'catalog.postures', 'catalog.engine' /* P5 O4 M3: the machine's half */,
  'host.op', // P5 O10 M7: main-only (mawsd's ledger), never bridged; its `context.engineSessionId` makes it path
  'files.readResolved', // P5 O3-E: main-only (library.read's reach), never bridged; a bare path
  'machineSettings.set', // P5 O3-D: as settings.set, its engine patch's paths
] as const satisfies readonly CommandName[];
export type PathCommandName = (typeof PATH_COMMANDS)[number];

type Def = { type: string } & Record<string, unknown>;
const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;
const lazyInner = (schema: z.ZodType): z.ZodType => (schema as unknown as { _zod: { innerType: z.ZodType } })._zod.innerType;
// Wrappers that admit a value without what is inside (an absent key, a null, a default filled in) and those that do not.
const ADMITS_NONE = new Set(['optional', 'nullable', 'default', 'prefault', 'catch']);
const PASSES_THROUGH = new Set(['nonoptional', 'readonly']);

// Does every valid value carry one of the four kinds? A cycle is not assumed to carry one.
function alwaysAddressed(schema: z.ZodType, visiting: Set<z.ZodType> = new Set()): boolean {
  if (addressedKindOf(schema)) return true;
  if (visiting.has(schema)) return false;
  visiting.add(schema);
  try {
    const def = defOf(schema);
    if (PASSES_THROUGH.has(def.type)) return alwaysAddressed(def.innerType as z.ZodType, visiting);
    switch (def.type) {
      case 'object':
        return Object.values(def.shape as Record<string, z.ZodType>).some((prop) => alwaysAddressed(prop, visiting));
      case 'tuple':
        return (def.items as z.ZodType[]).some((item) => alwaysAddressed(item, visiting));
      case 'array':
        return minLength(def) > 0 && alwaysAddressed(def.element as z.ZodType, visiting);
      case 'union':
        return (def.options as z.ZodType[]).every((option) => alwaysAddressed(option, visiting));
      case 'pipe':
        return alwaysAddressed(def.in as z.ZodType, visiting);
      case 'lazy':
        return alwaysAddressed(lazyInner(schema), visiting);
      default:
        return false; // a record may be empty; ADMITS_NONE admits a value without its inner one
    }
  } finally {
    visiting.delete(schema);
  }
}

const minLength = (def: Def): number => {
  const checks = (def.checks ?? []) as { _zod: { def: { check: string; minimum?: number; length?: number } } }[];
  let min = 0;
  for (const check of checks) {
    const { check: kind, minimum, length } = check._zod.def;
    if (kind === 'min_length' && minimum !== undefined) min = Math.max(min, minimum);
    if (kind === 'length_equals' && length !== undefined) min = Math.max(min, length);
  }
  return min;
};

// Does the input carry a machine path (a property under one of PATH_KEYS) or the engine's SessionId anywhere?
function carriesMachinePath(schema: z.ZodType, visiting: Set<z.ZodType> = new Set()): boolean {
  if (schema === SessionIdSchema) return true;
  if (visiting.has(schema)) return false;
  visiting.add(schema);
  const def = defOf(schema);
  const children: z.ZodType[] = [];
  switch (def.type) {
    case 'object': {
      const shape = def.shape as Record<string, z.ZodType>;
      if (Object.keys(shape).some((key) => PATH_KEYS.has(key) || ENGINE_SESSION_KEYS.has(key))) return true;
      children.push(...Object.values(shape));
      if (def.catchall) children.push(def.catchall as z.ZodType);
      break;
    }
    case 'array':
      children.push(def.element as z.ZodType);
      break;
    case 'tuple':
      children.push(...(def.items as z.ZodType[]), ...(def.rest ? [def.rest as z.ZodType] : []));
      break;
    case 'record':
      children.push(def.keyType as z.ZodType, def.valueType as z.ZodType);
      break;
    case 'union':
      children.push(...(def.options as z.ZodType[]));
      break;
    case 'intersection':
      children.push(def.left as z.ZodType, def.right as z.ZodType);
      break;
    case 'pipe':
      children.push(def.in as z.ZodType);
      break;
    case 'lazy':
      children.push(lazyInner(schema));
      break;
    default:
      if (ADMITS_NONE.has(def.type) || PASSES_THROUGH.has(def.type)) children.push(def.innerType as z.ZodType);
  }
  return children.some((child) => carriesMachinePath(child, visiting));
}

// The class of one command over a registry's input schema and its grade.
export function classify(name: string, input: z.ZodType): RouteClass {
  if (gradeOf(name) === 'client') return 'client';
  if (alwaysAddressed(input)) return 'addressed';
  if (carriesMachinePath(input)) return 'path';
  return 'machine-wide';
}

const classes = new Map<string, RouteClass>();
export function routeOf(name: CommandName): RouteClass {
  let known = classes.get(name);
  if (known === undefined) {
    known = classify(name, REGISTRY.commands[name].input);
    classes.set(name, known);
  }
  return known;
}
