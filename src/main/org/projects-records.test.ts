// The projects records main holds (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md, M10's
// Proves, "the marks' rules"; Interfaces §I): each verified against the held head, kept per machine at its highest
// revision, a lower one passed by and one at the mark with other content a conflict; the hub's snapshot removes nothing;
// a record that fails at arrival waits for a head it verifies under; a record leaves only when it stops verifying, and a
// retired key's mark goes with it; the file is verified again at load; another org's is discarded; `seen` is the later
// of a link's last up and the newest record's issue. A fake feed and session over real signed states and records.
import { afterEach, describe, expect, it } from 'vitest';
import { generateSigningKey, keyId, type ProjectsRecord, type Signed } from '../../../apps/org-protocol/src/index.ts';
import { iso } from '../../../test/endpoint/org-fixtures';
import { fakeFeed, HOUR, location, memoryFiles, random, World, type Machine } from '../../../test/org/rows-world';
import { createProjectsRecords, PROJECTS_FILE, type ProjectsFile, type ProjectsRecords } from './projects-records';

const running: ProjectsRecords[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) await r.close();
});

async function start(w: World, files = memoryFiles()) {
  const feed = fakeFeed();
  const logs: string[] = [];
  let changes = 0;
  const records = createProjectsRecords({ session: w.session, feed: feed.feed, files, now: () => w.clock, timing: { ROWS_CACHE_WRITE_MS: 1 }, log: (line) => logs.push(line) });
  records.onChanged(() => changes++);
  running.push(records);
  await records.loaded;
  return {
    records,
    feed,
    files,
    logs,
    changes: () => changes,
    /** Each held record as `<machine> r<revision>`, by machine. */
    held: () => records.records().map((r) => `${r.machine === w.m1.ref ? 'm1' : r.machine === w.m2.ref ? 'm2' : r.machine} r${r.revision}`),
    async page(list: Signed<ProjectsRecord>[], last = true) {
      feed.projectsPage(list, last);
      await records.settled();
    },
    async push(record: Signed<ProjectsRecord>) {
      feed.projectsRecord(record);
      await records.settled();
    },
    file: () => JSON.parse(files.store.get(PROJECTS_FILE) ?? 'null') as ProjectsFile | null,
  };
}
type Harness = Awaited<ReturnType<typeof start>>;

async function relaunch(w: World, h: Harness): Promise<Harness> {
  await h.records.close();
  running.splice(running.indexOf(h.records), 1);
  return start(w, h.files);
}

const ID = '1b3c2f0e-6a4d-4a36-9f53-2d2f1d0c1a01';

describe('the marks', () => {
  it('hold a verified record per machine at its highest revision; a lower one passes by, one at the mark with other content is a conflict', async () => {
    const w = await World.make();
    const h = await start(w);
    await h.page([await w.projects(w.m1, 5, [location('p1', ID, '/srv/a')]), await w.projects(w.m2, 3)]);
    expect(h.held()).toEqual(['m1 r5', 'm2 r3']);
    await h.push(await w.projects(w.m1, 4, [location('p9', ID, '/srv/old')]));
    expect(h.held()).toEqual(['m1 r5', 'm2 r3']);
    await h.push(await w.projects(w.m1, 5, [location('p2', ID, '/srv/other')]));
    expect(h.records.records()[0].locations.map((l) => l.path)).toEqual(['/srv/a']);
    expect(h.logs.some((line) => line.includes('conflicting'))).toBe(true);
    await h.push(await w.projects(w.m1, 6, [location('p1', ID, '/srv/a'), location('p2', ID, '/srv/b')]));
    expect(h.held()).toEqual(['m1 r6', 'm2 r3']);
    expect(h.records.records()[0].locations).toHaveLength(2);
  });

  it('take no record that does not verify, nor one of another org or of no record’s shape', async () => {
    const w = await World.make();
    const h = await start(w);
    const stranger: Machine = { ref: w.m1.ref, key: await generateSigningKey() };
    await h.page([await w.projects(stranger, 9), await w.projects(w.m2, 2, [], [], 'another-org'), { body: { machine: w.m2.ref }, sig: 'x' } as never]);
    expect(h.held()).toEqual([]);
    // the genuine record at a lower revision still lands: a record that never verified set no mark
    await h.push(await w.projects(w.m1, 1));
    expect(h.held()).toEqual(['m1 r1']);
  });

  it('are not moved by the hub’s snapshot: a machine a later snapshot lacks keeps its record', async () => {
    const w = await World.make();
    const h = await start(w);
    await h.page([await w.projects(w.m1, 5), await w.projects(w.m2, 3)]);
    h.feed.open();
    await h.page([await w.projects(w.m2, 3)]);
    expect(h.held()).toEqual(['m1 r5', 'm2 r3']);
  });

  it('let a record that failed at arrival land once a head lets its key speak', async () => {
    const w = await World.make();
    const h = await start(w);
    const late: Machine = { ref: `m3${random(20)}`, key: await generateSigningKey() };
    await h.push(await w.projects(late, 2, [location('p1', ID, '/srv/late')]));
    expect(h.held()).toEqual([]);
    await w.adopt((s) => {
      s.machines.push({ name: 'mac-three', ref: late.ref, pub: late.key.pub, owners: [w.A] });
      s.machineNames.push({ name: 'mac-three', ref: late.ref });
    });
    await h.records.settled();
    expect(h.held()).toEqual([`${late.ref} r2`]);
  });

  it('drop a record that stops verifying under a new head, and a retired key’s mark with it: its replay never lands', async () => {
    const w = await World.make();
    const h = await start(w);
    const r1 = await w.projects(w.m1, 5, [location('p1', ID, '/srv/a')]);
    await h.page([r1, await w.projects(w.m2, 3)]);
    const pub = w.m1.key.pub;
    await w.adopt(async (s) => {
      s.retired.push({ keyId: await keyId(pub), pub, notAfter: iso(w.clock - HOUR), holder: { machine: w.m1.ref } });
      s.machines = s.machines.filter((m) => m.ref !== w.m1.ref);
    });
    await h.records.settled();
    expect(h.held()).toEqual(['m2 r3']);
    expect(h.file()?.marks[w.m1.ref]).toBeUndefined();
    await h.push(r1);
    expect(h.held()).toEqual(['m2 r3']);
  });
});

