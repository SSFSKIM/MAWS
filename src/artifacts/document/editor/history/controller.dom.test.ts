// The history controller on its own (M5's fix wave 1 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; the
// review's probes ported): an agent deleting a whole tab is a change the pill counts and a comparison shows (the
// deleted tab listed, its body drawn as deleted); a change count that fails is surfaced, logged, and counted again on
// refresh or on asking again.
import { afterEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactVersion } from '@shared/artifacts/version';
import { attributedRuns, renderDiff } from '../../history';
import { applyEdit } from '../../patch-writer';
import { schemaFor } from '../../schema';
import { addTab, createDocument, deleteTab, tabBody } from '../../tabs';
import { ynodeToPmnode } from '../../../yjs/prosemirror';
import type { DocumentHandle } from '../host-types';
import { MemoryDocumentHost, openMemoryHandle, whenSynced } from '../memory-host';
import { until } from '../test-world';
import type { HistoryApi } from './api';
import { HistoryController } from './controller';
import { formatWhen } from './model';
import { MemoryHistory } from './memory-history';

const AGENT: Actor = { kind: 'session', appSessionId: '00000000-0000-4000-8000-0000000000a1' as AppSessionId };
const body = (id: string, text: string) => schemaFor().nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] }] });

let cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups = [];
});

// The owner viewed the document, then an agent deleted its second tab and nothing else.
async function deletedTab() {
  let now = Date.now() - 60 * 60_000;
  const host = new MemoryDocumentHost();
  const history = new MemoryHistory(host, { now: () => now });
  host.write((doc) => {
    createDocument(doc, { id: 'main', title: 'Main', body: body('p1', 'Kept') });
    addTab(doc, { id: 'removed', title: 'Removed tab', body: body('p2', 'The agent deletes this whole tab') });
  });
  history.version('auto');
  await history.markViewed();
  now += 60_000;
  host.write((doc) => deleteTab(doc, 'removed'), AGENT);
  const turn = history.version('turn', AGENT, { summary: 'Deleted a tab' });
  now += 60_000;
  const handle = openMemoryHandle(host, { log: () => {} });
  await whenSynced(handle);
  cleanups.push(() => host.destroy(), () => history.destroy(), () => handle.close());
  return { host, history, handle, turn };
}

function attach(handle: DocumentHandle, api: HistoryApi): HistoryController {
  const controller = new HistoryController(handle, api);
  cleanups.push(controller.attach());
  return controller;
}

describe('a deleted tab', () => {
  it('is a new change the pill counts', async () => {
    const { history, handle } = await deletedTab();
    const controller = attach(handle, history);
    await until(() => controller.getSnapshot().pill?.count != null, 'the counted pill');
    expect(controller.getSnapshot().pill?.count).toBe(1);
  });

  it('is listed in a comparison spanning it, its body drawn as deleted by the agent', async () => {
    const { history, handle, turn } = await deletedTab();
    const controller = attach(handle, history);
    await controller.select(turn.id);
    const preview = controller.getSnapshot().preview!;
    expect(preview.tabs.map(({ id, title, change }) => ({ id, title, change }))).toEqual([
      { id: 'main', title: 'Main', change: undefined },
      { id: 'removed', title: 'Removed tab', change: 'removed' },
    ]);
    controller.setTab('removed');
    const { view } = controller.getSnapshot().preview!;
    expect(view?.renderer).not.toBeNull();
    const drawn = renderDiff(view!.ytype, view!.renderer as never);
    expect(drawn.textContent).toBe('The agent deletes this whole tab');
    expect(attributedRuns(drawn).some((run) => run.kind === 'del' && run.who === `session:${AGENT.kind === 'session' ? AGENT.appSessionId : ''}`)).toBe(true);
  });
});

describe('a change count that fails', () => {
  it('is surfaced and logged, and counted again on refresh and on asking again', async () => {
    const { history, handle } = await deletedTab();
    const logged: string[] = [];
    let failing = 2;
    const api: HistoryApi = Object.assign(Object.create(history) as HistoryApi, {
      versionState: (id: number) => (failing-- > 0 ? Promise.reject(new Error('the host is unavailable')) : history.versionState(id)),
      log: (line: string) => logged.push(line),
    });
    const controller = attach(handle, api);
    await until(() => controller.getSnapshot().pill?.failed != null, 'the failed count');
    expect(controller.getSnapshot().pill).toMatchObject({ count: null, failed: 'the host is unavailable' });
    expect(controller.getSnapshot().error).toBe('Could not count the new changes: the host is unavailable');
    expect(logged).toEqual([expect.stringContaining('the host is unavailable')]);

    await controller.refresh(); // still failing once more
    expect(controller.getSnapshot().pill).toMatchObject({ count: null, failed: 'the host is unavailable' });
    await controller.recount(); // the pill's own retry
    expect(controller.getSnapshot().pill).toMatchObject({ count: 1, failed: null });
    expect(controller.getSnapshot().error).toBeNull();
  });
});

