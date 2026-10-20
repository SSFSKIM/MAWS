// E3 panel wave (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16 (3); R1b: "a preview is held
// while displayed"): a dashboard tab holds every snapshot a displayed history preview or suggestion review names, in one
// hold, from its display until another document is displayed or the tab ends; a preview whose snapshots change holds its
// new ones before letting the old go, and a hold the host's restart took is taken again on the same immutable refs. The
// live document is held by its own current descriptors and takes no preview hold. Retention is modelled as the store's
// rule (holds.test.ts, retention.test.ts): a snapshot no longer current, no longer pinned and not held is collected.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { newDoc } from '@artifacts/yjs';
import type { MawsBridge } from '@shared/ipc/schema';
import type { DocumentTabDeps } from '../document/tab-state';
import { PREVIEW_HOLD_RETRY_MS } from './preview-hold'; // E3 panel residual
import { DashboardTabState } from './tab-state';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const AT = Date.UTC(2026, 9, 17, 9, 0);
const query = (ref: string, title = 'Live'): DatasetDescriptor => ({ title, source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at: AT } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at: AT, by: { kind: 'human' } }, state: { status: 'ok', at: AT } });

function world() {
  const doc = newDoc();
  setDataset(doc, 'live', query('assets/q1.json'));
  const state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
  const handle = { doc, awareness: null, state: () => state, subscribe: () => () => {}, onRestored: () => () => {}, holdRemote: () => {}, close: () => {} } as unknown as DocumentHandle;
  const holds: { refs: string[]; lose(): void; released: boolean }[] = [];
  const gone = new Set<string>(); // collected snapshots
  const refusing = { next: 0 }; // E3 panel residual: how many hold requests a hold cap refuses next
  // a shown body opens its live datasets' connector surface (E3 M3); nothing here needs it to answer more
  const surface = { declareTools: async () => ({ ok: false, state: 'invalid', reason: 'lease' }), callTool: async () => ({ ok: false, state: 'invalid', reason: 'lease' }), watchTool: async () => ({ ok: false, state: 'invalid', reason: 'lease' }), unwatchTool: async () => false, refreshWatch: async () => false, setVisible: () => {}, close: () => {} };
  const host = {
    open: async () => handle,
    openConnectors: () => surface,
    connectorGrants: async () => [],
    identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' }),
    readDataset: async (_artifactId: string, ref: string) => {
      if (gone.has(ref)) throw new Error(`the snapshot ${ref} is unavailable`);
      return { columns: [{ name: 'v', type: 'number' }], rows: [[1]], total: 1, truncated: false };
    },
    // all or none, as main's `artifacts.holdDatasets`: a collected ref fails the whole hold
    holdDatasets: async (_artifactId: string, refs: readonly string[]) => {
      if (refs.some((ref) => gone.has(ref))) throw new Error('a snapshot is unavailable');
      if (refusing.next > 0) {
        refusing.next -= 1;
        throw new Error('the artifact holds 64 reads already');
      }
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
  return { doc, tab, holds, collect, gone, refusing };
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const tabs: DashboardTabState[] = [];
afterEach(() => {
  vi.useRealTimers();
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

// E3 panel residual (the retained high review's two findings): a lease counts as held only once it is ready; a failed
// acquisition is asked again boundedly, a failed replacement keeps the earlier hold, and the body's unmount (its tab
// inactive: B's history drops the preview with it) lets the hold go for good, unlike its window merely hiding.
describe('a dashboard tab’s preview hold, its failures and its body (E3 panel residual)', () => {
  it('a hold refused at its acquisition (a hold cap) is not taken for held: it is asked again, then held', async () => {
    const w = await ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    w.refusing.next = 1;
    const version = newDoc();
    setDataset(version, 'live', query('assets/q0.json'));
    w.tab.displayed(version);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.holds).toEqual([]); // refused: nothing held
    setDataset(version, 'live', query('assets/q0.json', 'Retitled')); // an update naming the same snapshot
    await vi.advanceTimersByTimeAsync(PREVIEW_HOLD_RETRY_MS[0]!);
    expect(live(w.holds)).toEqual([['assets/q0.json']]);
    w.collect(['assets/q0.json']);
    expect(w.gone.size).toBe(0);
  });

  it('a replacement whose acquisition fails keeps the earlier hold, so a snapshot both show is never let go', async () => {
    const w = await ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const review = newDoc();
    setDataset(review, 'live', query('assets/q0.json'));
    setDataset(review, 'shared', query('assets/s.json', 'Shared'));
    w.tab.displayed(review);
    await vi.advanceTimersByTimeAsync(0);
    expect(live(w.holds)).toEqual([['assets/q0.json', 'assets/s.json']]);
    w.refusing.next = PREVIEW_HOLD_RETRY_MS.length + 1; // every try of the replacement refused
    setDataset(review, 'live', query('assets/q5.json'));
    for (const wait of [0, ...PREVIEW_HOLD_RETRY_MS]) await vi.advanceTimersByTimeAsync(wait);
    expect(live(w.holds)).toEqual([['assets/q0.json', 'assets/s.json']]);
    w.collect(['assets/s.json']);
    expect(w.gone.size).toBe(0); // the shared snapshot stayed protected throughout
  });

  it('the body’s unmount lets the preview’s hold go and takes nothing again; its window hiding keeps it', async () => {
    const w = await ready();
    w.tab.setBodyShown(true);
    const version = newDoc();
    setDataset(version, 'live', query('assets/q0.json'));
    w.tab.displayed(version);
    await settle();
    w.tab.setBodyShown(false); // the window hid: the body and its preview are still there
    await settle();
    expect(live(w.holds)).toEqual([['assets/q0.json']]);
    w.tab.setBodyShown(true);
    w.tab.setBodyShown(false);
    w.tab.bodyUnmounted(); // the tab went inactive: its body, and the preview with it, are gone
    await settle();
    expect(live(w.holds)).toEqual([]);
    w.holds[0]!.lose(); // a host restart after: nothing is taken again
    await settle();
    expect(w.holds).toHaveLength(1);
    w.tab.toggleDatasets(); // what the tab now names its shown datasets is the live document's
    expect(w.tab.sheet.snapshot().datasets.map(({ descriptor }) => descriptor.source.kind === 'query' && descriptor.source.snapshot?.ref)).toEqual(['assets/q1.json']);
  });
});
