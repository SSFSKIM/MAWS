// The live wire asks the arrivals reader (UX wave U3, first landing; docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md,
// M4, Interfaces C and E, decisions 7, 8 and 21). A session MAWS runs, mapped from its journal through `Normalizer`: a
// background task's end is kept from its `system/task_notification` frame until the model is told, its line placed at
// the turn the engine opens, settled by the result that names its run, withdrawn when it does not, and given up at the
// next idle after a turn that did not name it. Each transition is pinned on the probes' recorded sessions
// (spikes/protocol-probe/fixtures/uxwave/); rows written by hand are invented.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { describe, expect, it } from 'vitest';
import { carriedOf, consentMessage } from '@shared/engine/arrival';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../test/support/fixtures';
import { rowsOf, withAllExpanded } from '../renderer/src/transcript/model/derive';
import { applyEvents, createState, type TranscriptState } from '../renderer/src/transcript/model/reduce';
import type { Row } from '../renderer/src/transcript/model/rows';
import { Normalizer } from './normalizer';

const APP = 'app-u3' as AppSessionId;
const normalizer = (launchId = 'L1') => new Normalizer({ appSessionId: APP, launchId, sessionId: null });

/** A journal's events through a fresh normaliser, each valid X1. */
function live(rows: JournalRow[], launchId?: string): SessionEvent[] {
  const n = normalizer(launchId);
  const events = rows.flatMap((row) => n.push(row));
  for (const event of events) SessionEventSchema.parse(event);
  return events;
}

const frameAt = (rows: JournalRow[], seq: number) => rows.find((row) => row.seq === seq)!.frame as Record<string, unknown>;
type Message = Extract<SessionEvent, { kind: 'user.message' }>;
const carriers = (events: SessionEvent[]) => events.filter((event): event is Message => event.kind === 'user.message' && event.arrival !== undefined);
/** Each placing and withdrawal of the line under one uuid, by the seq of the row that made it. */
const trail = (events: SessionEvent[], uuid: unknown) => carriers(events).filter((event) => event.messageUuid === uuid).map((event) => `${event.seq} ${carriedOf(event.arrival).length > 0 ? 'placed' : 'withdrawn'}`);
/** A line the host made itself: no frame carried its text (Interfaces C). */
const hostMade = (event: Message) => event.content === '';

const stateOf = (events: SessionEvent[]): TranscriptState => applyEvents(createState(null, null), events);
const drawn = (state: TranscriptState): Row[] => rowsOf(withAllExpanded(state));
const notices = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'notice' ? [`${row.class}${row.outcome === null ? '' : ` ${row.outcome}`}: ${row.text}`] : []));
const turnsOf = (state: TranscriptState) => state.order.map((id) => state.turns.get(id)!);

const r1 = loadUxwaveJournal('u3-tasks-r1');
const r1Events = live(r1);

