// UX wave U4a (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, M1; Interfaces B; decisions 32 and 34): what
// the normaliser makes of a message sent now, over the three probe passes' recorded sessions
// (spikes/protocol-probe/fixtures/uxwave/u4p1-*, u4p2-*, u4p3-*). An end is marked `endedForMessage` by what the frames
// show, never by an interrupt having been asked; several waiting messages the engine writes as one are forwarded as
// that one message, with `joined`; a replay that is an echo of the host's own frame emits nothing.
import { describe, expect, it } from 'vitest';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { consentMessage } from '@shared/engine/arrival';
import { loadUxwaveJournal } from '../../test/support/fixtures';
import { Normalizer } from './normalizer';

type Message = Extract<SessionEvent, { kind: 'user.message' }>;

/** A journal's events through a fresh normaliser, each valid X1. */
function live(rows: JournalRow[]): SessionEvent[] {
  const n = new Normalizer({ appSessionId: 'app-u4' as AppSessionId, launchId: 'L1', sessionId: null });
  const events = rows.flatMap((row) => n.push(row));
  for (const event of events) SessionEventSchema.parse(event);
  return events;
}

const eventsOf = new Map<string, SessionEvent[]>();
const events = (name: string): SessionEvent[] => {
  if (!eventsOf.has(name)) eventsOf.set(name, live(loadUxwaveJournal(name)));
  return eventsOf.get(name)!;
};
/** The main lane's `turn.ended` at the `result` row's seq. */
const endAt = (name: string, seq: number) => {
  const end = events(name).find((event) => event.kind === 'turn.ended' && event.seq === seq && event.parentToolUseId === null);
  expect(end, `${name}: no turn.ended at seq ${seq}`).toBeDefined();
  return end as Extract<SessionEvent, { kind: 'turn.ended' }>;
};
const uuidAt = (name: string, seq: number) => (loadUxwaveJournal(name).find((row) => row.seq === seq)!.frame as { uuid: MessageUuid }).uuid;
const humanMessages = (name: string, seq: number) => events(name).filter((event): event is Message => event.kind === 'user.message' && event.seq === seq && event.origin === 'human');

