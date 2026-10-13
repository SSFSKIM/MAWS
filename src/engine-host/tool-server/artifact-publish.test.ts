import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KindAdapter } from '@artifacts/host';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { ArtifactPublishResultSchema, artifactRefusalOf, TOOL_ERRORS } from '@shared/maws/tools';
import { ArtifactSession } from './artifact-context';
import { artifactPublishTool } from './artifact-publish';
import { artifactCreateTool, artifactReadTool } from './artifact-tools';
import { HUMAN, jsonOf, openWorld, SELF, textOf, type World } from './artifact-world.fixture';

let w: World;
beforeEach(() => {
  w = openWorld();
});
afterEach(() => w.close());

type Ctx = Parameters<World['ctx']>[0];
const create = async (args: Record<string, unknown>, over: Ctx = {}) => jsonOf<{ artifactId: string; revision: number }>(await artifactCreateTool(w.deps()).call(args, w.ctx(over)));
const read = async (artifact: string, over: Ctx = {}, deps: Parameters<World['deps']>[0] = {}) => jsonOf<{ revision: number; files: Record<string, string> }>(await artifactReadTool(w.deps(deps)).call({ artifact }, w.ctx(over)));
const publish = (args: Record<string, unknown>, over: Ctx = {}, deps: Parameters<World['deps']>[0] = {}) => artifactPublishTool(w.deps(deps)).call(args, w.ctx(over));
const liveFiles = (id: string): Record<string, string> => Object.fromEntries([...w.store.service.live(id).get('files').attrEntries()].map(([k, v]) => [String(k), v as string]));
const human = (id: string, edit: (files: ReturnType<ReturnType<World['service']['live']>['get']>) => void) => w.service.writeAs(id, HUMAN, (doc) => edit(doc.get('files')));
const page = (id: string) => Buffer.from(w.store.files.read(id, w.store.contentRef(id).ref)).toString('utf8');

