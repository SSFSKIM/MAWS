// X2's registered names without their schemas: the preload's allowlist (charter §13 X2, "the preload bridges only
// registered names"). Zod-free, so the sandboxed preload bundles a name list rather than every schema; the renderer
// client and main validate against the registries in `./schema.ts`, which re-exports the channels and `NAMESPACES`
// from here. Each namespace's list lives in `./names/<namespace>.ts` beside its registry module, and `./schema.ts`
// pins at compile time that the bridged and main-only lists together name exactly the registries' keys.
import * as attention from './names/attention';
import * as engine from './names/engine';
import * as fs from './names/fs';
import * as git from './names/git';
import * as layout from './names/layout';
import * as pty from './names/pty';
import * as session from './names/session';
import * as settings from './names/settings';
// C8c start
import * as files from './names/files';
// C8c end
// E8 start
import * as plugins from './names/plugins';
import * as marketplaces from './names/marketplaces';
// E8 end
// E9 start
import * as voice from './names/voice';
// E9 end
// E1 start
import * as maws from './names/maws';
// E1 end
// E6 start
import * as scm from './names/scm';
// E6 end

export const NAMESPACES = [
  'session', 'engine', 'fs', 'git', 'pty', 'layout', 'attention', 'settings',
  // C8c start
  'files',
  // C8c end
  'plugins', 'marketplaces', // E8
  // E9 start
  'voice',
  // E9 end
  // E1 start
  'maws',
  // E1 end
  // E6 start
  'scm',
  // E6 end
] as const;
export type Namespace = (typeof NAMESPACES)[number];

// One entry per namespace; `satisfies` refuses a missing namespace or a name outside its own.
export const NAMES = {
  session, engine, fs, git, pty, layout, attention, settings,
  files, // C8c
  plugins, marketplaces, // E8
  voice, // E9
  maws, // E1
  scm, // E6
} as const satisfies { [N in Namespace]: { commands: readonly `${N}.${string}`[]; events: readonly `${N}.${string}`[] } };

type Names = typeof NAMES;
export type BridgedCommandName = { [N in Namespace]: Names[N]['commands'][number] }[Namespace];
export type MainOnlyCommandName = (typeof engine.mainOnlyCommands)[number];
export const MAIN_ONLY_COMMANDS: readonly MainOnlyCommandName[] = engine.mainOnlyCommands;
export type BridgedEventName = { [N in Namespace]: Names[N]['events'][number] }[Namespace];

// Pure, so a bundle that takes only `NAMESPACES` or a channel (the renderer and main, through `./schema.ts`) drops
// the lists; the renderer's and main's bundles are byte-identical to before the split.
const namesOf = (kind: 'commands' | 'events'): ReadonlySet<string> => new Set(NAMESPACES.flatMap((ns) => NAMES[ns][kind]));
const commandNames = /* @__PURE__ */ namesOf('commands');
const eventNames = /* @__PURE__ */ namesOf('events');

// A set, so a prototype key such as `constructor` or `toString` is not a registered name.
export const isBridgedCommandName = (name: unknown): name is BridgedCommandName =>
  typeof name === 'string' && commandNames.has(name);
export const isBridgedEventName = (name: unknown): name is BridgedEventName =>
  typeof name === 'string' && eventNames.has(name);

export const commandChannel = (name: BridgedCommandName | MainOnlyCommandName) => `maws:cmd:${name}`;
export const eventChannel = (name: BridgedEventName) => `maws:evt:${name}`;
