// The engine host's design-system module over A's real store (P3-D M6; docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md
// D9, D10; Acceptance 7 through the store, 12 and 13): seeding, the default chain, the context `artifact_create`
// attaches, the agent's publish through the registered adapter, deletion's refusal and the pinned version's read.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { colorFromHex } from '@artifacts/design-system/color';
import { designSystemMirrorWriter } from '@artifacts/design-system/mirror';
import { isGeneratedPath, readFiles, readSystem, setToken, writeSystem } from '@artifacts/design-system/model';
import { parseTokens, serializeTokens } from '@artifacts/design-system/tokens';
import { snapshotOfDoc, staticView } from '@artifacts/design-system/view';
import { mirrorWriterFor } from '@artifacts/library/mirror';
import { DEFAULT_SYSTEMS, HOUSE_KEY } from '@artifacts/types/design_system/defaults';
import { applyV2, newDoc, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { openDocuments, type Documents } from '../documents';
import { ArtifactStoreError } from '../documents/errors';
import { artifactCreateTool, artifactDescribeTypeTool } from '../tool-server/artifact-tools';
import { jsonOf, openWorld } from '../tool-server/artifact-world.fixture';
import { registerDesignSystems, type DesignSystems } from '.';

const HUMAN: Actor = { kind: 'human' };
const AGENT: Actor = { kind: 'session', appSessionId: 'app-ds-agent' as AppSessionId };
const FONT = { name: 'face.woff2', mime: 'font/woff2', bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x32]) };

let dir: string;
let documents: Documents;
let systems: DesignSystems;
let logs: string[];