describe('a background task’s end is kept until the model is told (Interfaces E)', () => {
  it('u3-tasks-r1: kept at seq 58 and placed at the turn the engine opens at 61, at its head; settled by the result at 118, which names its run', () => {
    const uuid = frameAt(r1, 58).uuid;
    expect(trail(r1Events, uuid)).toEqual(['61 placed']);
    const atInit = r1Events.filter((event) => event.seq === 61).map((event) => event.kind);
    expect(atInit.slice(0, 3)).toEqual(['session.init', 'turn.started', 'user.message']);
    expect(carriers(r1Events).find((event) => event.messageUuid === uuid)).toMatchObject({
      isSynthetic: true, origin: 'task-notification', content: '', bash: null,
      arrival: [{ class: 'task', taskId: 'bky1j6v31', runId: '0mwdo00bz-9f5454ae', outcome: 'completed', summary: 'Background command "uxw ok" completed (exit code 0)', durationMs: null, detail: null }],
    });
  });

  it('u3-tasks-r1: an end told during the person’s turn (148) is kept across it and placed at the engine’s turn after it (159)', () => {
    expect(trail(r1Events, frameAt(r1, 148).uuid)).toEqual(['159 placed']);
  });

  it('u3-tasks-r1: an end the frame replayed at a tool boundary told (578) is spent there: never placed, its line the frame’s own', () => {
    expect(trail(r1Events, frameAt(r1, 559).uuid)).toEqual([]);
    const told = carriers(r1Events).filter((event) => event.seq === 578);
    expect(told).toMatchObject([{ messageUuid: frameAt(r1, 578).uuid, isSynthetic: true, origin: 'task-notification', arrival: [{ class: 'task', outcome: 'failed', runId: '0mwdo5gh5-47bafe76' }] }]);
  });

  it('u3-tasks-r1: the stopped task’s frame (216) is never kept; its end is the frame replayed with the person’s next prompt (228)', () => {
    expect(trail(r1Events, frameAt(r1, 216).uuid)).toEqual([]);
    expect(carriers(r1Events).filter((event) => event.seq === 228)).toMatchObject([{ arrival: [{ class: 'task', outcome: 'stopped', runId: '0mwdo1wz6-1b311c22' }] }]);
  });

  it('u3-tasks-r1: a monitor’s end kept at 743 is placed at 753, withdrawn at 762, placed again at 763 and settled at 780', () => {
    const uuid = frameAt(r1, 743).uuid;
    expect(trail(r1Events, uuid)).toEqual(['753 placed', '762 withdrawn', '763 placed']);
    // the withdrawal is the result's first event, before its turn.ended
    expect(r1Events.filter((event) => event.seq === 762).map((event) => event.kind)).toEqual(['user.message', 'turn.ended', 'usage.sample']);
  });

  it('u3-tasks-r1: only a background command’s or monitor’s end is kept: no line is placed for a foreground command, an agent or a stopped task', () => {
    const placed = new Set(carriers(r1Events).filter(hostMade).map((event) => event.messageUuid));
    expect(placed).toEqual(new Set([58, 148, 743].map((seq) => frameAt(r1, seq).uuid)));
  });

  it('u3-tasks-r2: a monitor’s end kept across two turns that are not its own is placed and withdrawn twice before the result at 624 settles it', () => {
    const r2 = loadUxwaveJournal('u3-tasks-r2');
    const events = live(r2);
    expect(trail(events, frameAt(r2, 580).uuid)).toEqual(['590 placed', '599 withdrawn', '600 placed', '609 withdrawn', '610 placed']);
    expect(carriers(events).filter((event) => event.seq === 624)).toEqual([]);
  });

  it('u3-cron-r1: the fire at seq 70 is drawn at the init at 71, under its command’s uuid, and its turn’s end, which has no origin, leaves the turn the engine’s', () => {
    const cron = loadUxwaveJournal('u3-cron-r1');
    const events = live(cron);
    expect(events.filter((event) => event.seq === 71).map((event) => event.kind).slice(0, 3)).toEqual(['session.init', 'turn.started', 'user.message']);
    const fire = carriers(events).find((event) => event.seq === 71)!;
    expect(fire).toMatchObject({ messageUuid: frameAt(cron, 70).command_uuid, content: '', isSynthetic: true, origin: 'task-notification', arrival: [{ class: 'schedule', prompt: null }] });
    const turn = turnsOf(stateOf(events)).find((candidate) => candidate.events.some((event) => event.id === fire.id))!;
    expect(turn).toMatchObject({ origin: 'engine', state: 'closed' });
  });

  // Written by hand (invented): a background command ends during the person's turn, an engine turn opens that does not
  // name it, the engine goes idle, and a later engine turn opens
  it('a kept end no turn names is given up at the next idle after a turn that did not name it, and stands on no turn', () => {
    const rows = handWritten([
      out(prompt('u-1')), inn(started('u-1')), inn(init), inn(bgStarted), inn(bgEnded), inn(result({ origin: { kind: 'human' }, user_message_uuids: ['u-1'] })), inn(idleFrame),
      inn(init), inn(result({ origin: { kind: 'task-notification' }, user_message_uuids: [] })), inn(idleFrame),
      inn(init), inn(result({ origin: { kind: 'task-notification' }, user_message_uuids: [] })),
    ]);
    const events = live(rows);
    expect(trail(events, 'f-ended')).toEqual(['8 placed', '9 withdrawn']);
    expect(notices(drawn(stateOf(events)))).toEqual([]);
  });

  // The recorded session with an idle written in (invented) while the monitor's line stands: the stream's message_stop
  // before the result is replaced by it. Idle never gives up the end whose line stands; the result settles or
  // withdraws that line as it would with no idle
  const idleAt = (seq: number) => r1.map((row) => (row.seq === seq ? { ...row, frame: { ...idleFrame, uuid: `st-${seq}` } } : row));

  it('u3-tasks-r1 with an idle at 761, while the monitor’s line placed at 753 stands: the result at 762, which does not name it, still withdraws it, and the turn at 763 places it again', () => {
    expect(frameAt(r1, 761).type).toBe('stream_event');
    const events = live(idleAt(761));
    expect(trail(events, frameAt(r1, 743).uuid)).toEqual(['753 placed', '762 withdrawn', '763 placed']);
    expect(drawn(stateOf(events)).filter((row) => row.id === 'notice:0mwdo8jdn-29730c86')).toHaveLength(1);
    const [closed] = turnsOf(stateOf(events)).filter((turn) => turn.events.some((event) => event.seq === 762));
    expect(closed!.events.some((event) => event.kind === 'user.message' && event.messageUuid === frameAt(r1, 743).uuid && carriedOf(event.arrival).length > 0)).toBe(false);
  });

  it('u3-tasks-r1 with an idle at 779, while the line placed at 763 stands: the result at 780, which names its run, settles it, and nothing of it is kept after', () => {
    expect(frameAt(r1, 779).type).toBe('stream_event');
    const n = normalizer();
    const events = idleAt(779).flatMap((row) => n.push(row));
    expect(trail(events, frameAt(r1, 743).uuid)).toEqual(['753 placed', '762 withdrawn', '763 placed']);
    expect(drawn(stateOf(events)).filter((row) => row.id === 'notice:0mwdo8jdn-29730c86')).toHaveLength(1);
    expect(n.state.arrivals).toMatchObject({ kept: [], placed: null });
  });

  // Written by hand (invented): no recorded session has a peer's or the owner's message arrive with no turn open and no
  // init before it (all 575 journals under spikes/protocol-probe/fixtures/ read through the normaliser), so this row of
  // Interfaces E is a guard. An end kept during the person's turn is outstanding when the message opens its own turn;
  // the next idle bounds by that turn, so the end is given up there and no later engine turn places it
  it.each([
    ['a peer’s', 'session:0demo0a1'],
    ['the owner’s', 'human'],
  ] as const)('%s message with no turn open opens its turn, and the idle after it gives up the end kept before it', (_, name) => {
    const body = `[sminos message from ${name} id=0d0e0f01]\nCheck the demo job.`;
    const delivered = {
      type: 'user', message: { role: 'user', content: `Another Claude session sent a message:\n<cross-session-message from-name="${name}">\n${body}\n</cross-session-message>\n\nThis came from another Claude session.` },
      parent_tool_use_id: null, uuid: 'p-demo', isReplay: true, isSynthetic: true, origin: { kind: 'peer', from: 'unknown', name, body },
    };
    const rows = handWritten([
      out(prompt('u-1')), inn(started('u-1')), inn(init), inn(bgStarted), inn(bgEnded), inn(result({ origin: { kind: 'human' }, user_message_uuids: ['u-1'] })), inn(idleFrame),
      inn(delivered), inn(said('m-2', 'Checked.')), inn(result({ origin: delivered.origin })), inn(idleFrame),
      inn(init), inn(result({ origin: { kind: 'task-notification' }, user_message_uuids: [] })),
    ]);
    const events = live(rows);
    expect(events.filter((event) => event.seq === 8).map((event) => event.kind)[0]).toBe('turn.started');
    expect(trail(events, 'f-ended')).toEqual([]);
    expect(notices(drawn(stateOf(events)))).toEqual([]);
  });

  // Interfaces E's invariant (decision 8 as revised): under one uuid the first carrier stands, so a line is withdrawn
  // before it is placed again
  it('in every recorded session: a line is withdrawn before it is placed again, at most one host-made line stands on a turn, and only on a turn the engine opened', () => {
    const journals = readdirSync(join(FIXTURE_DIR, 'uxwave')).filter((name) => /^u3-.*\.jsonl$/.test(name) && !name.endsWith('.transcript.jsonl')).map((name) => name.slice(0, -'.jsonl'.length));
    expect(journals.length).toBeGreaterThan(10);
    for (const name of journals) {
      const standing = new Set<unknown>();
      let lastTurn: string | null = null;
      let onTurn = 0;
      for (const event of live(loadUxwaveJournal(name))) {
        if (event.kind === 'turn.started' && event.parentToolUseId === null) [lastTurn, onTurn] = [event.origin, 0];
        if (event.kind !== 'user.message' || event.arrival === undefined) continue;
        if (carriedOf(event.arrival).length === 0) {
          expect(standing.has(event.messageUuid), `${name} ${event.seq}: a withdrawal of a line that stands`).toBe(true);
          standing.delete(event.messageUuid);
          if (hostMade(event)) onTurn -= 1;
          continue;
        }
        expect(standing.has(event.messageUuid), `${name} ${event.seq}: placed again with no withdrawal`).toBe(false);
        standing.add(event.messageUuid);
        if (!hostMade(event)) continue;
        onTurn += 1;
        expect(onTurn, `${name} ${event.seq}: lines the host made on one turn`).toBeLessThanOrEqual(1);
        expect(lastTurn, `${name} ${event.seq}: the turn it stands on`).toBe('engine');
      }
    }
  });
});

