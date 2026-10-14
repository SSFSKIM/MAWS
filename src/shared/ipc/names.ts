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
// E3 start
import * as side from './names/side';
// E3 end
// E2 start
// E2 end
// E10 start
import * as host from './names/host';
// E10 end
// E4a start
import * as browser from './names/browser';
// E4a end
// P2-C start (2026-10-09)
import * as mods from './names/mods';
import * as ownerChannel from './names/owner-channel'; // P2-C M4 (2026-10-09)
// P2-C end
// P3-A start (M4)
import * as artifacts from './names/artifacts';
import * as spaces from './names/spaces';
// P3-A end
// P3-L start (M1)
import * as library from './names/library';
// P3-L end

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
  // E3 start
  'side',
  // E3 end
  // E10 start
  'host',
  // E10 end
  // E4a start
  'browser',
  // E4a end
  // P2-C start (2026-10-09)
  'mods',
  'ownerChannel', // M4
  // P2-C end
  'artifacts', 'spaces', // P3-A M4
  'library', // P3-L M1
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
  side, // E3
  host, // E10
  browser, // E4a
  mods, // P2-C (2026-10-09)
  ownerChannel, // P2-C M4 (2026-10-09)
  artifacts, spaces, // P3-A M4
  library, // P3-L M1
} as const satisfies { [N in Namespace]: { commands: readonly `${N}.${string}`[]; events: readonly `${N}.${string}`[] } };

type Names = typeof NAMES;
export type BridgedCommandName = { [N in Namespace]: Names[N]['commands'][number] }[Namespace];
export type MainOnlyCommandName = (typeof engine.mainOnlyCommands)[number] | (typeof host.mainOnlyCommands)[number] /* E10: host's */ | (typeof artifacts.mainOnlyCommands)[number] /* P3-A M4 */ | (typeof library.mainOnlyCommands)[number]; // P3-L M1
export const MAIN_ONLY_COMMANDS: readonly MainOnlyCommandName[] = [...engine.mainOnlyCommands, ...host.mainOnlyCommands, ...artifacts.mainOnlyCommands /* P3-A M4 */, ...library.mainOnlyCommands /* P3-L M1 */];
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
