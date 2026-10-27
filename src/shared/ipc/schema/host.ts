// X2 `host.*` (P1 interface ledger §5; E10 execution document, Interfaces "X2 additions"): the supervisor. The engine
// host owns its own facts (`host.supervisorStatus`, command and event on every change) and the levers main pulls on it
// (`host.configure`, `host.stopAll`, `host.exitWhenIdle`; P5 O2 M2: `host.interest`), which only main may send: main's transport must know
// a stop it asked for from a crash. Main owns what the app shows (`host.status`, the last SupervisorStatus composed with
// main's own facts) and the two actions behind the Settings and Diagnostics rows and the banners (`host.restart`,
// `host.openLog`). The main-owned half never crosses the socket, so only the engine-host half is in the wire fingerprint.
import * as z from 'zod';
import { AppSessionIdSchema } from '../../graph/ids';
import { HostStateSchema, type CommandSpec } from './common';
import { DaemonStatusSchema } from './daemon'; // P5 O2 M7
import { MAX_IDLE_MINUTES } from './settings';

// The supervisor's idle time: settings' 1 to MAX_IDLE_MINUTES minutes, in ms, or null for never. Capped on the wire
// because past 2^31 - 1 ms Node clamps a timer to 1 ms, which would make both idle clocks fire at once and spin.
export const MAX_IDLE_EXIT_MS = MAX_IDLE_MINUTES * 60_000;
const IdleExitMsSchema = z.number().int().positive().max(MAX_IDLE_EXIT_MS).nullable();

export const SupervisorStatusSchema = z.strictObject({
  mode: z.enum(['detached', 'utility']),
  pid: z.number().int(),
  startedAt: z.string(),
  buildId: z.string(), // the first 16 hex of the SHA-1 of the engine-host entry file
  protocol: z.number().int(), // the socket layer's SOCKET_PROTOCOL
  wire: z.string(), // the wire fingerprint
  liveSessions: z.number().int(), // rows whose process has not exited
  rows: z.number().int(), // rows in the process table, exited ones included
  idleExitMs: IdleExitMsSchema, // null: never
  idleExitAt: z.string().nullable(), // when the idle clock fires, while it runs
  exitWhenIdle: z.boolean(),
  socketPath: z.string().nullable(), // null in utility mode
  logPath: z.string().nullable(), // null in utility mode
  orphansKilled: z.number().int(), // engines of a dead predecessor this supervisor stopped at its start
  // P5 O2 M2 (additive): the idle release's role and idle time (a laptop's the idle exit's, null for never; a server's
  // 24 hours); optional for an older supervisor
  release: z.strictObject({ role: z.enum(['laptop', 'server']), idleMs: z.number().int().positive().nullable() }).optional(),
});
export type SupervisorStatus = z.infer<typeof SupervisorStatusSchema>;

// E11 §2.7: main's own build as electron.vite.config.ts stamps it (the package version, the commit, the build time),
// shown in Diagnostics apart from the supervisor; not the engine-host bundle's `appBuildId`.
export const MainBuildSchema = z.strictObject({ version: z.string(), commit: z.string(), builtAt: z.string() });
export type MainBuild = z.infer<typeof MainBuildSchema>;

// P5 O2 M7 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M7 "Status"): `transport` is `daemon` when the engine host
// is reached through the machine daemon, whose own `daemon.status` is `daemon` (null in the embedded shape, and until
// the daemon first answers); `daemonUnavailable` says why a launch whose setting asks for the daemon runs embedded (no
// unit installed for an unpackaged run, a unit the system refuses), null otherwise. On the daemon shape `matches` compares
// the engine host's build with the one the daemon would start (`daemon.build.engineHostBuildId`).
export const HostStatusSchema = z.strictObject({
  transport: z.enum(['utility', 'detached', 'daemon']),
  state: HostStateSchema.shape.state,
  supervisor: SupervisorStatusSchema.nullable(), // null while none is connected
  appBuildId: z.string(),
  appWire: z.string(),
  mainBuild: MainBuildSchema, // E11 §2.7: which main is answering
  matches: z.enum(['same', 'build', 'wire', 'protocol']).nullable(), // null while no supervisor is connected
  reason: z.enum(['incompatible', 'held_lock']).nullable(), // why `crashed`, when it is
  // while `incompatible`: the sessions the refusing supervisor said it runs (the banner's N); null otherwise
  waitingLiveSessions: z.number().int().nonnegative().nullable(),
  // the last unexpected exit this app run; code and signal only for a supervisor this run spawned
  lastExit: z.strictObject({ code: z.number().int().nullable(), signal: z.string().nullable(), at: z.string(), interrupted: z.number().int() }).nullable(),
  daemon: DaemonStatusSchema.nullable(), // P5 O2 M7
  daemonUnavailable: z.string().nullable(), // P5 O2 M7
});
export type HostStatus = z.infer<typeof HostStatusSchema>;

const host = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'engine-host' as const });
const main = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'main' as const });

export const commands = {
  'host.supervisorStatus': host(z.void(), SupervisorStatusSchema),
  'host.configure': host(z.strictObject({ idleExitMs: IdleExitMsSchema }), z.void()), // main-only sender
  // the supervisor exits after answering; a utility host answers engine.shutdown's body and main forks a fresh one
  'host.stopAll': host(z.strictObject({ graceMs: z.number().int().nonnegative() }), z.strictObject({ stopped: z.number().int(), forced: z.number().int() })),
  'host.exitWhenIdle': host(z.strictObject({ armed: z.boolean() }), z.void()),
  // P5 O2 M2: the sessions the asking connection holds interest in (main's: open session tabs and on-screen sessions),
  // the full set, replacing its last; it ends with the connection. Main-only (a remote viewer's arrives through mawsd).
  'host.interest': host(z.strictObject({ sessions: z.array(AppSessionIdSchema).max(10_000) }), z.void()),
  'host.status': main(z.void(), HostStatusSchema),
  'host.restart': main(z.strictObject({ stopSessions: z.boolean() }), z.void()), // the banner's Restart now and Settings' Stop all
  'host.openLog': main(z.void(), z.void()), // shell.openPath on host.log
} as const satisfies Record<`host.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'host.supervisorStatus': SupervisorStatusSchema, // the engine host's, on every change and in the connect burst
  'host.status': HostStatusSchema, // main's, on every SupervisorStatus and every transport transition
} as const satisfies Record<`host.${string}`, z.ZodType>;
