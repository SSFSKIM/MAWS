// Main's owner channel (the P2-C document, Design §5 and §6; M4): marks from finalized text, answers followed through
// their members to delivered or unanswered, the attention projection, and the recovery read. Every answer here is
// driven through the host's real queue and normaliser (test/support/owner-host.ts): the seam's result is what the real
// queue answered, every row and lifecycle reaches main as the live stream carries it, and delivery is only ever the
// engine's `command_lifecycle`, never a `user.message` standing in for it. The transcript's evidence is read by the real
// reader from a transcript file the test writes as the engine would.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId, SessionId } from '@shared/graph/ids';
import { answerText } from '@shared/owner/answer';
import { markIdOf, type MarkId } from '@shared/owner/marks';
import type { OwnerChannelState, QuestionState } from '@shared/owner/state';
import { loadJournal, TRANSCRIPT_FIXTURE_DIR } from '../../../test/support/fixtures';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { MemoryFileReader } from '../../../test/support/memory-reader';
import { OwnerHostSim } from '../../../test/support/owner-host';
import { ChainFollower } from '../../engine-host/fs/chain-follower';
import { Normalizer } from '../../engine-host/normalizer';
import { Index } from '../index/index';
import { transcriptChain, transcriptEvidence } from './prompt-state';
import { OwnerChannelService, type AnsweredInput } from './service';
import type { LaunchRecord } from './store';

const SID = '6c07f148-ba9f-48de-9114-bb1d41c5c0b0' as SessionId;
const WATERMARK = '2026-10-09T09:00:00.000Z'; // the session's first lane-on launch, before the host's clock starts
const launch = (over: Partial<LaunchRecord> = {}): LaunchRecord => ({
  launchId: 'l1', at: WATERMARK, laneOn: true, desired: 'maws-contract', recorded: 'unrecorded', appended: true, snapshotOff: false, offUnavailable: false, applied: 'maws-contract', style: 'default', ...over,
});
const QUESTION = (head: string) => `<need-input>${head}\n<choice recommended>Postgres</choice>\n<choice>SQLite</choice>\n</need-input>`;

let dir: ReturnType<typeof tempDir>;
let index: Index;
let app: AppSessionId;
let transcript: string;
const services: OwnerChannelService[] = []; // stopped after each test (a recovery retry's timer goes with it)

beforeEach(() => {
  dir = tempDir('maws-owner-service-');
  index = new Index(join(dir.path, 'index.sqlite'));
  app = index.sessions.upsertFromSummary(summary({ sessionId: SID })).record.appId;
  index.ownerChannel.recordLaunch(app, launch());
  transcript = join(dir.path, 'transcript.jsonl');
  writeFileSync(transcript, '');
});
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  index.close();
  dir.dispose();
});

interface Projection {
  items: AttentionItem[];
  silent: AttentionId[];
}

async function harness(opts: { appEnabled?: boolean; launch?: boolean } = {}) {
  const projections: Projection[] = [];
  const states: OwnerChannelState[] = [];
  const h = { appEnabled: opts.appEnabled ?? true };
  let service!: OwnerChannelService;
  const sim = new OwnerHostSim(app, SID, (events) => service.onEvents(app, events));
  const make = () => {
    const made = new OwnerChannelService({
      store: index.ownerChannel,
      sessions: index.sessions,
      appEnabled: () => h.appEnabled,
      attention: { setOwnerItems: (id, items, silent) => void (id === app && projections.push({ items, silent: [...silent] })) },
      dispatch: sim.dispatch,
      transcriptEvidence: (_id, uuids) => transcriptEvidence(transcript, uuids),
      transcriptChain: (_id, uuid) => transcriptChain(transcript, uuid),
      emit: (_name, payload) => void states.push(payload.state),
      now: () => sim.nowIso(),
      log: () => {},
      recoveryRetryMs: 5,
    });
    services.push(made);
    return made;
  };
  service = make();
  service.start({ streaming: true });
  if (opts.launch !== false) await sim.launch();
  const restart = async () => {
    service.stop();
    service = make();
    service.start({ streaming: false });
    await service.settled();
  };
  const state = () => service.state(app);
  const mark = (id: MarkId) => state().marks.find((m) => m.id === id)!;
  const question = (id: MarkId): QuestionState => mark(id).question!;
  const ask = (head: string, more = ''): MarkId => {
    const uuid = sim.assistant([`${more}${QUESTION(head)}`]);
    return markIdOf(app, 'need-input', { messageUuid: uuid, blockIndex: 0, span: 0 });
  };
  const report = (markId: MarkId, result: Omit<AnsweredInput, 'appSessionId' | 'markId' | 'origin' | 'text' | 'started'> & { text?: string; started?: boolean }) =>
    service.answered({ appSessionId: app, markId, origin: 'answer', text: result.text ?? answerText(mark(markId).head, 'Postgres'), started: false, ...result });
  const items = () => projections.at(-1)?.items ?? [];
  // what the engine wrote to its transcript for a prompt it took (M4's probe: an idle prompt's user record)
  const taken = (uuid: string) => appendFileSync(transcript, `${JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: 'x' }, origin: { kind: 'human' } })}\n`);
  return { sim, h, projections, states, get service() { return service; }, restart, state, mark, question, ask, report, items, taken };
}
const flush = () => new Promise((r) => setImmediate(r));

// Journal rows the host's record lost (a torn journal, or a saved queue changed with no process to journal it): gone
// from `session.promptHistory` and from the next launch's recovery read.
function loseRows(sim: OwnerHostSim, lost: (row: { direction: string; frame: Record<string, unknown> }) => boolean): void {
  for (const launch of sim.launches) launch.rows = launch.rows.filter((row) => !lost(row as unknown as { direction: string; frame: Record<string, unknown> }));
}

