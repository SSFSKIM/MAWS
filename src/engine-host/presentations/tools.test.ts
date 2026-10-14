// P3-C M3 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D3, D6, D7; Decision Log 8, 11, 13): a deck through
// A's real tool server, store and SQLite file with the host's presentation module registered: create from files and
// empty, read with ids, publish with warnings and a held slide, the three layers (a stale base, a property conflict
// naming the file, the element and the property with nothing written, the re-read publish), a multi-file publish at one
// revision, a replayed tool-use id, the guide, no deck suggestions; and A's `publishDoc` answering `kept` and `removed`
// through the kind's `paths` (Decision Log 13 (c)).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFiles } from '@artifacts/files';
import type { KindAdapter } from '@artifacts/host';
import { createPresentationAdapter } from '@artifacts/slides/adapter';
import { DECK_PATH } from '@artifacts/slides/deck';
import { setStyle } from '@artifacts/slides/model';
import { KIND_GUIDES } from '@artifacts/types/guides';
import type { ToolUseId } from '@shared/graph/ids';
import { ArtifactPublishResultSchema, ArtifactReadResultSchema, artifactRefusalOf, type ArtifactPublishResult } from '@shared/maws/tools';
import { DesignSystemChain } from '../design-systems/chain';
import { artifactUploadAssetTool } from '../tool-server/artifact-assets';
import { artifactPublishTool } from '../tool-server/artifact-publish';
import { artifactCreateTool, artifactDescribeTypeTool, artifactReadTool } from '../tool-server/artifact-tools';
import { HUMAN, jsonOf, openWorld, SELF, textOf, type World } from '../tool-server/artifact-world.fixture';
import { registerPresentations, type Presentations } from '.';

let w: World;
let presentations: Presentations;
beforeEach(() => {
  w = openWorld();
  presentations = registerPresentations({ documents: w, chain: new DesignSystemChain(w.store, w.service) });
});
afterEach(() => {
  presentations.close();
  w.close();
});

type Ctx = Parameters<World['ctx']>[0];
const create = async (args: Record<string, unknown>) => jsonOf<{ artifactId: string; revision: number; guide?: { guide: string } }>(await artifactCreateTool(w.deps()).call(args, w.ctx()));
const read = async (artifact: string) => ArtifactReadResultSchema.parse(jsonOf(await artifactReadTool(w.deps()).call({ artifact }, w.ctx())));
const publish = (args: Record<string, unknown>, over: Ctx = {}) => artifactPublishTool(w.deps()).call(args, w.ctx(over));
const published = async (args: Record<string, unknown>, over: Ctx = {}): Promise<ArtifactPublishResult> => ArtifactPublishResultSchema.parse(jsonOf(await publish(args, over)));
const liveFiles = (id: string) => w.service.adapterFor('presentation')!.readFiles!(w.service.live(id));
const human = (id: string, slide: string, element: string, props: Record<string, string>) => w.service.writeAs(id, HUMAN, (doc) => setStyle(doc, slide, element, props));

const S1 = 'project/slides/s1.html';
const S2 = 'project/slides/s2.html';
const S3 = 'project/slides/s3.html';
const index = (order: string[]) => JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-10-14T09:00:00Z' }, title: 'Q3 review', cover: 's1', order });
const slide = (id: string, body: string) => `<section id="${id}" style="background:#ffffff; padding:128px">\n${body}\n</section>`;
const DECK = {
  [DECK_PATH]: index(['s1', 's2']),
  [S1]: slide('s1', '<h2 id="title" style="font-size:64px; color:#1a1a1a">Plan</h2>\n<p style="font-size:32px">One path for every team</p>'),
  [S2]: slide('s2', '<h2 id="t2" style="font-size:64px">Numbers</h2>'),
};
async function deck(): Promise<{ id: string; files: Record<string, string>; revision: number }> {
  const created = await create({ kind: 'presentation', title: 'Q3 review', files: DECK });
  const answer = await read(created.artifactId);
  return { id: created.artifactId, files: answer.files!, revision: answer.revision };
}

