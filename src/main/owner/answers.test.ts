// An answer's rules on their own (the P2-C document, Design §6, "An answer's members"), over the events the host's real
// queue and normaliser produce (test/support/owner-host.ts): every row of the member table applied to an answer seeded
// with an entry id and to one seeded with a uuid, the engine's lifecycles, a member added after its lifecycle, an event
// applied twice, a delivered answer absorbing what follows, and a question's several answers (`settleAnswers`).
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid, SessionId } from '@shared/graph/ids';
import type { AnswerMember } from '@shared/owner/state';
import { OwnerHostSim } from '../../../test/support/owner-host';
import { applyEvent, newAnswer, settleAnswers, statusOf, type Answer, type PromptEvent } from './answers';

const SID = '6c07f148-ba9f-48de-9114-bb1d41c5c0b0' as SessionId;
type Row = Extract<PromptEvent, { kind: 'queue.transition' }>;
type Life = AnswerMember['life'];

// What the host and the engine said of prompts while `play` drove the real queue: its rows and lifecycles, in order.
async function recorded(play: (sim: OwnerHostSim) => Promise<unknown>): Promise<PromptEvent[]> {
  const events: SessionEvent[] = [];
  const sim = new OwnerHostSim('app-answers' as AppSessionId, SID, (batch) => events.push(...batch));
  await sim.launch();
  await play(sim).catch(() => {}); // a hold whose cancel fails rejects; its rows are what the test reads
  return events.filter((e): e is PromptEvent => e.kind === 'queue.transition' || e.kind === 'command.lifecycle');
}

const seeded = (kind: AnswerMember['kind'], id: string): Answer =>
  newAnswer({ text: 'Answering "Which backend?": Postgres', origin: 'answer', members: [{ kind, id, life: 'alive' }], unconfirmed: false, reportedAt: '2026-10-09T10:00:00.000Z' });

// Applies the events in order, each with what came before it as the evidence already seen.
function fold(answer: Answer, events: readonly PromptEvent[]): Answer {
  events.forEach((event, i) => applyEvent(answer, event, () => events.slice(0, i)));
  return answer;
}

const lifeOf = (answer: Answer, kind: AnswerMember['kind'], id: string | null): Life | undefined => answer.members.find((m) => m.kind === kind && m.id === id)?.life;
const rowOf = (events: readonly PromptEvent[], action: Row['action']): Row => events.find((e): e is Row => e.kind === 'queue.transition' && e.action === action)!;
const upTo = (events: readonly PromptEvent[], last: PromptEvent) => events.slice(0, events.indexOf(last) + 1);
const gate = () => {
  let open!: () => void;
  return { promise: new Promise<void>((r) => (open = r)), open: () => open() };
};

// A queued entry steered out of the queue as a `next` steer: the entry an entry-seeded answer starts from, and the
// steer's uuid every row naming only a uuid then speaks of.
async function promoted(sim: OwnerHostSim): Promise<{ queueId: string; messageUuid: MessageUuid }> {
  sim.turn = true;
  const { entry } = await sim.queue.send('Answering "Which backend?": Postgres');
  const { messageUuid } = await sim.queue.promote(entry.queueId, { priority: 'next' });
  return { queueId: entry.queueId, messageUuid };
}