describe('a provisional line does not outlive its launch (decision 21)', () => {
  const monitorEnd = 'notice:0mwdo8jdn-29730c86';
  const cut = r1.filter((row) => row.seq <= 758); // the monitor's end kept at 743 and placed at 753; its result at 762 not reached
  const exitRow: JournalRow = { seq: 759, direction: 'meta', at: '2026-11-12T14:57:20.000Z', frame: { event: 'exit', code: 0, signal: null } };
  const ids = (state: TranscriptState) => drawn(state).map((row) => row.id);
  const secondLaunch = () => live(handWritten([out(prompt('u-9')), inn(started('u-9')), inn(init), inn(said('m-9', 'OK')), inn(result({ origin: { kind: 'human' }, user_message_uuids: ['u-9'] }))]), 'L2');

  it('u3-tasks-r1 cut after seq 758 and ended by its exit row: the line is withdrawn before process.exited, and no notice stands on that turn at each step, on a fresh replay, or with a second launch after it', () => {
    const n = normalizer();
    let state = createState(null, null);
    for (const row of cut) state = applyEvents(state, n.push(row));
    expect(ids(state)).toContain(monitorEnd); // placed, waiting for its turn's result
    const atExit = n.push(exitRow);
    expect(atExit.map((event) => event.kind)).toEqual(['user.message', 'process.exited']);
    expect(atExit[0]).toMatchObject({ messageUuid: frameAt(r1, 743).uuid, arrival: [] });
    state = applyEvents(state, atExit);
    expect(ids(state)).not.toContain(monitorEnd);
    const replayed = live([...cut, exitRow]);
    expect(ids(stateOf(replayed))).not.toContain(monitorEnd);
    expect(ids(stateOf([...replayed, ...secondLaunch()]))).not.toContain(monitorEnd);
  });

  it('the same cut journal with no exit row, closed by the model at a synthesised exit, draws none either', () => {
    const events = live(cut);
    const exited: SessionEvent = { id: 'synthesised:exit' as EventId, sessionId: events.at(-1)!.sessionId, at: '2026-11-12T14:57:20.000Z', seq: null, agentId: null, parentToolUseId: null, kind: 'process.exited', code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null };
    expect(ids(stateOf(events))).toContain(monitorEnd);
    expect(ids(stateOf([...events, exited]))).not.toContain(monitorEnd);
    expect(ids(stateOf([...events, exited, ...secondLaunch()]))).not.toContain(monitorEnd);
  });
});

