// The machines the signed-in member holds a grant on (the project registry, docs/doperpowers/plans/2026-11-10-project-
// registry.md, M10's decision "What a member sees"; design §11): read from each machine's own ledger (`endpoint.grants`,
// the caller's own entry) when its link is up, kept for the member across a relaunch, a failed read changing nothing.
import { afterEach, describe, expect, it } from 'vitest';
import type { CallResult } from '../machines/remote/link';
import { memoryFiles, World } from '../../../test/org/rows-world';
import { createMemberGrants, MEMBER_GRANTS_FILE, type MemberGrants } from './member-grants';

const running: MemberGrants[] = [];
afterEach(async () => {
  for (const g of running.splice(0)) await g.close();
});

const entry = (member: string, rights: string[] | null) => ({
  member,
  grant: rights === null ? null : { body: { org: 'o', machine: 'm', machineKey: 'k', member, rights, version: 1, issued: '2026-11-10T00:00:00.000Z' }, sig: { kid: 'kid', value: 'sig' } },
  highWater: rights === null ? 0 : 1,
});

async function start(w: World, files = memoryFiles()) {
  const answers: CallResult[] = [];
  const asked: string[] = [];
  const grants = createMemberGrants({
    session: w.session,
    files,
    call: async (ref, name) => {
      asked.push(`${ref} ${name}`);
      return answers.shift() ?? { ok: false, error: { code: 'offline' } };
    },
    log: () => {},
  });
  running.push(grants);
  await grants.loaded;
  return { grants, files, answers, asked, read: async (ref: string) => (grants.read(ref), await grants.settled()) };
}

describe('the member’s grants', () => {
  it('are read from the machine’s ledger: the member’s own entry, with rights', async () => {
    const w = await World.make();
    const h = await start(w);
    h.answers.push({ ok: true, output: { members: [entry(w.A, ['spawn'])] } });
    await h.read(w.m2.ref);
    expect(h.asked).toEqual([`${w.m2.ref} endpoint.grants`]);
    expect(h.grants.granted(w.m2.ref)).toBe(true);
    h.answers.push({ ok: true, output: { members: [entry(w.A, [])] } }); // withdrawn
    await h.read(w.m2.ref);
    expect(h.grants.granted(w.m2.ref)).toBe(false);
    h.answers.push({ ok: true, output: { members: [entry(w.B, ['shell'])] } }); // another member's entry is not theirs
    await h.read(w.m2.ref);
    expect(h.grants.granted(w.m2.ref)).toBe(false);
  });

  it('keep the last answer through a failed or malformed read, and across a relaunch, for that member alone', async () => {
    const w = await World.make();
    let h = await start(w);
    h.answers.push({ ok: true, output: { members: [entry(w.A, ['machine-admin'])] } }, { ok: false, error: { code: 'offline' } }, { ok: true, output: { members: 'none' } });
    await h.read(w.m2.ref);
    await h.read(w.m2.ref);
    await h.read(w.m2.ref);
    expect(h.grants.granted(w.m2.ref)).toBe(true);
    await h.grants.close();
    running.splice(0);
    expect(JSON.parse(h.files.store.get(MEMBER_GRANTS_FILE)!)).toMatchObject({ version: 1, member: w.A, granted: [w.m2.ref] });
    h = await start(w, h.files);
    expect(h.grants.granted(w.m2.ref)).toBe(true);
    w.session.set(w.signedIn(w.B));
    await h.grants.settled();
    expect(h.grants.granted(w.m2.ref)).toBe(false);
  });
});
