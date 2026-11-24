// The machine route in the session service (P5 O7 M9; docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9
// "The route" and "The relay check and the features"; Interfaces §U). A `machine` launch reaches whatever this machine's
// own settings, environment and login decide, so before one is made the service resolves the base URL it will reach
// (engine-host/models-cache.ts's `effectiveBaseUrl`, over the engine's environment and the launch's directory), and:
// - writes the legacy route from it (`gateway` at the relay, `direct` otherwise), which an older reader acts on;
// - sends `route: 'machine'` only to an engine host whose welcome lists `engine.route-machine`; to any other, a retained
//   older one included, it sends the legacy route alone where that reaches the same inference (the relay; or none of
//   the gateway keys, which the legacy direct route deletes, set at all) and otherwise refuses the start
//   `route-unsupported`: it never silently changes inference;
// - checks the relay, advisorily, only when the resolved URL is the relay's (the sheet's "Start anyway" goes past it;
//   an older host, which checks the relay on the legacy gateway route it is sent, cannot be started past it, and a dead
//   relay there is refused outright);
// - refuses a gateway model only where the launch would not reach ClaudeUsage;
// - records the chosen route on the session's record at the launch, whatever the host carries on the wire.
// A resolution that fails or is uncertain shows nothing and defers to the engine, whose get_status stays authoritative;
// to an older host it is never taken for an equivalent one. A new worktree is resolved before it exists by the project
// settings its branch tracks (`newWorktreeSettings`).
// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, D8): beside the route, a spec that carries a set
// of MAWS's tools goes only to a host that lists `engine.mawsTools`; one replaced since by an older host is refused.
import { legacyRouteOf, readRoute, type LegacyRoute, type Route } from '@shared/engine/route';
import type { Location } from '@shared/sessions/intent';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { RelayHealth } from '@shared/engine/relay-health';
import { ENGINE_MAWS_TOOLS_CAPABILITY, ENGINE_ROUTE_MACHINE_CAPABILITY } from '@shared/host/socket-protocol';
import { isGatewayModel } from '@shared/sessions/models';
import { RELAY_URL } from '../../engine-host/launch';
import { effectiveBaseUrl, type BaseUrlResolution } from '../../engine-host/models-cache';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { SetupPhase } from '@shared/sessions/setup';
import { hostCall } from './context';
import { newWorktreeTarget } from './intent-rules';
import { SetupFailure, type Setup } from './setup-steps';
import { MAWS_TOOLS_UNSUPPORTED } from './served-set'; // board ticket 421

export const ROUTE_UNSUPPORTED = "This machine's engine host predates the machine route; restart MAWS there, or choose gateway or direct for this session.";

export const ROUTE_RELAY_UNSUPPORTED =
  "ClaudeUsage's relay isn't answering, and this machine's engine host predates the machine route, so it can't start past the relay check; wait for the relay, restart MAWS there, or choose direct for this session.";

export const machineRouteRefusal = (model: string) =>
  `${model} is a gateway model, and this machine's own settings do not reach ClaudeUsage · choose a Claude model, or start on the gateway`;

// Where a launch's settings are read: its directory, and in place of that directory's project settings the text a
// checkout not yet made will have (newWorktreeSettings); or why that cannot be told.
export type SettingsSite = { cwd: string | null; project?: { settings: string | null; local: string | null } } | { uncertain: string };

// The base URL a machine-route launch at `site` reaches, with `flagEnv` its `--settings` env.
export async function machineBaseUrl(s: Pick<Setup, 'env' | 'systemRoot'>, site: SettingsSite, flagEnv?: unknown): Promise<BaseUrlResolution> {
  if ('uncertain' in site) return { kind: 'uncertain', why: site.uncertain };
  return effectiveBaseUrl({ env: s.env as Record<string, string>, cwd: site.cwd, project: site.project, flagEnv, systemRoot: s.systemRoot }).catch((error: unknown): BaseUrlResolution => ({ kind: 'uncertain', why: messageOf(error) }));
}