describe('a journal replayed gives the same events', () => {
  it('twice through fresh normalisers, and through a state restored from a checkpoint while a line is placed', () => {
    expect(live(r1)).toEqual(r1Events);
    const n = normalizer();
    const before = r1.filter((row) => row.seq <= 758).flatMap((row) => n.push(row));
    const restored = new Normalizer({ appSessionId: APP, launchId: 'L1', sessionId: null, state: deserialize(serialize(n.state)) as Normalizer['state'] });
    const after = r1.filter((row) => row.seq > 758).flatMap((row) => restored.push(row));
    expect([...before, ...after]).toEqual(r1Events);
  });
});

describe('a turn’s origin, twice (pitfall 5)', () => {
  it('u3-tasks-r1: a hand-back’s turn ends as the engine’s (“Continued for”), and the empty turn the engine reports after it is no turn', () => {
    expect(r1Events.find((event) => event.kind === 'turn.ended' && event.seq === 354)).toMatchObject({ origin: 'engine' });
    const state = stateOf(r1Events);
    const handback = turnsOf(state).find((turn) => turn.events.some((event) => event.seq === 337))!;
    expect(handback.origin).toBe('engine');
    expect(turnsOf(state).some((turn) => turn.events.some((event) => event.seq === 356 && event.kind === 'turn.ended'))).toBe(false);
  });

  it('u3-sminos-r1-maws: the owner’s inbox send while idle is one turn, the person’s, with no empty turn before it; a peer’s message while idle is a peer’s turn', () => {
    const journal = loadUxwaveJournal('u3-sminos-r1-maws');
    const events = live(journal);
    expect(events.filter((event) => event.seq === 54).map((event) => event.kind)).toEqual(['turn.started', 'user.message']);
    expect(events.find((event) => event.kind === 'turn.ended' && event.seq === 91)).toMatchObject({ origin: 'human' });
    expect(events.find((event) => event.kind === 'turn.ended' && event.seq === 233)).toMatchObject({ origin: 'peer' });
    const turns = turnsOf(stateOf(events));
    const own = turns.findIndex((turn) => turn.events.some((event) => event.kind === 'user.message' && event.content === 'UXW owner idle: reply with only the word ONE.'));
    expect(turns[own]).toMatchObject({ origin: 'human', state: 'closed' });
    expect(turns[own - 1]!.events.some((event) => event.kind === 'user.message' && event.content === 'Without using any tool, reply with only the word READY.')).toBe(true); // the turn before it is the person's last
    expect(turns.find((turn) => turn.events.some((event) => event.seq === 100))).toMatchObject({ origin: 'peer' });
  });
});

