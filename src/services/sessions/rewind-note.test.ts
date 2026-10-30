// P5 O3-D M4, the rewind repair (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, M4's Decisions and Proves; D18;
// O3 Decision Log 9): `session.rewind` through the services bus keeps a last-act note beside the session's intent, and
// the resume that both `session.start` and `session.acquire` reach re-sends a note a launch left before any input. Over
// the session service, the fake host and C4's real index; "the app restarts" is the harness's `restart()`, whose fresh
// host has an empty process table.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName } from '@shared/ipc/schema';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { sessionIdFor, summary } from '../../../test/support/index-fixture';
import { SessionHarness } from '../../../test/support/session-harness';
import type { FakeEngineHost } from '../../../test/support/session-host';
import * as files from './json-files';
import { registerSessionServiceHandlers } from './service-register';

vi.mock('electron', () => {
  throw new Error('SessionService must not load Electron');
});

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string } };
type Answer = (name: CommandName, input: Record<string, unknown>) => Promise<unknown>;
const OK_MESSAGE = { content: 'Reply OK', display: 'Reply OK' };
const TARGET = randomUUID();
const LAST_SEEN = randomUUID();
let n = 0;

// The fake host's answer to `session.rewind` replaced; every other command answered as before.
function answerRewind(host: FakeEngineHost, rewind: (input: Record<string, unknown>) => Promise<unknown>): void {
  const seam = host as unknown as { answer: Answer };
  const answer = seam.answer.bind(host);
  vi.spyOn(seam, 'answer').mockImplementation((name, input) => (name === 'session.rewind' ? rewind(input) : answer(name, input)));
}

const outcome = (rewound: boolean, reason: string | null = null) => ({ rewound, reason, error: null, prefillText: null, precedingAssistantUuid: null, files: null });

