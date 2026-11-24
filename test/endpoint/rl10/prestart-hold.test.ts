// A prestart's member (ticket 851, docs/doperpowers/plans/2026-11-24-prestart-engine.md, R4-6 and D11): a lane B member
// whose engine session the engine host holds hidden (a New chat's engine started at the first keystroke, not yet sent)
// is held by the endpoint with no handed-off mark, no record, no project presence and no listing; at its commit it is
// processed as a member that has just arrived, and at its end it is dropped with no trace. The orderings: the member
// before or after its `hidden`, a `committed` with no member yet, a member after its `ended`, a frame newer than the one
// held, and the hidden set read whole at a link with an event heard while the read is out. D11's re-join: an unjoined
// lane B member is joined when the spine says a record names its engine session. An ordinary unjoined member keeps
// today's marks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionReport } from '../../../src/endpoint/listings';
import { EARLY_HOLD_MS, Members, type Marks } from '../../../src/endpoint/rl10/members';

const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
/** The prestart's pin: the engine session the host holds hidden. */
const DRAFT_ENGINE = 'e0ad139c-18bc-45bd-9489-be8653145f80';
/** Another engine session. */
const OTHER = 'f1be24ad-29cd-46ce-a59a-cf9764256091';
/** The New chat's intent, the app session the committed engine runs under. */
const APP = 'b4d1e2f3-0a1b-4c2d-9e3f-4a5b6c7d8e9f';
const APP2 = 'c5e2f304-1b2c-4d3e-8f40-5b6c7d8e9fa0';

const memberFrame = (session: string, fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  t: 'member',
  session,
  alias: 'draft',
  project: P,
  lane: 'B',
  state: 'idle',
  title: 'a new chat',
  cwd: '/work/checkout',
  owners: ['@machine'],
  ownersProof: [],
  origin: { kind: 'terminal' },
  ...fields,
});

const told = (engineSessionId: string, state: 'hidden' | 'committed' | 'ended', appSessionId = APP) => ({ appSessionId, engineSessionId, state });

type Turn = () => Promise<void>;

/**
 * Members over a machine whose engine host lists `live` (engine session → app session) in `engine.sessions` and `hidden`
 * in `engine.prestarts`, with its handed-off mark kept here (every write recorded), every report and withdrawal, every
 * prestart move the endpoint is told of, and the reads it made. `turns`: held turns, run by the suite (`runTurns`).
 */
function machine({ heldTurns = false }: { heldTurns?: boolean } = {}) {
  const live = new Map<string, string>();
  let hidden: Array<{ appSessionId: string; engineSessionId: string }> = [];
  let marks: Marks = { appSessionIds: [], engineSessionIds: [] };
  const writes: Marks[] = [];
  const listed = new Map<string, SessionReport>();
  const reports: SessionReport[] = [];
  const withdrawn: string[] = [];
  const moved: Array<[string, string]> = [];
  const reads: string[] = [];
  const turns: Turn[] = [];
  let prestartsHeld: Promise<void> | null = null;
  let goneHeld: Promise<void> | null = null;
  // the engine host's start: its adoptions under way (`holder.adopting`); `away`, the reads it cannot answer
  let adopting = false;
  const away = new Set<string>();
  // reads the engine host answers before it is away (the prestart panel, scalpel-5#2): a read past its count throws
  const answering = new Map<string, number>();
  const members = new Members({
    dispatch: async (_owner, name) => {
      reads.push(name);
      if (away.has(name)) throw new Error('the engine host is away');
      const left = answering.get(name);
      if (left !== undefined) {
        if (left === 0) throw new Error('the engine host is away');
        answering.set(name, left - 1);
      }
      if (name === 'host.supervisorStatus') return { t: 'res', id: '0', ok: true, value: { holder: { adopting } } };
      if (name === 'engine.sessions') return { t: 'res', id: '0', ok: true, value: [...live].map(([engineSessionId, appSessionId]) => ({ engineSessionId, appSessionId })) };
      if (name === 'engine.prestarts') {
        const answer = { hidden: [...hidden] };
        await prestartsHeld;
        return { t: 'res', id: '0', ok: true, value: answer };
      }
      return { t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: name } };
    },
    listings: {
      report: async (report) => {
        reports.push(report);
        listed.set(report.session, report);
      },
      gone: async (session) => {
        await goneHeld;
        if (listed.delete(session)) withdrawn.push(session);
      },
    },
    listed: () => [...listed.keys()],
    forget: () => {},
    log: () => {},
    now: Date.now,
    marks: {
      read: () => marks,
      write: (next) => {
        marks = { appSessionIds: [...next.appSessionIds], engineSessionIds: [...next.engineSessionIds] };
        writes.push(marks);
      },
    },
    ...(heldTurns ? { inTurn: (take: Turn) => new Promise<void>((resolve, reject) => void turns.push(() => take().then(resolve, reject))) } : {}),
    prestartMoved: async (session, how) => void moved.push([session, how]),
  });
  const runTurns = async () => {
    while (turns.length > 0) await turns.shift()!();
  };
  return {
    members,
    live,
    setHidden: (next: Array<{ appSessionId: string; engineSessionId: string }>) => void (hidden = next),
    holdPrestarts: (until: Promise<void>) => void (prestartsHeld = until),
    holdGone: (until: Promise<void> | null) => void (goneHeld = until),
    setAdopting: (now: boolean) => void (adopting = now),
    away,
    answering,
    marks: () => marks,
    writes,
    listed,
    reports,
    withdrawn,
    moved,
    reads,
    runTurns,
  };
}

