// A prestart's member (ticket 851, docs/doperpowers/plans/2026-11-24-prestart-engine.md, R4-6 and D11): a lane B member
// whose engine session the engine host holds hidden (a New chat's engine started at the first keystroke, not yet sent)
// is held by the endpoint with no handed-off mark, no record, no project presence and no listing; at its commit it is
// processed as a member that has just arrived, and at its end it is dropped with no trace. The orderings: the member
// before or after its `hidden`, a `committed` with no member yet, a member after its `ended`, a frame newer than the one
// held, and the hidden set read whole at a link with an event heard while the read is out. D11's re-join: an unjoined
// lane B member is joined when the spine says a record names its engine session. An ordinary unjoined member keeps
// today's marks.
import { describe, expect, it } from 'vitest';
import type { SessionReport } from '../../../src/endpoint/listings';
import { Members, type Marks } from '../../../src/endpoint/rl10/members';

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
  const members = new Members({
    dispatch: async (_owner, name) => {
      reads.push(name);
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