describe('the rewind repair: a last-act note, re-sent at resume', () => {
  let h: SessionHarness;
  let bus: FakeBus;
  const bind = () => {
    bus = fakeBus();
    registerSessionServiceHandlers(h.service, bus, 'index');
  };
  const restart = async () => {
    await h.restart();
    bind();
  };
  beforeEach(async () => {
    h = await new SessionHarness().start();
    h.trustDirectory(h.work);
    bind();
  });
  afterEach(() => h.dispose());

  const invoke = (name: CommandName, input: unknown) => bus.invoke(name, input) as Promise<Result>;
  const rewindInput = (id: AppSessionId) => ({ appSessionId: id, targetMessageUuid: TARGET, lastSeenMessageUuid: LAST_SEEN, files: false });
  const rewind = (id: AppSessionId) => invoke('session.rewind', rewindInput(id));
  const noteOf = (id: AppSessionId): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(join(h.userData, 'sessions', 'rewinds', `${id}.json`), 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  // A record MAWS runs now (resumed once through acquisition, ready)
  const liveSession = async (): Promise<AppSessionId> => {
    const record = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x4e3000 + ++n), directory: h.work })).record;
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'ready', launched: true });
    return record.appId;
  };
  // The engine host's calls that touch the conversation, in order
  const conversationCalls = () => h.host.calls.map((c) => c.name).filter((name) => ['session.launch', 'session.rewind', 'session.send'].includes(name));

  it('intercepts the rewind and the acts that clear it in launch mode index only (scenario’s fixture seams intercept some of them)', () => {
    expect(bus.intercepted().sort()).toEqual(['host.op', 'session.bash', 'session.queue.promote', 'session.rewind', 'session.send', 'session.steer']);
    const scenario = fakeBus();
    registerSessionServiceHandlers(h.service, scenario, 'scenario');
    expect(scenario.intercepted()).toEqual([]);
  });

  it('a SIGKILL inside the answer’s window leaves `attempted`, and the resume through session.start re-sends it once before its message', async () => {
    const id = await liveSession();
    let noteAtForward: Record<string, unknown> | null = null;
    answerRewind(h.host, () => {
      noteAtForward = noteOf(id);
      return new Promise(() => {}); // the process dies before it answers
    });
    void rewind(id);
    await h.until(() => h.host.calledWith('session.rewind').length === 1);
    expect(noteAtForward, 'written before the forward').toMatchObject({ appSessionId: id, state: 'attempted', targetMessageUuid: TARGET, lastSeenMessageUuid: LAST_SEEN });
    h.host.exitNow(id); // SIGKILL: no end_session

    await restart();
    expect(await h.service.startSession(id, { message: OK_MESSAGE, options: {} })).toMatchObject({ status: 'starting' });
    expect(await h.settled(id, 2)).toMatchObject({ phase: 'ready' });
    expect(conversationCalls()).toEqual(['session.launch', 'session.rewind', 'session.send']);
    expect(h.host.calledWith('session.rewind')).toEqual([rewindInput(id)]);
    expect(noteOf(id), 'the resume’s own message is a later act').toBeNull();
  });

  it('a `confirmed` note whose launch was killed is re-sent once by the resume through session.acquire, which sends nothing else', async () => {
    const id = await liveSession();
    expect(await rewind(id)).toMatchObject({ ok: true, value: { rewound: true } });
    expect(noteOf(id)).toMatchObject({ state: 'confirmed', targetMessageUuid: TARGET, lastSeenMessageUuid: LAST_SEEN });
    h.host.exitNow(id);

    await restart();
    expect(await h.service.acquire(id, 'send')).toMatchObject({ status: 'ready', launched: true });
    expect(conversationCalls()).toEqual(['session.launch', 'session.rewind']);
    expect(h.host.calledWith('session.rewind')).toEqual([rewindInput(id)]);
    expect(noteOf(id), 'landed again in this launch: kept for its own end').toMatchObject({ state: 'confirmed' });
  });

  it('a `rewound: false` answer leaves no note', async () => {
    const id = await liveSession();
    h.host.rewound = false;
    expect(await rewind(id)).toMatchObject({ ok: true, value: { rewound: false } });
    expect(noteOf(id)).toBeNull();
  });

  it('a refusal before the request was sent leaves no note; a failure after it keeps `attempted`', async () => {
    const id = await liveSession();
    answerRewind(h.host, async () => {
      throw new Error(`session ${id} is not ready (exiting)`);
    });
    expect(await rewind(id)).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('is not ready') } });
    expect(noteOf(id)).toBeNull();
    answerRewind(h.host, async () => {
      throw new Error(`unknown session ${id}`);
    });
    expect(await rewind(id)).toMatchObject({ ok: false });
    expect(noteOf(id)).toBeNull();

    answerRewind(h.host, async () => {
      throw new Error('the process exited'); // written, never answered: the anchor may or may not have landed
    });
    expect(await rewind(id)).toMatchObject({ ok: false, error: { message: 'the process exited' } });
    expect(noteOf(id)).toMatchObject({ state: 'attempted' });
  });

  it('a later conversation act clears the note, and the next resume re-sends nothing', async () => {
    const id = await liveSession();
    expect(await rewind(id)).toMatchObject({ ok: true });
    expect(noteOf(id)).not.toBeNull();
    expect(await invoke('session.send', { appSessionId: id, content: 'after the rewind' })).toMatchObject({ ok: true, value: { disposition: 'sent' } });
    expect(noteOf(id)).toBeNull();
    h.host.exitNow(id);

    await restart();
    expect(await h.service.acquire(id, 'send')).toMatchObject({ status: 'ready', launched: true });
    expect(h.host.calledWith('session.rewind')).toEqual([]);
  });

  it('an act begun before the rewind, answered after it, leaves the rewind’s note', async () => {
    const id = await liveSession();
    const seam = h.host as unknown as { answer: Answer };
    const answer = seam.answer.bind(h.host);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let sent: () => void = () => {};
    const sending = new Promise<void>((resolve) => (sent = resolve));
    vi.spyOn(seam, 'answer').mockImplementation(async (name, input) => {
      if (name !== 'session.send') return answer(name, input);
      const result = await answer(name, input); // the send has reached the engine
      sent();
      await held; // its answer is on its way back while the rewind goes out
      return result;
    });
    const earlier = invoke('session.send', { appSessionId: id, content: 'before the rewind' });
    await sending;
    expect(await rewind(id)).toMatchObject({ ok: true });
    release();
    expect(await earlier).toMatchObject({ ok: true });
    expect(noteOf(id)).toMatchObject({ state: 'confirmed' });
    expect(await invoke('session.send', { appSessionId: id, content: 'after the rewind' })).toMatchObject({ ok: true });
    expect(noteOf(id)).toBeNull(); // an act begun after it still clears it
  });

  it('an act sent while the rewind’s note is being written goes first, and the rewind sent after it keeps its note', async () => {
    const id = await liveSession();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let writing: () => void = () => {};
    const written = new Promise<void>((resolve) => (writing = resolve));
    const writeWhole = files.writeWhole;
    vi.spyOn(files, 'writeWhole').mockImplementation(async (dir, ...rest) => {
      if (dir.endsWith('rewinds')) {
        writing();
        await held; // the `attempted` note is on its way to disk
      }
      return writeWhole(dir, ...rest);
    });
    const rewound = rewind(id);
    await written;
    const sent = invoke('session.send', { appSessionId: id, content: 'sent while the note was written' });
    await vi.waitFor(() => expect(conversationCalls().slice(-1)).toEqual(['session.send'])); // forwarded at once
    release();
    expect(await sent).toMatchObject({ ok: true });
    expect(await rewound).toMatchObject({ ok: true });
    expect(conversationCalls().slice(-2)).toEqual(['session.send', 'session.rewind']); // the engine's last act is the rewind
    expect(noteOf(id)).toMatchObject({ state: 'confirmed' });
  });

  it('a refused act keeps the note', async () => {
    const id = await liveSession();
    expect(await rewind(id)).toMatchObject({ ok: true });
    h.host.send = 'refuse';
    expect(await invoke('session.send', { appSessionId: id, content: 'refused' })).toMatchObject({ ok: false });
    expect(noteOf(id)).toMatchObject({ state: 'confirmed' });
  });

  it('`target_not_found` at resume changes nothing and deletes the note', async () => {
    const id = await liveSession();
    answerRewind(h.host, () => new Promise(() => {}));
    void rewind(id);
    await h.until(() => noteOf(id) !== null);
    h.host.exitNow(id);

    await restart();
    answerRewind(h.host, async () => outcome(false, 'target_not_found')); // the anchor had landed
    expect(await h.service.startSession(id, { message: OK_MESSAGE, options: {} })).toMatchObject({ status: 'starting' });
    expect(await h.settled(id, 2)).toMatchObject({ phase: 'ready' });
    expect(conversationCalls()).toEqual(['session.launch', 'session.rewind', 'session.send']);
    expect(h.host.events.get(id) ?? [], 'no rewind boundary').not.toContainEqual(expect.objectContaining({ kind: 'boundary.rewind' }));
    expect(noteOf(id)).toBeNull();
  });

  it('a re-send that fails fails the resume before its message, and keeps the note for the next one', async () => {
    const id = await liveSession();
    expect(await rewind(id)).toMatchObject({ ok: true });
    h.host.exitNow(id);

    await restart();
    answerRewind(h.host, async () => {
      throw new Error('rewind_conversation unanswered after 8 s');
    });
    expect(await h.service.startSession(id, { message: OK_MESSAGE, options: {} })).toMatchObject({ status: 'starting' });
    expect(await h.settled(id, 2)).toMatchObject({ phase: 'failed', outcome: { kind: 'error', message: expect.stringContaining('rewind') } });
    expect(h.host.calledWith('session.send')).toEqual([]);
    expect(noteOf(id)).toMatchObject({ state: 'confirmed' });
  });

  it('a launch that ended through end_session clears the note: its resume re-sends nothing', async () => {
    const id = await liveSession();
    expect(await rewind(id)).toMatchObject({ ok: true });
    expect(await h.host.dispatch('engine-host', 'session.stop', { appSessionId: id, reason: 'stop' })).toMatchObject({ ok: true }); // exit 0, no signal
    await h.until(() => noteOf(id) === null);

    await restart();
    expect(await h.service.acquire(id, 'send')).toMatchObject({ status: 'ready', launched: true });
    expect(h.host.calledWith('session.rewind')).toEqual([]);
  });
});

