// P3-C M8 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11): the deck's history controller over B's
// `HistoryApi`: the pill counts what an agent changed since the owner's last view; a version previews against the one
// before it with its pinned design system; a shift-click compares; ↑ ↓ walk the changes and move the stage; Restore and
// Make a copy act on the previewed version and leave; Show editors reads a live element's provenance; the preview's docs
// are freed once nothing shows them.
import { afterEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { AppSessionId } from '@shared/graph/ids';
import type { HistoryApi } from '../../../document/editor/history/api';
import { formatWhen, versionSummary } from '../../../document/editor/history/model';
import { applyV1, applyV2, attributionMap, contentIdsOf, encodeMap, mergeMaps, newDoc, onUpdate, stateV2, transact, type ContentMap, type Doc } from '../../../yjs';
import { importSlide, setNotes, setStyle, writeDeckKeys } from '../../model';
import { loadSlide } from '../../parse';
import { addThread } from '../../threads';
import { DeckHistoryController } from './controller';

const SESSION = '00000000-0000-4000-8000-0000000000a1' as AppSessionId;
const AGENT: Actor = { kind: 'session', appSessionId: SESSION };
const HUMAN: Actor = { kind: 'human' };
const PIN = { id: '00000000-0000-4000-8000-00000000d500', versionSeq: 3 };

/** A deck host with A's store's history as an editor sees it: provenance per update, versions as states. */
function deckHost(ids: string[]) {
  let now = Date.UTC(2026, 9, 12, 9, 0);
  const doc = newDoc();
  const rows: { seq: number; map: ContentMap }[] = [];
  const stored: (ArtifactVersion & { state: Uint8Array })[] = [];
  const calls: string[] = [];
  const versionListeners = new Set<() => void>();
  const restoredListeners = new Set<(e: { versionId: number }) => void>();
  let viewedAt: number | null = null;
  const write = (actor: Actor, edit: (d: Doc) => void) => {
    const replica = newDoc();
    applyV2(replica, stateV2(doc));
    const updates: Uint8Array[] = [];
    const off = onUpdate(replica, (u) => updates.push(u));
    edit(replica);
    off();
    for (const u of updates) {
      applyV1(doc, u);
      now += 60_000;
      const key = actor.kind === 'human' ? 'human' : `session:${actor.appSessionId}`;
      rows.push({ seq: rows.length + 1, map: attributionMap(contentIdsOf(u), { insertActor: key, deleteActor: key, at: now }) });
    }
  };
  const version = (kind: ArtifactVersion['kind'], actor: Actor = HUMAN, fields: Partial<ArtifactVersion> = {}) => {
    const v = { id: stored.length + 1, seq: rows.length, at: now, actor, kind, assetRefs: [], ...fields, state: stateV2(doc) } as ArtifactVersion & { state: Uint8Array };
    stored.push(v);
    versionListeners.forEach((listener) => listener());
    return v;
  };
  write(HUMAN, (d) =>
    transact(d, () => {
      writeDeckKeys(d, { v: 4, title: 'Deck', cover: ids[0], order: ids });
      ids.forEach((id, i) => {
        const l = loadSlide(`<section id="${id}"><h1 id="title" style="font-size:72px">Title ${id}</h1><p id="body" style="font-size:32px">Body</p><aside>Notes</aside></section>`);
        if (!l.ok) throw new Error('fixture');
        importSlide(d, l.slide, `a${i}`);
      });
    }),
  );
  const api: HistoryApi = {
    onVersions: (listener) => { versionListeners.add(listener); return () => versionListeners.delete(listener); },
    versions: async () =>
      stored.map((v) => {
        const listed: Partial<typeof v> = { ...v };
        delete listed.state;
        return listed as ArtifactVersion;
      }),
    lastViewedAt: async () => viewedAt,
    versionState: async (id) => stored.find((v) => v.id === id)!.state,
    attributions: async (from, to) => encodeMap(mergeMaps(rows.filter((r) => r.seq >= from && r.seq <= to).map((r) => r.map))),
    saveVersion: async ({ label }) => ({ versionId: version('named', HUMAN, { label }).id }),
    nameVersion: async (id, { label }) => void (stored.find((v) => v.id === id)!.label = label),
    restore: async (id) => {
      calls.push(`restore ${id}`);
      return { revision: rows.length, versionId: version('restore', HUMAN, { label: 'Restored' }).id };
    },
    duplicate: async (id) => {
      calls.push(`duplicate ${id}`);
      return { artifactId: 'copy' };
    },
    markViewed: async () => {
      calls.push('markViewed');
      viewedAt = now;
    },
    sessionTitle: (id) => (id === SESSION ? 'Deck agent' : undefined),
  };
  const handle = { doc, onRestored: (l: (e: { versionId: number }) => void) => (restoredListeners.add(l), () => restoredListeners.delete(l)) };
  return { doc, api, handle, write, version, calls, setViewed: (at: number | null) => (viewedAt = at), now: () => now, restored: (versionId: number) => restoredListeners.forEach((l) => l({ versionId })) };
}

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.reverse()) c();
  cleanups = [];
});
function attach(h: ReturnType<typeof deckHost>) {
  const controller = new DeckHistoryController(h.handle, h.api);
  cleanups.push(controller.attach());
  return controller;
}
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(check()).toBe(true);
};

