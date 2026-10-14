// The engine host's library reads over a real store (the P3-L document, M2; Decision Log 2 and 3): `library.snapshot`,
// `library.entry` and `library.text` as main calls them, each validated against the registry both ways, answered from
// A's store through its public reads only and released behind its commit barrier.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Doc, Node } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { AppSessionId } from '@shared/graph/ids';
import { HostCommandError, type HostOn } from '@shared/host/runtime';
import { commands, type CommandName, type CommandOutput } from '@shared/ipc/schema';
import { validateCommandInput, validateCommandOutput } from '@shared/ipc/validate';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { LIBRARY_DEADLINE_SHAPES, registerLibraryReads } from './register';

const sid = (id: string) => id as AppSessionId;
const human: Actor = { kind: 'human' };
const agent: Actor = { kind: 'session', appSessionId: sid('app-1') };
const other: Actor = { kind: 'session', appSessionId: sid('app-2') };

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let now: number;
let turns: (() => void)[] | null; // the batch commits a manual store deferred, else null
let handlers: Map<string, (input: unknown) => Promise<unknown>>;

function make(options: { manual?: boolean } = {}): void {
  turns = options.manual ? [] : null;
  const defer = turns ? (run: () => void) => turns!.push(run) : undefined;
  storage = SqliteDocumentStorage.open(join(dir, 'artifacts', 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { now: () => now, log: () => {}, kindOf: (id) => storage.kindOf(id), defer });
  store = new ArtifactStore(service, storage, { root: join(dir, 'artifacts'), now: () => now, log: () => {} });
  handlers = new Map();
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  registerLibraryReads(on, { store, service });
}
const tick = () => {
  while (turns && turns.length > 0) turns.shift()!();
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-library-reads-'));
  now = Date.UTC(2026, 9, 13, 9, 0);
  make();
});
afterEach(() => {
  store.close();
  service.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

// A call as the runtime makes it: the input validated first, the output checked against the registry after.
async function call<N extends CommandName>(name: N, input: unknown): Promise<CommandOutput<N>> {
  const checked = validateCommandInput(name, input);
  if (!checked.ok) throw new Error(`invalid input for ${name}: ${JSON.stringify(checked.error)}`);
  const value = await handlers.get(name)!(checked.value);
  const output = validateCommandOutput(name, value);
  if (!output.ok) throw new Error(`invalid output of ${name}: ${JSON.stringify(output.error.issues).slice(0, 400)}`);
  return output.value as CommandOutput<N>;
}
async function refusal(name: CommandName, input: unknown): Promise<unknown> {
  try {
    await call(name, input);
  } catch (error) {
    expect(error).toBeInstanceOf(HostCommandError);
    return (error as HostCommandError).ipcError;
  }
  throw new Error(`${name} was not refused`);
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const page = (markup: string) => ({ bytes: new TextEncoder().encode(markup) });
const file = (name: string, contents: string | Uint8Array) => {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return { path };
};
// A nested node, as A's restore tests make one (the binding module exports `Node` as a type only).
const node = (doc: Doc, name?: string): Node => new (doc.get('root').constructor as new (name?: string) => Node)(name);

describe('the library reads (M2)', () => {
  it('has a handler and exactly one deadline shape for every library read the engine host owns, each immediate (M6b: and the e2e import, bounded, registered by the module)', () => {
    const owned = Object.entries(commands).filter(([name, spec]) => name.startsWith('library.') && spec.owner === 'engine-host').map(([name]) => name);
    expect(owned.sort()).toEqual(['library.entry', 'library.snapshot', 'library.testImport', 'library.text']);
    expect(Object.keys(LIBRARY_DEADLINE_SHAPES).sort()).toEqual(owned);
    expect([...handlers.keys()].sort()).toEqual(owned.filter((name) => name !== 'library.testImport'));
    expect(Object.entries(LIBRARY_DEADLINE_SHAPES).filter(([, shape]) => shape !== 'immediate')).toEqual([['library.testImport', 'bounded']]);
  });

  it('snapshots every live artifact with its revision and last editor, their session links and the Spaces', async () => {
    const space = await store.createSpace({ name: 'Launch' });
    const plan = await store.create({ kind: 'document', title: 'Plan', spaceId: space.id }, human);
    now += 1_000;
    const pageArtifact = await store.create({ kind: 'html', title: 'Page', content: page('<p>hi</p>') }, agent);
    await store.link(plan.id, sid('app-2'), 'viewed');
    await store.update(pageArtifact.id, { pinned: true });
    const gone = await store.create({ kind: 'file', title: 'Old', content: file('old.txt', 'old') }, other);
    await store.delete(gone.id);

    const snapshot = await call('library.snapshot', undefined);
    expect(snapshot.artifacts.map((a) => a.id).sort()).toEqual([plan.id, pageArtifact.id].sort());
    const byId = new Map(snapshot.artifacts.map((a) => [a.id, a]));
    expect(byId.get(plan.id)).toMatchObject({ kind: 'document', title: 'Plan', spaceId: space.id, revision: 0, pinned: false, lastEditor: human, lastEditedAt: plan.createdAt });
    expect(byId.get(pageArtifact.id)).toMatchObject({ kind: 'html', pinned: true, revision: store.revision(pageArtifact.id), lastEditor: agent });
    expect(byId.get(pageArtifact.id)!.revision).toBeGreaterThan(0);
    expect(snapshot.links.map(({ artifactId, appSessionId, role }) => ({ artifactId, appSessionId, role })).sort((a, b) => a.artifactId.localeCompare(b.artifactId))).toEqual(
      [
        { artifactId: plan.id, appSessionId: 'app-2', role: 'viewed' },
        { artifactId: pageArtifact.id, appSessionId: 'app-1', role: 'created' },
      ].sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    );
    expect(snapshot.spaces).toEqual([space]);
  });

  it('reads one entry with its links, and null with no links once it is deleted or never was', async () => {
    const pageArtifact = await store.create({ kind: 'html', title: 'Page', content: page('<p>hi</p>') }, agent);
    await store.link(pageArtifact.id, sid('app-2'), 'commented');
    const entry = await call('library.entry', { artifactId: pageArtifact.id });
    expect(entry.artifact).toMatchObject({ id: pageArtifact.id, title: 'Page', revision: store.revision(pageArtifact.id), lastEditor: agent });
    expect(entry.links.map((link) => [link.appSessionId, link.role])).toEqual([
      ['app-1', 'created'],
      ['app-2', 'commented'],
    ]);
    await store.delete(pageArtifact.id);
    expect(await call('library.entry', { artifactId: pageArtifact.id })).toEqual({ artifact: null, links: [] });
    expect(await call('library.entry', { artifactId: '00000000-0000-4000-8000-000000000000' })).toEqual({ artifact: null, links: [] });
  });

  it('names the last write’s actor as the last editor: the creator before any write, the human, then a session', async () => {
    const doc = await store.create({ kind: 'document', title: 'Notes' }, agent);
    const created = await call('library.entry', { artifactId: doc.id });
    expect(created.artifact).toMatchObject({ lastEditor: agent, lastEditedAt: doc.createdAt });

    now += 60_000;
    await store.testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'mine' }], human);
    const mine = (await call('library.entry', { artifactId: doc.id })).artifact!;
    expect(mine).toMatchObject({ lastEditor: human, lastEditedAt: now });

    now += 60_000;
    await store.testWrite(doc.id, 'w2', [{ op: 'insertText', index: 0, text: 'theirs ' }], other);
    const theirs = (await call('library.entry', { artifactId: doc.id })).artifact!;
    expect(theirs).toMatchObject({ lastEditor: other, lastEditedAt: now });
    expect(theirs.revision).toBeGreaterThan(mine.revision);
  });

  it('dates the last edit at the last write, not at a later rename or move, and keeps it across a reopen (M6a, Decision Log 29)', async () => {
    const doc = await store.create({ kind: 'document', title: 'Notes' }, human);
    now += 60_000;
    const wroteAt = now;
    await store.testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'theirs' }], agent);
    now += 60_000;
    await store.update(doc.id, { title: 'Renamed' });
    const space = await store.createSpace({ name: 'Elsewhere' });
    now += 60_000;
    await store.update(doc.id, { spaceId: space.id });
    expect(store.get(doc.id)!.updatedAt).toBeGreaterThan(wroteAt);
    expect((await call('library.entry', { artifactId: doc.id })).artifact).toMatchObject({ title: 'Renamed', lastEditor: agent, lastEditedAt: wroteAt });

    store.close();
    service.close();
    storage.close();
    make();
    expect((await call('library.snapshot', undefined)).artifacts.find((a) => a.id === doc.id)).toMatchObject({ lastEditor: agent, lastEditedAt: wroteAt });
  });

  it('dates an imported artifact’s last edit at its last imported version, by that version’s actor (M6a)', async () => {
    const id = '0f8e2a1c-4b3d-4e5f-8a7b-6c5d4e3f2a1b';
    await store.importArtifact({
      id,
      kind: 'html',
      title: 'Report',
      createdAt: now - 5_000,
      updatedAt: now - 1_000,
      createdBy: agent,
      versions: [
        { at: now - 5_000, actor: agent, content: page('<p>v1</p>') },
        { at: now - 1_000, actor: other, content: page('<p>v2</p>') },
      ],
      links: [{ appSessionId: sid('app-1'), role: 'created', lastAt: now - 5_000 }],
    });
    expect((await call('library.entry', { artifactId: id })).artifact).toMatchObject({ lastEditor: other, lastEditedAt: now - 1_000 });
  });

  it('answers a read issued during an open batch only once that batch commits', async () => {
    store.close();
    service.close();
    storage.close();
    make({ manual: true });
    const creation = store.create({ kind: 'html', title: 'Pending', content: page('<p>pending words</p>') }, human);
    let released = 0;
    const snapshot = call('library.snapshot', undefined).finally(() => released++);
    await settle();
    expect(released).toBe(0); // the row it read is not durable yet
    tick();
    const artifact = await creation;
    expect((await snapshot).artifacts.map((a) => a.title)).toEqual(['Pending']);

    void store.update(artifact.id, { title: 'Renamed' });
    const entry = call('library.entry', { artifactId: artifact.id }).finally(() => released++);
    const text = call('library.text', { artifactId: artifact.id }).finally(() => released++);
    await settle();
    expect(released).toBe(1);
    tick();
    expect((await entry).artifact?.title).toBe('Renamed');
    expect(await text).toEqual({ revision: store.revision(artifact.id), text: 'pending words' });
  });
});

