import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KIND_GUIDES } from '@artifacts/types/guides';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import {
  ArtifactCreateResultSchema,
  ArtifactDescribeTypeResultSchema,
  ArtifactListAssetsResultSchema,
  ArtifactListResultSchema,
  ArtifactReadResultSchema,
  ArtifactUploadAssetResultSchema,
  artifactRefusalOf,
  TOOL_ERRORS,
} from '@shared/maws/tools';
import { artifactListAssetsTool, artifactUploadAssetTool } from './artifact-assets';
import { artifactExportTool, type ArtifactExportAnswer, type ArtifactExportRequest } from './artifact-export';
import { artifactCreateTool, artifactDescribeTypeTool, artifactListTool, artifactReadTool } from './artifact-tools';
import { HUMAN, jsonOf, openWorld, SELF, textOf, type World } from './artifact-world.fixture';
import { HostBridge } from './bridge';

const PAGE = '<!doctype html><h1>Dashboard</h1><img src="https://example.com/a.png">';
let w: World;
beforeEach(() => {
  w = openWorld();
  writeFileSync(join(w.cwd, 'dashboard.html'), PAGE);
});
afterEach(() => w.close());

const create = (args: Record<string, unknown>, over: Parameters<World['ctx']>[0] = {}) => artifactCreateTool(w.deps()).call(args, w.ctx(over));
const read = (args: Record<string, unknown>, over: Parameters<World['ctx']>[0] = {}) => artifactReadTool(w.deps()).call(args, w.ctx(over));
const list = (args: Record<string, unknown> = {}, deps: Parameters<World['deps']>[0] = {}, over: Parameters<World['ctx']>[0] = {}) => artifactListTool(w.deps(deps)).call(args, w.ctx(over));
const rows = (sql: string, ...params: (string | number)[]) => w.storage.db.prepare(sql).all(...params) as Record<string, unknown>[];