// A new worktree's settings before `git worktree add` makes it: the main checkout's directory with, in place of its
// own, the `.claude/settings.json` and `.claude/settings.local.json` the branch tracks, read at the ref the worktree
// will check out (a new branch's base, an existing branch's head) through the read-only git runner; the worktree's local
// file sits beneath the store it reads at the main checkout (models-cache.ts `project`). What a checkout hook or a
// filter would change is not foreseen; the launch's own resolution, in the made worktree, still decides what the host
// is sent. A checkout an earlier attempt made and kept is not projected: the guard resolves it where it stands.
export async function newWorktreeSettings(s: Pick<Setup, 'git' | 'worktrees'>, location: Extract<Location, { kind: 'newWorktree' }>): Promise<SettingsSite> {
  const SETTINGS = '.claude/settings.json';
  const LOCAL = '.claude/settings.local.json';
  try {
    const { root } = await newWorktreeTarget(s, location);
    const rev = location.branch.kind === 'new' ? `${location.branch.base}^{commit}` : `refs/heads/${location.branch.name}`;
    const tracked = new Set((await s.git(root, ['ls-tree', '--name-only', rev, '--', SETTINGS, LOCAL])).split('\n'));
    const text = (file: string) => (tracked.has(file) ? s.git(root, ['show', `${rev}:${file}`]) : null);
    const [settings, local] = await Promise.all([text(SETTINGS), text(LOCAL)]);
    return { cwd: root, project: { settings, local } };
  } catch (error) {
    return { uncertain: `the branch's project settings: ${messageOf(error)}` };
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The legacy route of a machine-route launch: the resolved base URL's, else (uncertain) the one the carrier holds.
export function legacyOfResolution(resolution: BaseUrlResolution, held: LegacyRoute): LegacyRoute {
  return resolution.kind === 'resolved' ? legacyRouteOf(resolution.baseUrl, RELAY_URL) : held;
}

// Where an older engine host's legacy route reaches the same inference as the machine route: the relay, which the
// legacy gateway route names; or none of the keys the legacy direct route deletes (a token or the tool-search switch
// without a base URL included). An uncertain resolution is neither.
const legacyEquivalent = (resolution: BaseUrlResolution): boolean => resolution.kind === 'resolved' && (resolution.baseUrl === RELAY_URL || resolution.gatewayKeys.length === 0);

// What a guard answers of a machine-route start before anything is created: a refusal (`route-unsupported`, or a gateway
// model the launch would not reach ClaudeUsage with), the relay sheet, or nothing.
export type MachineGuard = { refused: { field: 'route' | 'model'; message: string } } | { relay: RelayHealth } | null;

// Ticket 851 (D8): `relay: 'cached'`, the prestart's read of the relay's last health (it never forces a probe).
export async function guardMachineRoute(s: Setup, args: { site: SettingsSite; model: string | null; flagEnv?: unknown; startAnyway: boolean; relay?: 'probe' | 'cached' }): Promise<MachineGuard> {
  const resolution = await machineBaseUrl(s, args.site, args.flagEnv);
  const lists = await s.hostLists(ENGINE_ROUTE_MACHINE_CAPABILITY);
  if (!lists && !legacyEquivalent(resolution)) return { refused: { field: 'route', message: ROUTE_UNSUPPORTED } };
  const relay = resolution.kind === 'resolved' && resolution.baseUrl === RELAY_URL;
  if (args.model !== null && isGatewayModel(args.model) && resolution.kind === 'resolved' && !relay) return { refused: { field: 'model', message: machineRouteRefusal(args.model) } };
  if (!relay || (args.startAnyway && lists)) return null;
  const health = await hostCall(s.dispatch, 'engine.relayHealth', { force: args.relay !== 'cached' });
  if (health.ok) return null;
  // an older host refuses the legacy gateway launch at a dead relay, so no sheet offers to start past it
  return lists ? { relay: health } : { refused: { field: 'route', message: ROUTE_RELAY_UNSUPPORTED } };
}

// The spec a launch sends this engine host: `route` only for the machine route on a host that lists it (the legacy field
// beside it the resolved base URL's), the legacy route alone otherwise; or the refusal of a machine-route launch an
// older host would serve on another inference.
// Board ticket 421 (D8): a spec carries a set of MAWS's tools only when the attempt's one answer (served-set.ts) found a
// host that lists `engine.mawsTools`, so nothing is taken off here; a host replaced by an older one since is refused, as
// that answer would have refused it, rather than serving the session another list.
// Ticket 851 (docs/doperpowers/plans/2026-11-24-prestart-engine.md, D5): and beside that spec the prestart key, from the
// same resolution of the base URL: what decides the launch beyond that spec, the machine route's resolved
// base URL with the gateway keys it found (two base URLs that the legacy field maps alike are told apart here). The key is
// null where no prestart may be adopted: a machine route whose resolution is uncertain, or a host that cannot serve the
// machine route (the spec it is sent then says less than the launch it makes).
export async function hostLaunchOf(s: Setup, spec: LaunchSpec): Promise<{ spec: LaunchSpec; key: string | null } | { refused: string }> {
  if (spec.mawsTools !== undefined && !(await s.hostLists(ENGINE_MAWS_TOOLS_CAPABILITY))) return { refused: MAWS_TOOLS_UNSUPPORTED };
  const { route: _route, ...legacy } = spec;
  void _route;
  const chosen: Route = readRoute(spec);
  if (chosen !== 'machine') return { spec: { ...legacy, gateway: chosen }, key: prestartKey({ route: chosen }) };
  const resolution = await machineBaseUrl(s, { cwd: spec.cwd }, spec.extraSettings?.env);
  const gateway = legacyOfResolution(resolution, spec.gateway);
  if (await s.hostLists(ENGINE_ROUTE_MACHINE_CAPABILITY)) {
    const key = resolution.kind === 'resolved' ? prestartKey({ route: 'machine', baseUrl: resolution.baseUrl, gatewayKeys: [...resolution.gatewayKeys].sort() }) : null;
    return { spec: { ...legacy, gateway, route: 'machine' }, key };
  }
  return legacyEquivalent(resolution) ? { spec: { ...legacy, gateway }, key: null } : { refused: ROUTE_UNSUPPORTED };
}

const PRESTART_KEY_MAX = 4096; // session.prestart's bound on the key
const prestartKey = (facts: object): string | null => {
  const key = JSON.stringify({ v: 1, ...facts });
  return key.length <= PRESTART_KEY_MAX ? key : null;
};

// `session.launch` with the spec this engine host is sent (hostLaunchOf): a launch an older host would serve on another
// inference fails the setup with `route-unsupported`'s words, nothing launched (the guards refused it first, unless the
// host or the settings changed since). A launch the host takes records the route chosen for it on the session's record
// (none for a bootstrap's id), which an older host's status, carrying no route, leaves standing.
// Ticket 851 (D4): `adopt`, an intent's launch after its prestart was asked: the key is sent beside the spec (computed
// as the prestart's was), and the host adopts the prestart when both match; no key, no adoption.
export async function launchOnHost(s: Setup, phase: SetupPhase, input: Omit<CommandInput<'session.launch'>, 'spec' | 'adopt'> & { spec: LaunchSpec }, adopt = false): Promise<CommandOutput<'session.launch'>> {
  const sent = await hostLaunchOf(s, input.spec);
  if ('refused' in sent) throw new SetupFailure(phase, sent.refused);
  const answer = await hostCall(s.dispatch, 'session.launch', { ...input, spec: sent.spec, ...(adopt && sent.key !== null && { adopt: { key: sent.key } }) });
  if (answer.status === 'launching') s.sessions.setRoute(input.spec.appSessionId, readRoute(input.spec));
  return answer;
}
