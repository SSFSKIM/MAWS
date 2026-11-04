// The machine route in the session service (P5 O7 M9; docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9
// "The route" and "The relay check and the features"; Interfaces §U). A `machine` launch reaches whatever this machine's
// own settings, environment and login decide, so before one is made the service resolves the base URL it will reach
// (engine-host/models-cache.ts's `effectiveBaseUrl`, over the engine's environment and the launch's directory), and:
// - writes the legacy route from it (`gateway` at the relay, `direct` otherwise), which an older reader acts on;
// - sends `route: 'machine'` only to an engine host whose welcome lists `engine.route-machine`; to any other, a retained
//   older one included, it sends the legacy route alone where that reaches the same inference (the relay, or no base URL
//   at all) and otherwise refuses the start `route-unsupported`: it never silently changes inference;
// - checks the relay, advisorily, only when the resolved URL is the relay's (the sheet's "Start anyway" goes past it);
// - refuses a gateway model only where the launch would not reach ClaudeUsage.
// A resolution that fails or is uncertain shows nothing and defers to the engine, whose get_status stays authoritative.
import { legacyRouteOf, readRoute, type LegacyRoute, type Route } from '@shared/engine/route';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { RelayHealth } from '@shared/engine/relay-health';
import { ENGINE_ROUTE_MACHINE_CAPABILITY } from '@shared/host/socket-protocol';
import { isGatewayModel } from '@shared/sessions/models';
import { RELAY_URL } from '../../engine-host/launch';
import { effectiveBaseUrl, type BaseUrlResolution } from '../../engine-host/models-cache';
import type { CommandInput, CommandOutput } from '@shared/ipc/schema';
import type { SetupPhase } from '@shared/sessions/setup';
import { hostCall } from './context';
import { SetupFailure, type Setup } from './setup-steps';

export const ROUTE_UNSUPPORTED = "This machine's engine host predates the machine route; restart MAWS there, or choose gateway or direct for this session.";

export const machineRouteRefusal = (model: string) =>
  `${model} is a gateway model, and this machine's own settings do not reach ClaudeUsage · choose a Claude model, or start on the gateway`;

// The base URL a machine-route launch in `cwd` reaches, with `flagEnv` its `--settings` env.
export function machineBaseUrl(s: Pick<Setup, 'env' | 'systemRoot'>, cwd: string | null, flagEnv?: unknown): Promise<BaseUrlResolution> {
  return effectiveBaseUrl({ env: s.env as Record<string, string>, cwd, flagEnv, systemRoot: s.systemRoot }).catch((error: unknown): BaseUrlResolution => ({ kind: 'uncertain', why: error instanceof Error ? error.message : String(error) }));
}

// The legacy route of a machine-route launch: the resolved base URL's, else (uncertain) the one the carrier holds.
export function legacyOfResolution(resolution: BaseUrlResolution, held: LegacyRoute): LegacyRoute {
  return resolution.kind === 'resolved' ? legacyRouteOf(resolution.baseUrl, RELAY_URL) : held;
}

// Where an older engine host's legacy route reaches the same inference as the machine route.
const legacyEquivalent = (resolution: BaseUrlResolution): boolean => resolution.kind === 'resolved' && (resolution.baseUrl === null || resolution.baseUrl === RELAY_URL);

// What a guard answers of a machine-route start before anything is created: a refusal (`route-unsupported`, or a gateway
// model the launch would not reach ClaudeUsage with), the relay sheet, or nothing.
export type MachineGuard = { refused: { field: 'route' | 'model'; message: string } } | { relay: RelayHealth } | null;

export async function guardMachineRoute(s: Setup, args: { cwd: string | null; model: string | null; flagEnv?: unknown; startAnyway: boolean }): Promise<MachineGuard> {
  const resolution = await machineBaseUrl(s, args.cwd, args.flagEnv);
  if (!(await s.hostLists(ENGINE_ROUTE_MACHINE_CAPABILITY)) && !legacyEquivalent(resolution)) return { refused: { field: 'route', message: ROUTE_UNSUPPORTED } };
  const relay = resolution.kind === 'resolved' && resolution.baseUrl === RELAY_URL;
  if (args.model !== null && isGatewayModel(args.model) && resolution.kind === 'resolved' && !relay) return { refused: { field: 'model', message: machineRouteRefusal(args.model) } };
  if (!relay || args.startAnyway) return null;
  const health = await hostCall(s.dispatch, 'engine.relayHealth', { force: true });
  return health.ok ? null : { relay: health };
}

// The spec a launch sends this engine host: `route` only for the machine route on a host that lists it (the legacy field
// beside it the resolved base URL's), the legacy route alone otherwise; or the refusal of a machine-route launch an
// older host would serve on another inference.
export async function specForHost(s: Setup, spec: LaunchSpec): Promise<{ spec: LaunchSpec } | { refused: string }> {
  const { route: _route, ...legacy } = spec;
  void _route;
  const chosen: Route = readRoute(spec);
  if (chosen !== 'machine') return { spec: { ...legacy, gateway: chosen } };
  const resolution = await machineBaseUrl(s, spec.cwd, spec.extraSettings?.env);
  const gateway = legacyOfResolution(resolution, spec.gateway);
  if (await s.hostLists(ENGINE_ROUTE_MACHINE_CAPABILITY)) return { spec: { ...legacy, gateway, route: 'machine' } };
  return legacyEquivalent(resolution) ? { spec: { ...legacy, gateway } } : { refused: ROUTE_UNSUPPORTED };
}

// `session.launch` with the spec this engine host is sent (specForHost): a launch an older host would serve on another
// inference fails the setup with `route-unsupported`'s words, nothing launched (the guards refused it first, unless the
// host or the settings changed since).
export async function launchOnHost(s: Setup, phase: SetupPhase, input: CommandInput<'session.launch'>): Promise<CommandOutput<'session.launch'>> {
  const sent = await specForHost(s, input.spec);
  if ('refused' in sent) throw new SetupFailure(phase, sent.refused);
  return hostCall(s.dispatch, 'session.launch', { ...input, spec: sent.spec });
}
