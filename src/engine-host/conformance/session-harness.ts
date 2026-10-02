// Test seams for M4's session-level suites (not a test file): an EngineSession over a scripted transport with an
// auto-responder for the handshake, and an EngineSession over a fixture replay with a driver that runs at each `out`
// row the replay holds at (the moment the host would write it), so a suite issues the fixture's prompts, rewinds and
// `!` commands through the real session API and the replay fails on any write the probe never recorded.
import type { SessionEvent } from '@shared/graph/events';
import { SessionEventSchema } from '@shared/graph/events';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { JournalRow } from '@shared/wire/journal';
import { loadEngineJournal, loadJournal, type FixturePass } from '../../../test/support/fixtures';
import { buildLaunch, RELAY_URL } from '../launch';
import { ENGINE_BIN, ENGINE_VERSION } from '../../../test/support/engine-pin'; // W13: the fixtures' engine
import { Normalizer } from '../normalizer';
import { replayEngine, type ReplayTransport } from '../replay-transport';
import { EngineSession, type EngineSessionOptions } from '../session';
import type { EngineTransport } from '../transport';
import { handshakePrelude } from './harness';
import { autoResponder, MemoryJournal, scriptedTransport, type Responder, type ScriptedTransport } from './scripted-transport';

const prelude = loadEngineJournal('replay-handshake');
const responseOf = (seq: number) => (prelude.find((r) => r.seq === seq)!.frame as { response: { response: Record<string, unknown> } }).response.response;
export const INIT_RESPONSE = responseOf(3); // pass2/auto-routed seq 4
export const ROUTED_STATUS = responseOf(5); // pass2/auto-routed seq 145

export function launchSpec(overrides: Partial<LaunchSpec> = {}): LaunchSpec {
  return LaunchSpecSchema.parse({
    appSessionId: 'app-s', cwd: '/tmp/maws-session', additionalDirectories: [], model: 'sonnet', effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: '33333333-3333-4333-8333-333333333333', trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null /* C10 */, replay: null, ...overrides,
  });
}

export const handshakeResponder = (overrides: Responder = {}): Responder => ({
  initialize: () => ({ response: INIT_RESPONSE }),
  get_status: () => ({ response: ROUTED_STATUS }),
  apply_flag_settings: () => ({}),
  set_permission_mode: (r) => ({ response: { mode: r.mode } }),
  ...overrides,
});

export interface Observed {
  session: EngineSession;
  journal: MemoryJournal;
  events: SessionEvent[];
  rebuilt: () => SessionEvent[]; // the journal re-read through a fresh normaliser
}

function observe(session: EngineSession, journal: MemoryJournal, spec: LaunchSpec, launchId: string, sessionId: string | null): Observed {
  const events: SessionEvent[] = [];
  session.on('events', (batch) => {
    for (const e of batch) SessionEventSchema.parse(e);
    events.push(...batch);
  });
  const rebuilt = () => {
    const normalizer = new Normalizer({ appSessionId: spec.appSessionId, launchId, sessionId: sessionId as never });
    return journal.rows.flatMap((row) => normalizer.push(row));
  };
  return { session, journal, events, rebuilt };
}

export function scriptedSession(opts: { spec?: Partial<LaunchSpec>; responder?: Responder; session?: Partial<EngineSessionOptions>; transport?: Omit<Parameters<typeof scriptedTransport>[0] & object, 'onWrite'> } = {}): Observed & { transport: ScriptedTransport; logs: string[] } {
  const spec = launchSpec(opts.spec);
  const plan = buildLaunch(spec, { PATH: '/usr/bin', HOME: '/Users/x' }, { relayUrl: RELAY_URL, bin: ENGINE_BIN, engineVersion: ENGINE_VERSION });
  const transport = scriptedTransport({ ...opts.transport, onWrite: autoResponder(opts.responder ?? handshakeResponder()) });
  const journal = new MemoryJournal();
  const logs: string[] = [];
  const session = new EngineSession({ spec, plan, spawn: () => transport, journal, log: (m) => logs.push(m), ...opts.session });
  return { ...observe(session, journal, spec, plan.launchId, plan.sessionId), transport, logs };
}

// Replays `pass/name` through an EngineSession. `drive(row, ctx)` runs once per held `out` row the session does not
// author itself (its own `initialize` and prelude-answered `get_status` never reach it); it issues the row's frame
// through the session (after `ctx.ready()` for anything that needs a ready session; a row held during the handshake,
// such as `grant-reapply-resume`'s `list_permission_rules`, is issued at once), or kills the replay to end it there.
export async function replayedSession(
  pass: FixturePass,
  name: string,
  drive: (row: JournalRow, ctx: { session: EngineSession; transport: ReplayTransport; fixture: JournalRow[]; ready: () => Promise<void> }) => void,
  opts: { spec?: Partial<LaunchSpec>; session?: Partial<EngineSessionOptions>; beforeStart?: (o: Observed) => void; wrap?: (t: ReplayTransport) => EngineTransport; edit?: (rows: JournalRow[]) => JournalRow[] } = {},
): Promise<Observed & { fixture: JournalRow[]; transport: () => ReplayTransport }> {
  const fixture = (opts.edit ?? ((rows: JournalRow[]) => rows))(loadJournal(pass, name)); // `edit`: a test that extends a recording says so in its name
  const spec = launchSpec({ appSessionId: `replay-${name}` as LaunchSpec['appSessionId'], sessionId: null, model: null, replay: `${pass}/${name}`, ...opts.spec });
  const plan = buildLaunch(spec, { PATH: '/usr/bin', HOME: '/Users/x' }, { relayUrl: RELAY_URL, bin: ENGINE_BIN, engineVersion: ENGINE_VERSION });
  const journal = new MemoryJournal();
  let transport!: ReplayTransport;
  const session: EngineSession = new EngineSession({
    spec, plan, journal, log: () => {},
    spawn: () => {
      transport = replayEngine(fixture, {
        prelude: handshakePrelude(),
        onHold: (row) => {
          const frame = row.frame as { type: string; request?: { subtype?: string } };
          if (frame.type === 'control_request' && frame.request?.subtype === 'initialize') return; // the session's own
          drive(row, { session, transport, fixture, ready: () => session.start() });
        },
      });
      return opts.wrap ? opts.wrap(transport) : transport;
    },
    ...opts.session,
  });
  const observed = observe(session, journal, spec, plan.launchId, plan.sessionId);
  opts.beforeStart?.(observed);
  await session.start();
  await session.exited;
  return { ...observed, fixture, transport: () => transport };
}