// The whole-branch review's finding 4: a second arrival at the head of the turn the engine opened joins the turn the
// first one opened, in both branches that open one (a peer's delivery and the owner's own): one engine init, reply and
// result is one turn. The recorded session with a second delivery (invented words) written in directly after the first,
// before the model's first block; the rows after it move one seq on.
// The whole-branch review's finding 2: a gap's reseed (`meta transcript_reseed`) reads the transcript's rows with what
// the live reader already knows, so a completion a hand-back claimed on the live wire is not told a second time.
describe('a reseed reads on from what the live wire told', () => {
  it('u3-tasks-r1 through the hand-back at seq 337, then the notification it claimed (transcript line 114) by a reseed: its task ends, and no turn and no second completion is drawn', () => {
    const n = normalizer();
    const before = r1.filter((row) => row.seq <= 337).flatMap((row) => n.push(row));
    expect(n.state.arrivals.open.handbacks.has('a91c8f61a920a8733')).toBe(true); // the hand-back claims its task's next notification
    const claimed = JSON.parse(readFileSync(join(FIXTURE_DIR, 'uxwave', 'u3-tasks-r1.transcript.jsonl'), 'utf8').split('\n')[113]!) as Record<string, unknown>;
    expect(claimed).toMatchObject({ queueTranscriptOnly: true, origin: { kind: 'task-notification' } });
    const reseeded = n.push({ seq: 338, direction: 'meta', at: '2026-11-12T14:53:00.000Z', frame: { event: 'transcript_reseed', rows: [claimed] } });
    expect(reseeded.map((event) => event.kind)).toEqual(['task.notification']);
    expect(reseeded[0]).toMatchObject({ taskId: 'a91c8f61a920a8733', status: 'completed' });
    const rows = drawn(stateOf([...before, ...reseeded]));
    expect(rows.filter((row) => row.kind === 'agent_message' && row.text.startsWith('Report from uxw agent'))).toHaveLength(1);
    expect(notices(rows).filter((line) => line.includes('Agent "uxw agent" finished'))).toEqual([]);
  });
});