/** Whether `session` left any trace: a mark on disk, a held record, a listing, a report. */
function traces(m: ReturnType<typeof machine>, session: string, app = APP) {
  return {
    marked: m.marks().engineSessionIds.includes(session) || m.marks().appSessionIds.includes(app),
    held: m.members.sessions().includes(session) || m.members.get(session) !== null,
    record: m.members.recordOf(session),
    listed: m.listed.has(app),
  };
}
const NONE = { marked: false, held: false, record: null, listed: false };

describe('a lane B member whose engine session is hidden', () => {
  it('is held: no handed-off mark, no record, no project presence, no listing', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.writes).toEqual([]);
    expect(m.members.handedOff({ lane: 'B', session: DRAFT_ENGINE, appSessionId: '' })).toBe(false);
    expect(m.reports).toEqual([]);
    // nothing was asked of the engine host for it: no join was tried
    expect(m.reads).not.toContain('engine.sessions');
  });

  it('is dropped with no trace when its prestart ends, and a frame of it after the end is dropped too', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    await m.members.prestart(told(DRAFT_ENGINE, 'ended'));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    // sminos keeps a member whose process ended, and restates it after a welcome
    m.members.welcome();
    await m.members.member(memberFrame(DRAFT_ENGINE, { state: 'gone' }));
    await m.members.restated();
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.writes).toEqual([]);
    expect(m.withdrawn).toEqual([]);
  });

  it('is processed as a member just arrived once committed: marked, joined and listed', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE, { title: 'the first message' }));
    m.live.set(DRAFT_ENGINE, APP); // the host reveals the row before it says so
    await m.members.prestart(told(DRAFT_ENGINE, 'committed'));
    expect(m.members.sessions()).toEqual([DRAFT_ENGINE]);
    expect(m.members.appSessionId(DRAFT_ENGINE)).toBe(APP);
    expect(m.members.listingId(DRAFT_ENGINE)).toBe(APP);
    expect(m.reports.map((r) => [r.session, r.title])).toEqual([[APP, 'the first message']]);
    expect(m.marks().appSessionIds).toEqual([APP]);
    expect(m.marks().engineSessionIds).toEqual([]);
    expect(m.moved).toEqual([[DRAFT_ENGINE, 'arrived']]);
  });

  it('processes the latest frame held, and a commit with no frame yet leaves the next frame to arrive as any', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE, { state: 'starting' }));
    await m.members.member(memberFrame(DRAFT_ENGINE, { state: 'idle' }));
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.prestart(told(DRAFT_ENGINE, 'committed'));
    expect(m.members.get(DRAFT_ENGINE)?.state).toBe('idle');

    const n = machine();
    await n.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    n.live.set(DRAFT_ENGINE, APP);
    await n.members.prestart(told(DRAFT_ENGINE, 'committed'));
    expect(n.moved).toEqual([]);
    await n.members.member(memberFrame(DRAFT_ENGINE));
    expect(n.members.listingId(DRAFT_ENGINE)).toBe(APP);
    expect(n.listed.has(APP)).toBe(true);
  });

  it('a held member that sminos says is gone is dropped, and its commit processes nothing', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    await m.members.member({ t: 'member', session: DRAFT_ENGINE, gone: true });
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.prestart(told(DRAFT_ENGINE, 'committed'));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.withdrawn).toEqual([]);
  });

  it('a held member left out of a restatement is dropped, and one restated stays held', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    m.members.welcome();
    await m.members.restated();
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.prestart(told(DRAFT_ENGINE, 'committed'));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);

    const n = machine();
    await n.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await n.members.member(memberFrame(DRAFT_ENGINE));
    n.members.welcome();
    await n.members.member(memberFrame(DRAFT_ENGINE));
    await n.members.restated();
    expect(traces(n, DRAFT_ENGINE)).toEqual(NONE);
    n.live.set(DRAFT_ENGINE, APP);
    await n.members.prestart(told(DRAFT_ENGINE, 'committed'));
    expect(n.members.listingId(DRAFT_ENGINE)).toBe(APP);
  });
});