describe('artifact_create', () => {
  it("keeps E2's call working: an html artifact from the page file, its X12 record mirrored under the same id, linked created", async () => {
    const result = await create({ id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }, { toolUseId: 'toolu_create' as ToolUseId });
    const answer = ArtifactCreateResultSchema.parse(jsonOf(result));
    const id = answer.artifactId;
    expect(answer).toMatchObject({ status: 'created', kind: 'html', title: 'Dashboard', handle: 'dash', id: 'dash', deliverableId: id, version: 1, externalReferences: 1 });
    expect(answer.revision).toBeGreaterThan(0);
    expect(w.store.get(id)).toMatchObject({ kind: 'html', title: 'Dashboard', handle: 'dash', createdBy: { kind: 'session', appSessionId: SELF } });
    expect(w.store.links(id).map((l) => [l.appSessionId, l.role])).toEqual([[SELF, 'created']]);
    expect(Buffer.from(w.store.files.read(id, w.store.contentRef(id).ref)).toString('utf8')).toBe(PAGE);
    const copy = join(w.userData, 'deliverables', SELF, id, 'v1.html');
    const record = (await w.deliverables.get(SELF, id))!;
    expect(record).toMatchObject({ id, appSessionId: SELF, kind: 'artifact', artifactId: 'dash', title: 'Dashboard', path: copy, toolUseId: 'toolu_create' });
    expect(record.versions).toEqual([{ path: copy, at: record.createdAt, toolUseId: 'toolu_create', sourcePath: join(w.cwd, 'dashboard.html') }]);
    expect(readFileSync(copy, 'utf8')).toBe(PAGE);
    expect(w.written).toEqual([[id, 'created']]);
  });

  it('attaches the kind’s guide once per session, and an inline page needs no file', async () => {
    const first = ArtifactCreateResultSchema.parse(jsonOf(await create({ content: '<p>one</p>', title: 'One' })));
    expect(first.guide).toEqual(KIND_GUIDES.html);
    const second = ArtifactCreateResultSchema.parse(jsonOf(await create({ content: '<p>two</p>', title: 'Two' })));
    expect(second.guide).toBeUndefined();
    expect(second.handle).toBeUndefined();
    expect(second.id).toBe(second.artifactId); // the X12 name of a page without a handle is its id
    expect(ArtifactCreateResultSchema.parse(jsonOf(await create({ kind: 'design', title: 'D' }))).guide).toEqual(KIND_GUIDES.design);
  });

  it('creates a Y kind empty or from files, written by the session in one commit with the entity', async () => {
    const empty = ArtifactCreateResultSchema.parse(jsonOf(await create({ kind: 'presentation', title: 'Deck' })));
    expect(empty).toMatchObject({ kind: 'presentation', revision: 0 });
    expect(empty.deliverableId).toBeUndefined();
    const filled = ArtifactCreateResultSchema.parse(jsonOf(await create({ kind: 'design', title: 'Site', files: { 'index.html': '<p>hi</p>', 'site.css': 'p{}' } })));
    expect(filled.revision).toBeGreaterThan(0);
    const json = jsonOf(await read({ artifact: filled.artifactId }));
    expect(json).toMatchObject({ revision: filled.revision, files: { 'index.html': '<p>hi</p>', 'site.css': 'p{}' } });
    expect(rows('SELECT actor FROM artifact_updates WHERE artifactId = ?', filled.artifactId)).toEqual([{ actor: `session:${SELF}` }]);
  });

  it('refuses before writing anything: files a kind cannot hold, a taken handle, a missing or non-HTML file, contradictory arguments', async () => {
    await create({ id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' });
    const before = rows('SELECT id FROM artifacts').length;
    const invalid = await create({ kind: 'design', title: 'Bad', files: { '../x.css': 'x' } });
    expect(invalid.isError).toBe(true);
    expect(artifactRefusalOf(textOf(invalid))).toMatchObject({ reason: 'invalid', problems: [{ path: '../x.css' }] });
    expect(textOf(await create({ handle: 'dash', content: '<p/>', title: 'Again' }))).toBe(TOOL_ERRORS.artifactExists('dash'));
    expect(textOf(await create({ html_path: 'missing.html', title: 'M' }))).toBe(TOOL_ERRORS.artifactNotAFile('artifact_create', join(w.cwd, 'missing.html')));
    writeFileSync(join(w.cwd, 'notes.txt'), 'x');
    expect(textOf(await create({ path: 'notes.txt', title: 'N' }))).toBe(TOOL_ERRORS.notHtml('artifact_create', join(w.cwd, 'notes.txt')));
    expect((await create({ path: 'dashboard.html', content: '<p/>', title: 'Both' })).isError).toBe(true);
    expect((await create({ kind: 'document', title: 'Doc', files: { 'a.md': 'x' } })).isError).toBe(true);
    expect((await create({ id: 'a', handle: 'b', content: '<p/>', title: 'Two names' })).isError).toBe(true);
    expect(rows('SELECT id FROM artifacts').length).toBe(before);
  });

  it('a file artifact references its path in place, mirrored as an X12 file record', async () => {
    writeFileSync(join(w.cwd, 'report.pdf'), '%PDF-1.4');
    const answer = ArtifactCreateResultSchema.parse(jsonOf(await create({ kind: 'file', path: 'report.pdf', title: 'Report' })));
    expect(w.store.get(answer.artifactId)).toMatchObject({ kind: 'file', linkedPath: join(w.cwd, 'report.pdf') });
    expect(await w.deliverables.get(SELF, answer.artifactId)).toMatchObject({ kind: 'file', path: join(w.cwd, 'report.pdf'), title: 'Report' });
  });

  it('a replayed tool-use id answers the first result and writes nothing again', async () => {
    const first = jsonOf(await create({ content: '<p>once</p>', title: 'Once' }, { toolUseId: 'toolu_same' as ToolUseId }));
    const again = jsonOf(await create({ content: '<p>once</p>', title: 'Once' }, { toolUseId: 'toolu_same' as ToolUseId }));
    expect(again).toMatchObject({ artifactId: first.artifactId, revision: first.revision, version: 1 });
    expect(rows('SELECT id FROM artifacts')).toHaveLength(1);
    expect(w.written).toHaveLength(1);
    // the same tool-use id in another session is another call
    const other = jsonOf(await create({ content: '<p>once</p>', title: 'Once' }, { toolUseId: 'toolu_same' as ToolUseId, appSessionId: 'app-other' as AppSessionId }));
    expect(other.artifactId).not.toBe(first.artifactId);
  });

  it('answers a repeated call from its ledger before any precondition: a named create, its guide and X12 fields as first answered', async () => {
    const ctx = w.ctx({ toolUseId: 'toolu_named' as ToolUseId });
    const first = await artifactCreateTool(w.deps()).call({ handle: 'named', content: '<p>one</p>', title: 'Named' }, ctx);
    expect(ArtifactCreateResultSchema.parse(jsonOf(first)).guide).toEqual(KIND_GUIDES.html);
    const again = await artifactCreateTool(w.deps()).call({ handle: 'named', content: '<p>one</p>', title: 'Named' }, ctx);
    expect(again).toEqual(first); // not "already exists", and the guide still there
    expect(rows('SELECT id FROM artifacts')).toHaveLength(1);
    writeFileSync(join(w.cwd, 'gone.html'), '<p>x</p>');
    const fromFile = w.ctx({ toolUseId: 'toolu_file' as ToolUseId });
    const created = await create({ path: 'gone.html', title: 'Gone' }, fromFile);
    rmSync(join(w.cwd, 'gone.html'));
    expect(await artifactCreateTool(w.deps()).call({ path: 'gone.html', title: 'Gone' }, fromFile)).toEqual(created);
  });

  it('is atomic for a Y kind with files: an entity whose first content fails to land leaves nothing', async () => {
    let calls = 0;
    w.store.registerAdapter({ kind: 'design', publish: (live) => {
      if (++calls === 2) throw new Error('the write broke'); // the dry run passes, the write itself fails
      live.get('files').setAttr('a.css', 'x');
      return { changed: ['a.css'], conflicts: [] };
    } });
    const result = await create({ kind: 'design', title: 'Broken', files: { 'a.css': 'x' } }).catch((error: unknown) => error);
    expect(result instanceof Error || (result as { isError?: boolean }).isError).toBeTruthy();
    expect(rows('SELECT id FROM artifacts')).toEqual([]);
    expect(rows('SELECT seq FROM artifact_updates')).toEqual([]);
  });

  it('attaches what the registered chain names to a document, presentation or design create, and sets no designSystemId (Decision Log 42)', async () => {
    const system = await w.store.create({ kind: 'design_system', title: 'House' }, HUMAN);
    w.store.registerDesignSystemContext(async (s) => `LAW:${s.title}`);
    const targets: unknown[] = [];
    let answer: { id: string } | { builtin: 'maws' } = { id: system.id };
    w.store.registerDesignSystemChain({
      governing: (target) => {
        targets.push(target);
        return answer;
      },
    });
    const deck = ArtifactCreateResultSchema.parse(jsonOf(await create({ kind: 'presentation', title: 'Deck' })));
    expect(deck.designSystem).toBe('LAW:House');
    expect(w.store.get(deck.artifactId)!.designSystemId).toBeUndefined(); // governed by reference: the chain decides later
    expect(targets[0]).toEqual({ designSystemId: null, spaceId: null }); // a new artifact: no system or Space of its own
    answer = { builtin: 'maws' };
    expect(ArtifactCreateResultSchema.parse(jsonOf(await create({ kind: 'document', title: 'Doc' }))).designSystem).toBeUndefined();
  });

  it('reads the governing design system behind the read barrier: no answer reveals a batch still open', async () => {
    const system = await w.store.create({ kind: 'design_system', title: 'Brand' }, HUMAN);
    w.store.registerDesignSystemContext(async (s) => `LAW:${s.title}`);
    const original = w.store.designSystemContextFor.bind(w.store);
    let pending: Promise<void> | null = null;
    w.store.designSystemContextFor = (target) => {
      pending = w.store.setDefaults({ owner: system.id, spaces: {} }); // the owner's default lands in a batch still open
      return original(target);
    };
    const answer = jsonOf(await create({ kind: 'presentation', title: 'Deck' }));
    expect(w.storage.batchOpen).toBe(false);
    expect(answer.designSystem).toBe('LAW:Brand');
    await pending;
  });

  it('fails rather than answer a design-system context read from a batch that was then lost', async () => {
    const system = await w.store.create({ kind: 'design_system', title: 'Brand' }, HUMAN);
    await w.store.setDefaults({ owner: system.id, spaces: {} });
    w.store.registerDesignSystemContext(async () => {
      const pending = w.service.writeAs(system.id, HUMAN, (d) => d.get('law').setAttr('text', 'UNCOMMITTED LAW'));
      pending.catch(() => {});
      const text = String(w.service.live(system.id).get('law').getAttr('text'));
      const commit = w.storage.commit.bind(w.storage);
      w.storage.commit = () => {
        throw new Error('provider batch lost');
      };
      w.service.commitNow();
      w.storage.commit = commit;
      await pending.catch(() => {});
      return text;
    });
    const outcome = await create({ kind: 'presentation', title: 'Deck' }).catch((error: unknown) => error);
    expect(JSON.stringify(outcome instanceof Error ? outcome.message : outcome)).not.toContain('UNCOMMITTED LAW');
    expect(outcome instanceof Error || (outcome as { isError?: boolean }).isError).toBeTruthy();
    expect(w.store.list({ kind: 'presentation' })).toEqual([]);
  });

  it('answers overlapping creates and deliveries with one tool-use id alike, with one X12 record each', async () => {
    const tool = artifactCreateTool(w.deps());
    const ctx = w.ctx({ toolUseId: 'toolu_both' as ToolUseId });
    const [first, second] = await Promise.all([tool.call({ handle: 'dash', content: '<p/>', title: 'D' }, ctx), tool.call({ handle: 'dash', content: '<p/>', title: 'D' }, { ...ctx, requestId: w.ctx().requestId })]);
    expect(second).toEqual(first);
    expect(rows('SELECT id FROM artifacts')).toHaveLength(1);
    expect(w.written).toEqual([[jsonOf(first).artifactId, 'created']]);
  });

  it('attaches the governing design system’s guide to a document, presentation or design through D’s provider', async () => {
    const system = await w.store.create({ kind: 'design_system', title: 'Brand' }, HUMAN);
    await w.store.setDefaults({ owner: system.id, spaces: {} });
    w.store.registerDesignSystemContext(async (s) => `# DESIGN of ${s.title}`);
    expect(jsonOf(await create({ kind: 'presentation', title: 'Deck' }))).toMatchObject({ designSystem: '# DESIGN of Brand' });
    expect(jsonOf(await create({ content: '<p/>', title: 'Page' })).designSystem).toBeUndefined();
  });

  it('refuses a document’s markdown content, which P3-B’s document create serves, writing nothing', async () => {
    const result = await create({ kind: 'document', title: 'Notes', content: '# Notes' });
    expect(artifactRefusalOf(textOf(result))).toMatchObject({ reason: 'invalid', kind: 'document' });
    expect(rows('SELECT id FROM artifacts')).toEqual([]);
  });

  it('answers unavailable when the store did not open', async () => {
    const result = await artifactCreateTool(w.deps({ artifacts: () => null })).call({ content: '<p/>', title: 'X' }, w.ctx());
    expect(artifactRefusalOf(textOf(result))).toEqual({ reason: 'unavailable' });
  });
});

describe('artifact_list', () => {
  it('lists what the session and the sessions above it are linked to, newest first, with revision and last editor; scope all lists the library', async () => {
    const PARENT = 'app-parent' as AppSessionId;
    const mine = jsonOf(await create({ handle: 'mine', content: '<p/>', title: 'Mine' }));
    const theirs = jsonOf(await create({ handle: 'theirs', content: '<p/>', title: 'Theirs' }, { appSessionId: PARENT }));
    const stranger = jsonOf(await create({ content: '<p/>', title: 'Stranger' }, { appSessionId: 'app-stranger' as AppSessionId }));
    const human = await w.store.create({ kind: 'design', title: 'Human' }, HUMAN);
    await w.service.writeAs(human.id, HUMAN, (doc) => doc.get('files').setAttr('a.md', 'x'));

    const own = ArtifactListResultSchema.parse(jsonOf(await list()));
    expect(own.artifacts.map((a) => a.title)).toEqual(['Mine']);
    const scoped = ArtifactListResultSchema.parse(jsonOf(await list({}, { artifactScope: [PARENT] })));
    expect(scoped.artifacts.map((a) => a.title)).toEqual(['Theirs', 'Mine']);
    expect(scoped.artifacts[0]).toMatchObject({ id: theirs.artifactId, handle: 'theirs', kind: 'html', revision: theirs.revision, lastEditor: { by: 'another session', appSessionId: PARENT } });
    expect(scoped.artifacts[1]).toMatchObject({ id: mine.artifactId, lastEditor: { by: 'this session' } });
    const all = ArtifactListResultSchema.parse(jsonOf(await list({ scope: 'all' })));
    expect(all.artifacts.map((a) => a.title).sort()).toEqual(['Human', 'Mine', 'Stranger', 'Theirs']);
    expect(all.artifacts.find((a) => a.id === human.id)).toMatchObject({ kind: 'design', lastEditor: { by: 'user' } });
    expect(all.artifacts.find((a) => a.id === stranger.artifactId)).not.toHaveProperty('handle');
    expect(ArtifactListResultSchema.parse(jsonOf(await list({ scope: 'all', kind: 'design' }))).artifacts.map((a) => a.title)).toEqual(['Human']);
    expect(ArtifactListResultSchema.parse(jsonOf(await list({ scope: 'all', query: 'the' }))).artifacts.map((a) => a.title)).toEqual(['Theirs']);
  });

  it('takes E2’s empty call', async () => {
    expect(jsonOf(await list({}))).toEqual({ status: 'listed', artifacts: [] });
  });
});

describe('artifact_describe_type', () => {
  it('returns the kind’s guide and format reference, placeholders included', async () => {
    for (const kind of ['html', 'document', 'presentation'] as const) {
      expect(ArtifactDescribeTypeResultSchema.parse(jsonOf(await artifactDescribeTypeTool().call({ kind }, w.ctx())))).toEqual({ status: 'described', kind, ...KIND_GUIDES[kind] });
    }
    expect((await artifactDescribeTypeTool().call({ kind: 'spreadsheet' }, w.ctx())).isError).toBe(true);
  });

  it('attaches the governing design system’s guide for a document, presentation or design, as the chain names it (Decision Log 42)', async () => {
    const system = await w.store.create({ kind: 'design_system', title: 'Brand' }, HUMAN);
    w.store.registerDesignSystemContext(async (s) => `LAW:${s.title}`);
    const describe = async (kind: string) => jsonOf(await artifactDescribeTypeTool(w.deps()).call({ kind }, w.ctx()));
    expect((await describe('document')).designSystem).toBeUndefined(); // A's chain before registration: no default set, nothing governs
    await w.store.setDefaults({ owner: system.id, spaces: {} });
    expect(ArtifactDescribeTypeResultSchema.parse(await describe('design'))).toEqual({ status: 'described', kind: 'design', ...KIND_GUIDES.design, designSystem: 'LAW:Brand' });
    expect((await describe('html')).designSystem).toBeUndefined(); // only the kinds a design system styles

    let answer: { id: string } | { builtin: 'maws' } = { builtin: 'maws' };
    w.store.registerDesignSystemChain({ governing: () => answer });
    expect((await describe('presentation')).designSystem).toBeUndefined(); // the bundled floor: nothing attached, no guide made up
    answer = { id: system.id };
    expect((await describe('presentation')).designSystem).toBe('LAW:Brand');
  });
});

describe('artifact_read', () => {
  it('reads an html page as its one file, links the session viewed and lists the versions newest first', async () => {
    const created = jsonOf(await create({ handle: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }));
    const answer = ArtifactReadResultSchema.parse(jsonOf(await read({ artifact: 'dash' })));
    expect(answer).toMatchObject({ status: 'read', artifactId: created.artifactId, kind: 'html', handle: 'dash', revision: created.revision, files: { 'index.html': PAGE } });
    expect(answer.versions).toEqual([expect.objectContaining({ kind: 'import', revision: created.revision, by: 'this session' })]);
    expect(w.store.links(created.artifactId as string).map((l) => l.role).sort()).toEqual(['created', 'viewed']);
    expect(ArtifactReadResultSchema.parse(jsonOf(await read({ artifact: created.artifactId })))).toMatchObject({ files: { 'index.html': PAGE } });
  });

  it('reads an earlier html revision and a retained version read-only', async () => {
    const created = jsonOf(await create({ handle: 'dash', content: '<p>one</p>', title: 'D' }));
    const id = created.artifactId as string;
    await w.store.writeContent(id, { bytes: Buffer.from('<p>two</p>'), name: 'index.html' }, HUMAN);
    expect(jsonOf(await read({ artifact: 'dash' }))).toMatchObject({ files: { 'index.html': '<p>two</p>' } });
    expect(jsonOf(await read({ artifact: 'dash', revision: created.revision as number }))).toMatchObject({ revision: created.revision, files: { 'index.html': '<p>one</p>' } });
    const [first] = w.store.listVersions(id);
    expect(jsonOf(await read({ artifact: 'dash', version: first!.id }))).toMatchObject({ version: { id: first!.id, kind: 'import' }, files: { 'index.html': '<p>one</p>' } });
    expect(artifactRefusalOf(textOf(await read({ artifact: 'dash', version: 999 })))).toMatchObject({ reason: 'notFound', version: 999 });
  });

  it('reads a file kind’s files, all or the named ones, and a document’s root types as JSON', async () => {
    const design = jsonOf(await create({ kind: 'design', title: 'Site', files: { 'a.html': 'A', 'b.css': 'B' } }));
    expect(jsonOf(await read({ artifact: design.artifactId, paths: ['b.css', 'nope.css'] }))).toMatchObject({ files: { 'b.css': 'B' }, missing: ['nope.css'] });
    const doc = await w.store.create({ kind: 'document', title: 'Notes' }, HUMAN);
    await w.service.writeAs(doc.id, HUMAN, (d) => {
      d.get('root').setAttr('title', 'Notes');
      d.get('root').insert(0, 'hello');
    });
    const answer = ArtifactReadResultSchema.parse(jsonOf(await read({ artifact: doc.id })));
    expect(answer.json).toEqual({ root: { attrs: { title: 'Notes' }, children: ['hello'] } });
    expect(answer.files).toBeUndefined();
  });

  it('reads a file artifact’s metadata, with its text when it is a small text file', async () => {
    writeFileSync(join(w.cwd, 'notes.txt'), 'plain notes');
    writeFileSync(join(w.cwd, 'blob.bin'), Buffer.from([0, 1, 2, 0xff]));
    const text = jsonOf(await create({ kind: 'file', path: 'notes.txt', title: 'Notes' }));
    const blob = jsonOf(await create({ kind: 'file', path: 'blob.bin', title: 'Blob' }));
    expect(jsonOf(await read({ artifact: text.artifactId }))).toMatchObject({ file: { name: 'notes.txt', path: join(w.cwd, 'notes.txt'), size: 11, exists: true, text: 'plain notes' } });
    expect((jsonOf(await read({ artifact: blob.artifactId })) as { file: Record<string, unknown> }).file).not.toHaveProperty('text');
  });

  it('refuses an artifact no session of the lineage holds', async () => {
    expect(textOf(await read({ artifact: 'nope' }))).toBe(TOOL_ERRORS.noArtifact('artifact_read', 'nope'));
  });
});

describe('artifact_upload_asset and artifact_list_assets', () => {
  it('adds a file under the working directory as an asset, idempotent by tool-use id, and lists it', async () => {
    const design = jsonOf(await create({ kind: 'design', title: 'Site' }));
    mkdirSync(join(w.cwd, 'img'));
    writeFileSync(join(w.cwd, 'img', 'logo.png'), Buffer.from([137, 80, 78, 71]));
    const upload = () => artifactUploadAssetTool(w.deps()).call({ artifact: design.artifactId, path: 'img/logo.png' }, w.ctx({ toolUseId: 'toolu_up' as ToolUseId }));
    const answer = ArtifactUploadAssetResultSchema.parse(jsonOf(await upload()));
    expect(answer).toMatchObject({ status: 'uploaded', ref: 'assets/logo.png', name: 'logo.png', size: 4 });
    expect(jsonOf(await upload())).toEqual(answer);
    const listed = ArtifactListAssetsResultSchema.parse(jsonOf(await artifactListAssetsTool(w.deps()).call({ artifact: design.artifactId }, w.ctx())));
    expect(listed.assets).toEqual([expect.objectContaining({ assetId: answer.assetId, ref: 'assets/logo.png', mime: 'image/png', size: 4 })]);
    expect(w.store.links(design.artifactId as string).map((l) => l.role).sort()).toEqual(['created', 'edited']);
  });

  it('answers a repeated upload from its ledger even after its source file is gone', async () => {
    const design = jsonOf(await create({ kind: 'design', title: 'Site' }));
    writeFileSync(join(w.cwd, 'logo.png'), 'png');
    const ctx = w.ctx({ toolUseId: 'toolu_up' as ToolUseId });
    const first = await artifactUploadAssetTool(w.deps()).call({ artifact: design.artifactId, path: 'logo.png' }, ctx);
    rmSync(join(w.cwd, 'logo.png'));
    expect(await artifactUploadAssetTool(w.deps()).call({ artifact: design.artifactId, path: 'logo.png' }, ctx)).toEqual(first);
  });

  it('refuses a path outside the working directory and a missing file', async () => {
    const design = jsonOf(await create({ kind: 'design', title: 'Site' }));
    expect(artifactRefusalOf(textOf(await artifactUploadAssetTool(w.deps()).call({ artifact: design.artifactId, path: '/etc/hosts' }, w.ctx())))).toMatchObject({ reason: 'invalid' });
    expect(textOf(await artifactUploadAssetTool(w.deps()).call({ artifact: design.artifactId, path: 'gone.png' }, w.ctx()))).toBe(TOOL_ERRORS.artifactNotAFile('artifact_upload_asset', join(w.cwd, 'gone.png')));
  });
});

describe('artifact_export', () => {
  it('asks main’s export service for a path under the artifact’s exports and copies the file to `to` (a stubbed answer)', async () => {
    const page = jsonOf(await create({ handle: 'dash', content: '<p/>', title: 'D' }));
    const sent: ArtifactExportRequest[] = [];
    const exporter = new HostBridge<ArtifactExportRequest, ArtifactExportAnswer>({ send: (request) => sent.push(request), answerMs: 60_000 });
    const pending = artifactExportTool({ ...w.deps(), exporter }).call({ artifact: 'dash', format: 'pdf', to: 'out/dash.pdf' }, w.ctx());
    for (let i = 0; i < 200 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 1));
    const path = join(w.userData, 'artifacts', page.artifactId as string, 'exports', `${page.revision}-pdf.pdf`);
    expect(sent).toEqual([expect.objectContaining({ artifactId: page.artifactId, kind: 'html', format: 'pdf', revision: page.revision, path, appSessionId: SELF })]);
    writeFileSync(path, '%PDF-1.7');
    exporter.answer(sent[0]!.requestId, { ok: true });
    expect(jsonOf(await pending)).toEqual({ status: 'exported', artifactId: page.artifactId, format: 'pdf', revision: page.revision, path, copiedTo: join(w.cwd, 'out', 'dash.pdf') });
    expect(readFileSync(join(w.cwd, 'out', 'dash.pdf'), 'utf8')).toBe('%PDF-1.7');
  });

  it('answers exportUnavailable for a pair main has no exporter for, and in a build without the service', async () => {
    jsonOf(await create({ handle: 'dash', content: '<p/>', title: 'D' }));
    const exporter = new HostBridge<ArtifactExportRequest, ArtifactExportAnswer>({ send: (request) => queueMicrotask(() => exporter.answer(request.requestId, { ok: false, unavailable: true, error: 'no docx for html' })), answerMs: 60_000 });
    expect(artifactRefusalOf(textOf(await artifactExportTool({ ...w.deps(), exporter }).call({ artifact: 'dash', format: 'docx' }, w.ctx())))).toEqual({ reason: 'exportUnavailable', format: 'docx', kind: 'html' });
    expect(artifactRefusalOf(textOf(await artifactExportTool(w.deps()).call({ artifact: 'dash', format: 'pdf' }, w.ctx())))).toMatchObject({ reason: 'exportUnavailable' });
    const closed = new HostBridge<ArtifactExportRequest, ArtifactExportAnswer>({ send: () => {}, answerMs: 60_000, hasClient: () => false });
    expect(textOf(await artifactExportTool({ ...w.deps(), exporter: closed }).call({ artifact: 'dash', format: 'pdf' }, w.ctx()))).toBe(TOOL_ERRORS.appNotOpen('artifact_export'));
    expect(existsSync(join(w.cwd, 'out'))).toBe(false);
  });
});