describe('the deck’s history controller (D11)', () => {
  it('keeps open history current through automatic human and agent-turn versions', async () => {
    const h = deckHost(['a']);
    h.version('auto');
    const controller = attach(h);
    await until(() => controller.getSnapshot().versions?.length === 1);
    h.write(HUMAN, (d) => setNotes(d, 'a', 'Human notes'));
    const human = h.version('auto');
    await until(() => controller.getSnapshot().versions?.some((v) => v.id === human.id) === true);
    h.write(AGENT, (d) => setStyle(d, 'a', 'title', { color: '#123456' }));
    const agent = h.version('turn', AGENT);
    await until(() => controller.getSnapshot().versions?.some((v) => v.id === agent.id) === true);
    expect(controller.getSnapshot().versions?.map((v) => v.id)).toEqual([1, human.id, agent.id]);
  });

  it('does not let an older history refresh hide a newly committed version', async () => {
    const h = deckHost(['a']);
    h.version('auto');
    const controller = attach(h);
    await until(() => controller.getSnapshot().versions?.length === 1);
    const old = await h.api.versions();
    const read = h.api.versions;
    let finish!: (versions: ArtifactVersion[]) => void;
    h.api.versions = () => new Promise((resolve) => { finish = resolve; });
    const pending = controller.refresh();
    h.api.versions = read;
    h.version('turn', AGENT);
    await until(() => controller.getSnapshot().versions?.length === 2);
    finish(old);
    await pending;
    expect(controller.getSnapshot().versions).toHaveLength(2);
  });

  it('offers “See N new changes” counting what an agent changed since the last view, then marks the deck viewed', async () => {
    const h = deckHost(['a', 'b']);
    h.version('auto');
    h.setViewed(h.now());
    h.write(AGENT, (d) => {
      setStyle(d, 'a', 'title', { color: '#ff0000' });
      setNotes(d, 'b', 'Notes, rewritten');
    });
    h.version('turn', AGENT);
    const controller = attach(h);
    await until(() => controller.getSnapshot().pill?.count != null);
    expect(controller.getSnapshot().pill?.count).toBe(2);
    expect(h.calls).toContain('markViewed');
    await controller.openNewChanges();
    const preview = controller.getSnapshot().preview!;
    expect(preview.title).toBe('Changes since you last looked');
    expect(preview.system).toBeNull(); // the live deck draws in its own system
    expect(preview.changes.slides.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('previews a version against the one before it, in the version’s pinned design system, on the live slide', async () => {
    const h = deckHost(['a', 'b']);
    h.version('auto');
    h.write(HUMAN, (d) => setStyle(d, 'b', 'body', { color: '#00ff00' }));
    const v = h.version('named', HUMAN, { label: 'Green', designSystemRef: PIN });
    const controller = attach(h);
    controller.setLiveSlide('a');
    await until(() => controller.getSnapshot().versions !== null);
    await controller.select(v.id);
    const preview = controller.getSnapshot().preview!;
    expect(preview.system).toEqual(PIN);
    expect(preview.versionId).toBe(v.id);
    expect(preview.slideId).toBe('a');
    expect(preview.changes.count).toBe(1);
    expect(preview.changes.slides[0]!.elements[0]).toMatchObject({ id: 'body', by: 'human' });
    // a version written with no pin draws in the floor
    await controller.select(1);
    expect(controller.getSnapshot().preview!.system).toEqual({ builtin: 'maws' });
  });

  it('compares two versions by shift-click, and ↑ ↓ walk every change, wrapping, moving the stage to each one’s slide', async () => {
    const h = deckHost(['a', 'b', 'c']);
    const first = h.version('auto');
    h.write(HUMAN, (d) => setStyle(d, 'a', 'title', { color: '#111111' }));
    h.version('auto');
    h.write(AGENT, (d) => setStyle(d, 'c', 'body', { color: '#222222' }));
    const last = h.version('turn', AGENT);
    const controller = attach(h);
    await until(() => controller.getSnapshot().versions !== null);
    await controller.select(last.id);
    await controller.select(first.id, { extend: true });
    const preview = controller.getSnapshot().preview!;
    expect(controller.getSnapshot().selected).toEqual([last.id, first.id]);
    expect(preview.versionId).toBeNull();
    expect(preview.changes.count).toBe(2);
    expect(preview.focus).toBe(0);
    expect(preview.stops[preview.focus!]).toEqual({ part: 'element', slideId: 'a', elementId: 'title' });
    expect(controller.step(1)).toEqual({ part: 'element', slideId: 'c', elementId: 'body' });
    expect(controller.getSnapshot().preview!.slideId).toBe('c');
    expect(controller.step(1)).toEqual({ part: 'element', slideId: 'a', elementId: 'title' });
    expect(controller.step(-1)).toEqual({ part: 'element', slideId: 'c', elementId: 'body' });
  });

  it('restores and copies the previewed version, then leaves history; a restore elsewhere shows the banner', async () => {
    const h = deckHost(['a']);
    const v = h.version('named', HUMAN, { label: 'Before' });
    h.write(HUMAN, (d) => setStyle(d, 'a', 'title', { color: '#333333' }));
    h.version('auto');
    const controller = attach(h);
    await until(() => controller.getSnapshot().versions !== null);
    await controller.select(v.id);
    await controller.duplicate();
    expect(h.calls).toContain(`duplicate ${v.id}`);
    await controller.restore();
    expect(h.calls).toContain(`restore ${v.id}`);
    expect(controller.getSnapshot().preview).toBeNull();
    h.restored(v.id);
    await until(() => controller.getSnapshot().banner !== null);
    expect(controller.getSnapshot().banner).toBe('Before');
  });

  it('keeps the restored label when a newer versions notification leaves its refresh unpublished', async () => {
    const h = deckHost(['a']);
    h.version('named', HUMAN, { label: 'Draft' });
    let versionsChanged!: () => void;
    h.api.onVersions = (listener) => { versionsChanged = listener; return () => {}; };
    const controller = attach(h);
    await until(() => controller.getSnapshot().versions?.length === 1);
    const restored = h.version('restore', HUMAN, { label: 'Restored from Draft' });
    const versions = await h.api.versions();
    const reads: Array<(versions: ArtifactVersion[]) => void> = [];
    h.api.versions = () => new Promise((resolve) => { reads.push(resolve); });

    h.restored(restored.id);
    versionsChanged();
    expect(reads).toHaveLength(2);
    // The restore read has the label, but the subscription's newer read is still in flight.
    reads[0]!(versions);
    await until(() => controller.getSnapshot().banner !== null);
    expect(controller.getSnapshot().banner).toBe('Restored from Draft');
    reads[1]!(versions);
    await until(() => controller.getSnapshot().versions?.length === 2);
    expect(controller.getSnapshot().banner).toBe('Restored from Draft');
  });

  it('frees a preview’s docs once the editor shows another, and every doc when it detaches', async () => {
    const h = deckHost(['a']);
    const v1 = h.version('auto');
    h.write(HUMAN, (d) => setStyle(d, 'a', 'title', { color: '#444444' }));
    const v2 = h.version('auto');
    const controller = new DeckHistoryController(h.handle, h.api);
    const detach = controller.attach();
    await until(() => controller.getSnapshot().versions !== null);
    await controller.select(v1.id);
    const first = controller.getSnapshot().preview!.shown;
    await controller.select(v2.id);
    const second = controller.getSnapshot().preview!.shown;
    controller.applied(second);
    expect(first.isDestroyed).toBe(true);
    expect(second.isDestroyed).toBe(false);
    detach();
    expect(second.isDestroyed).toBe(true);
    expect(controller.getSnapshot().preview).toBeNull();
  });

  // The history-anchors review (scalpel-5#3): the preview's heading reads the version's new name once it is named, as
  // the rail's row does.
  it('names the previewed version, and the preview’s heading with it', async () => {
    const h = deckHost(['a']);
    const v = h.version('auto');
    const controller = attach(h);
    await until(() => controller.getSnapshot().versions !== null);
    await controller.select(v.id);
    expect(controller.getSnapshot().preview!.title).toBe(formatWhen(v.at));
    expect(await controller.name('Before legal')).toBe(true);
    expect(controller.getSnapshot().versions!.find((x) => x.id === v.id)!.label).toBe('Before legal');
    expect(controller.getSnapshot().preview!.title).toBe(`Before legal · ${formatWhen(v.at)}`);
  });

  it('shows the editors of a live element by name, colour and time', async () => {
    const h = deckHost(['a']);
    h.write(AGENT, (d) => setStyle(d, 'a', 'title', { color: '#555555' }));
    const controller = attach(h);
    const editors = await controller.editorsOf('a', 'title');
    expect(editors.map((e) => e.name)).toEqual(['Deck agent', 'You']);
    expect(editors[0]!.color).toMatch(/^--author-\d$/);
  });

  // P4 W1-B (the tracker's "P4 version history lines"): a turn's thread lines (artifact_reply's, artifact_resolve's) read
  // "replied on c:<id>" in B's rail; the deck names the comment by its element's words in the live deck instead
  it('names a comment in the rail’s lines by its element’s live words', () => {
    const h = deckHost(['a']);
    h.write(HUMAN, (d) => addThread(d, { threadId: 't1', slideId: 'a', elementId: 'title', quote: 'An older title', by: HUMAN, at: 1, body: 'Bigger?' }));
    const controller = attach(h);
    const turn = (summary: string) => versionSummary({ id: 1, seq: 1, at: 0, actor: AGENT, kind: 'turn', assetRefs: [], summary }, controller.words());
    expect(turn('replied on c:t1')).toBe('Replied to the comment on “Title a”');
    expect(turn('resolved c:gone')).toBe('Resolved a comment');
  });
});
