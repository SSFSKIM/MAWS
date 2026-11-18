// The machine's sessions as sminos reports them on RL10 (src/endpoint/rl10/members.ts), as a thread's lifecycle moves
// them (docs/doperpowers/plans/2026-11-18-mw-sminos-channels.md). A lane change (Interfaces §E): a `member` frame whose
// lane is not the held one is the session leaving and arriving, so the listing under its old lane is withdrawn, once,
// and what notify keeps of it forgotten, by `gone`'s own path.
import { describe, expect, it } from 'vitest';
import type { SessionReport } from '../../../src/endpoint/listings';
import { Members } from '../../../src/endpoint/rl10/members';

const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const S1 = 'e0ad139c-18bc-45bd-9489-be8653145f80';
const S2 = 'f1be24ad-29cd-46ce-a59a-cf9764256091';
const APP = 'b4d1e2f3-0a1b-4c2d-9e3f-4a5b6c7d8e9f';

/** A `member` frame of `session` under `lane`, as sminos sends one. */
const memberFrame = (session: string, lane: 'A' | 'B', fields: Record<string, unknown> = {}): Record<string, unknown> => ({
  t: 'member',
  session,
  alias: 'main',
  project: P,
  lane,
  state: 'idle',
  title: 'the main session',
  cwd: '/work/checkout',
  owners: ['@machine'],
  ownersProof: [],
  origin: { kind: 'terminal' },
  ...fields,
});

/**
 * Members over a machine whose engine host names `live` (engine session → app session) and whose spine holds no record;
 * the listings it keeps (`listed`), every report, every withdrawal and every session notify forgets, in order. A
 * withdrawal is counted as `Listings.gone` makes one: of a session that is listed (a second of one already withdrawn
 * signs and sends nothing).
 */
function machine(live: Record<string, string> = {}) {
  const listed = new Map<string, SessionReport>();
  const reports: SessionReport[] = [];
  const withdrawn: string[] = [];
  const forgotten: string[] = [];
  const members = new Members({
    dispatch: async (_owner, name) =>
      name === 'engine.sessions'
        ? { t: 'res', id: '0', ok: true, value: Object.entries(live).map(([engineSessionId, appSessionId]) => ({ engineSessionId, appSessionId })) }
        : { t: 'res', id: '0', ok: false, error: { code: 'unknown_command', message: name } },
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
    forget: (session) => void forgotten.push(session),
    log: () => {},
    now: Date.now,
  });
  return { members, listed, reports, withdrawn, forgotten };
}

describe('a lane change', () => {
  it('from lane A to lane B withdraws the listing under the session id once, and lists the session under its app session once joined', async () => {
    const m = machine({ [S1]: APP });
    await m.members.member(memberFrame(S1, 'A'));
    expect([...m.listed.keys()]).toEqual([S1]);
    await m.members.member(memberFrame(S1, 'B'));
    expect(m.withdrawn).toEqual([S1]);
    expect(m.forgotten).toEqual([S1]);
    expect(m.reports.map((r) => [r.session, r.lane])).toEqual([
      [S1, 'A'],
      [APP, 'B'],
    ]);
    expect([...m.listed.keys()]).toEqual([APP]);
    expect(m.members.listingId(S1)).toBe(APP);
  });

  it('from lane B to lane A withdraws the listing under the app session id, and lists the session under its own', async () => {
    const m = machine({ [S1]: APP });
    await m.members.member(memberFrame(S1, 'B'));
    expect([...m.listed.keys()]).toEqual([APP]);
    await m.members.member(memberFrame(S1, 'A'));
    expect(m.withdrawn).toEqual([APP]);
    expect(m.forgotten).toEqual([APP]);
    expect([...m.listed.keys()]).toEqual([S1]);
    expect(m.members.appSessionId(S1)).toBeNull();
    expect(m.members.recordOf(S1)).toMatchObject({ session: S1, lane: 'A' });
  });

  it('from lane B to lane A withdraws nothing while another held member still reports under the app session', async () => {
    // a `/clear` left two engine sessions joined to one app session; one of them is now a lane A session of its own
    const m = machine({ [S1]: APP, [S2]: APP });
    await m.members.member(memberFrame(S1, 'B'));
    await m.members.member(memberFrame(S2, 'B'));
    await m.members.member(memberFrame(S1, 'A'));
    expect(m.withdrawn).toEqual([]);
    expect(m.forgotten).toEqual([]);
    expect([...m.listed.keys()].sort()).toEqual([APP, S1].sort());
    expect(m.members.listingId(S2)).toBe(APP);
  });

  it('withdraws nothing for a frame that keeps the lane', async () => {
    const m = machine({ [S2]: APP });
    await m.members.member(memberFrame(S1, 'A'));
    await m.members.member(memberFrame(S1, 'A', { title: 'renamed', state: 'busy' }));
    await m.members.member(memberFrame(S2, 'B'));
    await m.members.member(memberFrame(S2, 'B', { state: 'busy' }));
    expect(m.withdrawn).toEqual([]);
    expect(m.forgotten).toEqual([]);
    expect([...m.listed.keys()].sort()).toEqual([APP, S1].sort());
  });

  it('withdraws once for a gone followed by the other lane’s frame, as a sminos that sends its own gone does', async () => {
    const m = machine({ [S1]: APP });
    await m.members.member(memberFrame(S1, 'A'));
    await m.members.member({ t: 'member', session: S1, gone: true });
    await m.members.member(memberFrame(S1, 'B'));
    expect(m.withdrawn).toEqual([S1]);
    expect([...m.listed.keys()]).toEqual([APP]);
  });

  it('withdraws the old listing once inside a restatement, and the restatement withdraws nothing more', async () => {
    const m = machine({ [S1]: APP });
    await m.members.member(memberFrame(S1, 'A'));
    m.members.welcome();
    await m.members.member(memberFrame(S1, 'B'));
    await m.members.restated();
    expect(m.withdrawn).toEqual([S1]);
    expect([...m.listed.keys()]).toEqual([APP]);
    const back = machine({ [S1]: APP });
    await back.members.member(memberFrame(S1, 'B'));
    back.members.welcome();
    await back.members.member(memberFrame(S1, 'A'));
    await back.members.restated();
    expect(back.withdrawn).toEqual([APP]);
    expect([...back.listed.keys()]).toEqual([S1]);
  });
});