describe('a second arrival at the head of the engine’s turn joins the turn the first opened', () => {
  const journal = loadUxwaveJournal('u3-sminos-r1-maws');
  const withSecond = (seq: number, from: string, to: string, uuid: string): JournalRow[] => {
    const second = JSON.parse(JSON.stringify(frameAt(journal, seq)).split(from).join(to)) as Record<string, unknown>;
    expect(JSON.stringify(second)).toContain(to);
    return journal.flatMap((row) => (row.seq < seq ? [row] : row.seq === seq ? [row, { ...row, seq: seq + 1, frame: { ...second, uuid } }] : [{ ...row, seq: row.seq + 1 }]));
  };
  const holding = (state: TranscriptState, seqs: number[]) => turnsOf(state).filter((turn) => turn.events.some((event) => event.kind === 'user.message' && seqs.includes(event.seq!)));

  it('u3-sminos-r1-maws with a second peer’s message after seq 100: one turn, a peer’s, holds both lines', () => {
    const rows = withSecond(100, 'id=8f775ba5]\\nUXW peer idle: reply with only the word TWO.', 'id=8f775ba6]\\nUXW peer idle: then add the word THREE.', 'c7b77db4-0000-4000-8000-0000000000b2');
    const events = live(rows);
    expect(events.filter((event) => event.seq === 101).map((event) => event.kind)).toEqual(['user.message', 'peer.message']);
    const state = stateOf(events);
    const turns = holding(state, [100, 101]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ origin: 'peer', state: 'closed' });
    const lines = drawn(state).filter((row) => row.turnId === turns[0]!.id && row.kind === 'agent_message').map((row) => (row.kind === 'agent_message' ? row.text : ''));
    expect(lines).toEqual([expect.stringContaining('reply with only the word TWO.'), expect.stringContaining('then add the word THREE.')]);
  });

  it('u3-sminos-r1-maws with a second send of the owner’s after seq 54: one turn, the person’s, holds both, the second taken into it', () => {
    const rows = withSecond(54, 'id=328cfd59]\\nUXW owner idle: reply with only the word ONE.', 'id=328cfd5a]\\nUXW owner idle: and the word TWO after it.', '5c14a56c-0000-4000-8000-0000000000b2');
    const events = live(rows);
    expect(events.filter((event) => event.seq === 55).map((event) => event.kind)).toEqual(['user.message', 'command.lifecycle']);
    const state = stateOf(events);
    const turns = holding(state, [54, 55]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ origin: 'human', state: 'closed' });
    const users = drawn(state).filter((row) => row.turnId === turns[0]!.id && row.kind === 'user').map((row) => (row.kind === 'user' ? `${row.steer ? 'steer' : 'prompt'}: ${row.text}` : ''));
    expect(users).toEqual(['prompt: UXW owner idle: reply with only the word ONE.', 'steer: UXW owner idle: and the word TWO after it.']);
  });
});