describe('the order of the engine host’s word and sminos’s frame', () => {
  it('a member that arrived before its hidden event is pulled back: its mark removed, its record dropped, its readers told', async () => {
    const m = machine();
    const changed: unknown[] = [];
    m.members.onChange((target) => void changed.push(target));
    await m.members.member(memberFrame(DRAFT_ENGINE)); // no live row names it: unjoined, marked by its engine session
    expect(m.marks().engineSessionIds).toEqual([DRAFT_ENGINE]);
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.marks().engineSessionIds).toEqual([]);
    expect(changed.at(-1)).toEqual({ lane: 'B', session: DRAFT_ENGINE, appSessionId: '' });
    expect(m.moved).toEqual([[DRAFT_ENGINE, 'held']]);
    // and is processed as arrived at its commit
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.prestart(told(DRAFT_ENGINE, 'committed'));
    expect(m.members.listingId(DRAFT_ENGINE)).toBe(APP);
    expect(m.listed.has(APP)).toBe(true);
  });

  it('a member that arrived before its hidden event and whose prestart then ends leaves nothing', async () => {
    const m = machine();
    await m.members.member(memberFrame(DRAFT_ENGINE));
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.prestart(told(DRAFT_ENGINE, 'ended'));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.marks()).toEqual({ appSessionIds: [], engineSessionIds: [] });
  });

  it('an ended event for a member the endpoint never heard hidden drops it and its marks', async () => {
    const m = machine();
    await m.members.member(memberFrame(DRAFT_ENGINE));
    await m.members.prestart(told(DRAFT_ENGINE, 'ended'));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.marks()).toEqual({ appSessionIds: [], engineSessionIds: [] });
  });

  it('a member whose prestart ended before it arrived is dropped', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.prestart(told(DRAFT_ENGINE, 'ended'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.writes).toEqual([]);
  });

  it('a frame newer than the one held, taken in turn before the commit’s replay, is the one processed', async () => {
    const m = machine({ heldTurns: true });
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE, { state: 'starting' }));
    m.live.set(DRAFT_ENGINE, APP);
    const committed = m.members.prestart(told(DRAFT_ENGINE, 'committed')); // its replay waits for its turn
    await m.members.member(memberFrame(DRAFT_ENGINE, { state: 'working' })); // a frame taken first: not hidden any more
    await m.runTurns();
    await committed;
    expect(m.members.get(DRAFT_ENGINE)?.state).toBe('working');
    expect(m.reports.map((r) => r.state)).toEqual(['working']);
    expect(m.moved).toEqual([]);
  });

  it('a joined member is never pulled back by a hidden event', async () => {
    const m = machine();
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.member(memberFrame(DRAFT_ENGINE));
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    expect(m.members.listingId(DRAFT_ENGINE)).toBe(APP);
    expect(m.moved).toEqual([]);
  });

  it('lane A is not held', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE, { lane: 'A' }));
    expect(m.members.sessions()).toEqual([DRAFT_ENGINE]);
  });
});

