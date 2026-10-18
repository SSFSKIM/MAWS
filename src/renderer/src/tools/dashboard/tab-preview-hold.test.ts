// E3 panel wave (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16 (3); R1b: "a preview is held
// while displayed"): a dashboard tab holds every snapshot a displayed history preview or suggestion review names, in one
// hold, from its display until another document is displayed or the tab ends; a preview whose snapshots change holds its
// new ones before letting the old go, and a hold the host's restart took is taken again on the same immutable refs. The
// live document is held by its own current descriptors and takes no preview hold. Retention is modelled as the store's
// rule (holds.test.ts, retention.test.ts): a snapshot no longer current, no longer pinned and not held is collected.
import { afterEach, describe, expect, it } from 'vitest';
import { setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { newDoc } from '@artifacts/yjs';
import type { MawsBridge } from '@shared/ipc/schema';
import type { DocumentTabDeps } from '../document/tab-state';
import { DashboardTabState } from './tab-state';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const AT = Date.UTC(2026, 9, 17, 9, 0);
const query = (ref: string, title = 'Live'): DatasetDescriptor => ({ title, source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at: AT } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at: AT, by: { kind: 'human' } }, state: { status: 'ok', at: AT } });

function world() {
  const doc = newDoc();
  setDataset(doc, 'live', query('assets/q1.json'));
  const state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false };
  const handle = { doc, awareness: null, state: () => state, subscribe: () => () => {}, onRestored: () => () => {}, holdRemote: () => {}, close: () => {} } as unknown as DocumentHandle;
  const holds: { refs: string[]; lose(): void; released: boolean }[] = [];
  const gone = new Set<string>(); // collected snapshots
  const host = {
    open: async () => handle,
    identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' }),
    readDataset: async (_artifactId: string, ref: string) => {
      if (gone.has(ref)) throw new Error(`the snapshot ${ref} is unavailable`);
      return { columns: [{ name: 'v', type: 'number' }], rows: [[1]], total: 1, truncated: false };
    },
    // all or none, as main's `artifacts.holdDatasets`: a collected ref fails the whole hold
    holdDatasets: async (_artifactId: string, refs: readonly string[]) => {
      if (refs.some((ref) => gone.has(ref))) throw new Error('a snapshot is unavailable');
      let lose!: () => void;
      const invalidated = new Promise<void>((resolve) => (lose = resolve));
      const entry = { refs: [...refs], lose, released: false };
      holds.push(entry);
      return { invalidated, release: () => void (entry.released = true) };
    },
  } as unknown as ArtifactHost;
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async () => ({ ok: false, error: { code: 'internal', message: 'not here' } })) as unknown as MawsBridge['invoke'],
    on: (() => () => {}) as unknown as MawsBridge['on'],
  };
  const deps: DocumentTabDeps = { host, ipc, log: () => {}, confirm: () => true, sessionTitle: () => undefined, sessions: () => [] };
  const tab = new DashboardTabState({ artifactId: A, kind: 'dashboard', surface: 'panel' }, deps);
  tabs.push(tab);
  // the store's collection of retired snapshots no current descriptor or version names: only a hold keeps them
  const collect = (retired: string[]) => {
    const held = new Set(holds.filter((hold) => !hold.released).flatMap((hold) => hold.refs));
    for (const ref of retired) if (!held.has(ref)) gone.add(ref);
  };
  return { doc, tab, holds, collect, gone };
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const tabs: DashboardTabState[] = [];
afterEach(() => {
  for (const tab of tabs.splice(0)) tab.dispose();
});
const live = (holds: { released: boolean; refs: string[] }[]) => holds.filter((hold) => !hold.released).map((hold) => [...hold.refs].sort());

async function ready() {
  const w = world();
  await expect.poll(() => w.tab.document.snapshot().ready).toBe(true);
  return w;
}

describe('a dashboard tab holds what a displayed preview names (E3 panel)', () => {
  it('holds every snapshot of a displayed version until the live document is displayed again; retention collects none meanwhile', async () => {
    const w = await ready();
    w.tab.displayed(w.doc); // the live document: its current descriptors protect it
    await settle();
    expect(w.holds).toEqual([]);
    const version = newDoc(); // a retained version's own document, its snapshots retired from the live query since
    setDataset(version, 'live', query('assets/q0.json'));
    setDataset(version, 'other', query('assets/q9.json', 'Other'));
    w.tab.displayed(version);
    await settle();
    expect(live(w.holds)).toEqual([['assets/q0.json', 'assets/q9.json']]); // one hold for the preview
    w.collect(['assets/q0.json', 'assets/q9.json']); // the version that pinned them pruned or thinned while displayed
    expect(w.gone.size).toBe(0);
    w.tab.toggleDatasets(); // the header's Datasets on the preview: its snapshots are still there to hold and read
    await settle();
    expect(w.tab.sheet.snapshot().hold).toBe('held');
    w.tab.toggleDatasets();
    w.tab.displayed(w.doc); // the preview closes
    await settle();
    expect(live(w.holds)).toEqual([]);
    w.collect(['assets/q0.json', 'assets/q9.json']);
    expect([...w.gone].sort()).toEqual(['assets/q0.json', 'assets/q9.json']);
  });

  it('a preview whose snapshots change holds the new before letting the old go; one whose refs stay takes no new hold; the tab’s end lets it go', async () => {
    const w = await ready();
    const review = newDoc(); // a suggestion review's replica
    setDataset(review, 'live', query('assets/q0.json'));
    w.tab.displayed(review);
    await settle();
    expect(live(w.holds)).toEqual([['assets/q0.json']]);
    setDataset(review, 'live', query('assets/q5.json'));
    await settle();
    expect(w.holds.map((hold) => hold.refs)).toEqual([['assets/q0.json'], ['assets/q5.json']]);
    expect(live(w.holds)).toEqual([['assets/q5.json']]);
    setDataset(review, 'live', query('assets/q5.json', 'Retitled')); // the same snapshot
    await settle();
    expect(w.holds).toHaveLength(2);
    w.tab.dispose();
    await settle(); // a group's release is sent once its hold has answered
    expect(live(w.holds)).toEqual([]);
  });

  it('a preview’s hold the host’s restart took is taken again on the same refs while it is displayed', async () => {
    const w = await ready();
    const version = newDoc();
    setDataset(version, 'live', query('assets/q0.json'));
    w.tab.displayed(version);
    await settle();
    w.holds[0]!.lose();
    await settle();
    expect(w.holds.map((hold) => hold.refs)).toEqual([['assets/q0.json'], ['assets/q0.json']]);
    expect(live(w.holds)).toEqual([['assets/q0.json']]);
    w.tab.displayed(w.doc);
    w.holds[1]!.lose(); // lost after the preview closed: nothing taken again
    await settle();
    expect(w.holds).toHaveLength(2);
    expect(live(w.holds)).toEqual([]);
  });
});
