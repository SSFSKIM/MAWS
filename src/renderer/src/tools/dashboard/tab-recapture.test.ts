// E3 M1 fix wave (task review finding 6; the architect's restart ruling): when the engine host restarts under an open
// source sheet, the dashboard tab recaptures the latest only once the displayed document has synced again after the
// sheet's hold was taken (never relabelling the old descriptors as latest), holds it afresh and reopens the sheet on
// that one capture; if the document does not sync again within the bound, the sheet says the snapshot is unavailable.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeDataset, setDataset, type DatasetDescriptor } from '@artifacts/dashboard/datasets';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { newDoc } from '@artifacts/yjs';
import type { MawsBridge } from '@shared/ipc/schema';
import type { DocumentTabDeps } from '../document/tab-state';
import { RECAPTURE_SYNC_MS, DashboardTabState } from './tab-state';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const AT = Date.UTC(2026, 9, 17, 9, 0);
const live = (ref: string, title = 'Live'): DatasetDescriptor => ({ title, source: { kind: 'query', server: 'fixture', tool: 'rows', args: {}, snapshot: { ref, at: AT } }, columns: [{ name: 'v', type: 'number' }], rows: 1, updated: { at: AT, by: { kind: 'human' } }, state: { status: 'ok', at: AT } });

function world() {
  const doc = newDoc();
  setDataset(doc, 'live', live('assets/q1.json'));
  let state: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, integrated: 0, readOnly: false };
  const listeners = new Set<(state: DocumentState) => void>();
  const handle = { doc, awareness: null, state: () => state, subscribe: (listener: (s: DocumentState) => void) => (listeners.add(listener), () => listeners.delete(listener)), onRestored: () => () => {}, holdRemote: () => {}, close: () => {} } as unknown as DocumentHandle;
  const setState = (next: Partial<DocumentState>) => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener(state);
  };
  const holds: { refs: string[]; lose(): void; released: boolean }[] = [];
  const host = {
    open: async () => handle,
    identity: () => ({ actor: { kind: 'human' }, name: 'Owner', color: '--author-1' }),
    readDataset: async () => ({ columns: [{ name: 'v', type: 'number' }], rows: [[1]], total: 1, truncated: false }),
    holdDatasets: async (_artifactId: string, refs: readonly string[]) => {
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
  return { doc, tab, holds, setState };
}
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const tabs: DashboardTabState[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const tab of tabs.splice(0)) tab.dispose();
});

async function opened() {
  const w = world();
  tabs.push(w.tab);
  await vi.waitFor(() => expect(w.tab.document.snapshot().ready).toBe(true));
  w.tab.displayed(w.doc);
  w.tab.toggleDatasets();
  await settle();
  expect(w.holds.map((hold) => hold.refs)).toEqual([['assets/q1.json']]);
  expect(w.tab.sheet.snapshot().hold).toBe('held');
  return w;
}

describe('the dashboard tab’s source sheet across a host restart (E3)', () => {
  it('waits for the displayed document to sync again, then reopens the sheet on the latest, held afresh', async () => {
    const w = await opened();
    w.setState({ phase: 'off', synced: false }); // the host went: the replica's port closed
    w.holds[0]!.lose(); // its hold went with it
    await settle();
    expect(w.tab.sheet.snapshot().hold).toBe('pending');
    expect(w.holds).toHaveLength(1); // nothing recaptured from the stale document
    setDataset(w.doc, 'live', live('assets/q2.json', 'Live, later')); // what the restarted host's sync brings
    w.setState({ phase: 'live', synced: true });
    await settle();
    expect(w.holds.map((hold) => hold.refs)).toEqual([['assets/q1.json'], ['assets/q2.json']]);
    expect(w.holds[0]!.released).toBe(true);
    const snapshot = w.tab.sheet.snapshot();
    expect(snapshot.datasets.map(({ descriptor }) => descriptor.title)).toEqual(['Live, later']);
    expect(snapshot.hold).toBe('held');
  });

  it('a document already synced again when the loss is heard is fresh: it recaptures at once', async () => {
    const w = await opened();
    w.setState({ phase: 'off', synced: false });
    setDataset(w.doc, 'live', live('assets/q3.json'));
    w.setState({ phase: 'live', synced: true });
    w.holds[0]!.lose();
    await settle();
    expect(w.holds.map((hold) => hold.refs)).toEqual([['assets/q1.json'], ['assets/q3.json']]);
    expect(w.tab.sheet.snapshot().hold).toBe('held');
  });

  // E3 panel wave (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md, Decision Log 16 (4)): the freshness is the
  // synchronization that follows the host's loss, compared across it, never an earlier reconnect's
  it('a reconnect between the opening and the restart does not count: it waits for the restarted replica’s sync', async () => {
    const w = await opened();
    w.setState({ phase: 'off', synced: false }); // the document's port reconnects; the hold is untouched
    w.setState({ phase: 'live', synced: true });
    await settle();
    expect(w.tab.sheet.snapshot().hold).toBe('held');
    expect(w.holds).toHaveLength(1);
    w.setState({ phase: 'off', synced: false }); // then the host restarts: the replica's port closes, its hold goes
    w.holds[0]!.lose();
    await settle();
    expect(w.tab.sheet.snapshot().hold).toBe('pending');
    expect(w.holds).toHaveLength(1); // nothing recaptured from the stale document
    setDataset(w.doc, 'live', live('assets/q2.json', 'Live, later')); // what the restarted host's sync brings
    w.setState({ phase: 'live', synced: true });
    await settle();
    expect(w.holds.map((hold) => hold.refs)).toEqual([['assets/q1.json'], ['assets/q2.json']]);
    expect(w.tab.sheet.snapshot().datasets.map(({ descriptor }) => descriptor.title)).toEqual(['Live, later']);
    expect(w.tab.sheet.snapshot().hold).toBe('held');
  });

  it('a document that does not sync again within the bound leaves the sheet unavailable', async () => {
    const w = await opened();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    w.holds[0]!.lose();
    await vi.advanceTimersByTimeAsync(RECAPTURE_SYNC_MS);
    vi.useRealTimers();
    await settle();
    expect(w.tab.sheet.snapshot().hold).toBe('unavailable');
    expect(w.holds).toHaveLength(1);
  });
});