describe('artifact_publish of an html page', () => {
  it('writes the page as a new version from the revision its create returned, and the creator’s X12 record gains it', async () => {
    const created = await create({ handle: 'dash', content: '<p>v1</p>', title: 'Dashboard' }, { toolUseId: 'toolu_create' as ToolUseId });
    const answer = ArtifactPublishResultSchema.parse(jsonOf(await publish({ artifact: 'dash', baseRevision: created.revision, files: { 'index.html': '<p>v2</p>' } }, { toolUseId: 'toolu_pub' as ToolUseId })));
    expect(answer).toMatchObject({ status: 'published', artifactId: created.artifactId, kind: 'html', changed: ['index.html'], kept: [], removed: [], id: 'dash', deliverableId: created.artifactId, version: 2 });
    expect(answer.revision).toBeGreaterThan(created.revision);
    expect(answer.ownerAppSessionId).toBeUndefined();
    expect(page(created.artifactId)).toBe('<p>v2</p>');
    const record = (await w.deliverables.get(SELF, created.artifactId))!;
    expect(record.versions.map((v) => [readFileSync(v.path, 'utf8'), v.toolUseId])).toEqual([['<p>v1</p>', 'toolu_create'], ['<p>v2</p>', 'toolu_pub']]);
    expect(w.store.links(created.artifactId).map((l) => l.role).sort()).toEqual(['created', 'edited']);
    // its own publish is its new base: the next one goes on from it
    expect(jsonOf(await publish({ artifact: 'dash', baseRevision: answer.revision, files: { 'index.html': '<p>v3</p>' } }))).toMatchObject({ version: 3 });
  });

  it('layer 1: refuses a session that never read the page, and a base that is not its last read, naming the live revision', async () => {
    const created = await create({ handle: 'dash', content: '<p>v1</p>', title: 'D' });
    const stranger = await publish({ artifact: 'dash', baseRevision: created.revision, files: { 'index.html': 'x' } }, {}, { session: new ArtifactSession() });
    expect(artifactRefusalOf(textOf(stranger))).toEqual({ reason: 'staleBase', liveRevision: created.revision });
    expect(textOf(stranger)).toContain('read the artifact first');
    expect(artifactRefusalOf(textOf(await publish({ artifact: 'dash', baseRevision: created.revision - 1, files: { 'index.html': 'x' } })))).toEqual({ reason: 'staleBase', liveRevision: created.revision });
    expect(page(created.artifactId)).toBe('<p>v1</p>');
  });

  it('layer 3: a page the user changed since the read is refused naming it; force overwrites it; the page as it is writes nothing', async () => {
    const created = await create({ handle: 'dash', content: '<p>v1</p>', title: 'D' });
    await w.store.writeContent(created.artifactId, { bytes: Buffer.from('<p>user</p>'), name: 'index.html' }, HUMAN);
    const refused = await publish({ artifact: 'dash', baseRevision: created.revision, files: { 'index.html': '<p>mine</p>' } });
    expect(artifactRefusalOf(textOf(refused))).toMatchObject({ reason: 'conflict', paths: ['index.html'] });
    expect(page(created.artifactId)).toBe('<p>user</p>');
    const forced = jsonOf<{ revision: number }>(await publish({ artifact: 'dash', baseRevision: created.revision, files: { 'index.html': '<p>mine</p>' }, force: true }));
    expect(forced).toMatchObject({ changed: ['index.html'], version: 2 });
    expect(page(created.artifactId)).toBe('<p>mine</p>');
    const versions = w.store.listVersions(created.artifactId).length;
    const same = jsonOf(await publish({ artifact: 'dash', baseRevision: forced.revision, files: { 'index.html': '<p>mine</p>' } }));
    expect(same).toMatchObject({ changed: [], revision: forced.revision });
    expect(same.version).toBeUndefined();
    expect(w.store.listVersions(created.artifactId)).toHaveLength(versions);
  });

  it('refuses anything but the one page, a file artifact and a document', async () => {
    const created = await create({ handle: 'dash', content: '<p>v1</p>', title: 'D' });
    for (const files of [{ 'other.html': 'x' }, { 'index.html': 'x', 'b.html': 'y' }, { 'index.html': null }]) {
      expect(artifactRefusalOf(textOf(await publish({ artifact: 'dash', baseRevision: created.revision, files })))).toMatchObject({ reason: 'invalid' });
    }
    const doc = await w.store.create({ kind: 'document', title: 'Doc' }, HUMAN);
    expect(artifactRefusalOf(textOf(await publish({ artifact: doc.id, baseRevision: 0, files: { 'a.md': 'x' } })))).toEqual({ reason: 'invalid', kind: 'document' });
    expect(textOf(await publish({ artifact: 'nope', baseRevision: 0, files: { 'a': 'x' } }))).toBe(TOOL_ERRORS.noArtifact('artifact_publish', 'nope'));
  });

  it('a replayed tool-use id answers the first result and writes nothing again', async () => {
    const created = await create({ handle: 'dash', content: '<p>v1</p>', title: 'D' });
    const args = { artifact: 'dash', baseRevision: created.revision, files: { 'index.html': '<p>v2</p>' } };
    const first = jsonOf(await publish(args, { toolUseId: 'toolu_once' as ToolUseId }));
    const again = jsonOf(await publish(args, { toolUseId: 'toolu_once' as ToolUseId }));
    expect(again).toEqual(first);
    expect(w.store.listVersions(created.artifactId)).toHaveLength(2);
    expect((await w.deliverables.get(SELF, created.artifactId))!.versions).toHaveLength(2);
  });

  it('two overlapping calls with one tool-use id publish once, mirror one X12 version and answer alike', async () => {
    const created = await create({ handle: 'dash', content: '<p>v1</p>', title: 'D' }, { toolUseId: 'toolu_c' as ToolUseId });
    const args = { artifact: 'dash', baseRevision: created.revision, files: { 'index.html': '<p>v2</p>' } };
    const tool = artifactPublishTool(w.deps());
    const ctx = w.ctx({ toolUseId: 'toolu_twice' as ToolUseId });
    const [first, second] = await Promise.all([tool.call(args, ctx), tool.call(args, { ...ctx, requestId: w.ctx().requestId })]);
    expect(jsonOf(first)).toMatchObject({ version: 2, deliverableId: created.artifactId });
    expect(second).toEqual(first);
    expect((await w.deliverables.get(SELF, created.artifactId))!.versions.map((v) => v.toolUseId)).toEqual(['toolu_c', 'toolu_twice']);
    expect(w.store.listVersions(created.artifactId)).toHaveLength(2);
  });

  it('mirrors a side thread’s publish as a version of its own when its raw tool-use id equals one its parent already used', async () => {
    const created = await create({ handle: 'dash', content: '<p>one</p>', title: 'D' });
    const first = jsonOf(await publish({ artifact: 'dash', baseRevision: created.revision, files: { 'index.html': '<p>two</p>' } }, { toolUseId: 'toolu_reused' as ToolUseId }));
    expect(first).toMatchObject({ version: 2 });
    const CHILD = 'app-child' as AppSessionId;
    const thread = { session: new ArtifactSession(), artifactScope: [SELF] };
    const base = await read('dash', { appSessionId: CHILD }, thread);
    const second = jsonOf(await publish({ artifact: 'dash', baseRevision: base.revision, files: { 'index.html': '<p>three</p>' } }, { appSessionId: CHILD, toolUseId: 'toolu_reused' as ToolUseId }, thread));
    expect(second).toMatchObject({ version: 3, ownerAppSessionId: SELF });
    const record = (await w.deliverables.get(SELF, created.artifactId))!;
    expect(record.versions.map((v) => readFileSync(v.path, 'utf8'))).toEqual(['<p>one</p>', '<p>two</p>', '<p>three</p>']);
    expect(record.versions.map((v) => [v.toolUseId, v.appSessionId ?? null])).toEqual([[expect.any(String), null], ['toolu_reused', null], ['toolu_reused', CHILD]]); // the parent's own versions name no session
    expect(readFileSync(record.path, 'utf8')).toBe('<p>three</p>');
  });

  it('a side thread publishes its parent’s page after reading it: the parent’s record gains the version, nothing under the thread', async () => {
    const PARENT = 'app-parent' as AppSessionId;
    const THREAD = 'app-thread' as AppSessionId;
    const created = await create({ handle: 'dash', content: '<p>v1</p>', title: 'D' }, { appSessionId: PARENT });
    const thread = new ArtifactSession();
    const base = await read('dash', { appSessionId: THREAD }, { artifactScope: [PARENT], session: thread });
    const answer = jsonOf(await publish({ artifact: 'dash', baseRevision: base.revision, files: { 'index.html': '<p>v2</p>' } }, { appSessionId: THREAD }, { artifactScope: [PARENT], session: thread }));
    expect(answer).toMatchObject({ id: 'dash', deliverableId: created.artifactId, version: 2, ownerAppSessionId: PARENT });
    expect((await w.deliverables.get(PARENT, created.artifactId))!.versions).toHaveLength(2);
    expect(existsSync(join(w.userData, 'deliverables', THREAD))).toBe(false);
  });
});