describe('answers follow their members (Design §6)', () => {
  it('an idle send the engine started before the renderer reported it: delivered from the log', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const { entry, disposition } = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    expect(disposition).toBe('sent');
    t.sim.engine(entry.messageUuid!, 'queued');
    t.sim.engine(entry.messageUuid!, 'started');
    t.report(q, { disposition: 'sent', messageUuid: entry.messageUuid! });
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which backend?', 'Postgres'), origin: 'answer' } });
    expect(t.items().some((i) => i.kind === 'async_input')).toBe(false);
  });

  it.each(['cancelled', 'refused'] as const)('an idle send the engine %s before the report: unanswered, a refusal noted', async (state) => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    t.sim.engine(entry.messageUuid!, 'queued');
    t.sim.engine(entry.messageUuid!, state);
    await flush();
    t.report(q, { disposition: 'sent', messageUuid: entry.messageUuid! });
    expect(t.question(q)).toEqual(state === 'refused' ? { state: 'unanswered', failed: { reason: 'refused' } } : { state: 'unanswered' });
    expect(t.items().filter((i) => i.kind === 'async_input')).toHaveLength(1);
  });

  it('a seam refusal leaves the question unanswered with its reason', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.report(q, { disposition: 'refused', reason: 'The session has ended' });
    expect(t.question(q)).toEqual({ state: 'unanswered', failed: { reason: 'The session has ended' } });
  });

  it('a next steer held: queued through the withdrawal (its cancelled lifecycle changes nothing, no item, no second answer), the held entry a member, then delivered at its start', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.turn = true;
    const { messageUuid } = await t.sim.queue.steer(answerText('Which backend?', 'Postgres'), { priority: 'next' });
    t.report(q, { disposition: 'steered', messageUuid });
    let answer!: () => void;
    t.sim.cancelGate = new Promise<void>((r) => (answer = r));
    const holding = t.sim.queue.hold(messageUuid);
    await flush();
    // the withdraw row and the engine's cancelled lifecycle are in, the hold row is not
    expect(t.question(q)).toMatchObject({ state: 'queued', members: [{ kind: 'uuid', id: messageUuid, life: 'withdrawing' }] });
    expect(t.items().some((i) => i.kind === 'async_input')).toBe(false);
    answer();
    const held = await holding;
    expect(t.question(q)).toMatchObject({ state: 'queued', members: expect.arrayContaining([{ kind: 'uuid', id: messageUuid, life: 'dead' }, { kind: 'entry', id: held.queueId, life: 'alive' }]) });
    await t.sim.turnEnded();
    const resent = t.sim.queue.state.entries.find((e) => e.queueId === held.queueId)!.messageUuid!;
    expect(t.question(q).state).toBe('queued');
    t.sim.engine(resent, 'started');
    expect(t.question(q)).toMatchObject({ state: 'delivered' });
  });

  it('two holds of identical text finishing in reverse order: each answer keeps its own held entry', async () => {
    const t = await harness();
    const a = t.ask('Which backend?');
    const b = t.ask('Which backend?');
    const text = answerText('Which backend?', 'Postgres');
    t.sim.turn = true;
    const ua = (await t.sim.queue.steer(text, { priority: 'next' })).messageUuid;
    const ub = (await t.sim.queue.steer(text, { priority: 'next' })).messageUuid;
    t.report(a, { disposition: 'steered', messageUuid: ua, text });
    t.report(b, { disposition: 'steered', messageUuid: ub, text });
    const gates = new Map<string, () => void>();
    t.sim.cancelGate = (uuid) => new Promise<void>((r) => gates.set(uuid, r));
    const holdA = t.sim.queue.hold(ua);
    const holdB = t.sim.queue.hold(ub);
    await flush();
    gates.get(ub)!();
    const heldB = await holdB;
    gates.get(ua)!();
    const heldA = await holdA;
    const entryOf = (id: MarkId) => (t.question(id) as Extract<QuestionState, { members: unknown }>).members.filter((m) => m.kind === 'entry' && m.life === 'alive').map((m) => m.id);
    expect(entryOf(a)).toEqual([heldA.queueId]);
    expect(entryOf(b)).toEqual([heldB.queueId]);
    await t.sim.turnEnded(); // the queue releases its head, B's held entry
    const sentB = t.sim.queue.state.entries.find((e) => e.queueId === heldB.queueId)!.messageUuid!;
    t.sim.engine(sentB, 'started');
    expect(t.question(b).state).toBe('delivered');
    expect(t.question(a).state).toBe('queued');
  });

  it('a host-queued answer A beside a steered answer B of the same text, B started before its report: A is not delivered by B', async () => {
    const t = await harness();
    const a = t.ask('Which backend?');
    const b = t.ask('Which backend?');
    const text = answerText('Which backend?', 'Postgres');
    t.sim.turn = true;
    const queued = await t.sim.queue.send(text);
    expect(queued.disposition).toBe('queued');
    t.report(a, { disposition: 'queued', queueId: queued.entry.queueId, text });
    const { messageUuid } = await t.sim.queue.steer(text, { priority: 'next' });
    t.sim.engine(messageUuid, 'queued');
    t.sim.engine(messageUuid, 'started');
    expect(t.question(a).state).toBe('queued');
    t.report(b, { disposition: 'steered', messageUuid, text });
    expect(t.question(b).state).toBe('delivered');
    expect(t.question(a)).toMatchObject({ state: 'queued', members: [{ kind: 'entry', id: queued.entry.queueId, life: 'alive' }] });
  });

  it('a promotion then the steer\'s start delivers; so does a start the stream carries before the promote row', async () => {
    for (const reorder of [false, true]) {
      const t = await harness();
      const q = t.ask('Which backend?');
      t.sim.turn = true;
      const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
      t.report(q, { disposition: 'queued', queueId: entry.queueId });
      if (reorder) t.sim.holding = [];
      const { messageUuid } = await t.sim.queue.promote(entry.queueId, { priority: 'next' });
      t.sim.engine(messageUuid, 'started');
      if (reorder) {
        t.sim.release((events) => [...events.filter((e) => e.kind === 'command.lifecycle'), ...events.filter((e) => e.kind !== 'command.lifecycle')]);
      }
      expect(t.question(q)).toMatchObject({ state: 'delivered' });
      t.service.stop();
    }
  });

  it('a uuid-only seed whose submission an exit cuts: the uncertain row enrols its entry, the transcript says the uuid was not taken, and the resubmission delivers it', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    t.report(q, { disposition: 'sent', messageUuid: entry.messageUuid! });
    await t.sim.exit('crash');
    await t.service.settled();
    expect(t.question(q)).toMatchObject({ state: 'queued', members: expect.arrayContaining([{ kind: 'entry', id: entry.queueId, life: 'alive' }, { kind: 'uuid', id: entry.messageUuid, life: 'dead' }]) });
    await t.sim.launch();
    await t.sim.queue.setPaused(false); // the human re-sends the uncertain head
    const resent = t.sim.queue.state.entries.find((e) => e.queueId === entry.queueId)!.messageUuid!;
    expect(resent).not.toBe(entry.messageUuid);
    t.sim.engine(resent, 'started');
    expect(t.question(q).state).toBe('delivered');
  });

  it('an uncertain entry after an exit whose uuid the engine took: settled delivered by the transcript\'s evidence', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    t.report(q, { disposition: 'sent', messageUuid: entry.messageUuid! });
    t.taken(entry.messageUuid!); // on disk, though its lifecycle never reached the host before the crash
    await t.sim.exit('crash');
    await t.service.settled();
    expect(t.question(q).state).toBe('delivered');
  });

  it('Answer again keeps each attempt\'s text and members: the old attempt\'s evidence settles the old text and never certifies the new one', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const postgres = answerText('Which backend?', 'Postgres');
    const sqlite = answerText('Which backend?', 'SQLite');
    t.sim.turn = true;
    const { messageUuid } = await t.sim.queue.steer(postgres, { priority: 'next' });
    t.report(q, { disposition: 'steered', messageUuid, text: postgres });
    await t.restart(); // the app closed
    t.sim.listening = false;
    let answer!: () => void;
    t.sim.cancelGate = new Promise<void>((r) => (answer = r));
    const holding = t.sim.queue.hold(messageUuid); // the withdraw row and the engine's cancelled; the hold row waits
    await flush();
    // the journal lost the withdrawal's rows (torn): the recovery read cannot settle the steer
    loseRows(t.sim, (row) => (row.direction === 'meta' && row.frame.action === 'withdraw') || (row.direction === 'in' && row.frame.command_uuid === messageUuid));
    t.sim.historyComplete = false;
    t.sim.listening = true;
    await t.service.hostStreaming();
    expect(t.question(q)).toMatchObject({ state: 'unconfirmed', text: postgres });
    const retry = await t.sim.queue.send(sqlite); // Answer again
    t.report(q, { disposition: 'queued', queueId: retry.entry.queueId, text: sqlite });
    expect(t.question(q)).toEqual({ state: 'queued', text: sqlite, origin: 'answer', members: [{ kind: 'entry', id: retry.entry.queueId, life: 'alive' }] });
    answer();
    const held = await holding; // the old steer, withdrawn into a held entry: the old attempt's member
    const promoted = await t.sim.queue.promote(held.queueId, { priority: 'next' });
    t.sim.engine(promoted.messageUuid, 'started');
    // the old attempt arrived and is the question's answer; the new one is still on its way, and its card says so
    expect(t.question(q)).toMatchObject({ state: 'queued', text: sqlite });
    expect(index.ownerChannel.mark(q)).toMatchObject({ answerText: postgres, answerOrigin: 'answer' });
    await t.sim.turnEnded();
    const sent = t.sim.queue.state.entries.find((e) => e.queueId === retry.entry.queueId)!.messageUuid!;
    t.sim.engine(sent, 'started');
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: sqlite, origin: 'answer' } });
  });

  it('a seam result with neither a uuid nor an entry id is unconfirmed; a unique head settles it once the engine takes the prompt', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.report(q, { disposition: 'sent', started: true });
    expect(t.question(q)).toMatchObject({ state: 'unconfirmed', members: [] });
    expect(t.items().some((i) => i.kind === 'async_input')).toBe(false);
    const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres')); // the resumed session's first prompt
    expect(t.question(q).state).toBe('unconfirmed'); // written, not yet taken
    t.sim.engine(entry.messageUuid!, 'started');
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which backend?', 'Postgres'), origin: 'legacy' } });
  });

  it('an answer whose send started the session first correlates by its uuid like any other (X22: started is a field)', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres')); // the acquired session's first prompt
    t.report(q, { disposition: 'sent', started: true, messageUuid: entry.messageUuid! });
    expect(t.question(q)).toMatchObject({ state: 'queued', members: expect.arrayContaining([{ kind: 'uuid', id: entry.messageUuid, life: 'alive' }]) });
    t.sim.engine(entry.messageUuid!, 'started');
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which backend?', 'Postgres'), origin: 'answer' } });
  });

  it('a refused send leaves the question unanswered with the card’s words, whether or not the session was started', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.report(q, { disposition: 'refused', started: false, reason: 'Trust this folder in the session to continue' });
    expect(t.question(q)).toEqual({ state: 'unanswered', failed: { reason: 'Trust this folder in the session to continue' } });
  });
});