describe('the hidden set read whole at a link to the engine host', () => {
  it('learns a pin the events missed: its member is held', async () => {
    const m = machine();
    m.setHidden([{ appSessionId: APP, engineSessionId: DRAFT_ENGINE }]);
    await m.members.restatePrestarts();
    await m.members.member(memberFrame(DRAFT_ENGINE));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
  });

  it('settles a pin no longer hidden by the host’s rows: committed when a live row names it, else ended', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.prestart(told(OTHER, 'hidden', APP2));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    await m.members.member(memberFrame(OTHER));
    m.live.set(DRAFT_ENGINE, APP); // committed while the link was down: its event lost
    m.setHidden([]);
    await m.members.restatePrestarts();
    expect(m.members.listingId(DRAFT_ENGINE)).toBe(APP);
    expect(m.listed.has(APP)).toBe(true);
    expect(traces(m, OTHER, APP2)).toEqual(NONE);
    await m.members.member(memberFrame(OTHER)); // ended: a late frame is dropped
    expect(traces(m, OTHER, APP2)).toEqual(NONE);
  });

  it('an event heard while the read is out is newer than the read', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    m.setHidden([{ appSessionId: APP, engineSessionId: DRAFT_ENGINE }]); // the host's answer, taken before its end
    let answer!: () => void;
    m.holdPrestarts(new Promise<void>((resolve) => (answer = resolve)));
    const read = m.members.restatePrestarts();
    await m.members.prestart(told(DRAFT_ENGINE, 'ended'));
    answer();
    await read;
    await m.members.member(memberFrame(DRAFT_ENGINE));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.writes).toEqual([]);
  });

  it('a read that fails keeps what is held', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    m.holdPrestarts(Promise.reject(new Error('the engine host is away')));
    await m.members.restatePrestarts();
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.prestart(told(DRAFT_ENGINE, 'committed'));
    expect(m.members.listingId(DRAFT_ENGINE)).toBe(APP);
  });
});

describe('an ordinary unjoined lane B member', () => {
  it('keeps today’s marks: held, marked by its engine session before the join, not listed', async () => {
    const m = machine();
    await m.members.member(memberFrame(OTHER));
    expect(m.members.sessions()).toEqual([OTHER]);
    expect(m.marks().engineSessionIds).toEqual([OTHER]);
    expect(m.members.handedOff({ lane: 'B', session: OTHER, appSessionId: '' })).toBe(true);
    expect(m.members.recordOf(OTHER)).not.toBeNull();
    expect(m.reports).toEqual([]);
  });
});

describe('D11: the re-join when the spine says a record changed', () => {
  const record = (fields: Record<string, unknown> = {}) => ({ appId: APP, engineSessionId: DRAFT_ENGINE, archived: false, title: { text: 'the first message', source: 'none' }, ...fields });

  it('joins an unjoined lane B member the record names, and lists it under the record’s app session', async () => {
    const m = machine();
    await m.members.member(memberFrame(DRAFT_ENGINE)); // the endpoint never heard it hidden: unjoined, as before
    expect(m.members.listingId(DRAFT_ENGINE)).toBeNull();
    m.live.set(DRAFT_ENGINE, APP); // committed: the host's rows name it now
    await m.members.recordChanged(record({ title: { text: 'Renamed', source: 'user' } }));
    expect(m.members.appSessionId(DRAFT_ENGINE)).toBe(APP);
    expect(m.reports.map((r) => [r.session, r.title])).toEqual([[APP, 'Renamed']]);
    expect(m.marks().appSessionIds).toEqual([APP]);
  });

  it('joins on a record whose title and archive did not move since the last one heard', async () => {
    const m = machine();
    await m.members.member(memberFrame(DRAFT_ENGINE));
    await m.members.recordChanged(record({ engineSessionId: null })); // the record before its engine session is bound
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.recordChanged(record());
    expect(m.listed.has(APP)).toBe(true);
  });

  it('reads nothing for a record that names no unjoined member', async () => {
    const m = machine();
    await m.members.member(memberFrame(OTHER));
    const before = m.reads.length;
    await m.members.recordChanged(record());
    await m.members.recordChanged(record({ engineSessionId: null }));
    expect(m.reads.slice(before)).toEqual([]);
  });
});