// P3-F dashboard-live-ui wave (scalpel-1#1): the recapture reads the document the sheet was opened on, never whatever the
// editor displays by the restart, and the sheet keeps its own preview flag: the live document's latest for a sheet opened
// on it behind a history preview, and the version's own descriptors for one opened on the version
describe('the dashboard tab’s source sheet recaptures from the document it was opened on (P3-F)', () => {
  const versionOf = () => {
    const version = newDoc(); // a retained version's own document
    setDataset(version, 'live', live('assets/q0.json', 'Version'));
    return version;
  };
  const restart = async (w: Awaited<ReturnType<typeof opened>>, hold: number) => {
    w.setState({ phase: 'off', synced: false }); // the host went: the replica's port closed and the sheet's hold with it
    w.holds[hold]!.lose();
    await settle();
    setDataset(w.doc, 'live', live('assets/q2.json', 'Live, later')); // what the restarted host's sync brings
    w.setState({ phase: 'live', synced: true });
    await settle();
  };

  it('opened on the live document, a history preview displayed meanwhile: the live latest, never the version, still no preview', async () => {
    const w = await opened();
    expect(w.tab.sheet.snapshot().preview).toBe(false);
    w.tab.document.setPreviewing(true); // the owner opens a version in history
    w.tab.displayed(versionOf());
    await settle();
    await restart(w, 0);
    const snapshot = w.tab.sheet.snapshot();
    expect(snapshot.datasets.map(({ descriptor }) => descriptor.title)).toEqual(['Live, later']);
    expect(snapshot.preview).toBe(false);
    expect(w.holds.at(-1)!.refs).toEqual(['assets/q2.json']);
    expect(snapshot.hold).toBe('held');
  });

  it('opened on a version, the live document displayed again since: the version’s own, still a preview', async () => {
    const w = world();
    tabs.push(w.tab);
    await vi.waitFor(() => expect(w.tab.document.snapshot().ready).toBe(true));
    w.tab.document.setPreviewing(true);
    w.tab.displayed(versionOf());
    await settle();
    w.tab.toggleDatasets(); // the header's Datasets on the version
    await settle();
    const sheetHold = w.holds.length - 1; // the sheet's own, beside the preview's
    expect(w.holds.map((hold) => hold.refs)).toEqual([['assets/q0.json'], ['assets/q0.json']]);
    expect(w.tab.sheet.snapshot().preview).toBe(true);
    w.tab.document.setPreviewing(false); // the preview ends
    w.tab.displayed(w.doc);
    await settle();
    await restart(w, sheetHold);
    const snapshot = w.tab.sheet.snapshot();
    expect(snapshot.datasets.map(({ descriptor }) => descriptor.title)).toEqual(['Version']);
    expect(snapshot.preview).toBe(true);
    expect(w.holds.at(-1)!.refs).toEqual(['assets/q0.json']);
  });
});

// P3-F dashboard-live-ui wave (scalpel-1#2): Show current reopens the sheet on the current capture of its datasets; a
// dataset removed since leaves the shown document's others, never the false "No data is bound" sheet while some remain
describe('the dashboard tab’s Show current on a removed dataset (P3-F)', () => {
  it('reopens on the remaining datasets; with none left, on none', async () => {
    const w = world();
    tabs.push(w.tab);
    await vi.waitFor(() => expect(w.tab.document.snapshot().ready).toBe(true));
    setDataset(w.doc, 'other', live('assets/o1.json', 'Other'));
    w.tab.displayed(w.doc);
    w.tab.reopenSheet('live'); // as its source label opens it: that dataset alone
    await settle();
    expect(w.tab.sheet.snapshot().datasets.map(({ id }) => id)).toEqual(['live']);
    removeDataset(w.doc, 'live');
    w.tab.reopenSheet('live'); // its live block's Show current
    await settle();
    const snapshot = w.tab.sheet.snapshot();
    expect(snapshot.open).toBe(true);
    expect(snapshot.datasets.map(({ id }) => id)).toEqual(['other']);
    expect(snapshot.selected).toBe('other');
    removeDataset(w.doc, 'other');
    w.tab.reopenSheet('other');
    expect(w.tab.sheet.snapshot().datasets).toEqual([]); // nothing bound now: the sheet says so truly
  });
});