// P5 O3-D M5a (D44(3), D47): a phone's rewind is lane B's claimed op, `host.op` with the inner name `session.rewind`, run
// inside the engine host by its op ledger; through the note as a local rewind is. The fake host's ledger: `host.opQuery`
// answers what it knows, and `host.op` runs the inner command through the fake's own answer once, replaying after.
describe('the rewind repair on lane B’s claimed op (host.op)', () => {
  let h: SessionHarness;
  let bus: FakeBus;
  let ledger: Map<string, unknown>;
  let refuseOps: string | null;
  let hangOps: (() => void) | null; // the process dies before the ledger answers: told as the op is forwarded
  let queryAnswer: ((opId: string) => Promise<unknown>) | null; // host.opQuery's answer, when a case sets its own
  const bind = () => {
    bus = fakeBus();
    registerSessionServiceHandlers(h.service, bus, 'index');
  };
  // the engine host's op ledger, over the fake's own answers
  const withLedger = () => {
    const seam = h.host as unknown as { answer: Answer };
    const answer = seam.answer.bind(h.host);
    vi.spyOn(seam, 'answer').mockImplementation(async (name, input) => {
      if (name === 'host.opQuery') return queryAnswer ? queryAnswer(input.opId as string) : { state: ledger.has(input.opId as string) ? 'done' : 'not-received' };
      if (name !== 'host.op') return answer(name, input);
      const opId = input.opId as string;
      if (hangOps !== null) {
        hangOps();
        return new Promise(() => {});
      }
      if (ledger.has(opId)) return ledger.get(opId); // a known op: what the ledger holds, nothing run
      if (refuseOps !== null) return { state: 'refused', reason: refuseOps };
      const inner = input.name as CommandName;
      h.host.calls.push({ name: inner, input: input.input }); // what the ledger ran, as the fake records a call
      let result: unknown;
      try {
        result = { ok: true, value: await answer(inner, input.input as Record<string, unknown>) };
      } catch (error) {
        result = { ok: false, error: { code: 'internal', message: (error as Error).message } };
      }
      const done = { state: 'done', result };
      ledger.set(opId, done);
      return done;
    });
  };
  beforeEach(async () => {
    h = await new SessionHarness().start();
    h.trustDirectory(h.work);
    ledger = new Map();
    refuseOps = null;
    hangOps = null;
    queryAnswer = null;
    bind();
    withLedger();
  });
  afterEach(() => h.dispose());

  const noteOf = (id: AppSessionId): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(join(h.userData, 'sessions', 'rewinds', `${id}.json`), 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const liveSession = async (): Promise<AppSessionId> => {
    const record = h.index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(0x4e4000 + ++n), directory: h.work })).record;
    expect(await h.service.acquire(record.appId, 'send')).toMatchObject({ status: 'ready', launched: true });
    return record.appId;
  };
  const rewindArgs = (id: AppSessionId) => ({ appSessionId: id, targetMessageUuid: TARGET, lastSeenMessageUuid: LAST_SEEN, files: false });
  // the endpoint's claimed op through the intercept the bus holds for it (host.op is main-only, which a client may not send)
  const op = async (opId: string, name: string, input: unknown): Promise<Result> => {
    try {
      return { ok: true, value: await h.service.claimedOp({ opId, opCreated: '2026-10-30T00:00:00.000Z', member: 'member-1', device: 'phone-1', fingerprint: 'fp-1', name, input: input as never, context: { launchId: 'l', engineSessionId: 'e' } }) };
    } catch (error) {
      return { ok: false, error: { code: 'thrown', message: (error as Error).message } };
    }
  };
  const opId = (n: number) => `phone-op-${String(n).padStart(8, '0')}`;

  it('a claimed rewind writes `attempted` before the op is forwarded, and a SIGKILL inside the window is re-sent once by the resume', async () => {
    const id = await liveSession();
    let noteAtForward: Record<string, unknown> | null = null;
    hangOps = () => void (noteAtForward = noteOf(id));
    void op(opId(1), 'session.rewind', rewindArgs(id));
    await h.until(() => h.host.calledWith('host.op').length === 1);
    expect(noteAtForward, 'written before the forward').toMatchObject({ appSessionId: id, state: 'attempted', targetMessageUuid: TARGET, lastSeenMessageUuid: LAST_SEEN });
    h.host.exitNow(id); // SIGKILL: no end_session

    hangOps = null;
    await h.restart();
    bind();
    withLedger();
    expect(await h.service.acquire(id, 'send')).toMatchObject({ status: 'ready', launched: true });
    expect(h.host.calledWith('session.rewind')).toEqual([rewindArgs(id)]); // once, before any input
  });

  it('the outcome is read from the op’s answer: `rewound: true` confirms, `rewound: false` and a ledger refusal delete', async () => {
    const id = await liveSession();
    const first = await op(opId(2), 'session.rewind', rewindArgs(id));
    expect(first, JSON.stringify(first)).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true, value: { rewound: true } } } });
    expect(noteOf(id)).toMatchObject({ state: 'confirmed' });
    h.host.rewound = false;
    expect(await op(opId(3), 'session.rewind', rewindArgs(id))).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true, value: { rewound: false } } } });
    expect(noteOf(id)).toBeNull();
    refuseOps = 'context';
    expect(await op(opId(4), 'session.rewind', rewindArgs(id))).toMatchObject({ ok: true, value: { state: 'refused', reason: 'context' } });
    expect(noteOf(id)).toBeNull();
  });

  it('a replayed op answer is not a new rewind: a retried rewind leaves a later note as it is, and a retried act clears nothing', async () => {
    const id = await liveSession();
    expect(await op(opId(5), 'session.rewind', rewindArgs(id))).toMatchObject({ ok: true });
    expect(await op(opId(6), 'session.send', { appSessionId: id, content: 'from the phone' })).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true } } });
    expect(noteOf(id), 'a claimed act clears the note').toBeNull();
    expect(await op(opId(5), 'session.rewind', rewindArgs(id))).toMatchObject({ ok: true, value: { state: 'done' } }); // the device retried
    expect(noteOf(id), 'the replay wrote no note').toBeNull();
    expect(h.host.calledWith('session.rewind')).toHaveLength(1);
    expect(await bus.invoke('session.rewind', rewindArgs(id))).toMatchObject({ ok: true }); // a local rewind after it
    expect(noteOf(id)).toMatchObject({ state: 'confirmed' });
    expect(await op(opId(6), 'session.send', { appSessionId: id, content: 'from the phone' })).toMatchObject({ ok: true }); // the act retried
    expect(noteOf(id), 'a replayed act clears nothing').toMatchObject({ state: 'confirmed' });
  });

  // Fix round 2: the ledger's query reserves nothing, so two copies of one op asked at once both hear `not-received`. Here
  // each query is answered as the ledger stood when it arrived, the first held until the second could have arrived; the
  // second's answer is delivered only after the first copy ran and a newer local rewind B wrote its note.
  it('two copies of one op at once: the second touches no note, so a newer local rewind’s note survives', async () => {
    const id = await liveSession();
    const held: (() => void)[] = [];
    queryAnswer = (asked) => {
      const state = ledger.has(asked) ? 'done' : 'not-received';
      return new Promise((answer) => held.push(() => answer({ state })));
    };
    const targetA = randomUUID();
    const first = op(opId(9), 'session.rewind', { ...rewindArgs(id), targetMessageUuid: targetA });
    const second = op(opId(9), 'session.rewind', { ...rewindArgs(id), targetMessageUuid: targetA });
    await h.until(() => held.length >= 1);
    await new Promise((settle) => setTimeout(settle, 50)); // the second copy's query, had it one, has arrived
    held.shift()!();
    expect(await first).toMatchObject({ ok: true, value: { state: 'done', result: { ok: true, value: { rewound: true } } } });
    expect(noteOf(id)).toMatchObject({ state: 'confirmed', targetMessageUuid: targetA });
    queryAnswer = null;
    expect(await bus.invoke('session.rewind', rewindArgs(id))).toMatchObject({ ok: true }); // B, newer, local
    for (const answer of held.splice(0)) answer();
    expect(await second).toMatchObject({ ok: true, value: { state: 'done' } }); // the ledger's replay
    expect(noteOf(id)).toMatchObject({ state: 'confirmed', targetMessageUuid: TARGET });
    expect(h.host.calledWith('session.rewind')).toHaveLength(2); // A once, B once
  });

  it('a query that fails or finds the ledger unavailable refuses the op unsent, touching no note', async () => {
    const id = await liveSession();
    expect(await bus.invoke('session.rewind', rewindArgs(id))).toMatchObject({ ok: true });
    queryAnswer = async () => ({ state: 'unavailable', ledger: 'unwritable' });
    expect(await op(opId(10), 'session.rewind', { ...rewindArgs(id), targetMessageUuid: randomUUID() })).toMatchObject({ ok: true, value: { state: 'refused', reason: 'unavailable', ledger: 'unwritable' } });
    queryAnswer = async () => Promise.reject(new Error('the engine host is gone'));
    expect(await op(opId(11), 'session.send', { appSessionId: id, content: 'from the phone' })).toMatchObject({ ok: true, value: { state: 'refused', reason: 'unavailable' } });
    expect(h.host.calledWith('host.op')).toEqual([]);
    expect(noteOf(id)).toMatchObject({ state: 'confirmed', targetMessageUuid: TARGET });
  });

  it('a claimed op of another command goes on untouched', async () => {
    const id = await liveSession();
    expect(await op(opId(7), 'session.rewind', rewindArgs(id))).toMatchObject({ ok: true });
    await op(opId(8), 'session.interrupt', { appSessionId: id });
    expect(h.host.calledWith('host.opQuery')).toHaveLength(1); // the rewind's only
    expect(noteOf(id)).toMatchObject({ state: 'confirmed' });
  });
});
