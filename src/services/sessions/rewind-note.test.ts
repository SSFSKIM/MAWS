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
    expect(bus.intercepted().sort()).toEqual(['session.bash', 'session.queue.promote', 'session.rewind', 'session.send', 'session.steer']);
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
