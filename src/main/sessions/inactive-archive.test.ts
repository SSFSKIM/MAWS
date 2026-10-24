import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { item, status } from '../../../test/support/builders';
import { summary } from '../../../test/support/index-fixture';
import { SessionHarness } from '../../../test/support/session-harness';
import type { AppSessionId } from '@shared/graph/ids';
import { InactiveArchive, scheduleInactiveArchive } from './inactive-archive';

it('does not stop a process reserved while the eligibility check was in flight', async () => {
  const record = h.index.sessions.upsertFromSummary(summary({ directory: h.work })).record;
  const outcome = await h.service.archive(record.appId, { onlyIfIdle: true, eligible: async () => { h.host.reserve(record.appId); return true; } });
  expect(outcome).toMatchObject({ status: 'skipped_live' });
  expect(h.host.calledWith('session.stop')).toEqual([]);
  expect(h.index.sessions.get(record.appId)?.archived).toBe(false);
});

let h: SessionHarness;
beforeEach(async () => { h = await new SessionHarness().start(); });
afterEach(() => h.dispose());

it('archives only old safe sessions and keeps pinned, waiting, live, background-running and dirty worktree sessions', async () => {
  const old = '2026-09-01T00:00:00.000Z';
  const records = Array.from({ length: 7 }, () => h.index.sessions.upsertFromSummary(summary({ directory: h.work, lastRecordAt: old })).record);
  h.index.sessions.setPinned(records[1].appId, true);
  await h.index.attention.replaceForSession(records[2].appId, [item(records[2].appId, 'question', old)]);
  h.index.sessions.update(records[5].appId, { worktree: { path: '/dirty', branch: 'feature' } });
  h.index.sessions.upsertFromSummary({ ...h.index.sessions.summaryOf(records[6].appId)!, lastRecordAt: '2026-10-23T00:00:00.000Z' });
  const statuses = new Map([
    [records[3].appId, status(records[3].appId)],
    [records[4].appId, { ...status(records[4].appId, { process: 'exited' }), keepAlive: ['background_tasks' as const] }],
  ]);
  const archiver = new InactiveArchive({ discovered: () => true,
    index: h.index, status: (id) => statuses.get(id) ?? null, waiting: () => false,
    git: async () => ' M changed.txt\n', archive: (id, eligible, stillEligible) => h.service.archive(id, { onlyIfIdle: true, eligible, stillEligible }),
    now: () => Date.parse('2026-10-24T00:00:00.000Z'),
  });
  const result = await archiver.run(7, null);
  expect(records.map((r) => h.index.sessions.get(r.appId)!.archived)).toEqual([true, false, false, false, false, false, false]);
  expect(result).toEqual({ archived: 1, skipped: 6 });
  expect(records.filter((r) => h.index.sessions.get(r.appId)!.archived).map((r) => r.appId)).toEqual([records[0].appId]);
  expect(h.host.calledWith('session.stop')).toEqual([]);
});

it('rechecks eligibility inside archive after a worktree read, leaving newly pinned work untouched', async () => {
  const record = h.index.sessions.upsertFromSummary(summary({ directory: h.work, lastRecordAt: '2026-09-01T00:00:00.000Z' })).record;
  h.index.sessions.update(record.appId, { worktree: { path: '/clean', branch: 'feature' } });
  const archiver = new InactiveArchive({ discovered: () => true, index: h.index, status: () => null, waiting: () => false,
    git: async () => { h.index.sessions.setPinned(record.appId, true); return ''; },
    archive: (id: AppSessionId, eligible, stillEligible) => h.service.archive(id, { onlyIfIdle: true, eligible, stillEligible }),
    now: () => Date.parse('2026-10-24T00:00:00.000Z'),
  });
  expect(await archiver.run(7, null)).toEqual({ archived: 0, skipped: 1 });
  expect(h.index.sessions.get(record.appId)?.archived).toBe(false);
});

it('does nothing until the owner opts in, and stops scheduling when disabled', async () => {
  const record = h.index.sessions.upsertFromSummary(summary({ directory: h.work, lastRecordAt: '2026-09-01T00:00:00.000Z' })).record;
  const archiver = new InactiveArchive({ discovered: () => true, index: h.index, status: () => null, waiting: () => false, git: async () => '',
    archive: (id, eligible, stillEligible) => h.service.archive(id, { onlyIfIdle: true, eligible, stillEligible }),
    now: () => Date.parse('2026-10-24T00:00:00.000Z'),
  });
  let days: 7 | null = null;
  let changed = () => {};
  const stop = scheduleInactiveArchive(archiver, () => days, (listener) => { changed = listener; return () => {}; }, () => () => {});
  try {
    await Promise.resolve();
    expect(h.index.sessions.get(record.appId)?.archived).toBe(false);
    days = 7; changed();
    await vi.waitFor(() => expect(h.index.sessions.get(record.appId)?.archived).toBe(true));
    days = null; changed();
    const later = h.index.sessions.upsertFromSummary(summary({ directory: h.work, lastRecordAt: '2026-09-01T00:00:00.000Z' })).record;
    changed();
    await Promise.resolve();
    expect(h.index.sessions.get(later.appId)?.archived).toBe(false);
  } finally { stop(); }
});

// l1-sessions-13 review: no sweep reads the index before the store's scan has answered; the scan's answer starts one.
it('the automatic sweep waits for the scan, then runs once it answers', async () => {
  const record = h.index.sessions.upsertFromSummary(summary({ directory: h.work, lastRecordAt: '2026-09-01T00:00:00.000Z' })).record;
  let current = false;
  const archiver = new InactiveArchive({ discovered: () => current, index: h.index, status: () => null, waiting: () => false, git: async () => '',
    archive: (id, eligible, stillEligible) => h.service.archive(id, { onlyIfIdle: true, eligible, stillEligible }),
    now: () => Date.parse('2026-10-24T00:00:00.000Z'),
  });
  let scanned = () => {};
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const stop = scheduleInactiveArchive(archiver, () => 7, () => () => {}, (listener) => { scanned = listener; return () => {}; });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(h.index.sessions.get(record.appId)?.archived).toBe(false);
    expect(warn).not.toHaveBeenCalled(); // waiting is not a failure
    current = true;
    scanned();
    await vi.waitFor(() => expect(h.index.sessions.get(record.appId)?.archived).toBe(true));
  } finally { stop(); warn.mockRestore(); }
});

// Coordinator ruling: a session open in a tab is one the owner keeps in view, so the automatic sweep keeps it; the
// project command archives it (the renderer closes its tab on the archive's change).
it('the automatic sweep keeps a session open in a tab; the explicit command archives it', async () => {
  const old = '2026-09-01T00:00:00.000Z';
  const [open, closed] = [0, 1].map(() => h.index.sessions.upsertFromSummary(summary({ directory: h.work, lastRecordAt: old })).record);
  const archiver = new InactiveArchive({ discovered: () => true, index: h.index, status: () => null, waiting: () => false, git: async () => '',
    open: (id) => id === open.appId,
    archive: (id, eligible, stillEligible) => h.service.archive(id, { onlyIfIdle: true, eligible, stillEligible }),
    now: () => Date.parse('2026-10-24T00:00:00.000Z'),
  });
  expect(await archiver.run(7, null, { automatic: true })).toEqual({ archived: 1, skipped: 1 });
  expect([open, closed].map((r) => h.index.sessions.get(r.appId)!.archived)).toEqual([false, true]);
  expect(await archiver.run(7, null)).toEqual({ archived: 1, skipped: 0 });
  expect(h.index.sessions.get(open.appId)!.archived).toBe(true);
});