describe('the recovery read (Design §6, "Restarts and reconnects")', () => {
  it('main disconnected while the engine crashed with a pending steer: the abandon row in the recovery read settles it unanswered', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.turn = true;
    const { messageUuid } = await t.sim.queue.steer(answerText('Which backend?', 'Postgres'), { priority: 'next' });
    t.report(q, { disposition: 'steered', messageUuid });
    t.service.hostDown();
    t.sim.listening = false;
    await t.sim.exit('crash');
    await t.sim.launch();
    t.sim.listening = true;
    expect(t.question(q).state).toBe('queued'); // nothing concluded before the read
    await t.service.hostStreaming();
    expect(t.question(q)).toEqual({ state: 'unanswered' });
  });

  it('a failed write, then a resubmission under a new uuid while main is disconnected: delivered by the recovery read', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.failWrite = () => true;
    const sent = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    expect(sent.disposition).toBe('queued');
    t.report(q, { disposition: 'queued', queueId: sent.entry.queueId });
    expect(t.question(q)).toMatchObject({ state: 'queued' });
    t.service.hostDown();
    t.sim.listening = false;
    t.sim.failWrite = null;
    await t.sim.queue.setPaused(false);
    const resent = t.sim.queue.state.entries[0]!.messageUuid!;
    t.sim.engine(resent, 'started');
    t.sim.listening = true;
    await t.service.hostStreaming();
    expect(t.question(q).state).toBe('delivered');
  });

  it('a reconnect whose queue snapshot no longer shows the entry: the missed lifecycle in the history delivers it, never unanswered on the way', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.turn = true;
    const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    t.report(q, { disposition: 'queued', queueId: entry.queueId });
    t.service.hostDown();
    t.sim.listening = false;
    await t.sim.turnEnded(); // releases the entry
    const uuid = t.sim.queue.state.entries[0]!.messageUuid!;
    t.sim.engine(uuid, 'started');
    t.sim.engine(uuid, 'completed');
    await t.sim.turnEnded([uuid]); // the entry leaves the queue: the snapshot shows nothing
    expect(t.sim.queue.state.entries).toEqual([]);
    t.sim.listening = true;
    const before = t.states.length;
    await t.service.hostStreaming();
    expect(t.question(q).state).toBe('delivered');
    expect(t.states.slice(before).map((s) => s.marks.find((m) => m.id === q)!.question!.state)).not.toContain('unanswered');
  });

  it('a history that is not complete leaves an unsettled answer unconfirmed, or delivered when the transcript shows its prompt', async () => {
    for (const onDisk of [false, true]) {
      const t = await harness();
      const q = t.ask('Which backend?');
      t.sim.turn = true;
      const { messageUuid } = await t.sim.queue.steer(answerText('Which backend?', 'Postgres'), { priority: 'next' });
      t.report(q, { disposition: 'steered', messageUuid });
      await t.restart(); // the app closed meanwhile
      t.sim.listening = false;
      await t.sim.exit('crash');
      await t.sim.launch();
      t.sim.launches.splice(0, t.sim.launches.length - 1); // the journals that held the steer's end were pruned
      t.sim.historyComplete = false;
      if (onDisk) t.taken(messageUuid);
      t.sim.listening = true;
      await t.service.hostStreaming();
      expect(t.question(q).state).toBe(onDisk ? 'delivered' : 'unconfirmed');
      t.service.stop();
    }
  });

  it('a prompt taken while the recovery read is out: the fold makes it the answer\'s member, never a legacy answer', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.turn = true;
    const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    t.report(q, { disposition: 'queued', queueId: entry.queueId });
    t.service.hostDown();
    t.sim.listening = false;
    await t.sim.turnEnded(); // release (Q, U) and the prompt's write, unheard
    const uuid = t.sim.queue.state.entries[0]!.messageUuid!;
    t.sim.listening = true;
    t.sim.resync(['user.message']); // the reconnect re-delivers the prompt before the read
    t.sim.engine(uuid, 'started');
    expect(t.question(q).state).toBe('queued');
    await t.service.hostStreaming();
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { origin: 'answer' } });
  });

  it('a prompt taken while the recovery read is out is read as a legacy answer only after the fold: never for another question when it is an answer\'s, still when it is no answer\'s', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const other = t.ask('Which region?');
    const terminal = t.ask('Which database?');
    t.sim.turn = true;
    const text = answerText('Which backend?', `Postgres\n${answerText('Which region?', 'eu')}`);
    const { entry } = await t.sim.queue.send(text);
    t.report(q, { disposition: 'queued', queueId: entry.queueId, text });
    t.service.hostDown();
    t.sim.listening = false;
    await t.sim.turnEnded(); // release (Q, U) and the prompt's write, unheard
    const uuid = t.sim.queue.state.entries[0]!.messageUuid!;
    t.sim.listening = true;
    t.sim.resync(['user.message']); // the reconnect re-delivers the prompt before the read
    t.sim.engine(uuid, 'started');
    await t.sim.turnEnded([uuid]);
    const typed = await t.sim.queue.send(answerText('Which database?', 'SQLite')); // no answer's prompt
    t.sim.engine(typed.entry.messageUuid!, 'started');
    expect(t.question(other)).toEqual({ state: 'unanswered' });
    expect(t.question(terminal)).toEqual({ state: 'unanswered' }); // held until the read is folded
    await t.service.hostStreaming();
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { origin: 'answer' } });
    expect(t.question(other)).toEqual({ state: 'unanswered' });
    expect(t.question(terminal)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which database?', 'SQLite'), origin: 'legacy' } });
  });

  it.each(['backoff', 'reconnect'] as const)('a failed recovery read keeps the gate closed, so a partial log concludes nothing, and the read is retried (%s)', async (via) => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.turn = true;
    const { messageUuid } = await t.sim.queue.steer(answerText('Which backend?', 'Postgres'), { priority: 'next' });
    t.report(q, { disposition: 'steered', messageUuid });
    t.service.hostDown();
    t.sim.listening = false;
    const held = await t.sim.queue.hold(messageUuid); // withdraw, the engine's cancelled, hold: all unheard
    t.sim.listening = true;
    t.sim.resync(['command.lifecycle']); // the reconnect re-delivers the engine's cancelled, not the host's rows
    t.sim.failCommand = 'session.promptHistory';
    await t.service.hostStreaming();
    expect(t.question(q)).toMatchObject({ state: 'queued', members: [{ kind: 'uuid', id: messageUuid, life: 'alive' }] });
    expect(t.items().some((i) => i.kind === 'async_input')).toBe(false);
    t.sim.failCommand = null;
    const expected = { state: 'queued', members: expect.arrayContaining([{ kind: 'uuid', id: messageUuid, life: 'dead' }, { kind: 'entry', id: held.queueId, life: 'alive' }]) };
    if (via === 'reconnect') {
      t.service.hostDown();
      await t.service.hostStreaming();
      expect(t.question(q)).toMatchObject(expected);
    } else {
      await vi.waitFor(() => expect(t.question(q)).toMatchObject(expected));
    }
  });

  it.each(['reconnect', 'restart'] as const)('a withdrawal the folded record proves stays queued through a %s until its outcome row, with no second answer offered', async (via) => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.turn = true;
    const { messageUuid } = await t.sim.queue.steer(answerText('Which backend?', 'Postgres'), { priority: 'next' });
    t.report(q, { disposition: 'steered', messageUuid });
    let answer!: () => void;
    t.sim.cancelGate = new Promise<void>((r) => (answer = r));
    const holding = t.sim.queue.hold(messageUuid); // withdraw and the engine's cancelled are in, the hold row is not
    await flush();
    if (via === 'reconnect') t.service.hostDown();
    else await t.restart();
    await t.service.hostStreaming();
    expect(t.question(q)).toMatchObject({ state: 'queued', members: [{ kind: 'uuid', id: messageUuid, life: 'withdrawing' }] });
    expect(t.items().some((i) => i.kind === 'async_input')).toBe(false);
    answer();
    const held = await holding;
    expect(t.question(q)).toMatchObject({ state: 'queued', members: expect.arrayContaining([{ kind: 'uuid', id: messageUuid, life: 'dead' }, { kind: 'entry', id: held.queueId, life: 'alive' }]) });
  });

  it('a withdrawal whose outcome a history that is not complete may have lost proves nothing: with no other evidence the answer reads unconfirmed', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.turn = true;
    const { messageUuid } = await t.sim.queue.steer(answerText('Which backend?', 'Postgres'), { priority: 'next' });
    t.report(q, { disposition: 'steered', messageUuid });
    await t.restart();
    t.sim.listening = false;
    await t.sim.queue.cancelSteer(messageUuid); // cancelled while main was away
    loseRows(t.sim, (row) => row.direction === 'meta' && row.frame.action === 'cancel'); // the journal kept the withdraw row, not the cancel
    t.sim.historyComplete = false;
    expect(t.sim.queue.state.entries).toEqual([]);
    expect(t.sim.queue.state.steers ?? []).toEqual([]);
    t.sim.listening = true;
    await t.service.hostStreaming();
    expect(t.question(q).state).toBe('unconfirmed');
  });

  it('a saved entry removed with no row (no process held the queue) is still read from the transcript and otherwise unconfirmed', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.turn = true;
    const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    t.report(q, { disposition: 'queued', queueId: entry.queueId });
    await t.restart();
    t.sim.listening = false;
    await t.sim.queue.remove(entry.queueId);
    loseRows(t.sim, (row) => row.direction === 'meta' && row.frame.action === 'remove'); // a saved queue's removal writes none
    t.sim.listening = true;
    await t.service.hostStreaming();
    expect(t.question(q)).toMatchObject({ state: 'unconfirmed' });
  });

  it('a restart restores open answers from the table and folds the history before anything else', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    t.sim.turn = true;
    const { entry } = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    t.report(q, { disposition: 'queued', queueId: entry.queueId });
    await t.restart();
    t.sim.listening = false;
    await t.sim.turnEnded();
    const uuid = t.sim.queue.state.entries[0]!.messageUuid!;
    t.sim.engine(uuid, 'started');
    t.sim.listening = true;
    expect(t.question(q).state).toBe('queued');
    await t.service.hostStreaming();
    expect(t.question(q).state).toBe('delivered');
  });
});

