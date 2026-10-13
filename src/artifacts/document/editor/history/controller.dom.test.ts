// The history controller on its own (M5's fix wave 1 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; the
// review's probes ported): an agent deleting a whole tab is a change the pill counts and a comparison shows (the
// deleted tab listed, its body drawn as deleted); a change count that fails is surfaced, logged, and counted again on
// refresh or on asking again.
import { afterEach, describe, expect, it } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { attributedRuns, renderDiff } from '../../history';
import { schemaFor } from '../../schema';
import { addTab, createDocument, deleteTab } from '../../tabs';
import type { DocumentHandle } from '../host-types';
import { MemoryDocumentHost, openMemoryHandle, whenSynced } from '../memory-host';
import { until } from '../test-world';
import type { HistoryApi } from './api';
import { HistoryController } from './controller';
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