describe('where each class is read (M4)', () => {
  it('u3-commands-r1: a command’s output frame is the command’s output, never the model’s answer; one sent again under its uuid emits nothing', () => {
    const events = live(loadUxwaveJournal('u3-commands-r1'));
    expect(events.filter((event) => event.kind === 'assistant.block.complete' && event.parentToolUseId === null && event.model === '<synthetic>')).toEqual([]);
    const outputs = events.filter((event): event is Message => event.kind === 'user.message' && event.origin === 'local-command');
    expect(outputs.filter((event) => event.content === '<local-command-stdout>Compaction canceled.</local-command-stdout>').map((event) => event.seq)).toEqual([406]);
    expect(outputs.find((event) => event.seq === 28)).toMatchObject({ content: '<local-command-stderr>Error: No messages to compact</local-command-stderr>', isSynthetic: false });
  });

  it('MAWS’s own consent message carries its arrival on the person’s message; the same sentence with one word changed carries none', () => {
    const sentence = consentMessage('command', 'npm run deploy:demo');
    const events = live(handWritten([out(prompt('u-1', sentence)), out(prompt('u-2', sentence.replace('exact', 'whole')))]));
    expect(events).toMatchObject([{ kind: 'user.message', origin: 'human', isSynthetic: false, arrival: [{ class: 'consent', kind: 'command', subject: 'npm run deploy:demo' }] }, { kind: 'user.message', origin: 'human' }]);
    expect(events[1]).not.toHaveProperty('arrival');
  });

  it('u3-tasks-r1: the notification a hand-back claimed at one tool boundary (667, after 666) emits nothing; the hand-back is its line', () => {
    expect(r1Events.filter((event) => event.seq === 667)).toEqual([]);
    expect(r1Events.filter((event) => event.seq === 666).map((event) => event.kind)).toEqual(['user.message', 'subagent.message']);
    expect(r1Events.find((event) => event.seq === 666)).toMatchObject({ isSynthetic: true, origin: 'peer' });
  });

  // The replayed frames of a notification, a hand-back and a peer's message exist only because MAWS launches the engine
  // with --replay-user-messages (launch.ts); the bare launches show the wire without it (findings-uxwave-u3-tasks.txt,
  // -commands.txt). What other frames carry stays: a background command's end told while idle (`system/task_notification`),
  // a command's output frame, and the "Compacted" frame, which the engine sends without the flag too.
  it('the bare launches: nothing is an error, no message line is drawn, and what the other frames carry still draws', () => {
    for (const name of ['u3-tasks-bare', 'u3-commands-bare']) {
      const events = live(loadUxwaveJournal(name));
      expect(events.filter((event) => event.kind === 'error.raised' || event.kind === 'frame.unknown'), name).toEqual([]);
      expect(drawn(stateOf(events)).some((row) => row.kind === 'agent_message'), name).toBe(false);
    }
    expect(notices(drawn(stateOf(live(loadUxwaveJournal('u3-tasks-bare')))))).toEqual(['task failed: Background command "uxw fail" failed with exit code 1']);
    const outputs = drawn(stateOf(live(loadUxwaveJournal('u3-commands-bare')))).flatMap((row) => (row.kind === 'local_command' ? [row.text.split('\n', 1)[0]] : []));
    expect(outputs).toEqual(['Error: No messages to compact', 'Total cost:            $0.0013', 'Session renamed to: uxw renamed', 'Compaction canceled.', 'Compacted']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Rows written by hand, in the shapes the recorded frames have, with invented values

function handWritten(rows: { direction: JournalRow['direction']; frame: unknown }[]): JournalRow[] {
  return rows.map((row, i) => ({ seq: i + 1, direction: row.direction, at: `2026-11-12T10:00:${String(i).padStart(2, '0')}.000Z`, frame: row.frame }));
}
const inn = (frame: unknown) => ({ direction: 'in' as const, frame });
const out = (frame: unknown) => ({ direction: 'out' as const, frame });
const prompt = (uuid: string, content = 'Start the demo job.') => ({ type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' } });
const started = (uuid: string) => ({ type: 'command_lifecycle', command_uuid: uuid, state: 'started', uuid: `s-${uuid}`, session_id: 'sess-demo' });
const init = {
  type: 'system', subtype: 'init', cwd: '/tmp/demo', session_id: 'sess-demo', tools: ['Bash'], mcp_servers: [], model: 'claude-demo', permissionMode: 'default',
  slash_commands: [], claude_code_version: '2.1.322', output_style: 'default', uuid: 'i-demo',
};
const idleFrame = { type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'st-demo', session_id: 'sess-demo' };
const bgStarted = { type: 'system', subtype: 'task_started', task_id: 'bdemo0001', run_id: 'run-demo-1', tool_use_id: 'toolu_demo1', description: 'demo sleep', is_backgrounded: true, task_type: 'local_bash', uuid: 'f-started', session_id: 'sess-demo' };
const bgEnded = {
  type: 'system', subtype: 'task_notification', task_id: 'bdemo0001', run_id: 'run-demo-1', tool_use_id: 'toolu_demo1', status: 'completed', output_file: '/tmp/demo/bdemo0001.output',
  summary: 'Background command "demo sleep" completed (exit code 0)', uuid: 'f-ended', session_id: 'sess-demo',
};
const said = (id: string, text: string) => ({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model: 'claude-demo', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null, uuid: `a-${id}`, session_id: 'sess-demo' });
const result = (extra: Record<string, unknown>) => ({
  type: 'result', subtype: 'success', session_id: 'sess-demo', is_error: false, duration_ms: 10, duration_api_ms: 8, num_turns: 1, total_cost_usd: 0.01,
  usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, permission_denials: [], result: 'OK', terminal_reason: 'completed', uuid: 'r-demo', ...extra,
});