describe('ownerChannel.cancel (Design §6, "Cancel")', () => {
  it('cancels a queued entry through session.queue.remove and a pending steer through session.steer.cancel: unanswered', async () => {
    const t = await harness();
    const queued = t.ask('Queued?');
    const steered = t.ask('Steered?');
    t.sim.turn = true;
    const { entry } = await t.sim.queue.send(answerText('Queued?', 'yes'));
    t.report(queued, { disposition: 'queued', queueId: entry.queueId });
    const { messageUuid } = await t.sim.queue.steer(answerText('Steered?', 'yes'), { priority: 'next' });
    t.report(steered, { disposition: 'steered', messageUuid });
    expect(await t.service.cancel({ appSessionId: app, markId: queued })).toEqual({ outcome: 'cancelled' });
    expect(await t.service.cancel({ appSessionId: app, markId: steered })).toEqual({ outcome: 'cancelled' });
    expect(t.question(queued)).toEqual({ state: 'unanswered' });
    expect(t.question(steered)).toEqual({ state: 'unanswered' });
    expect(t.sim.commands.map((c) => c.name)).toEqual(expect.arrayContaining(['session.queue.remove', 'session.steer.cancel']));
    expect(await t.service.cancel({ appSessionId: app, markId: queued })).toEqual({ outcome: 'not_queued' });
  });

  it('a steer the engine already started, and an entry already submitting, answer already_delivering and stay queued for the lifecycle', async () => {
    const t = await harness();
    const steered = t.ask('Steered?');
    t.sim.turn = true;
    const { messageUuid } = await t.sim.queue.steer(answerText('Steered?', 'yes'), { priority: 'next' });
    t.report(steered, { disposition: 'steered', messageUuid });
    t.sim.holding = [];
    t.sim.engine(messageUuid, 'started'); // the host knows; main has not heard yet
    expect(await t.service.cancel({ appSessionId: app, markId: steered })).toEqual({ outcome: 'already_delivering' });
    expect(t.question(steered).state).toBe('queued');
    t.sim.release();
    expect(t.question(steered).state).toBe('delivered');

    const sent = t.ask('Sent?');
    t.sim.turn = false;
    await t.sim.turnEnded();
    const { entry, disposition } = await t.sim.queue.send(answerText('Sent?', 'yes'));
    expect(disposition).toBe('sent');
    t.report(sent, { disposition: 'sent', messageUuid: entry.messageUuid! });
    expect(await t.service.cancel({ appSessionId: app, markId: sent })).toEqual({ outcome: 'already_delivering' });
    expect(t.question(sent).state).toBe('queued');
  });

  it('a follow-up Reply to an answered question, cancelled, leaves it answered as it was', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const first = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    t.report(q, { disposition: 'sent', messageUuid: first.entry.messageUuid! });
    t.sim.engine(first.entry.messageUuid!, 'started');
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which backend?', 'Postgres') } });
    t.sim.turn = true;
    const followUp = await t.sim.queue.send(answerText('Which backend?', 'SQLite after all'));
    t.service.answered({ appSessionId: app, markId: q, origin: 'reply', text: answerText('Which backend?', 'SQLite after all'), disposition: 'queued', started: false, queueId: followUp.entry.queueId });
    expect(t.question(q)).toMatchObject({ state: 'queued', origin: 'reply' });
    expect(await t.service.cancel({ appSessionId: app, markId: q })).toEqual({ outcome: 'cancelled' });
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which backend?', 'Postgres') } });
    expect(t.items().some((i) => i.kind === 'async_input')).toBe(false);
  });

  it('the delivered answer is kept in the table beside a follow-up: a restart, then the follow-up\'s removal, reads the delivered answer again', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const first = await t.sim.queue.send(answerText('Which backend?', 'Postgres'));
    t.report(q, { disposition: 'sent', messageUuid: first.entry.messageUuid! });
    t.sim.engine(first.entry.messageUuid!, 'started');
    t.sim.turn = true;
    const followUp = await t.sim.queue.send(answerText('Which backend?', 'SQLite'));
    t.service.answered({ appSessionId: app, markId: q, origin: 'reply', text: answerText('Which backend?', 'SQLite'), disposition: 'queued', started: false, queueId: followUp.entry.queueId });
    await t.restart();
    await t.sim.queue.remove(followUp.entry.queueId);
    await t.service.hostStreaming();
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which backend?', 'Postgres'), origin: 'answer' } });
  });

  it('a failed command leaves the answer unchanged', async () => {
    const t = await harness();
    const q = t.ask('Queued?');
    t.sim.turn = true;
    const { entry } = await t.sim.queue.send(answerText('Queued?', 'yes'));
    t.report(q, { disposition: 'queued', queueId: entry.queueId });
    t.sim.failCommand = 'session.queue.remove';
    await expect(t.service.cancel({ appSessionId: app, markId: q })).rejects.toThrow('failed');
    expect(t.question(q)).toMatchObject({ state: 'queued', members: [{ kind: 'entry', id: entry.queueId, life: 'alive' }] });
  });
});