// Design §6's member table: the life each row gives the entry id and the uuid it names ('—' where it names none).
const MATRIX: { row: Row['action']; entry: Life | '—'; uuid: Life | '—'; play: (sim: OwnerHostSim) => Promise<unknown> }[] = [
  { row: 'release', entry: 'alive', uuid: 'alive', play: (sim) => sim.queue.send('a') },
  {
    row: 'revert', entry: 'alive', uuid: 'dead',
    play: async (sim) => {
      sim.failWrite = () => true;
      await sim.queue.send('a');
    },
  },
  {
    row: 'uncertain', entry: 'alive', uuid: 'unknown',
    play: async (sim) => {
      await sim.queue.send('a');
      await sim.exit('crash');
    },
  },
  {
    row: 'retire', entry: 'dead', uuid: 'dead',
    play: async (sim) => {
      const { entry } = await sim.queue.send('a');
      sim.engine(entry.messageUuid!, 'queued'); // released
      await sim.exit('crash');
    },
  },
  ...(['cancelled', 'discarded', 'refused'] as const).map((reason) => ({
    row: 'drop' as const, entry: 'dead' as const, uuid: 'dead' as const,
    play: async (sim: OwnerHostSim) => {
      const { entry } = await sim.queue.send('a');
      sim.engine(entry.messageUuid!, reason);
    },
  })),
  {
    row: 'withdraw', entry: '—', uuid: 'withdrawing',
    play: async (sim) => {
      const { messageUuid } = await promoted(sim);
      const cancel = gate();
      sim.cancelGate = cancel.promise;
      void sim.queue.hold(messageUuid);
    },
  },
  {
    row: 'giveback', entry: '—', uuid: 'alive',
    play: async (sim) => {
      const { messageUuid } = await promoted(sim);
      sim.cancelAnswer = new Error('cancel failed');
      await sim.queue.hold(messageUuid);
    },
  },
  {
    row: 'hold', entry: 'alive', uuid: 'dead',
    play: async (sim) => {
      const { messageUuid } = await promoted(sim);
      await sim.queue.hold(messageUuid);
    },
  },
  {
    row: 'cancel', entry: '—', uuid: 'dead',
    play: async (sim) => {
      const { messageUuid } = await promoted(sim);
      await sim.queue.cancelSteer(messageUuid);
    },
  },
  {
    row: 'abandon', entry: '—', uuid: 'dead',
    play: async (sim) => {
      await promoted(sim);
      await sim.exit('crash');
    },
  },
  { row: 'promote', entry: 'dead', uuid: 'alive', play: (sim) => promoted(sim) },
  {
    row: 'remove', entry: 'dead', uuid: '—',
    play: async (sim) => {
      sim.failWrite = () => true; // release then revert: the entry's uuid is known, and the entry waits queued
      const { entry } = await sim.queue.send('a');
      await sim.queue.remove(entry.queueId);
    },
  },
];