describe('the file', () => {
  it('keeps the records across a relaunch, verified again at load, and tells the change', async () => {
    const w = await World.make();
    let h = await start(w);
    await h.page([await w.projects(w.m1, 5, [location('p1', ID, '/srv/a')])]);
    expect(h.changes()).toBeGreaterThan(0);
    h = await relaunch(w, h);
    expect(h.held()).toEqual(['m1 r5']);
    // its mark held too: a lower revision passes by
    await h.push(await w.projects(w.m1, 4));
    expect(h.held()).toEqual(['m1 r5']);
  });

  it('holds no record a later head no longer verifies at load, and discards another org’s file', async () => {
    const w = await World.make();
    let h = await start(w);
    await h.page([await w.projects(w.m1, 5), await w.projects(w.m2, 3)]);
    await h.records.close();
    const pub = w.m2.key.pub;
    await w.adopt(async (s) => {
      s.revoked.push({ keyId: await keyId(pub), holder: { machine: w.m2.ref } });
      s.machines = s.machines.filter((m) => m.ref !== w.m2.ref);
    });
    h = await relaunch(w, h);
    expect(h.held()).toEqual(['m1 r5']);
    await h.records.close();
    running.splice(running.indexOf(h.records), 1);
    h.files.store.set(PROJECTS_FILE, JSON.stringify({ ...h.file()!, org: 'another-org' }));
    h = await start(w, h.files);
    expect(h.held()).toEqual([]);
    expect(h.logs.some((line) => line.includes('another org'))).toBe(true);
  });

  it('reads nothing signed out, and holds what it has for the next sign-in', async () => {
    const w = await World.make();
    const h = await start(w);
    await h.page([await w.projects(w.m1, 5)]);
    w.session.set(null);
    await h.records.settled();
    expect(h.held()).toEqual([]);
    w.session.set(w.signedIn());
    await h.records.settled();
    expect(h.held()).toEqual(['m1 r5']);
  });
});

describe('seen', () => {
  it('is per machine the later of its link’s last up and its newest record’s issue, kept across a relaunch', async () => {
    const w = await World.make();
    let h = await start(w);
    const issued = w.clock;
    await h.page([await w.projects(w.m1, 5), await w.projects(w.m2, 3)]);
    w.clock += HOUR;
    h.records.linkSeen(w.m1.ref);
    await h.records.settled();
    expect(h.records.seen()).toEqual({ [w.m1.ref]: iso(issued + HOUR), [w.m2.ref]: iso(issued) });
    h = await relaunch(w, h);
    expect(h.records.seen()[w.m1.ref]).toBe(iso(issued + HOUR));
    w.clock += HOUR;
    await h.push(await w.projects(w.m1, 6));
    expect(h.records.seen()[w.m1.ref]).toBe(iso(issued + 2 * HOUR));
  });
});
