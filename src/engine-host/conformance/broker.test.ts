// The broker's round trips replayed through a whole EngineSession (C3 M3): ReplayTransport → ControlClient →
// Normalizer → PermissionBroker, with a scripted human answering each broker item as it appears and a driver that
// sends the fixture's own prompts. The replay fails on any write the probe never recorded, so every answer here is
// a frame the fixture's next `out` row accepts (control responses match by request id and behavior).
import { appReplayHandshake } from '../replay-handshake';
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { RequestId } from '@shared/graph/ids';
import type { RequestAnswer } from '@shared/engine/answers';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { loadJournal, type FixturePass } from '../../../test/support/fixtures';
import { buildLaunch, RELAY_URL } from '../launch';
import { ENGINE_BIN, FIXTURE_ENGINE_VERSION } from '../../../test/support/engine-pin'; // W13
import { Normalizer } from '../normalizer';
import { replayEngine, type ReplayTransport } from '../replay-transport';
import { EngineSession } from '../session';
import { handshakePrelude } from './harness';
import { MemoryJournal } from './scripted-transport';

interface Replayed {
  session: EngineSession;
  journal: MemoryJournal;
  events: SessionEvent[];
  states: Map<string, string[]>; // request id → the states its attention item showed, in order, 'gone' once it left the list
  fixture: JournalRow[];
  rebuilt: () => SessionEvent[]; // the journal re-read through a fresh normaliser
}

// Replays `pass/name` through an EngineSession. `human(item)` answers each new pending item (or null to leave it);
// `onItems` sees every broker list. The driver sends the fixture's prompts and ends the replay (SIGTERM) at the first
// `out` row the session does not author itself.
async function replaySession(pass: FixturePass, name: string, opts: { human?: (item: AttentionItem) => RequestAnswer | null; onItems?: (items: AttentionItem[], transport: ReplayTransport) => void } = {}): Promise<Replayed> {
  const fixture = loadJournal(pass, name);
  const spec = LaunchSpecSchema.parse({
    appSessionId: `replay-${name}`, cwd: '/tmp/maws-replay', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null /* C10 */, replay: `${pass}/${name}`,
  });
  const plan = buildLaunch(spec, { PATH: '/usr/bin', HOME: '/Users/x' }, { relayUrl: RELAY_URL, bin: ENGINE_BIN, engineVersion: FIXTURE_ENGINE_VERSION });
  const journal = new MemoryJournal();
  let transport!: ReplayTransport;
  const session: EngineSession = new EngineSession({
    spec, plan, journal, log: () => {},
    spawn: () => {
      transport = replayEngine(appReplayHandshake(fixture, spec.trust), {
        prelude: handshakePrelude(),
        onHold: (row) => {
          const frame = row.frame as StdinFrame;
          if (frame.type === 'user') void session.start().then(() => session.send(frame.message.content));
          else if (frame.type === 'control_response') return; // the scripted human's answer is on its way
          else if (frame.type === 'control_request' && frame.request.subtype === 'initialize') return; // the session's own
          else transport.kill('SIGTERM'); // a row this test does not drive: end the replay here
        },
      });
      return transport;
    },
  });
  const events: SessionEvent[] = [];
  const states = new Map<string, string[]>();
  const answered = new Set<string>();
  session.on('events', (batch) => {
    for (const e of batch) SessionEventSchema.parse(e);
    events.push(...batch);
  });
  session.on('brokerItems', (items) => {
    for (const [id, seen] of states) if (!items.some((i) => i.request.requestId === id) && seen.at(-1) !== 'gone') seen.push('gone');
    for (const item of items) {
      const seen = states.get(item.request.requestId!) ?? [];
      if (seen.at(-1) !== item.state) seen.push(item.state);
      states.set(item.request.requestId!, seen);
      if (item.state === 'pending' && !answered.has(item.request.requestId!)) {
        const answer = opts.human?.(item);
        if (answer) {
          answered.add(item.request.requestId!);
          void session.answer(item.request.requestId as RequestId, answer);
        }
      }
    }
    opts.onItems?.(items, transport);
  });
  await session.start();
  await session.exited;
  const rebuilt = () => {
    const normalizer = new Normalizer({ appSessionId: spec.appSessionId, launchId: plan.launchId, sessionId: plan.sessionId });
    return journal.rows.flatMap((row) => normalizer.push(row));
  };
  return { session, journal, events, states, fixture, rebuilt };
}