function open(): void {
  documents = openDocuments(dir, () => {})!;
  logs = [];
  systems = registerDesignSystems({ documents, log: (line) => logs.push(line), loadAssets: async (key) => (key === 'official' ? [FONT] : []) });
}
function close(): void {
  systems.close();
  documents.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-design-systems-'));
  open();
});
afterEach(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

const store = () => documents.store;
const service = () => documents.service;
const live = (): { id: string; title: string }[] => store().list({ kind: 'design_system' });
const docOf = (artifactId: string): Doc => {
  const doc = newDoc();
  applyV2(doc, service().readState(artifactId).state);
  return doc;
};
const filesOf = (artifactId: string) => readFiles(docOf(artifactId));
const byKey = (key: string) => live().find((s) => readSystem(docOf(s.id)).meta?.origin.key === key)!.id;
const accent = (doc: Doc) => readSystem(doc).tokens.tokens.get('color.accent.$root')!.$value as { hex: string };

describe('seeding (D9; Decision Log 7)', () => {
  it('creates every bundled default in a fresh store, as an ordinary system with its origin, files and assets', async () => {
    await systems.seeded;
    const seeded = live();
    expect(seeded.map((s) => s.title).sort()).toEqual(DEFAULT_SYSTEMS.map((d) => d.name).sort());
    for (const source of DEFAULT_SYSTEMS) {
      const id = byKey(source.key);
      const { meta } = readSystem(docOf(id));
      expect(meta).toMatchObject({ name: source.name, origin: { route: 'default', key: source.key } });
      expect(store().get(id)).toMatchObject({ createdBy: HUMAN, kind: 'design_system' });
      // the files the agent reads are the bundled files, the generated two beside them
      const files = filesOf(id);
      // the token file as the canonical writer writes the bundled one, read on its own (M6 fix wave 1, I4)
      const canonical = parseTokens(JSON.parse(source.files['tokens.tokens.json']!));
      expect(canonical.problems, source.key).toEqual([]);
      for (const [path, text] of Object.entries(source.files)) expect(files[path], path).toBe(path === 'tokens.tokens.json' ? serializeTokens(canonical.tokens!) : text);
      expect(Object.keys(files)).toEqual(expect.arrayContaining(['tokens.css', 'office-theme.json']));
    }
    expect(store().listAssets(byKey('official')).map((a) => a.ref)).toEqual(['assets/face.woff2']);
    expect(store().listAssets(byKey(HOUSE_KEY))).toEqual([]);
    expect(logs).toEqual([expect.stringContaining('seeded the built-in design systems')]);
  });

  it('never seeds a store that held a system, deleted ones included', async () => {
    await systems.seeded;
    for (const { id } of live()) await store().delete(id);
    close();
    open();
    await systems.seeded;
    expect(live()).toEqual([]);
    expect(store().list({ kind: 'design_system', deleted: true })).toHaveLength(DEFAULT_SYSTEMS.length);
    expect(logs).toEqual([]);
  });

  it('leaves a store with an owner-made system alone', async () => {
    close();
    rmSync(dir, { recursive: true, force: true });
    dir = mkdtempSync(join(tmpdir(), 'maws-design-systems-'));
    documents = openDocuments(dir, () => {})!;
    await documents.store.create({ kind: 'design_system', title: 'Mine' }, HUMAN);
    documents.close();
    open();
    await systems.seeded;
    expect(live().map((s) => s.title)).toEqual(['Mine']);
  });
});

describe('the default chain (Acceptance 12)', () => {
  it('takes the artifact’s own system, then its Space’s, then the owner’s, then the house system, then the floor', async () => {
    await systems.seeded;
    const chain = systems.chain!;
    const [house, classroom, official] = [byKey(HOUSE_KEY), byKey('classroom'), byKey('official')];
    const space = (await store().createSpace({ name: 'Teaching' })).id;
    expect(chain.governing({})).toEqual({ id: house });
    await store().setDefaults({ owner: official, spaces: { [space]: classroom } });
    expect(chain.governing({})).toEqual({ id: official });
    expect(chain.governing({ spaceId: space })).toEqual({ id: classroom });
    expect(chain.governing({ spaceId: space, designSystemId: house })).toEqual({ id: house });
    // a deleted id is skipped down the chain, never an error
    await store().delete(classroom);
    expect(chain.governing({ spaceId: space })).toEqual({ id: official });
    expect(chain.governing({ designSystemId: 'b9d1c8a2-0000-4000-8000-000000000000' })).toEqual({ id: official });
    await store().delete(official);
    expect(chain.governing({ spaceId: space })).toEqual({ id: house });
    await store().delete(house);
    expect(chain.house()).toBeNull();
    expect(chain.governing({})).toEqual({ builtin: 'maws' });
  });

  it('names as the house system the earliest live system adopted from the maws key, not its title', async () => {
    await systems.seeded;
    const chain = systems.chain!;
    const house = byKey(HOUSE_KEY);
    await store().update(house, { title: 'Renamed' });
    expect(chain.house()).toBe(house);
    // a copy of the house system is a later one with the same origin: the first stays the house
    const copy = await store().duplicate(house, {}, HUMAN);
    expect(chain.house()).toBe(house);
    await store().delete(house);
    expect(chain.house()).toBe(copy.id);
  });
});

// D's chain registered in A's store (X23, A's M7): what A's pin and A's tools ask the store, D's chain answers, with the
// house link and a deleted default's fall-through that A's own chain lacks.
describe('the chain registered in A’s store (X23; Acceptance 12)', () => {
  const pinOf = async (artifactId: string) => {
    await service().writeAs(artifactId, AGENT, (d) => d.get('root').setAttr('n', Math.random()));
    const versionId = (await store().createVersion(artifactId, { kind: 'named', actor: HUMAN, label: 'v' }))!;
    return store().listVersions(artifactId).find((v) => v.id === versionId)!.designSystemRef ?? null;
  };

  it('pins a document with no system of its own, and no defaults set, to the house system', async () => {
    await systems.seeded;
    const doc = await store().create({ kind: 'document', title: 'Note' }, AGENT);
    expect(await pinOf(doc.id)).toEqual({ id: byKey(HOUSE_KEY), versionSeq: expect.any(Number) });
  });

  it('lets a deleted default fall through: a Space’s to the owner’s, the owner’s to the house system', async () => {
    await systems.seeded;
    const [house, classroom, official] = [byKey(HOUSE_KEY), byKey('classroom'), byKey('official')];
    const space = (await store().createSpace({ name: 'Teaching' })).id;
    await store().setDefaults({ owner: official, spaces: { [space]: classroom } });
    const doc = await store().create({ kind: 'document', title: 'Lab notes', spaceId: space }, AGENT);
    expect((await pinOf(doc.id))!.id).toBe(classroom);
    await store().delete(classroom); // a default names it, no artifact does: the delete goes through
    expect((await pinOf(doc.id))!.id).toBe(official);
    await store().delete(official);
    expect((await pinOf(doc.id))!.id).toBe(house);
  });

  it('attaches the governing system’s law to artifact_create and artifact_describe_type, down the chain', async () => {
    const world = openWorld();
    const mounted = registerDesignSystems({ documents: { storage: world.storage, service: world.service, store: world.store, close: () => {} }, log: () => {}, loadAssets: async () => [] });
    try {
      await mounted.seeded;
      const keyed = (key: string) => world.store.list({ kind: 'design_system' }).find((s) => s.title === DEFAULT_SYSTEMS.find((d) => d.key === key)!.name)!.id;
      const lawOf = (key: string) => DEFAULT_SYSTEMS.find((d) => d.key === key)!.files['DESIGN.md']!.trim();
      const describeType = async () => jsonOf<{ designSystem?: string }>(await artifactDescribeTypeTool({ artifacts: () => world.store }).call({ kind: 'document' }, world.ctx())).designSystem;
      const create = async (title: string) => jsonOf<{ designSystem?: string; artifactId: string }>(await artifactCreateTool(world.deps()).call({ kind: 'document', title }, world.ctx()));

      // no defaults: the house system's law
      expect(await describeType()).toContain(lawOf(HOUSE_KEY));
      const first = await create('First');
      expect(first.designSystem).toContain(lawOf(HOUSE_KEY));
      expect(world.store.get(first.artifactId)!.designSystemId).toBeUndefined(); // governed by reference
      // the owner's default
      const classroom = keyed('classroom');
      await world.store.setDefaults({ owner: classroom, spaces: {} });
      expect(await describeType()).toContain(lawOf('classroom'));
      expect((await create('Second')).designSystem).toContain(lawOf('classroom'));
      // deleted, it falls through to the house system
      await world.store.delete(classroom);
      expect(await describeType()).toContain(lawOf(HOUSE_KEY));
      expect((await create('Third')).designSystem).toContain(lawOf(HOUSE_KEY));
    } finally {
      mounted.close();
      world.close();
    }
  });
});

describe('the context artifact_create attaches (D10, Decision Log 4)', () => {
  it('names the governing system, lists its values and attaches its law whole', async () => {
    await systems.seeded;
    const house = byKey(HOUSE_KEY);
    const doc = await store().create({ kind: 'document', title: 'Syllabus', designSystemId: house }, AGENT);
    const context = (await store().designSystemContextFor(doc.id))!;
    const source = DEFAULT_SYSTEMS.find((d) => d.key === HOUSE_KEY)!;
    expect(context).toContain(`The design system "${source.name}" (artifact ${house}) governs this artifact.`);
    expect(context).toMatch(/--ds-color-accent: #[0-9a-f]{6};/);
    expect(context).toContain(source.files['DESIGN.md']!.trim());
  });

  it('says a system has no law rather than writing one', async () => {
    await systems.seeded;
    const bare = await store().create({ kind: 'design_system', title: 'Imported' }, HUMAN);
    const tokens = DEFAULT_SYSTEMS[0]!.files['tokens.tokens.json']!;
    await service().writeAs(bare.id, HUMAN, (doc) => void writeSystem(doc, { 'tokens.tokens.json': tokens }, { route: 'imported', at: 1 }, { name: 'Imported' }));
    const doc = await store().create({ kind: 'document', title: 'Note', designSystemId: bare.id }, AGENT);
    expect(await store().designSystemContextFor(doc.id)).toContain('It has no law yet');
  });
});

describe('the agent’s publish through the store (Acceptance 7)', () => {
  const adapter = () => service().adapterFor('design_system')!;
  const tokensWith = (files: Record<string, string>, path: string[], hex: string) => {
    const json = JSON.parse(files['tokens.tokens.json']!) as Record<string, unknown>;
    let node = json as Record<string, unknown>;
    for (const key of path) node = node[key] as Record<string, unknown>;
    node.$value = { colorSpace: 'srgb', components: colorFromHex(hex)!.components, hex };
    // what the agent sends back: its read less the generated files, with the token file it changed
    const authored = Object.fromEntries(Object.entries(files).filter(([path]) => !isGeneratedPath(path)));
    return { ...authored, 'tokens.tokens.json': `${JSON.stringify(json, null, 2)}\n` };
  };

  it('round-trips a system’s files through the store and a reopen', async () => {
    await systems.seeded;
    const id = byKey(HOUSE_KEY);
    const before = filesOf(id);
    close();
    open();
    await systems.seeded;
    expect(filesOf(id)).toEqual(before);
    expect(adapter().readFiles!(docOf(id))).toEqual(before);
  });

  it('merges a publish whose tokens differ from the human’s concurrent edit, keeping the human’s, and refuses one that changed the same token', async () => {
    await systems.seeded;
    const id = byKey(HOUSE_KEY);
    const base = filesOf(id); // the agent's read
    await service().writeAs(id, HUMAN, (doc) => setToken(doc, 'color.status.ok', { $value: '#00aa00' })); // the human, after the read
    const sent = tokensWith(base, ['color', 'accent', '$root'], '#123456');
    let result!: ReturnType<NonNullable<ReturnType<typeof adapter>['publish']>>;
    await service().writeAs(id, AGENT, (doc) => (result = adapter().publish!(doc, base, sent, false)));
    expect(result.conflicts).toEqual([]);
    const merged = docOf(id);
    expect(accent(merged).hex).toBe('#123456');
    expect((readSystem(merged).tokens.tokens.get('color.status.ok')!.$value as { hex: string }).hex).toBe('#00aa00');

    // the human recolours the accent too; an agent publish from the old read that recolours it and something else is
    // refused naming the accent, and lands nothing
    await service().writeAs(id, HUMAN, (doc) => setToken(doc, 'color.accent.$root', { $value: '#654321' }));
    const both = tokensWith(tokensWith(base, ['color', 'accent', '$root'], '#abcdef'), ['color', 'status', 'warn'], '#ff8800');
    await service().writeAs(id, AGENT, (doc) => (result = adapter().publish!(doc, base, both, false)));
    expect(result.conflicts).toEqual([{ path: 'tokens.tokens.json', detail: expect.stringContaining('color.accent') }]);
    expect(result.changed).toEqual([]);
    const after = docOf(id);
    expect(accent(after).hex).toBe('#654321');
    expect((readSystem(after).tokens.tokens.get('color.status.warn')!.$value as { hex: string }).hex).not.toBe('#ff8800');
  });
});

describe('deletion and the pin (Acceptance 13; D10)', () => {
  // A version ref's read as apply.ts's `openDesignSystem` makes it (its unit test drives that over a fake host): the
  // retained state `ArtifactHost.versionState` answers, which the renderer's host asks the store for
  // (`artifacts.versionState`), as a view that never follows the system.
  const pinnedView = (ref: { id: string; versionSeq: number }) => {
    const doc = newDoc();
    applyV2(doc, store().versionState(ref.id, { seq: ref.versionSeq }));
    return staticView(snapshotOfDoc(doc)!, (asset) => `maws-artifact://${ref.id}/live/${asset}`);
  };

  it('refuses to delete a system a live artifact names, naming it; after it moves, deletes, and the pinned version still renders', async () => {
    await systems.seeded;
    const [house, classroom] = [byKey(HOUSE_KEY), byKey('classroom')];
    const doc = await store().create({ kind: 'document', title: 'Handout', designSystemId: classroom }, AGENT);
    await service().writeAs(doc.id, AGENT, (d) => d.get('root').setAttr('x', 1));
    const firstAccent = accent(docOf(classroom)).hex;
    const versionId = (await store().createVersion(doc.id, { kind: 'named', actor: HUMAN, label: 'Handed out' }))!;
    const pin = store().listVersions(doc.id).find((v) => v.id === versionId)!.designSystemRef!;
    expect(pin.id).toBe(classroom);

    // the system moves on after the version
    await service().writeAs(classroom, HUMAN, (d) => setToken(d, 'color.accent.$root', { $value: '#123456' }));

    const refused = await store().delete(classroom).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ArtifactStoreError);
    expect(refused).toMatchObject({ code: 'designSystemInUse', data: { artifactIds: [doc.id] } });

    await store().update(doc.id, { designSystemId: house });
    await store().delete(classroom);
    expect(store().get(classroom)).toBeNull();

    // the retained version's pin still reads the system's state as it was, through the host's version read
    const pinned = pinnedView({ id: pin.id, versionSeq: pin.versionSeq! });
    expect((pinned.tokens.tokens.get('color.accent.$root')!.$value as { hex: string }).hex).toBe(firstAccent);
    expect(pinned.css(':root', 'document')).toContain(`--ds-color-accent: ${firstAccent}`);
    expect(firstAccent).not.toBe('#123456');
  });
});

describe('the mirror (Decision Log 18)', () => {
  it('registers the design system’s writer, which mirrors the agent’s file view in a folder named by its slug', async () => {
    await systems.seeded;
    expect(mirrorWriterFor('design_system')).toBe(designSystemMirrorWriter);
    const id = byKey(HOUSE_KEY);
    const artifact = store().get(id)!;
    const { files } = designSystemMirrorWriter({ artifact, doc: docOf(id) });
    const folder = `${artifact.title}-${id.slice(0, 8)}`;
    expect(Object.keys(files).sort()).toEqual(Object.keys(filesOf(id)).map((path) => `${folder}/${path}`).sort());
    expect(files[`${folder}/tokens.css`]).toContain('--ds-color-accent');
    expect(designSystemMirrorWriter({ artifact, doc: newDoc() })).toEqual({ files: {} });
    systems.close();
    expect(mirrorWriterFor('design_system')).toBeUndefined();
    systems = registerDesignSystems({ documents, log: () => {}, loadAssets: async () => [] }); // afterEach closes it
  });
});