describe('M4’s review', () => {
  it('1. a pin the successor host no longer names while its adoptions run is not ended: committed once they have ended', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    // the engine host died after the native promotion, before `committed` was heard: its successor names no hidden pin,
    // and lists the promoted engine only once its start has adopted it
    m.setHidden([]);
    m.setAdopting(true);
    await m.members.restatePrestarts();
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    m.live.set(DRAFT_ENGINE, APP);
    m.setAdopting(false);
    await m.members.hostStatus({ holder: { adopting: false } });
    expect(m.members.listingId(DRAFT_ENGINE)).toBe(APP);
    expect(m.listed.has(APP)).toBe(true);
  });

  it('1. a read the engine host cannot answer ends no pin: the next link settles it', async () => {
    for (const read of ['host.supervisorStatus', 'engine.sessions']) {
      const m = machine();
      await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
      await m.members.member(memberFrame(DRAFT_ENGINE));
      m.setHidden([]);
      m.away.add(read);
      await m.members.restatePrestarts();
      expect(traces(m, DRAFT_ENGINE), read).toEqual(NONE);
      m.away.delete(read);
      m.live.set(DRAFT_ENGINE, APP);
      await m.members.restatePrestarts();
      expect(m.members.listingId(DRAFT_ENGINE), read).toBe(APP);
    }
  });

  it('3. a held member left out of a restatement still under way when its commit is heard is not processed by the replay', async () => {
    const m = machine({ heldTurns: true });
    await m.members.member(memberFrame(OTHER, { lane: 'A' })); // listed under its session: its withdrawal awaits the hub
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    m.members.welcome();
    let release!: () => void;
    m.holdGone(new Promise<void>((resolve) => (release = resolve)));
    const restating = m.members.restated(); // RL10's turn: the other member's withdrawal first, then the pin's departure
    m.live.set(DRAFT_ENGINE, APP);
    const committed = m.members.prestart(told(DRAFT_ENGINE, 'committed')); // its replay waits for the next turn
    release();
    await restating;
    await m.runTurns();
    await committed;
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.moved).toEqual([]);
  });

  it('4. a member processed before its hidden word and gone before it is heard leaves no trace once it is', async () => {
    for (const word of ['hidden', 'ended'] as const) {
      for (const leaves of ['gone', 'left out of a restatement'] as const) {
        const m = machine();
        await m.members.member(memberFrame(DRAFT_ENGINE)); // no word heard yet: unjoined, marked by its engine session
        expect(m.marks().engineSessionIds).toEqual([DRAFT_ENGINE]);
        if (leaves === 'gone') await m.members.member({ t: 'member', session: DRAFT_ENGINE, gone: true });
        else {
          m.members.welcome();
          await m.members.restated();
        }
        await m.members.prestart(told(DRAFT_ENGINE, word));
        expect(m.marks().engineSessionIds, `${word}, ${leaves}`).toEqual([]);
        expect(m.moved, `${word}, ${leaves}`).toEqual([[DRAFT_ENGINE, 'held']]); // RL10 drops its audience history
      }
    }
  });

  it('4. a joined member that left keeps its marks at a word of its engine session', async () => {
    const m = machine();
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.member(memberFrame(DRAFT_ENGINE));
    await m.members.member({ t: 'member', session: DRAFT_ENGINE, gone: true });
    const before = m.marks();
    await m.members.prestart(told(DRAFT_ENGINE, 'ended'));
    expect(m.marks()).toEqual(before);
    expect(m.marks().appSessionIds).toEqual([APP]);
    expect(m.moved).toEqual([]);
  });

  it('5. the re-join at a record’s change joins only the member that record names, under that record’s app session', async () => {
    const m = machine();
    await m.members.member(memberFrame(DRAFT_ENGINE));
    await m.members.member(memberFrame(OTHER));
    m.live.set(DRAFT_ENGINE, APP);
    m.live.set(OTHER, APP2); // eligible too, but no record of it changed
    await m.members.recordChanged({ appId: APP, engineSessionId: DRAFT_ENGINE, archived: false, title: { text: 'the first message', source: 'none' } });
    expect(m.members.appSessionId(DRAFT_ENGINE)).toBe(APP);
    expect(m.members.appSessionId(OTHER)).toBeNull();
    expect(m.marks().appSessionIds).toEqual([APP]);
    expect(m.marks().engineSessionIds).toEqual([OTHER]);
    // a record naming an engine session the live rows put under another app session joins nothing
    const n = machine();
    await n.members.member(memberFrame(DRAFT_ENGINE));
    n.live.set(DRAFT_ENGINE, APP2);
    await n.members.recordChanged({ appId: APP, engineSessionId: DRAFT_ENGINE, archived: false, title: { text: 'x', source: 'none' } });
    expect(n.members.appSessionId(DRAFT_ENGINE)).toBeNull();
  });
});