const metaRows = (journal: MemoryJournal, event: string) => journal.rows.filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === event);
const ofKind = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);
const outResponses = (journal: MemoryJournal) => journal.rows.filter((r) => r.direction === 'out' && (r.frame as { type: string }).type === 'control_response').map((r) => ({ seq: r.seq, response: (r.frame as { response: { request_id: string; response: Record<string, unknown> } }).response }));

describe('permission broker states and the approvals-lost rule', () => {
  it('pass1/permission-roundtrip: allow once, deny, then an allow with scope session downgraded because every request there is an ask rule', async () => {
    const script: RequestAnswer[] = [
      { kind: 'permission', decision: 'allow', scope: 'once' },
      { kind: 'permission', decision: 'deny' },
      { kind: 'permission', decision: 'allow', scope: 'session' },
    ];
    const run = await replaySession('pass1', 'permission-roundtrip', { human: () => script.shift() ?? null });
    expect(metaRows(run.journal, 'replay_mismatch')).toEqual([]);
    expect(script).toEqual([]);
    const requested = ofKind(run.events, 'permission.requested');
    expect(requested.map((e) => [e.toolUseId, e.decisionReasonType])).toEqual([['toolu_01RWDevVWYVi2Tn3y58pxRS3', 'rule'], ['toolu_01WfZTvMV6147Psn1MBSesXw', 'rule'], ['toolu_01LQMM9an9pCcucqYfhdoJdV', 'rule']]);
    // each item went pending → delivered → confirmed (its tool_result) and left the list at its turn's result
    for (const e of requested) expect(run.states.get(e.requestId)).toEqual(['pending', 'delivered', 'confirmed', 'gone']);

    const responses = outResponses(run.journal);
    expect(responses.map((r) => r.response.response.behavior)).toEqual(['allow', 'deny', 'allow']);
    expect(responses[2]!.response.response).toEqual({ behavior: 'allow', updatedInput: { command: 'git status --short', description: 'Show git status in short format' }, decisionClassification: 'user_temporary' });
    expect(run.journal.rows.find((r) => r.seq === responses[2]!.seq - 1)!.frame).toEqual({ event: 'answer_note', requestId: requested[2]!.requestId, note: 'scope downgraded: ask rule' });
    const resolved = ofKind(run.events, 'permission.resolved');
    expect(resolved.map((e) => [e.behavior, e.message, e.resolvedBy])).toEqual([['allow', null, 'user'], ['deny', 'Denied by the user in MAWS.', 'user'], ['allow', 'scope downgraded: ask rule', 'user']]);
    expect(ofKind(run.events, 'tool.result').find((r) => r.toolUseId === 'toolu_01WfZTvMV6147Psn1MBSesXw')).toMatchObject({ denial: 'permission-rule' });
    expect(run.session.status()).toMatchObject({ grants: [], gateway: { verified: 'routed' }, process: 'exited', pendingRequests: 0 });
    expect(ofKind(run.events, 'process.exited')).toMatchObject([{ lostAttentionCount: 0 }]);
    // every event derived from a journal row the session wrote first: the journal rebuilds the live graph exactly
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('pass2/grant-reapply-start: an allow with scope session sends seq 32\'s updatedPermissions and the snapshot records the rule', async () => {
    const run = await replaySession('pass2', 'grant-reapply-start', { human: () => ({ kind: 'permission', decision: 'allow', scope: 'session' }) });
    expect(metaRows(run.journal, 'replay_mismatch')).toEqual([]);
    expect(ofKind(run.events, 'permission.requested')).toMatchObject([{ decisionReasonType: null, toolUseId: 'toolu_01Eu21W4avHdQXawFme4uM4y' }]);
    const recorded = (run.fixture.find((r) => r.seq === 32)!.frame as { response: { response: { updatedPermissions: unknown } } }).response.response.updatedPermissions;
    const [sent] = outResponses(run.journal);
    expect(sent!.response.response.updatedPermissions).toEqual(recorded);
    expect(sent!.response.response.decisionClassification).toBe('user_permanent');
    expect(run.session.status().grants).toEqual(['Bash(touch granted.txt)']);
    expect(ofKind(run.events, 'permission.resolved')).toMatchObject([{ behavior: 'allow', message: null, updatedPermissions: recorded }]);
  });

  it('pass1/question-roundtrip: the answers ride updatedInput keyed by the exact question strings', async () => {
    const run = await replaySession('pass1', 'question-roundtrip', {
      human: (item) => (item.kind === 'question' ? { kind: 'question', answers: { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' } } : null),
    });
    expect(metaRows(run.journal, 'replay_mismatch')).toEqual([]);
    const recorded = (run.fixture.find((r) => r.seq === 138)!.frame as { response: { response: unknown } }).response.response;
    expect(outResponses(run.journal)[0]!.response.response).toEqual(recorded);
    expect(ofKind(run.events, 'question.answered')).toMatchObject([{ answers: { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' } }]);
    const [question] = ofKind(run.events, 'question.requested');
    expect(run.states.get(question!.requestId)).toEqual(['pending', 'delivered', 'confirmed', 'gone']);
  });
});

describe('id-less requests retire at the turn\'s end', () => {
  const accept: RequestAnswer = { kind: 'elicitation', action: 'accept', content: { color: 'teal' } };

  it('pass2/dialogs: the elicitation (seq 41, no tool-use id) is delivered at seq 43, never confirmed, retired at the seq 55 result; the exit after loses nothing', async () => {
    const run = await replaySession('pass2', 'dialogs', { human: () => accept });
    expect(metaRows(run.journal, 'replay_mismatch')).toEqual([]);
    const [requested] = ofKind(run.events, 'elicitation.requested');
    expect(requested).toMatchObject({ mcpServerName: 'maws-elicit', mode: 'form' });
    expect(run.states.get(requested!.requestId)).toEqual(['pending', 'delivered', 'gone']);
    // the item left the list exactly at the main-lane result, the earliest frame proving the engine moved past it
    const ended = ofKind(run.events, 'turn.ended').find((e) => !e.isEchoReceipt)!;
    expect(ended.resultText).toContain('teal');
    expect(ofKind(run.events, 'process.exited')).toMatchObject([{ lostAttentionCount: 0 }]);
  });

  it('pass2/dialogs: a process that dies between the answer (seq 43) and the result (seq 55) has lost the delivered elicitation', async () => {
    let killed = false;
    const run = await replaySession('pass2', 'dialogs', {
      human: () => accept,
      onItems: (items, transport) => {
        if (!killed && items.some((i) => i.state === 'delivered')) {
          killed = true;
          transport.kill('SIGKILL');
        }
      },
    });
    const [requested] = ofKind(run.events, 'elicitation.requested');
    expect(run.states.get(requested!.requestId)).toEqual(['pending', 'delivered', 'gone']);
    expect(ofKind(run.events, 'turn.ended').filter((e) => !e.isEchoReceipt)).toEqual([]);
    expect(ofKind(run.events, 'process.exited')).toMatchObject([{ lostAttentionCount: 1, reason: 'crash', signal: 'SIGKILL' }]);
    expect(metaRows(run.journal, 'exit').map((r) => (r.frame as { lostAttentionCount: number }).lostAttentionCount)).toEqual([1]);
    expect(run.rebuilt()).toEqual(run.events);
  });
});
