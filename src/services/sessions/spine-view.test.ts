// The in-process backing of the spine's view (P5 O3-C, Interfaces §B's table): each member answers its backing's value,
// each event fires with its backing's, and the view's own rules (`silent`, `known`, both project sets, availability in a
// refused run and in launch mode scenario) hold over a real index and read model.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { SetupIntent } from '@shared/sessions/intent';
import type { AcquireOutcome } from '@shared/sessions/setup';
import { digest, item, project, record, status } from '../../../test/support/builders';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { intentFor } from '../../../test/support/session-host';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { emittedAttentionSource } from './index';
import { SessionReadModel, type ReadModelWriter } from './read-model';
import { createSpineView, type SpineViewDeps } from './spine-view';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;

const intentOf = (appSessionId: AppSessionId): SetupIntent => intentFor(appSessionId);

describe('the in-process view', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let model: SessionReadModel;
  let writer: ReadModelWriter;
  let bus: FakeBus;
  let intents: Map<AppSessionId, SetupIntent>;
  let acquired: [AppSessionId, string][];
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    model = new SessionReadModel('index');
    model.register({ start: (w) => ((writer = w), () => {}) });
    bus = fakeBus();
    intents = new Map();
    acquired = [];
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  const deps = (over: Partial<SpineViewDeps> = {}): SpineViewDeps => ({
    mode: 'index',
    model,
    index,
    intents: { get: (id) => intents.get(id) ?? null, list: () => [...intents.values()] },
    tap: bus.onEmitted,
    acquire: async (id, reason) => {
      acquired.push([id, reason]);
      return { status: 'ready' } as AcquireOutcome;
    },
    ...over,
  });

  it('answers the read model’s records, digests, attention, statuses, mid-turn count and visible set', () => {
    const view = createSpineView(deps()).view;
    writer.observeRecord(record(A));
    writer.observeRecord(record(B, { archived: true }));
    writer.setDigest(digest(A, { lastAssistantLine: 'done' }));
    writer.applyEngineStatus(status(A, { process: 'starting' }));
    writer.observeAttention(A, [item(A, 'permission', '2026-10-28T10:00:00Z')]);
    model.setVisible(A, true);
    expect(view.record(A)).toEqual(model.record(A));
    expect(view.records().map((r) => r.appId)).toEqual([A, B]); // archived included
    expect(view.digest(A)).toEqual(model.digest(A));
    expect(view.digests()).toEqual(model.digests());
    expect(view.attention(A)).toEqual(model.attention(A));
    expect(view.allAttention()).toEqual(model.allAttention());
    expect(view.engineStatuses()).toEqual(model.engineStatuses());
    expect(view.midTurnCount()).toBe(1);
    expect(view.visibleSessions()).toEqual([A]);
    expect(view.unavailable()).toBeNull();
  });

  it('fires record, digest, engine and visible with the read model’s, and stops hearing it once stopped', () => {
    const { view, stop } = createSpineView(deps());
    const heard: unknown[] = [];
    const digests: unknown[] = [];
    const fromModel: unknown[] = [];
    model.on('digest', (d) => fromModel.push(d));
    view.on('record', (id, r) => heard.push(['record', id, r?.appId ?? null]));
    view.on('digest', (d) => digests.push(d));
    view.on('engine', (id, s) => heard.push(['engine', id, s?.process ?? null]));
    view.on('visible', (id, shown) => heard.push(['visible', id, shown]));
    writer.observeRecord(record(A));
    writer.setDigest(digest(A));
    writer.applyEngineStatus(status(A));
    writer.forgetEngineStatus(A);
    model.setVisible(A, true);
    writer.observeRemoved(A);
    expect(heard).toEqual([['record', A, A], ['engine', A, 'ready'], ['engine', A, null], ['visible', A, true], ['record', A, null]]);
    expect(digests.length).toBeGreaterThan(0);
    expect(digests).toEqual(fromModel);
    stop();
    writer.observeRecord(record(B));
    writer.setDigest(digest(B));
    expect(heard).toHaveLength(5);
    expect(digests).toHaveLength(fromModel.length - 1);
  });

  // P5 O3-D M1 (D13): `silent` travels on attention.changed, filled by the attention service from its restored ids, and
  // the view reads it from the event, as the mirror does (Interfaces §F)
  it('fires attention with the event’s items and its silent ids, after the read model holds them', () => {
    model.register(emittedAttentionSource(bus.onEmitted)); // production's order: the read model's tap before the view's
    const view = createSpineView(deps()).view;
    writer.observeRecord(record(A));
    const restored = item(A, 'question', '2026-10-28T09:00:00Z');
    const live = item(A, 'permission', '2026-10-28T10:00:00Z');
    const heard: [AppSessionId, string[], string[], number][] = [];
    view.on('attention', (id, items, silent) => heard.push([id, items.map((i) => i.id), [...silent], view.attention(id).length]));
    bus.emit('attention.changed', { appSessionId: A, items: [restored, live], silent: [restored.id] });
    bus.emit('attention.changed', { appSessionId: A, items: [live] }); // an emitter that fills none (the scenario stub)
    expect(heard).toEqual([[A, [restored.id, live.id], [restored.id], 2], [A, [live.id], [], 1]]);
  });

  it('reads intents from the store and hears each session.intent.changed; known is a record or an intent', async () => {
    const view = createSpineView(deps()).view;
    const heard: [AppSessionId, boolean][] = [];
    view.on('intent', (id, intent) => heard.push([id, intent !== null]));
    intents.set(B, intentOf(B));
    expect(bus.emit('session.intent.changed', { appSessionId: B, intent: intentOf(B) })).toBe(true);
    expect(view.intent(B)).toEqual(intentOf(B));
    expect(view.intents()).toEqual([intentOf(B)]);
    expect(view.known(B)).toBe(true); // an intent with no record
    expect(view.known(A)).toBe(false);
    writer.observeRecord(record(A));
    expect(view.known(A)).toBe(true);
    intents.delete(B);
    bus.emit('session.intent.changed', { appSessionId: B, intent: null });
    expect(view.known(B)).toBe(false);
    expect(heard).toEqual([[B, true], [B, false]]);
  });

  // P5 O3-D M1 (D13): both sets from session.projects.changed (`rows` filled by the index source), the index read once at
  // the start, as the mirror reads its snapshot (Interfaces §F)
  it('keeps both project sets from session.projects.changed: the listing, and every row when the event carries them', () => {
    const work = join(dir.path, 'work');
    const added = index.projects.add(mkdirOf(join(work, 'added')));
    const view = createSpineView(deps()).view;
    let changes = 0;
    view.on('projects', () => (changes += 1));
    expect(view.projectRows().map((p) => p.id)).toEqual([added.id]); // read at the start
    index.projects.hide(added.id);
    expect(changes).toBe(0); // the index's own change is the source's to tell, on the event
    const listed = [project('listed', 0)];
    bus.emit('session.projects.changed', { projects: listed, revision: 7, rows: index.projects.list({ includeHidden: true }) });
    expect(changes).toBe(1);
    expect(view.projects()).toEqual(listed);
    expect(view.project(added.id)).toMatchObject({ id: added.id, hidden: true }); // a hidden project, marked hidden
    bus.emit('session.projects.changed', { projects: [], revision: 8 }); // no rows: the rows stand
    expect(changes).toBe(2);
    expect(view.projects()).toEqual([]);
    expect(view.projectRows().map((p) => p.id)).toEqual([added.id]);
    expect(view.project('nowhere' as ProjectId)).toBeNull();
  });

  it('over a real index: a discovered project whose only transcript was removed is in projectRows and project(id), not projects', () => {
    const directory = mkdirOf(join(dir.path, 'discovered'));
    const { record: discovered } = index.sessions.upsertFromSummary(summary({ directory }));
    index.sessions.markTranscriptRemoved(discovered.engineSessionId!);
    const view = createSpineView(deps()).view;
    const id = discovered.projectId!;
    expect(view.projects().map((p) => p.id)).not.toContain(id);
    expect(view.projectRows().map((p) => p.id)).toContain(id);
    expect(view.project(id)).toMatchObject({ id, directory });
  });

  it('acquires through the session service, and reads files’ admission from the library', async () => {
    const linked = new Map([[A, ['/files/a.pdf']]]);
    const view = createSpineView(deps({ index: { unavailable: null, projects: index.projects, library: { fileLinkedPaths: (id) => linked.get(id) ?? [] } } })).view;
    await expect(view.acquire(A, 'send')).resolves.toEqual({ status: 'ready' });
    expect(acquired).toEqual([[A, 'send']]);
    await expect(view.fileLinkedPaths(A)).resolves.toEqual(['/files/a.pdf']);
  });

  it('names the refusal in a refused run: no projects, no linked paths, and acquire rejects as main’s would', async () => {
    const refused = new Index(join(dir.path, 'refused.sqlite'), { refused: 'another MAWS holds spine.lock' });
    const view = createSpineView(deps({ index: refused, acquire: () => Promise.reject(new Error('MAWS cannot reach its sessions this run: another MAWS holds spine.lock')) })).view;
    expect(view.unavailable()).toBe(refused.unavailable);
    expect(view.unavailable()).toContain('another MAWS holds spine.lock');
    expect([view.projects(), view.projectRows()]).toEqual([[], []]);
    await expect(view.fileLinkedPaths(A)).resolves.toEqual([]);
    await expect(view.acquire(A, 'send')).rejects.toThrow('MAWS cannot reach its sessions this run');
    refused.close();
  });

  it('in launch mode scenario answers the scenario’s sessions and projects and names the scenario as why it is unavailable', () => {
    index.projects.add(mkdirOf(join(dir.path, 'profile-project'))); // the profile's, which the scenario does not show
    const scenario = new SessionReadModel('scenario');
    let w!: ReadModelWriter;
    scenario.registerScenario({ start: (sw) => ((w = sw), () => {}) });
    w.observeProject(project('scenario-project', 0));
    w.observeRecord(record(A, { projectId: 'scenario-project' as ProjectId }));
    const view = createSpineView(deps({ mode: 'scenario', model: scenario })).view;
    expect(view.unavailable()).toBe('launch mode scenario: the sessions shown are a scenario’s');
    expect(view.records().map((r) => r.appId)).toEqual([A]);
    expect(view.projects().map((p) => p.id)).toEqual(['scenario-project']);
    expect(view.projectRows().map((p) => p.id)).toEqual(['scenario-project']);
    expect(view.project('scenario-project' as ProjectId)).toMatchObject({ id: 'scenario-project' });
  });

  // D28's two exceptions to "[] while unavailable": the scenario's unavailability is not the index's refusal
  it('in launch mode scenario over a readable index still answers files’ admission from the profile’s library', async () => {
    const linked = new Map([[A, ['/files/a.pdf']]]);
    const library = { fileLinkedPaths: (id: AppSessionId) => linked.get(id) ?? [] };
    const view = createSpineView(deps({ mode: 'scenario', model: new SessionReadModel('scenario'), index: { unavailable: null, projects: index.projects, library } })).view;
    expect(view.unavailable()).toBe('launch mode scenario: the sessions shown are a scenario’s');
    await expect(view.fileLinkedPaths(A)).resolves.toEqual(['/files/a.pdf']);
  });

  it('in launch mode scenario over a refused index names the refusal before the scenario and answers no linked paths', async () => {
    const refused = new Index(join(dir.path, 'refused.sqlite'), { refused: 'another MAWS holds spine.lock' });
    const view = createSpineView(deps({ mode: 'scenario', model: new SessionReadModel('scenario'), index: refused })).view;
    expect(view.unavailable()).toBe(refused.unavailable);
    expect(view.unavailable()).toContain('another MAWS holds spine.lock');
    await expect(view.fileLinkedPaths(A)).resolves.toEqual([]);
    refused.close();
  });
});

function mkdirOf(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}