describe('a deck through A’s tool server (M3)', () => {
  it('creates a deck from files, attaching the guide, and reads it back with an id on every element and no generic json', async () => {
    const created = await create({ kind: 'presentation', title: 'Q3 review', files: DECK });
    expect(created.guide?.guide).toBe(KIND_GUIDES.presentation.guide);
    const answer = await read(created.artifactId);
    expect(Object.keys(answer.files!)).toEqual([DECK_PATH, S1, S2]);
    expect(answer.files![S1]).toMatch(/<h2 id="title"/);
    expect(answer.files![S1]).toMatch(/<p id="e\d+-[0-9a-z]{4}"/); // the agent wrote it without one: minted (D4)
    expect(answer.json).toBeUndefined(); // the deck's roots are its files (Decision Log 8 (3))
    expect(answer.held).toBeUndefined();
    expect(answer.warnings).toBeUndefined();
  });

  it('creates an empty deck as its cover, in the design system’s roles', async () => {
    const created = await create({ kind: 'presentation', title: 'Kickoff' });
    const answer = await read(created.artifactId);
    expect(Object.keys(answer.files!)).toEqual([DECK_PATH, 'project/slides/cover.html']);
    expect(JSON.parse(answer.files![DECK_PATH]!)).toMatchObject({ v: 4, title: 'Kickoff', cover: 'cover', order: ['cover'] });
    expect(answer.files!['project/slides/cover.html']).toContain('var(--ds-type-title-size, 96px)');
  });

  it('answers a publish with the loader’s warnings and the slides it held; a read names the held slide and returns its source', async () => {
    const { id, files, revision } = await deck();
    const heldSource = slide('s2', '<div id="box" style="display:flex">loose text</div>');
    const answer = await published({
      artifact: id, baseRevision: revision,
      files: { [S1]: files[S1]!.replace('font-size:64px; color:#1a1a1a', 'font-size:64px; color:#1a1a1a; cursor:pointer'), [S2]: heldSource },
    });
    expect(answer.changed).toEqual([S2]); // a dropped property changes nothing; the held slide is marked held
    expect(answer.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ path: S1, slide: 's1', element: 'title', property: 'cursor' })]));
    expect(answer.held).toEqual([{ path: S2, reasons: [expect.stringMatching(/text/)] }]);
    const again = await read(id);
    expect(again.files![S2]).toBe(heldSource);
    expect(again.held).toEqual(answer.held);
  });

  it('warns of a picture whose asset the deck does not hold, until it is uploaded; a Claude reference always', async () => {
    const { id, files, revision } = await deck();
    const withPicture = files[S2]!.replace('</section>', '<img id="hq" alt="" src="assets/hq.png" style="width:400px; height:300px">\n<img id="logo" alt="" src="/_blob/logo1" style="width:200px; height:100px">\n</section>');
    const first = await published({ artifact: id, baseRevision: revision, files: { [S2]: withPicture } });
    expect(first.warnings).toEqual([
      { path: S2, slide: 's2', element: 'hq', property: 'src', message: expect.stringContaining('no asset assets/hq.png') },
      { path: S2, slide: 's2', element: 'logo', property: 'src', message: expect.stringContaining('Claude reference') },
    ]);
    expect((await read(id)).warnings).toEqual(first.warnings);
    writeFileSync(join(w.cwd, 'hq.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(jsonOf(await artifactUploadAssetTool(w.deps()).call({ artifact: id, path: 'hq.png' }, w.ctx()))).toMatchObject({ ref: 'assets/hq.png' });
    const reread = await read(id);
    expect(reread.warnings?.map((warning) => warning.element)).toEqual(['logo']);
  });

  it('layer 1: refuses a baseRevision that is not the session’s last read, naming the live revision', async () => {
    const { id, files, revision } = await deck();
    const refused = await publish({ artifact: id, baseRevision: revision - 1, files: { [S2]: files[S2]!.replace('Numbers', 'Totals') } });
    expect(artifactRefusalOf(textOf(refused))).toEqual({ reason: 'staleBase', liveRevision: revision });
    expect(liveFiles(id)).toEqual(files);
  });

  it('layer 3: refuses a property the owner changed since the read, naming the file, the element and the property, writing nothing; the re-read publish lands over the owner’s other edits', async () => {
    const { id, files, revision } = await deck();
    await human(id, 's1', 'title', { 'font-size': '80px' });
    const body = files[S1]!.match(/<p id="([^"]+)"/)![1]!; // the minted id (the human writes by it)
    await human(id, 's1', body, { color: '#333333' });
    const before = liveFiles(id);
    const refused = await publish({ artifact: id, baseRevision: revision, files: { [S1]: files[S1]!.replace('font-size:64px', 'font-size:72px') } });
    expect(artifactRefusalOf(textOf(refused))).toMatchObject({ reason: 'conflict', paths: [S1], conflicts: [{ path: S1, detail: 'element title: font-size changed since your read' }] });
    expect(textOf(refused)).toContain(`${S1} (element title: font-size changed since your read)`);
    expect(liveFiles(id)).toEqual(before);

    const fresh = await read(id);
    const answer = await published({ artifact: id, baseRevision: fresh.revision, files: { [S1]: fresh.files![S1]!.replace('font-size:80px', 'font-size:72px') } });
    expect(answer).toMatchObject({ status: 'published', changed: [S1], kept: [DECK_PATH, S2], removed: [] });
    expect(liveFiles(id)[S1]).toContain('font-size:72px');
    expect(liveFiles(id)[S1]).toContain('color:#333333');
  });

  it('lands a multi-file publish whole at one revision, the created slide named as added', async () => {
    const { id, files, revision } = await deck();
    const sent = {
      [DECK_PATH]: files[DECK_PATH]!.replace('"s2"\n', '"s2",\n    "s3"\n'),
      [S1]: files[S1]!.replace('>Plan<', '>The plan<'),
      [S2]: files[S2]!.replace('>Numbers<', '>Totals<'),
      [S3]: slide('s3', '<h2 id="t3" style="font-size:64px">Next</h2>'),
    };
    expect(sent[DECK_PATH]).toContain('"s3"');
    const answer = await published({ artifact: id, baseRevision: revision, files: sent });
    expect(answer).toMatchObject({ changed: [DECK_PATH, S1, S2, S3], added: [S3], kept: [], removed: [] });
    expect(answer.revision).toBe(revision + 1); // one log row: every file's change at one revision
    const live = liveFiles(id);
    expect(JSON.parse(live[DECK_PATH]!).order).toEqual(['s1', 's2', 's3']);
    expect([live[S1], live[S2], live[S3]].map((text) => /The plan|Totals|Next/.test(text!))).toEqual([true, true, true]);
  });

  it('answers a replayed tool-use id with the first result and writes nothing again', async () => {
    const { id, files, revision } = await deck();
    const args = { artifact: id, baseRevision: revision, files: { [S2]: files[S2]!.replace('>Numbers<', '>Totals<') } };
    const first = jsonOf(await publish(args, { toolUseId: 'toolu_deck_once' as ToolUseId }));
    const again = jsonOf(await publish(args, { toolUseId: 'toolu_deck_once' as ToolUseId }));
    expect(again).toEqual(first);
    expect(w.store.revision(id)).toBe((first as { revision: number }).revision);
  });

  it('describes the kind with its written guide and its format reference', async () => {
    const described = jsonOf<{ guide: string; format: string }>(await artifactDescribeTypeTool(w.deps()).call({ kind: 'presentation' }, w.ctx()));
    expect(described.format).toBe(KIND_GUIDES.presentation.format);
    expect(described.guide).not.toMatch(/Not yet written/);
    for (const name of ['artifact_publish', 'baseRevision', 'held', 'artifact_upload_asset', 'force']) expect(described.guide).toContain(name);
  });

  it('refuses a suggestion, asked for or set by the owner, writing nothing (Decision Log 8 (2))', async () => {
    const { id, files, revision } = await deck();
    const sent = { [S2]: files[S2]!.replace('>Numbers<', '>Totals<') };
    const asked = await publish({ artifact: id, baseRevision: revision, files: sent, mode: 'suggest' });
    expect(artifactRefusalOf(textOf(asked))).toMatchObject({ reason: 'invalid', kind: 'presentation', mode: 'suggest' });
    expect(textOf(asked)).toContain('mode "direct"');
    await w.store.update(id, { agentEditsAsSuggestions: true });
    const set = await publish({ artifact: id, baseRevision: revision, files: sent });
    expect(artifactRefusalOf(textOf(set))).toMatchObject({ reason: 'invalid', kind: 'presentation', setting: true });
    expect(textOf(set)).toContain('turn off');
    expect(liveFiles(id)).toEqual(files);
  });

  it('ends the turn with the deck’s summary, a created slide counted as added', async () => {
    const { id, files, revision } = await deck();
    await published({ artifact: id, baseRevision: revision, files: { [DECK_PATH]: files[DECK_PATH]!.replace('"s2"', '"s3"'), [S2]: null, [S3]: slide('s3', '<h2 id="t3" style="font-size:64px">Next</h2>') } });
    await w.store.endTurn(SELF);
    expect(w.store.listVersions(id).at(-1)).toMatchObject({ kind: 'turn', summary: 'Published 2 slides (0 changed, 1 added, 1 removed)' });
  });
});