describe('a marked end: the turn a sent-now message ended (Interfaces B)', () => {
  // [fixture, the result's seq, marked], the three tables of Interfaces B
  const cases: [string, number, boolean][] = [
    // the first pass
    ['u4p1-a-seeded-1', 46, true], // send-now behind a command: success, aborted_tools
    ['u4p1-c-seeded-1', 134, true], // send-now while the model writes: error_during_execution, aborted_streaming
    ['u4p1-d-seeded-1', 45, true], // a permission request pending
    ['u4p1-f-seeded-1', 46, true], // a `now` frame
    ['u4p1-f-text-seeded-1', 103, true],
    ['u4p1-c0-seeded-1', 140, false], // a Stop
    ['u4p1-s0-seeded-1', 43, false],
    ['u4p1-h-seeded-2', 45, true], // the send-now's end
    ['u4p1-h-seeded-2', 61, false], // then a Stop after the sent message had started
    // the second, under MAWS's launch environment
    ['u4p2-a-1', 47, true],
    ['u4p2-two-1-1', 51, true], // two messages at the next step
    ['u4p2-two-2-1', 78, true],
    ['u4p2-k-text-1', 133, true], // error_during_execution, aborted_streaming, no plain interrupt written
    ['u4p2-k-perm-1', 48, true],
    ['u4p2-k-hook-1', 46, true],
    ['u4p2-k-mcp-1', 132, false], // an MCP call moved, the message read in the same turn: completed
    ['u4p2-n-never-1', 55, false], // nothing waiting
    ['u4p2-n-dropped-1', 61, false],
    ['u4p2-n-started-1', 144, false],
    ['u4p2-stop-inflight-hold-1', 51, false], // the Stop square before the move, after the message's `cancelled` at 44
    ['u4p2-stop-after-hold-1', 51, false],
    ['u4p2-stop-moved-hold-1', 54, false], // the square after the move: success, aborted_tools, after the `cancelled` at 48
    ['u4p2-stop-inflight-1', 48, false], // a plain interrupt that holds nothing, before the move
    ['u4p2-stop-after-1', 47, false],
    ['u4p2-stop-moved-1', 52, true], // the same after the move: the end is the Send now's
    ['u4p2-old-1', 83, true], // engine 2.1.283 takes the request for a plain interrupt
    // the third
    ['u4p3-end2-1', 677, false], // a turn's ordinary end with messages waiting
    ['u4p3-end3-1', 507, false],
    ['u4p3-promote-late-1', 49, true], // a `now` frame once the shell call is a task
    ['u4p3-promote-1', 46, true], // a `now` frame before that: the command ran to its own end first
    ['u4p3-mirror-1', 47, true], // the request at that same early moment
  ];

  it.each(cases)('%s: the end at seq %i is marked: %s', (name, seq, marked) => {
    const end = endAt(name, seq);
    if (marked) expect(end.endedForMessage).toBe(true);
    else expect(end).not.toHaveProperty('endedForMessage');
  });

  it('marks nothing else: every other end of every case reads as today', () => {
    const marked = new Set(cases.filter(([, , m]) => m).map(([name, seq]) => `${name}:${seq}`));
    for (const name of new Set(cases.map(([n]) => n))) {
      const ends = events(name).filter((event): event is Extract<SessionEvent, { kind: 'turn.ended' }> => event.kind === 'turn.ended' && event.endedForMessage === true);
      for (const end of ends) expect(marked.has(`${name}:${end.seq}`), `${name}:${end.seq}`).toBe(true);
    }
  });

  it('marks an end only when it is aborted: the same-turn and nothing-waiting cases end completed, unmarked', () => {
    for (const [name, seq] of [['u4p2-k-mcp-1', 132], ['u4p2-n-never-1', 55]] as const) expect(endAt(name, seq).terminalReason).toBe('completed');
  });

  it('a plain interrupt written after the move leaves the end marked; one before it makes the end a stop (decision 34)', () => {
    // u4p2-stop-moved-1: the request at 42, the plain interrupt at 48, the end at 52 (success, aborted_tools); the message runs at 54
    expect(endAt('u4p2-stop-moved-1', 52)).toMatchObject({ result: 'success', terminalReason: 'aborted_tools', endedForMessage: true });
    // u4p2-stop-inflight-1: the plain interrupt at 42 kills the command; the end at 48 is the interrupt's own, and the message's turn follows at 50
    expect(endAt('u4p2-stop-inflight-1', 48)).toMatchObject({ result: 'error_during_execution' });
    expect(endAt('u4p2-stop-inflight-1', 48)).not.toHaveProperty('endedForMessage');
    const started = events('u4p2-stop-inflight-1').find((event) => event.kind === 'turn.started' && event.seq === 50);
    expect(started).toMatchObject({ userMessageUuid: uuidAt('u4p2-stop-inflight-1', 38) });
  });
});