/** `done` settled, the held turns run as they come (a turn can be queued after an await). */
async function driven(m: ReturnType<typeof machine>, done: Promise<unknown>): Promise<void> {
  let settled = false;
  void done.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!settled) {
    await m.runTurns();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await done;
}

describe('the prestart panel (ticket 851, the xhigh round)', () => {
  afterEach(() => void vi.useRealTimers());

  it('scalpel-4#6: a first member the host holds hidden, its word still on the way, is held: no mark kept, no record, never arrived', async () => {
    const m = machine();
    m.setHidden([{ appSessionId: APP, engineSessionId: DRAFT_ENGINE }]); // the host holds it hidden; its `hidden` is late
    await m.members.member(memberFrame(DRAFT_ENGINE));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE); // its sight's mark taken back, as at a word
    expect(m.members.prestartPin(DRAFT_ENGINE)).toBe(true);
    expect(m.moved).toEqual([[DRAFT_ENGINE, 'held']]);
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden')); // the word, late
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.moved).toEqual([[DRAFT_ENGINE, 'held']]);
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.prestart(told(DRAFT_ENGINE, 'committed'));
    expect(m.members.listingId(DRAFT_ENGINE)).toBe(APP);
    expect(m.moved).toEqual([[DRAFT_ENGINE, 'held'], [DRAFT_ENGINE, 'arrived']]);
  });

  it('scalpel-4#6: a first member the host names live is public: processed at once, its join on the rows already read', async () => {
    const m = machine();
    m.live.set(DRAFT_ENGINE, APP);
    await m.members.member(memberFrame(DRAFT_ENGINE));
    expect(m.members.listingId(DRAFT_ENGINE)).toBe(APP);
    expect(m.reads.filter((read) => read === 'engine.sessions')).toHaveLength(1);
    expect(m.reads).not.toContain('engine.prestarts');
  });

  it('scalpel-4#6: one the host cannot place is held, closed by its sight, until its word, a whole-set read that answers, or the bound', async () => {
    const closed = (m: ReturnType<typeof machine>) => m.members.handedOff({ lane: 'B', session: DRAFT_ENGINE, appSessionId: '' });
    const unprocessed = (m: ReturnType<typeof machine>) => ({ held: m.members.sessions().includes(DRAFT_ENGINE), record: m.members.recordOf(DRAFT_ENGINE), listed: m.listed.has(APP) });
    const UNPROCESSED = { held: false, record: null, listed: false };
    // its word: hidden after all, its sight's mark is taken back and it stays held; ended, nothing is left
    const m = machine();
    m.away.add('engine.prestarts');
    await m.members.member(memberFrame(DRAFT_ENGINE));
    expect(unprocessed(m)).toEqual(UNPROCESSED);
    expect(m.marks().engineSessionIds).toEqual([DRAFT_ENGINE]); // P5 O12 M11: the sight on disk while it waits
    expect(closed(m)).toBe(true);
    expect(m.moved).toEqual([]);
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    await m.members.prestart(told(DRAFT_ENGINE, 'ended'));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.moved.filter(([, how]) => how === 'arrived')).toEqual([]);

    // the next link's whole set answers without it: an ordinary member, processed as one just arrived
    const n = machine();
    n.away.add('engine.prestarts');
    await n.members.member(memberFrame(DRAFT_ENGINE));
    expect(unprocessed(n)).toEqual(UNPROCESSED);
    n.away.delete('engine.prestarts');
    await n.members.restatePrestarts();
    expect(n.members.sessions()).toEqual([DRAFT_ENGINE]);
    expect(n.marks().engineSessionIds).toEqual([DRAFT_ENGINE]);
    expect(n.moved).toEqual([[DRAFT_ENGINE, 'arrived']]);

    // the bound: no word and no read, an ordinary member once it has passed, never before
    vi.useFakeTimers();
    const o = machine();
    o.away.add('engine.prestarts');
    await o.members.member(memberFrame(DRAFT_ENGINE));
    await vi.advanceTimersByTimeAsync(EARLY_HOLD_MS - 1);
    expect(unprocessed(o)).toEqual(UNPROCESSED);
    expect(closed(o)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(o.members.sessions()).toEqual([DRAFT_ENGINE]);
    expect(o.marks().engineSessionIds).toEqual([DRAFT_ENGINE]);
    expect(o.moved).toEqual([[DRAFT_ENGINE, 'arrived']]);
    // and sminos's departure while it is held leaves nothing for the bound to process
    const q = machine();
    q.away.add('engine.prestarts');
    await q.members.member(memberFrame(DRAFT_ENGINE));
    await q.members.member({ t: 'member', session: DRAFT_ENGINE, gone: true });
    await vi.advanceTimersByTimeAsync(EARLY_HOLD_MS);
    expect(unprocessed(q)).toEqual(UNPROCESSED);
    expect(q.moved).toEqual([]);
    // its sight stays, as an unjoined member's that left does, until a word of its engine session takes it back
    await q.members.prestart(told(DRAFT_ENGINE, 'ended'));
    expect(traces(q, DRAFT_ENGINE)).toEqual(NONE);
  });

  it('scalpel-5#1: a settlement queued behind RL10’s turn when its link is replaced reads nothing of the successor', async () => {
    const m = machine({ heldTurns: true });
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    // the first link: the pin committed (a live row names it) and its word lost; the host's adoptions ended
    m.setHidden([]);
    m.live.set(DRAFT_ENGINE, APP);
    const first = m.members.restatePrestarts(); // its settlement waits behind RL10's turn
    await new Promise((resolve) => setImmediate(resolve));
    // that link drops; its successor names no live row yet: it is still adopting the promoted engine
    m.live.delete(DRAFT_ENGINE);
    m.setAdopting(true);
    await driven(m, Promise.all([first, m.members.restatePrestarts()]));
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE); // held still, not ended
    // the successor's adoption ends within its bounds, and it says so
    m.live.set(DRAFT_ENGINE, APP);
    m.setAdopting(false);
    await driven(m, m.members.hostStatus({ holder: { adopting: false } }));
    expect(m.members.listingId(DRAFT_ENGINE)).toBe(APP);
    expect(m.listed.has(APP)).toBe(true);
  });

  it('scalpel-5#1: a settlement whose link drops while it waits reads nothing, whoever would answer it', async () => {
    const m = machine({ heldTurns: true });
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    m.setHidden([]); // the link's whole set leaves it out, and the host's adoptions have ended
    const first = m.members.restatePrestarts(); // its settlement waits behind RL10's turn
    await new Promise((resolve) => setImmediate(resolve));
    m.members.hostLinkLost();
    await driven(m, first);
    expect(traces(m, DRAFT_ENGINE)).toEqual(NONE);
    expect(m.reads.filter((read) => read === 'engine.sessions')).toEqual([]);
  });

  it('scalpel-5#2: a committed member replayed at a reconnect is joined on the live row that settled it, with no second read', async () => {
    const m = machine();
    await m.members.prestart(told(DRAFT_ENGINE, 'hidden'));
    await m.members.member(memberFrame(DRAFT_ENGINE));
    m.setHidden([]);
    m.live.set(DRAFT_ENGINE, APP); // committed while the link was down
    m.answering.set('engine.sessions', 1); // the settlement's read is answered; a second would fail
    await m.members.restatePrestarts();
    expect(m.members.appSessionId(DRAFT_ENGINE)).toBe(APP);
    expect(m.listed.has(APP)).toBe(true);
    expect(m.marks()).toEqual({ appSessionIds: [APP], engineSessionIds: [] });
  });
});