describe('library.text (M2)', () => {
  it('extracts a document’s text from its committed state, nested nodes and a session’s write included', async () => {
    const doc = await store.create({ kind: 'presentation', title: 'Deck' }, human);
    await service.writeAs(doc.id, human, (d) => {
      const slide = node(d);
      slide.setAttr('id', 's1');
      const notes = node(d);
      notes.insert(0, 'remember the demo');
      slide.setAttr('notes', notes);
      const box = node(d, 'p');
      box.insert(0, 'Quarterly results');
      slide.insert(0, [box]);
      d.get('slides').setAttr('s1', slide);
    });
    await store.testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: '분기 실적', root: 'title' }], agent);
    expect(service.loaded(doc.id)).not.toBeNull(); // the writes keep it loaded; the read must not depend on that

    const { revision, text } = await call('library.text', { artifactId: doc.id });
    expect(revision).toBe(store.revision(doc.id));
    expect(text.split('\n')).toEqual(['Quarterly results', 'remember the demo', '분기 실적']);
  });

  it('reads an unloaded document without keeping it loaded', async () => {
    const doc = await store.create({ kind: 'document', title: 'Cold' }, human);
    await store.testWrite(doc.id, 'w1', [{ op: 'insertText', index: 0, text: 'cold text' }], human);
    store.close();
    service.close();
    storage.close();
    make();
    expect(service.loaded(doc.id)).toBeNull();
    expect((await call('library.text', { artifactId: doc.id })).text).toBe('cold text');
    expect(service.loaded(doc.id)).toBeNull();
  });

  it('extracts an html page’s text without its script and style', async () => {
    const artifact = await store.create(
      { kind: 'html', title: 'Report', content: page('<html><head><style>.needle{}</style><script>let hidden = 1</script></head><body><h1>Revenue &amp; costs</h1><p>Up 12%</p></body></html>') },
      agent,
    );
    expect(await call('library.text', { artifactId: artifact.id })).toEqual({ revision: store.revision(artifact.id), text: 'Revenue & costs Up 12%' });
  });

  it('extracts a UTF-8 file’s content, and names a binary or vanished file', async () => {
    const notes = await store.create({ kind: 'file', title: 'notes.md', content: file('notes.md', '# 회의록\nship it') }, agent);
    expect((await call('library.text', { artifactId: notes.id })).text).toBe('# 회의록\nship it');
    const image = await store.create({ kind: 'file', title: 'Logo', content: file('logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a])) }, agent);
    expect((await call('library.text', { artifactId: image.id })).text).toBe('logo.png');
    rmSync(join(dir, 'notes.md'));
    expect((await call('library.text', { artifactId: notes.id })).text).toBe('notes.md');
  });

  it('refuses an artifact that is deleted or never was, as A’s reads do', async () => {
    const artifact = await store.create({ kind: 'document', title: 'Gone' }, human);
    await store.delete(artifact.id);
    expect(await refusal('library.text', { artifactId: artifact.id })).toMatchObject({ code: 'invalid_input', issues: { reason: 'notFound' } });
    expect(await refusal('library.text', { artifactId: '00000000-0000-4000-8000-000000000000' })).toMatchObject({ code: 'invalid_input', issues: { reason: 'notFound' } });
  });
});

describe('the library reads without a store', () => {
  it('answer `unavailable` when the store could not be opened this run', async () => {
    handlers = new Map();
    registerLibraryReads((name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>), null);
    for (const [name, input] of [
      ['library.snapshot', undefined],
      ['library.entry', { artifactId: '00000000-0000-4000-8000-000000000000' }],
      ['library.text', { artifactId: '00000000-0000-4000-8000-000000000000' }],
    ] as const) {
      expect(await refusal(name, input)).toMatchObject({ code: 'internal', issues: { reason: 'unavailable' } });
    }
  });
});