describe('legacy recognition (Design §6)', () => {
  it('a prompt the engine took that answers a unique head settles that question; two questions with one head are never settled by it', async () => {
    const t = await harness();
    const unique = t.ask('Which backend?');
    const twinA = t.ask('Which region?');
    const twinB = t.ask('Which region?');
    const { entry } = await t.sim.queue.send(`${answerText('Which backend?', 'SQLite')}\n${answerText('Which region?', 'eu')}`);
    expect(t.question(unique).state).toBe('unanswered'); // written, not taken
    t.sim.engine(entry.messageUuid!, 'started');
    expect(t.question(unique)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which backend?', 'SQLite'), origin: 'legacy' } });
    expect(t.question(twinA)).toEqual({ state: 'unanswered' });
    expect(t.question(twinB)).toEqual({ state: 'unanswered' });
  });

  it('a prompt that belongs to an answer is never read as a legacy answer to another question', async () => {
    const t = await harness();
    const asked = t.ask('Which backend?');
    const other = t.ask('Which region?');
    const text = answerText('Which backend?', `Postgres\n${answerText('Which region?', 'eu')}`);
    const { entry } = await t.sim.queue.send(text);
    t.report(asked, { disposition: 'sent', messageUuid: entry.messageUuid!, text });
    t.sim.engine(entry.messageUuid!, 'started');
    expect(t.question(asked)).toMatchObject({ state: 'delivered', answer: { origin: 'answer' } });
    expect(t.question(other)).toEqual({ state: 'unanswered' });
  });

  it.each(['live', 'restart'] as const)('an answer a newer one superseded is still its question\'s: followed to its end, its prompt is never a legacy answer to another question (%s)', async (via) => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const other = t.ask('Which region?');
    const old = answerText('Which backend?', `Postgres\n${answerText('Which region?', 'eu')}`);
    const sqlite = answerText('Which backend?', 'SQLite');
    t.sim.turn = true;
    const { messageUuid } = await t.sim.queue.steer(old, { priority: 'next' });
    t.report(q, { disposition: 'steered', messageUuid, text: old });
    await t.restart();
    t.sim.listening = false;
    let answer!: () => void;
    t.sim.cancelGate = new Promise<void>((r) => (answer = r));
    const holding = t.sim.queue.hold(messageUuid); // the hold row waits on the engine's answer
    await flush();
    loseRows(t.sim, (row) => (row.direction === 'meta' && row.frame.action === 'withdraw') || (row.direction === 'in' && row.frame.command_uuid === messageUuid));
    t.sim.historyComplete = false;
    t.sim.listening = true;
    await t.service.hostStreaming();
    expect(t.question(q).state).toBe('unconfirmed');
    const retry = await t.sim.queue.send(sqlite); // Answer again
    t.report(q, { disposition: 'queued', queueId: retry.entry.queueId, text: sqlite });
    const newer = await t.sim.queue.promote(retry.entry.queueId, { priority: 'next' });
    t.sim.engine(newer.messageUuid, 'started');
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: sqlite } });
    if (via === 'restart') {
      await t.restart();
      await t.service.hostStreaming();
    }
    answer();
    const held = await holding; // the old steer comes back as a held entry, then goes out and is taken
    const older = await t.sim.queue.promote(held.queueId, { priority: 'next' });
    t.sim.engine(older.messageUuid, 'started');
    expect(t.question(other)).toEqual({ state: 'unanswered' });
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: sqlite } }); // the newest taken answer stays the card's
  });

  it('a delivered answer a follow-up replaced keeps its prompt: read back from disk after a restart, it answers no other question', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    const other = t.ask('Which region?');
    const first = answerText('Which backend?', `Postgres\n${answerText('Which region?', 'eu')}`);
    t.sim.holding = [];
    const sent = await t.sim.queue.send(first);
    const written = t.sim.holding.find((e) => e.kind === 'user.message')!;
    t.sim.release();
    t.report(q, { disposition: 'sent', messageUuid: sent.entry.messageUuid!, text: first });
    t.sim.engine(sent.entry.messageUuid!, 'started');
    await t.sim.turnEnded([sent.entry.messageUuid!]);
    const followUp = await t.sim.queue.send(answerText('Which backend?', 'SQLite'));
    t.service.answered({ appSessionId: app, markId: q, origin: 'reply', text: answerText('Which backend?', 'SQLite'), disposition: 'sent', started: false, messageUuid: followUp.entry.messageUuid! });
    t.sim.engine(followUp.entry.messageUuid!, 'started');
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which backend?', 'SQLite'), origin: 'reply' } });
    await t.restart();
    await t.service.hostStreaming();
    t.service.onEvents(app, [{ ...written, seq: null } as SessionEvent]); // the transcript's record of the first answer
    expect(t.question(other)).toEqual({ state: 'unanswered' });
  });

  it('a question answered in a terminal (the prompt read back from disk) reads answered', async () => {
    const t = await harness();
    const q = t.ask('Which backend?');
    // the engine's own records of a terminal session (w1-steer-next-disk), its first prompt replaced by the answer and
    // its clock moved after the question
    const bytes = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'w1-steer-next-disk.jsonl'), 'utf8')
      .replaceAll('2026-10-01T', '2026-10-10T')
      .replace(/Count to 8 with separate Bash sleep 1 calls[^"]*/g, JSON.stringify(answerText('Which backend?', 'Postgres')).slice(1, -1));
    const events = await backfill(Buffer.from(bytes), '655f7a68-9781-4217-a02f-db29a972ac95');
    t.service.onEvents(app, events);
    expect(t.question(q)).toMatchObject({ state: 'delivered', answer: { text: answerText('Which backend?', 'Postgres'), origin: 'legacy' } });
  });
});