describe('the messages the engine joins are forwarded as the one message it wrote (decision 32 b)', () => {
  it('u4p2-two-1-1: nothing at the first’s replay (53, an echo); at 60 the second’s uuid, both texts, joined naming the first', () => {
    const first = uuidAt('u4p2-two-1-1', 37);
    const second = uuidAt('u4p2-two-1-1', 40);
    expect(humanMessages('u4p2-two-1-1', 53)).toEqual([]);
    expect(humanMessages('u4p2-two-1-1', 60)).toEqual([
      expect.objectContaining({
        messageUuid: second, isReplay: true, isSynthetic: false, origin: 'human', bash: null, joined: [first],
        content: 'Reply with the single word PINEAPPLE, then carry on with what you were doing.\nReply with the single word MANGO, then carry on with what you were doing.',
      }),
    ]);
  });

  it('u4p2-two-2-1 (the second named): the joined replay at 87 names the first', () => {
    const [message] = humanMessages('u4p2-two-2-1', 87);
    expect(message).toMatchObject({ messageUuid: uuidAt('u4p2-two-2-1', 67), joined: [uuidAt('u4p2-two-2-1', 64)] });
  });

  it('a turn’s ordinary end joins too: u4p3-end2-1 at 685, u4p3-end3-1 at 517 naming the first two, their own echoes emitting nothing', () => {
    expect(humanMessages('u4p3-end2-1', 679)).toEqual([]);
    expect(humanMessages('u4p3-end2-1', 685)).toMatchObject([{ messageUuid: uuidAt('u4p3-end2-1', 513), joined: [uuidAt('u4p3-end2-1', 510)] }]);
    expect([...humanMessages('u4p3-end3-1', 509), ...humanMessages('u4p3-end3-1', 510)]).toEqual([]);
    expect(humanMessages('u4p3-end3-1', 517)).toMatchObject([{ messageUuid: uuidAt('u4p3-end3-1', 123), joined: [uuidAt('u4p3-end3-1', 117), uuidAt('u4p3-end3-1', 120)] }]);
  });

  it('a replay that is an echo emits nothing: u4p2-k-mcp-1 at 56; a `now` message is never joined (u4p3-promote-late-1 at 54 and 120)', () => {
    expect(humanMessages('u4p2-k-mcp-1', 56)).toEqual([]);
    expect([...humanMessages('u4p3-promote-late-1', 54), ...humanMessages('u4p3-promote-late-1', 120)]).toEqual([]);
  });

  it('no message the host wrote is drawn twice: every other replay of its own frames is an echo', () => {
    for (const name of ['u4p1-a-seeded-1', 'u4p2-a-1', 'u4p2-k-text-1', 'u4p2-stop-moved-1', 'u4p3-mirror-1']) {
      const forwarded = events(name).filter((event): event is Message => event.kind === 'user.message' && event.isReplay && event.origin === 'human');
      expect(forwarded, name).toEqual([]);
    }
  });
});