describe('A’s publishDoc answers kept and removed from the kind’s paths (Decision Log 13 (b), (c))', () => {
  it('agrees with the files’ fallback for a File kind', async () => {
    const calls: number[] = [];
    w.store.registerAdapter({ kind: 'design', paths: (doc) => (calls.push(1), Object.keys(readFiles(doc))) });
    const answers = [];
    for (const kind of ['design', 'dashboard']) {
      const created = await create({ kind, title: kind, files: { 'a.html': 'A', 'b.css': 'B', 'c.js': 'C' } });
      const base = await read(created.artifactId);
      answers.push(await published({ artifact: created.artifactId, baseRevision: base.revision, files: { 'b.css': 'B2', 'c.js': null, 'd.svg': 'D' } }));
    }
    expect(calls.length).toBeGreaterThan(0);
    const shape = (answer: ArtifactPublishResult) => ({ changed: answer.changed, kept: answer.kept, removed: answer.removed });
    expect(shape(answers[0]!)).toEqual({ changed: ['b.css', 'd.svg'], kept: ['a.html'], removed: ['c.js'] });
    expect(shape(answers[1]!)).toEqual(shape(answers[0]!));
  });

  it('answers a deck’s publish through its paths, reading its files once, for the session’s next base', async () => {
    const real = createPresentationAdapter();
    const counts = { paths: 0, readFiles: 0 };
    const counted: KindAdapter = {
      ...real,
      paths: (doc) => (counts.paths++, real.paths!(doc)),
      readFiles: (doc) => (counts.readFiles++, real.readFiles!(doc)),
    };
    w.store.registerAdapter(counted);
    const { id, files, revision } = await deck();
    Object.assign(counts, { paths: 0, readFiles: 0 });
    const answer = await published({ artifact: id, baseRevision: revision, files: { [DECK_PATH]: files[DECK_PATH]!.replace('"s2"', '"s3"'), [S2]: null, [S3]: slide('s3', '<h2 id="t3" style="font-size:64px">Next</h2>') } });
    expect(answer).toMatchObject({ changed: [DECK_PATH, S3], added: [S3], kept: [S1], removed: [S2] });
    expect(counts).toEqual({ paths: 1, readFiles: 1 });
    // the next publish goes on from that base without reading it again
    const next = await published({ artifact: id, baseRevision: answer.revision, files: { [S3]: slide('s3', '<h2 id="t3" style="font-size:64px">Then</h2>') } });
    expect(next).toMatchObject({ changed: [S3], kept: [DECK_PATH, S1] });
    expect(counts).toEqual({ paths: 2, readFiles: 2 });
  });
});