describe('the turn version of an html page', () => {
  it('turns the auto version of the session’s last write into the turn’s checkpoint; a turn that only created keeps its import', async () => {
    const created = await create({ handle: 'dash', content: '<p>v1</p>', title: 'D' });
    await w.store.endTurn(SELF);
    expect(w.store.listVersions(created.artifactId).map((v) => v.kind)).toEqual(['import']);
    await publish({ artifact: 'dash', baseRevision: created.revision, files: { 'index.html': '<p>v2</p>' } });
    await w.store.endTurn(SELF);
    const versions = w.store.listVersions(created.artifactId);
    expect(versions.map((v) => v.kind)).toEqual(['import', 'turn']);
    expect(versions[1]).toMatchObject({ actor: { kind: 'session', appSessionId: SELF }, summary: '1 edit' });
    await w.store.endTurn(SELF); // nothing written since: nothing more
    expect(w.store.listVersions(created.artifactId)).toHaveLength(2);
  });
});

describe('artifact_publish of a file kind (the generic file model)', () => {
  const design = () => create({ kind: 'design', title: 'Site', files: { 'a.html': 'A', 'b.css': 'B' } });

  it('layer 2: merges over a file the user changed meanwhile, keeping it, and answers changed, kept and removed', async () => {
    const created = await design();
    await human(created.artifactId, (f) => f.setAttr('b.css', 'B by the user'));
    const answer = ArtifactPublishResultSchema.parse(jsonOf(await publish({ artifact: created.artifactId, baseRevision: created.revision, files: { 'a.html': 'A2', 'new.js': 'N' } })));
    expect(answer).toMatchObject({ changed: ['a.html', 'new.js'], removed: [], kept: ['b.css'] });
    expect(liveFiles(created.artifactId)).toEqual({ 'a.html': 'A2', 'b.css': 'B by the user', 'new.js': 'N' });
    const removed = jsonOf(await publish({ artifact: created.artifactId, baseRevision: answer.revision, files: { 'new.js': null } }));
    expect(removed).toMatchObject({ changed: [], removed: ['new.js'] });
    const rows = w.storage.db.prepare('SELECT actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq').all(created.artifactId) as { actor: string }[];
    expect(rows.map((r) => r.actor)).toEqual([`session:${SELF}`, 'human', `session:${SELF}`, `session:${SELF}`]);
  });

  it('layer 3 and force: a file the user changed since the read refuses the whole publish naming it; force overwrites it', async () => {
    const created = await design();
    await human(created.artifactId, (f) => f.setAttr('a.html', 'A by the user'));
    const before = w.store.revision(created.artifactId);
    const refused = await publish({ artifact: created.artifactId, baseRevision: created.revision, files: { 'a.html': 'A2', 'b.css': 'B2' } });
    expect(artifactRefusalOf(textOf(refused))).toMatchObject({ reason: 'conflict', paths: ['a.html'] });
    expect(w.store.revision(created.artifactId)).toBe(before);
    expect(liveFiles(created.artifactId)).toEqual({ 'a.html': 'A by the user', 'b.css': 'B' });
    expect(jsonOf(await publish({ artifact: created.artifactId, baseRevision: created.revision, files: { 'a.html': 'A2', 'b.css': 'B2' }, force: true }))).toMatchObject({ changed: ['a.html', 'b.css'] });
    expect(liveFiles(created.artifactId)).toEqual({ 'a.html': 'A2', 'b.css': 'B2' });
  });

  it('is atomic: a publish whose second file cannot be held writes nothing', async () => {
    const created = await design();
    const before = w.store.revision(created.artifactId);
    const refused = await publish({ artifact: created.artifactId, baseRevision: created.revision, files: { 'a.html': 'A2', '../escape.css': 'x' } });
    expect(artifactRefusalOf(textOf(refused))).toMatchObject({ reason: 'invalid', problems: [{ path: '../escape.css' }] });
    expect(w.store.revision(created.artifactId)).toBe(before);
    expect(liveFiles(created.artifactId)).toEqual({ 'a.html': 'A', 'b.css': 'B' });
  });

  it('after a publish the base is what the session knows: a file the user changed that it never read still conflicts', async () => {
    const created = await design();
    await human(created.artifactId, (f) => f.setAttr('b.css', 'B by the user'));
    const merged = jsonOf<{ revision: number }>(await publish({ artifact: created.artifactId, baseRevision: created.revision, files: { 'a.html': 'A2' } }));
    expect(artifactRefusalOf(textOf(await publish({ artifact: created.artifactId, baseRevision: created.revision, files: { 'a.html': 'A3' } })))).toMatchObject({ reason: 'staleBase' });
    const blind = await publish({ artifact: created.artifactId, baseRevision: merged.revision, files: { 'b.css': 'B mine' } });
    expect(artifactRefusalOf(textOf(blind))).toMatchObject({ reason: 'conflict', paths: ['b.css'] });
    const fresh = await read(created.artifactId);
    expect(jsonOf(await publish({ artifact: created.artifactId, baseRevision: fresh.revision, files: { 'b.css': 'B mine' } }))).toMatchObject({ changed: ['b.css'] });
  });

  it('names a file a restore removed since the read as "removed by restore"', async () => {
    const created = await create({ kind: 'design', title: 'Site', files: { 'a.html': 'A' } });
    const named = await w.store.createVersion(created.artifactId, { kind: 'named', actor: HUMAN, label: 'only a' });
    await human(created.artifactId, (f) => f.setAttr('b.css', 'B'));
    const base = await read(created.artifactId);
    expect(base.files).toEqual({ 'a.html': 'A', 'b.css': 'B' });
    await w.store.restore(created.artifactId, named!, HUMAN);
    const refused = await publish({ artifact: created.artifactId, baseRevision: base.revision, files: { 'b.css': 'B2' } });
    expect(artifactRefusalOf(textOf(refused))).toMatchObject({ reason: 'conflict', conflicts: [{ path: 'b.css', detail: 'removed by restore' }] });
    expect(textOf(refused)).toContain('b.css (removed by restore)');
  });

  it('goes through the kind’s registered publish and readFiles when it has them', async () => {
    const calls: unknown[] = [];
    const adapter: KindAdapter = {
      kind: 'dashboard',
      readFiles: (doc) => ({ 'view.json': String(doc.get('model').getAttr('view') ?? '{}') }),
      publish: (live, base, sent, force) => {
        calls.push({ base, sent, force });
        live.get('model').setAttr('view', sent['view.json']);
        return { changed: ['view.json'], conflicts: [] };
      },
    };
    w.store.registerAdapter(adapter);
    const created = await create({ kind: 'dashboard', title: 'Board' });
    const answer = jsonOf(await publish({ artifact: created.artifactId, baseRevision: created.revision, files: { 'view.json': '{"a":1}' } }));
    expect(answer).toMatchObject({ changed: ['view.json'], kept: [] });
    expect(calls[0]).toEqual({ base: { 'view.json': '{}' }, sent: { 'view.json': '{"a":1}' }, force: false });
    expect(await read(created.artifactId)).toMatchObject({ files: { 'view.json': '{"a":1}' } });
  });

  it('lets an unexpected adapter exception escape the write: nothing it wrote before throwing is committed', async () => {
    w.store.registerAdapter({ kind: 'design', publish: (doc) => {
      doc.get('files').setAttr('a.html', 'partial');
      throw new Error('adapter broke');
    } });
    const created = await create({ kind: 'design', title: 'Design' });
    const outcome = await publish({ artifact: created.artifactId, baseRevision: created.revision, files: { 'a.html': 'sent' } }).catch((error: unknown) => error);
    expect(String(outcome instanceof Error ? outcome.message : textOf(outcome as never))).toContain('adapter broke');
    w.service.commitNow();
    expect(w.store.revision(created.artifactId)).toBe(created.revision);
    expect(liveFiles(created.artifactId)).toEqual({});
    expect(w.store.listVersions(created.artifactId)).toEqual([]);
  });

  it('shows the session’s presence on the artifact and writes one turn version at the turn’s end', async () => {
    const created = await design();
    await publish({ artifact: created.artifactId, baseRevision: created.revision, files: { 'a.html': 'A2' } });
    const replica = w.service.replica(SELF, created.artifactId);
    expect(replica.provider.awareness.getLocalState()).toMatchObject({ name: 'Claude' });
    await w.store.endTurn(SELF);
    expect(w.store.listVersions(created.artifactId).filter((v) => v.kind === 'turn')).toEqual([expect.objectContaining({ actor: { kind: 'session', appSessionId: SELF } })]);
    expect(replica.provider.awareness.getLocalState()).toBeNull();
  });
});