describe('a restore overlapping a versions notification', () => {
  it('keeps the restored label when an older response replaces the list before the banner is set', async () => {
    const { history, handle, host } = await deletedTab();
    let versionsChanged!: () => void;
    const api: HistoryApi = Object.assign(Object.create(history) as HistoryApi, {
      onVersions: (listener: () => void) => { versionsChanged = listener; return () => {}; },
    });
    const controller = attach(handle, api);
    await until(() => controller.getSnapshot().pill?.count === 1, 'the first look');
    const before = await history.versions();
    const reads: Array<(versions: ArtifactVersion[]) => void> = [];
    api.versions = () => new Promise((resolve) => { reads.push(resolve); });

    versionsChanged();
    // A live restore sends its document update before the notice, so the notice is not initial-sync catch-up.
    host.write((doc) => { addTab(doc, { id: 'removed', title: 'Removed tab', body: body('p2', 'The agent deletes this whole tab') }); });
    const restored = history.version('restore', { kind: 'human' }, { label: 'Restored from Draft' });
    const versions = await history.versions();
    host.announceRestored(restored.id);
    await until(() => reads.length === 2, 'the restore read');
    // Both refresh continuations run before restored() resumes: the older list wins the snapshot.
    reads[1]!(versions);
    reads[0]!(before);
    await until(() => controller.getSnapshot().banner !== null, 'the restore banner');
    expect(controller.getSnapshot().banner).toBe('Restored from Draft');
  });
});

// The history-anchors review (scalpel-5#3): the preview's heading reads the version's new name once it is named, as
// the rail's row does.
describe('Name this version', () => {
  it('renames the preview’s heading with the version', async () => {
    const { history, handle, turn } = await deletedTab();
    const controller = attach(handle, history);
    await controller.select(turn.id);
    expect(controller.getSnapshot().preview!.title).toBe(formatWhen(turn.at));
    expect(await controller.name('Before legal')).toBe(true);
    expect(controller.getSnapshot().versions!.find((v) => v.id === turn.id)!.label).toBe('Before legal');
    expect(controller.getSnapshot().preview!.title).toBe(`Before legal · ${formatWhen(turn.at)}`);
  });
});

// P4 W1-B (tracker L274; sitting candidate 28): the document stayed open while the owner was away (a panel closed and
// reopened, the main region behind the panel and shown again), so its editor and this controller stayed too. Each
// return is a look, as the first showing is: the agent's changes since the last look raise the pill, and the look is
// recorded, so a second away-edit is counted from the first return, not from the first showing.
describe('a return to the document', () => {
  it('offers the first away-edit before the agent finishes its turn', async () => {
    let now = 1_000;
    const host = new MemoryDocumentHost();
    const history = new MemoryHistory(host, { now: () => now });
    host.write((doc) => createDocument(doc, { id: 'main', title: 'Main', body: body('p1', 'First') }));
    history.version('auto');
    const handle = openMemoryHandle(host, { log: () => {} });
    await whenSynced(handle);
    cleanups.push(() => host.destroy(), () => history.destroy(), () => handle.close());
    const controller = attach(handle, history);
    await until(() => history.viewedAt !== null, 'first look');
    now += 1_000;
    host.write((doc) => void applyEdit(doc, [{ op: 'insert', after: 'p1', markdown: 'Mid-turn edit. ^p2' }]), AGENT);
    await until(() => ynodeToPmnode(tabBody(handle.doc, 'main')!, schemaFor()).textContent.includes('Mid-turn'), 'live edit');
    // No turn version yet: the return must capture and compare the live state itself.
    history.returned();
    await until(() => controller.getSnapshot().pill?.count === 1, 'first mid-turn change');
  });

  it('raises the pill for each away-edit and records each look', async () => {
    let now = Date.now() - 60 * 60_000;
    const host = new MemoryDocumentHost();
    const history = new MemoryHistory(host, { now: () => now });
    host.write((doc) => createDocument(doc, { id: 'main', title: 'Main', body: body('p1', 'First') }));
    history.version('auto');
    const handle = openMemoryHandle(host, { log: () => {} });
    await whenSynced(handle);
    cleanups.push(() => host.destroy(), () => history.destroy(), () => handle.close());
    const controller = attach(handle, history);
    await until(() => history.viewedAt !== null, 'the first look');
    expect(controller.getSnapshot().pill).toBeNull();
    const looks = [history.viewedAt!];

    for (const id of ['p2', 'p3']) {
      now += 60_000; // away: an agent's edit and its turn's version
      host.write((doc) => void applyEdit(doc, [{ op: 'insert', after: 'p1', markdown: `Added as ${id}. ^${id}` }]), AGENT);
      await until(() => ynodeToPmnode(tabBody(handle.doc, 'main')!, schemaFor()).textContent.includes(`Added as ${id}.`), `the edit adding ${id} at the replica`);
      history.version('turn', AGENT, { summary: `Added ${id}` });
      now += 60_000;
      history.returned();
      await until(() => controller.getSnapshot().pill?.count != null, `the pill after adding ${id}`);
      expect(controller.getSnapshot().pill?.count).toBe(1); // this away-edit alone: counted from the last look
      await until(() => history.viewedAt === now, 'this look recorded');
      looks.push(history.viewedAt!);
      controller.dismissPill();
    }
    expect(looks).toHaveLength(3);
  });
});