describe("the member table (Design §6): each row's lives, from an entry-seeded and from a uuid-seeded answer", () => {
  it.each(MATRIX.map((c, i) => [`${c.row}${c.row === 'drop' ? ` #${i}` : ''}`, c] as const))('%s', async (_name, c) => {
    const events = await recorded(c.play);
    const row = rowOf(events, c.row);
    expect(row).toBeDefined();
    const prefix = upTo(events, row);
    // the ids the answer knows before the row: the row's own, or, for a row naming only a uuid, the entry it was
    // promoted from (an entry-seeded answer learns the uuid at the `promote` row), or, for `remove`, the uuid its
    // entry was released as (a uuid-seeded answer learns the entry at the `release` row)
    const entryId = row.queueId ?? rowOf(events, 'promote').queueId!;
    const uuidId = row.messageUuid ?? rowOf(events, 'release').messageUuid!;
    for (const answer of [fold(seeded('entry', entryId), prefix), fold(seeded('uuid', uuidId), prefix)]) {
      if (c.entry !== '—') expect(lifeOf(answer, 'entry', row.queueId)).toBe(c.entry);
      if (c.uuid !== '—') expect(lifeOf(answer, 'uuid', row.messageUuid)).toBe(c.uuid);
      // two-way association: every id the row names is a member now
      expect(answer.members.map((m) => m.id)).toEqual(expect.arrayContaining([row.queueId, row.messageUuid].filter((id) => id !== null)));
      if (c.row === 'drop' && row.reason === 'refused') expect(answer.failed).toEqual({ reason: 'refused' });
    }
  });

  it('a row naming no member changes nothing', async () => {
    const events = await recorded((sim) => sim.queue.send('a'));
    const answer = seeded('entry', 'another-entry');
    expect(applyEvent(answer, rowOf(events, 'release'), () => [])).toBe(false);
    expect(answer.members).toEqual([{ kind: 'entry', id: 'another-entry', life: 'alive' }]);
  });
});

describe("the engine's lifecycle for a member uuid", () => {
  it.each(['started', 'completed'] as const)('%s delivers the answer', async (state) => {
    const events = await recorded(async (sim) => {
      const { entry } = await sim.queue.send('a');
      sim.engine(entry.messageUuid!, state);
    });
    const answer = fold(seeded('uuid', rowOf(events, 'release').messageUuid!), events);
    expect(statusOf(answer)).toBe('delivered');
    expect(answer.deliveredAt).toBe(events.find((e) => e.kind === 'command.lifecycle' && e.state === state)!.at);
  });

  it.each(['discarded', 'refused', 'cancelled'] as const)('%s kills a uuid the host is not withdrawing', async (state) => {
    const events = await recorded(async (sim) => {
      sim.turn = true;
      const { messageUuid } = await sim.queue.steer('a', { priority: 'next' });
      sim.engine(messageUuid, state);
    });
    const uuid = (events.find((e) => e.kind === 'command.lifecycle') as Extract<PromptEvent, { kind: 'command.lifecycle' }>).commandUuid;
    const answer = fold(seeded('uuid', uuid), events);
    expect(lifeOf(answer, 'uuid', uuid)).toBe('dead');
    expect(statusOf(answer)).toBe('unanswered');
    expect(answer.failed).toEqual(state === 'refused' ? { reason: 'refused' } : null);
  });

  it("a cancelled for a uuid being withdrawn changes nothing: the host's outcome row decides (hold, cancel, giveback)", async () => {
    for (const outcome of ['hold', 'cancel', 'giveback'] as const) {
      let uuid!: MessageUuid;
      const events = await recorded(async (sim) => {
        sim.turn = true;
        uuid = (await sim.queue.steer('a', { priority: 'next' })).messageUuid;
        if (outcome === 'giveback') {
          // the engine cancels the steer, then the host's request fails: the host gives back a steer the engine dropped
          sim.cancelGate = () => Promise.reject(new Error('cancel failed'));
          await sim.queue.hold(uuid);
        } else if (outcome === 'hold') await sim.queue.hold(uuid);
        else await sim.queue.cancelSteer(uuid);
      });
      const cancelled = events.find((e) => e.kind === 'command.lifecycle' && e.state === 'cancelled')!;
      const answer = fold(seeded('uuid', uuid), upTo(events, cancelled));
      expect(lifeOf(answer, 'uuid', uuid)).toBe('withdrawing');
      expect(statusOf(answer)).toBe('queued');
      fold(answer, events);
      expect(lifeOf(answer, 'uuid', uuid)).toBe('dead');
      expect(statusOf(answer)).toBe(outcome === 'hold' ? 'queued' : 'unanswered'); // a hold transfers it to the held entry
    }
  });
});

describe('members added late, events applied twice, a delivered answer', () => {
  it("a lifecycle that came before the row associating its uuid is reconciled when the uuid joins (start-before-promote)", async () => {
    let queueId!: string;
    const events = await recorded(async (sim) => {
      sim.turn = true;
      const { entry } = await sim.queue.send('a');
      queueId = entry.queueId;
      sim.holding = [];
      const { messageUuid } = await sim.queue.promote(entry.queueId, { priority: 'next' });
      sim.engine(messageUuid, 'started');
      sim.release((held) => [...held.filter((e) => e.kind === 'command.lifecycle'), ...held.filter((e) => e.kind !== 'command.lifecycle')]);
    });
    expect(events.findIndex((e) => e.kind === 'command.lifecycle')).toBeLessThan(events.indexOf(rowOf(events, 'promote')));
    const answer = fold(seeded('entry', queueId), events);
    expect(statusOf(answer)).toBe('delivered');
  });

  it('an event applied again (the history and the live log carry the same ids) changes nothing the second time', async () => {
    let uuid!: MessageUuid;
    const events = await recorded(async (sim) => {
      sim.turn = true;
      uuid = (await sim.queue.steer('a', { priority: 'next' })).messageUuid;
      await sim.queue.hold(uuid);
    });
    const hold = rowOf(events, 'hold');
    const answer = fold(seeded('uuid', uuid), events);
    const members = structuredClone(answer.members);
    // the withdraw row again after the hold would revive the uuid as withdrawing if it were applied twice
    for (const event of events) expect(applyEvent(answer, event, () => events)).toBe(false);
    expect(answer.members).toEqual(members);
    expect(lifeOf(answer, 'entry', hold.queueId)).toBe('alive');
  });

  it('a delivered answer stays delivered: a later drop, removal or exit changes nothing', async () => {
    let uuid!: MessageUuid;
    const events = await recorded(async (sim) => {
      const { entry } = await sim.queue.send('a');
      uuid = entry.messageUuid!;
      sim.engine(uuid, 'started');
      sim.engine(uuid, 'refused'); // too late to matter
      await sim.exit('crash');
    });
    const answer = fold(seeded('uuid', uuid), events);
    expect(statusOf(answer)).toBe('delivered');
    expect(answer.failed).toBeNull();
    expect(lifeOf(answer, 'uuid', uuid)).toBe('alive');
  });

  it('an answer with no member reads unconfirmed until a member settles it; with every member dead, unanswered', async () => {
    const bare = newAnswer({ text: 'a', origin: 'answer', members: [], unconfirmed: true, reportedAt: '2026-10-09T10:00:00.000Z' });
    expect(statusOf(bare)).toBe('unconfirmed');
    const events = await recorded(async (sim) => {
      const { entry } = await sim.queue.send('a');
      sim.engine(entry.messageUuid!, 'discarded');
    });
    const flagged = fold({ ...seeded('uuid', rowOf(events, 'release').messageUuid!), unconfirmed: true }, events);
    expect(statusOf(flagged)).toBe('unanswered');
  });
});

describe("a question's several answers (settleAnswers)", () => {
  // Two answers sent one after the other, each followed through the real queue: the first released and started or not.
  async function two(play: (sim: OwnerHostSim, first: MessageUuid, second: MessageUuid) => void): Promise<[Answer, Answer]> {
    let first!: MessageUuid;
    let second!: MessageUuid;
    const events = await recorded(async (sim) => {
      sim.turn = true;
      first = (await sim.queue.steer('Answering "Which backend?": Postgres', { priority: 'next' })).messageUuid;
      second = (await sim.queue.steer('Answering "Which backend?": SQLite', { priority: 'next' })).messageUuid;
      play(sim, first, second);
    });
    return [fold({ ...seeded('uuid', first), text: 'Postgres' }, events), fold({ ...seeded('uuid', second), text: 'SQLite' }, events)];
  }

  it('the newest the engine took is the answer, and older ones are dropped whether they arrived or not', async () => {
    const [older, newer] = await two((sim, first, second) => {
      sim.engine(second, 'started');
      sim.engine(first, 'started');
    });
    expect(settleAnswers([older, newer])).toEqual({ delivered: newer, open: [], dead: [] });
    const [waiting, taken] = await two((sim, _first, second) => sim.engine(second, 'started'));
    expect(settleAnswers([waiting, taken])).toEqual({ delivered: taken, open: [], dead: [] });
  });

  it('an older answer that arrived is the answer while a newer one is still on its way, and never carries the newer text', async () => {
    const [older, newer] = await two((sim, first) => sim.engine(first, 'started'));
    const settled = settleAnswers([older, newer]);
    expect(settled.delivered?.text).toBe('Postgres');
    expect(settled.open).toEqual([newer]);
  });

  it('an answer no member carries any more is dead, and nothing arrived', async () => {
    const [older, newer] = await two((sim, first) => sim.engine(first, 'discarded'));
    expect(settleAnswers([older, newer])).toEqual({ delivered: null, open: [newer], dead: [older] });
  });
});