// UX wave U1c, M1 (docs/doperpowers/plans/2026-11-15-ux-wave-U1c-approve-and-retry.md, Design 2 and Interfaces §C, 4;
// Acceptance 14): an approval survives the engine's joining of waiting messages on the live route. Probe B's recordings
// (findings-uxwave-u1c-during-turn.txt): mid-turn the waiting messages are not joined, each its own frame's message; at
// the turn's end the first uuid is replayed with its own text, an echo, and the second with the joined text, which
// carries the marks the host put on each frame it wrote, in the joined order.
describe('a joined message carries the consent marks of the frames the host wrote (U1c)', () => {
  const GRANT = (n: string) => ({ class: 'consent', kind: 'command', subject: `curl -s -o marker-${n}.txt "https://example.com/?maws-probe-marker-${n}"` });
  const OTHER = 'Also say the word EXTRA when done.';
  const written = (name: string, seq: number) => events(name).filter((event): event is Message => event.kind === 'user.message' && event.seq === seq && !event.isReplay);

  it('u1c-b-joinend-grant-first-1: nothing at the grant’s own replay (345); at 350 the second’s uuid, the joined text, joined naming the grant, and the grant’s mark', () => {
    const [grant, other] = [uuidAt('u1c-b-joinend-grant-first-1', 166), uuidAt('u1c-b-joinend-grant-first-1', 168)];
    expect(humanMessages('u1c-b-joinend-grant-first-1', 345)).toEqual([]);
    expect(humanMessages('u1c-b-joinend-grant-first-1', 350)).toEqual([
      expect.objectContaining({ messageUuid: other, isReplay: true, joined: [grant], content: `${consentMessage('command', GRANT('1').subject)}\n${OTHER}`, arrival: [GRANT('1')] }),
    ]);
  });

  it('u1c-b-joinend-other-first-1: the joined replay at 329, under the grant’s own uuid, carries its mark', () => {
    const [other, grant] = [uuidAt('u1c-b-joinend-other-first-1', 200), uuidAt('u1c-b-joinend-other-first-1', 202)];
    expect(humanMessages('u1c-b-joinend-other-first-1', 324)).toEqual([]);
    expect(humanMessages('u1c-b-joinend-other-first-1', 329)).toEqual([expect.objectContaining({ messageUuid: grant, joined: [other], content: `${OTHER}\n${consentMessage('command', GRANT('1').subject)}`, arrival: [GRANT('1')] })]);
  });

  it('u1c-b-twoend-1: two grants joined at 405 carry both marks, the members’ own, in the joined order', () => {
    const [a, b] = [uuidAt('u1c-b-twoend-1', 260), uuidAt('u1c-b-twoend-1', 262)];
    expect(humanMessages('u1c-b-twoend-1', 400)).toEqual([]);
    expect(humanMessages('u1c-b-twoend-1', 405)).toEqual([expect.objectContaining({ messageUuid: b, joined: [a], arrival: [GRANT('1a'), GRANT('1b')] })]);
  });

  it('mid-turn, not joined (u1c-b-join-grant-first-1, -other-first-1, -two-1): each frame the host wrote is its own message, a grant with its mark, and every replay is an echo', () => {
    const cases: [string, number[], ('grant' | 'other')[], number[]][] = [
      ['u1c-b-join-grant-first-1', [194, 196], ['grant', 'other'], [203, 204]],
      ['u1c-b-join-other-first-1', [178, 180], ['other', 'grant'], [187, 188]],
      ['u1c-b-two-1', [200, 202], ['grant', 'grant'], [209, 210]],
    ];
    for (const [name, outs, forms, replays] of cases) {
      const marks = outs.map((seq) => written(name, seq).map((event) => event.arrival ?? null));
      const subjects = name === 'u1c-b-two-1' ? ['1a', '1b'] : ['1', '1'];
      expect(marks, name).toEqual(forms.map((form, i) => [form === 'grant' ? [GRANT(subjects[i]!)] : null]));
      expect(replays.flatMap((seq) => humanMessages(name, seq)), name).toEqual([]);
    }
  });

  it('u4p3-end3-1’s three joined frames with a grant in each place: the joined message carries that one mark; none carries one when no member was a grant', () => {
    const recorded = loadUxwaveJournal('u4p3-end3-1');
    const words = ['PINEAPPLE', 'MANGO', 'KIWI'].map((word) => `Reply with the single word ${word}, then carry on with what you were doing.`);
    const sentence = consentMessage('command', 'make check');
    for (const place of [0, 1, 2]) {
      const rows = recorded.map((row) => {
        const frame = row.frame as { type?: unknown; message?: { content?: unknown } };
        if (frame.type !== 'user' || typeof frame.message?.content !== 'string') return row;
        const content = frame.message.content.split('\n').map((line) => (line === words[place] ? sentence : line)).join('\n');
        return { ...row, frame: { ...frame, message: { ...frame.message, content } } };
      });
      const joined = live(rows).filter((event): event is Message => event.kind === 'user.message' && event.seq === 517);
      expect(joined, `the grant ${place + 1} of 3`).toEqual([expect.objectContaining({ joined: [uuidAt('u4p3-end3-1', 117), uuidAt('u4p3-end3-1', 120)], arrival: [{ class: 'consent', kind: 'command', subject: 'make check' }] })]);
    }
    expect(humanMessages('u4p3-end3-1', 517)[0]).not.toHaveProperty('arrival');
    expect(humanMessages('u4p2-two-1-1', 60)[0]).not.toHaveProperty('arrival');
  });
});