describe('marks and the attention projection (Design §5)', () => {
  const ESSENTIAL = '<essential>The key rotates tonight.</essential>';

  it('stores a live mark with its item, projects a question and an essential, and the notifier may announce them', async () => {
    const t = await harness();
    const uuid = t.sim.assistant([`Plan.\n${QUESTION('Which backend?')}\n${ESSENTIAL}`]);
    const q = markIdOf(app, 'need-input', { messageUuid: uuid, blockIndex: 0, span: 0 });
    const e = markIdOf(app, 'essential', { messageUuid: uuid, blockIndex: 0, span: 0 });
    const projection = t.projections.at(-1)!;
    expect(projection.items.map((i) => [i.id, i.kind, i.summary, i.anchor])).toEqual([
      [`${app}:async_input:${q}`, 'async_input', 'Question — Which backend?', { messageUuid: uuid, blockIndex: 0, span: 0 }],
      [`${app}:essential_unread:${e}`, 'essential_unread', 'Must read — The key rotates tonight.', { messageUuid: uuid, blockIndex: 0, span: 0 }],
    ]);
    expect(projection.silent).toEqual([]);
    expect(index.ownerChannel.marks(app).map((m) => [m.kind, m.live, m.item])).toEqual([['need-input', true, true], ['essential', true, true]]);
    t.service.markRead({ appSessionId: app, markIds: 'all' });
    expect(t.mark(e).essential).toMatchObject({ state: 'read' });
    expect(t.items().map((i) => i.kind)).toEqual(['async_input']);
  });

  it('only finalized main-thread text counts: no mark from an aborted block, from code, or twice from a replay', async () => {
    const t = await harness();
    t.sim.assistant(['`<need-input>quoted</need-input>` in code']);
    t.sim.assistant([QUESTION('Cut off?')], { aborted: true });
    const uuid = t.sim.assistant([QUESTION('Which backend?')]);
    const changes = t.states.length;
    // the same frames again (a resync burst or a replay re-delivers them): nothing changes
    t.service.onEvents(app, replayOf(t.sim));
    expect(t.states.length).toBe(changes);
    expect(index.ownerChannel.marks(app).map((m) => m.messageUuid)).toEqual([uuid]);
  });

  it('a mark before the watermark raises no item; a backfilled mark is stored, not live, and silent', async () => {
    const t = await harness();
    index.ownerChannel.recordLaunch(app, launch({ launchId: 'off', laneOn: false, desired: 'off', applied: 'off' })); // clears the watermark
    t.ask('Before?');
    expect(t.items()).toEqual([]);
    index.ownerChannel.recordLaunch(app, launch({ launchId: 'on', at: '2026-09-01T00:00:00.000Z' }));
    const events = await backfill(withMark(readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'w1-steer-next-disk.jsonl'), 'utf8')), '655f7a68-9781-4217-a02f-db29a972ac95');
    t.service.onEvents(app, events);
    const backfilled = index.ownerChannel.marks(app).filter((m) => m.head === 'From disk?');
    expect(backfilled.length).toBeGreaterThan(0);
    expect(backfilled.every((m) => !m.live && m.item)).toBe(true);
    const ids = backfilled.map((m) => `${app}:async_input:${m.id}`);
    expect(t.projections.at(-1)!.silent).toEqual(expect.arrayContaining(ids));
  });

  it('a foreign-held session: an essential item, silent, and no question item', async () => {
    const t = await harness();
    index.sessions.setHolder(SID, { kind: 'terminal', pid: 4242 });
    const uuid = t.sim.assistant([`${QUESTION('Which backend?')}\n${ESSENTIAL}`]);
    const projection = t.projections.at(-1)!;
    expect(projection.items.map((i) => i.kind)).toEqual(['essential_unread']);
    expect(projection.silent).toEqual([projection.items[0]!.id]);
    expect(index.ownerChannel.marks(app).every((m) => !m.live)).toBe(true);
    expect(uuid).toBeTruthy();
  });

  it('a change of holder re-projects silently; the lane off withdraws the items and keeps the marks', async () => {
    const t = await harness();
    t.ask('Which backend?');
    index.sessions.setHolder(SID, { kind: 'terminal', pid: 4242 });
    expect(t.projections.at(-1)!.items).toEqual([]);
    index.sessions.setHolder(SID, { kind: 'none' });
    expect(t.projections.at(-1)!.items.map((i) => i.kind)).toEqual(['async_input']);
    expect(t.projections.at(-1)!.silent).toEqual([t.projections.at(-1)!.items[0]!.id]);
    t.h.appEnabled = false;
    t.service.laneChanged();
    expect(t.projections.at(-1)!.items).toEqual([]);
    expect(index.ownerChannel.marks(app)).toHaveLength(1);
    expect(t.state().lane).toMatchObject({ on: false, override: 'inherit' });
  });

  it('a restart re-projects every item silently; a resync burst\'s mark written while main was away notifies once', async () => {
    const t = await harness();
    t.ask('Which backend?');
    await t.restart();
    const restored = t.projections.at(-1)!;
    expect(restored.items.map((i) => i.kind)).toEqual(['async_input']);
    expect(restored.silent).toEqual([restored.items[0]!.id]);
    t.sim.listening = false;
    t.sim.assistant(['<essential>Written while the app was closed.</essential>']);
    t.sim.listening = true;
    t.sim.resync(['assistant.block.complete']);
    const burst = t.projections.at(-1)!;
    const essential = burst.items.find((i) => i.kind === 'essential_unread')!;
    expect(burst.silent).not.toContain(essential.id);
    const count = t.projections.length;
    t.service.onEvents(app, [...t.sim.lost]); // nothing left to re-deliver
    expect(t.projections.length).toBe(count);
  });

  it('a superseding block, a retraction and a rewind each retire the marks of the messages they take away', async () => {
    const t = await harness();
    const refused = t.sim.assistant([QUESTION('Refused?')]);
    t.sim.assistant(['A replacement.'], { supersedes: [refused] });
    const retracted = t.sim.assistant([QUESTION('Retracted?')]);
    t.sim.row('in', { type: 'system', subtype: 'model_refusal_fallback', original_model: 'a', fallback_model: 'b', retracted_message_uuids: [retracted], session_id: SID, uuid: 'sys-1' });
    const { entry } = await t.sim.queue.send('Go on');
    t.sim.assistant([QUESTION('Rewound?')]);
    t.sim.row('out', { type: 'control_request', request_id: 'rw-1', request: { subtype: 'rewind_conversation', target_message_uuid: entry.messageUuid } });
    t.sim.row('in', { type: 'control_response', response: { subtype: 'success', request_id: 'rw-1', response: { rewound: true, targetMessageUuid: entry.messageUuid, prefillText: null, precedingAssistantUuid: retracted } } });
    const states = Object.fromEntries(index.ownerChannel.marks(app).map((m) => [m.head, m.state]));
    expect(states).toEqual({ 'Refused?': 'retired', 'Retracted?': 'retired', 'Rewound?': 'retired' });
    expect(t.items()).toEqual([]);
  });

  it('a rewind to a prompt this run never saw retires the marks the transcript\'s chain puts after it, though the kept assistant has no mark', async () => {
    const t = await harness();
    const kept = t.sim.assistant(['No mark here.']);
    const { entry } = await t.sim.queue.send('Continue');
    const q = t.ask('Which backend?');
    const before = t.ask('Earlier?'); // a mark the rewind keeps: its message is before the target on the chain (the chain decides, not the clock)
    const target = entry.messageUuid!;
    const record = (type: string, uuid: string, parentUuid: string | null) => JSON.stringify({ type, uuid, parentUuid, sessionId: SID });
    // the engine's chain: the other mark's message, the kept assistant, the target prompt, the question's message
    const messageOf = (id: MarkId) => index.ownerChannel.mark(id)!.messageUuid;
    appendFileSync(transcript, [record('assistant', messageOf(before), null), record('assistant', kept, messageOf(before)), record('user', target, kept), record('assistant', messageOf(q), target)].map((l) => `${l}\n`).join(''));
    await t.restart(); // this run never saw the target prompt
    t.sim.row('out', { type: 'control_request', request_id: 'rw-2', request: { subtype: 'rewind_conversation', target_message_uuid: target } });
    t.sim.row('in', { type: 'control_response', response: { subtype: 'success', request_id: 'rw-2', response: { rewound: true, targetMessageUuid: target, prefillText: null, precedingAssistantUuid: kept } } });
    await t.service.settled();
    expect(t.question(q)).toEqual({ state: 'retired' });
    expect(t.question(before)).toEqual({ state: 'unanswered' });
    expect(t.items().map((i) => i.summary)).toEqual(['Question — Earlier?']);
  });

  it('a live journal and its transcript yield the same mark ids', async () => {
    const t = await harness({ launch: false });
    // pass3/steer-next-disk-live is the live journal of the run whose transcript is w1-steer-next-disk; each main-thread
    // text block is given the same question on both sides, so the ids come from the engine's own uuids and indexes
    const live = new Normalizer({ appSessionId: app, launchId: 'live', sessionId: null });
    const liveEvents = loadJournal('pass3', 'steer-next-disk-live').flatMap((row) => live.push(row)).map(withQuestion);
    const diskEvents = (await backfill(Buffer.from(readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'w1-steer-next-disk.jsonl'))), '655f7a68-9781-4217-a02f-db29a972ac95')).map(withQuestion);
    t.service.onEvents(app, liveEvents);
    const fromLive = index.ownerChannel.marks(app).map((m) => m.id).sort();
    expect(fromLive.length).toBeGreaterThan(0);
    const other = index.sessions.upsertFromSummary(summary()).record.appId;
    t.service.onEvents(other, diskEvents);
    expect(index.ownerChannel.marks(other).map((m) => m.id.slice(other.length)).sort()).toEqual(fromLive.map((id) => id.slice(app.length)));
  });
});

// C4's backfill of a transcript, as `session.events` answers for a session no process holds.
async function backfill(bytes: Buffer, sessionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(bytes), sessionId as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}

// Every main-thread assistant text block, with a question appended.
function withQuestion(event: SessionEvent): SessionEvent {
  if (event.kind !== 'assistant.block.complete' || event.block.type !== 'text' || event.parentToolUseId !== null) return event;
  return { ...event, block: { ...event.block, text: `${String(event.block.text)}\n${QUESTION('Same?')}` } };
}

// The transcript with its first assistant text given a question (as an engine record would carry it).
function withMark(text: string): Buffer {
  return Buffer.from(text.replace(/("type":"text","text":")([^"]*)"/, (_m, open: string, body: string) => `${open}${body}\\n<need-input>From disk?</need-input>"`));
}

// The sim's last launch read again through a fresh normaliser: the same events with the same ids.
function replayOf(sim: OwnerHostSim): SessionEvent[] {
  const launch = sim.launches.at(-1)!;
  const normalizer = new Normalizer({ appSessionId: sim.appSessionId, launchId: launch.launchId, sessionId: sim.sessionId });
  return launch.rows.flatMap((row) => normalizer.push(row));
}
