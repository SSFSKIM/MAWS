// UX wave, U10 · l6-artifacts-07 (a), "a formatting clean-up is never a write of its own": the regression suite. Written by
// the check of 2026-11-12 (docs/doperpowers/specs/2026-11-12-ux-wave/U10-artifacts.md, Probes and checks; findings in
// spikes/protocol-probe/findings-uxwave-u10-format-cleanup.txt) before the fix, through the real document service and
// the `maws` server's own tool definitions over A's real store (the wired suite's pattern), and kept as the fix's proof
// (docs/doperpowers/plans/2026-11-12-ux-wave-U10a-unmade-writes.md, M1). The trigger: an agent's edit that keeps part of
// a bold run without the bold leaves formatting markers that Yjs's post-apply clean-up removed in a transaction of its
// own, which the live doc refused and every replica that received the edit sent on as its reader's write.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { textOf } from '@artifacts/document/writer.fixture';
import { DocIndex } from '@artifacts/document/block-index';
import { decodeFrame, type Frame } from '@artifacts/provider/frames';
import { PortProvider, type PortLike } from '@artifacts/provider/port';
import { newDoc } from '@artifacts/yjs';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { fromNodePort } from '../documents/ports';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';
import { mawsTools } from './tools';

const SELF = 'app-format' as AppSessionId;
let world: DocumentWorld;
let tools: Map<string, McpToolDefinition>;
let calls = 0;

beforeEach(() => {
  world = openDocumentWorld();
  const list = mawsTools({
    bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }),
    asks: new AskTable(), askCancelled: () => {}, artifacts: () => world.store,
  });
  tools = new Map(list.map((tool) => [tool.name, tool]));
});
afterEach(() => world.close());

const ctx = (): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: `toolu_f${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false });
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text;
// A handler's throw as the server answers it (an error result), so a refused write reads the same as a refusal.
async function call(name: string, args: unknown): Promise<McpToolResult> {
  try {
    return await tools.get(name)!.call(args, ctx());
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] } as McpToolResult;
  }
}
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${text(result)}`);
  return JSON.parse(text(result)) as T;
};

// A document made by the agent from markdown, read once: its id, the revision read and its block ids in order.
async function created(content: string): Promise<{ id: string; revision: number; ids: string[] }> {
  const { artifactId } = json<{ artifactId: string }>(await call('artifact_create', { kind: 'document', title: 'Memo', handle: `memo-${calls}`, content }));
  const read = json<{ revision: number; markdown: string }>(await call('artifact_read', { artifact: artifactId }));
  return { id: artifactId, revision: read.revision, ids: [...read.markdown.matchAll(/\^([a-z0-9]+)/g)].map((match) => match[1]) };
}

// The store's rows of the artifact: seq and actor key.
function rows(id: string): { seq: number; actor: string }[] {
  const db = new DatabaseSync(join(world.dir, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT seq, actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq').all(id) as { seq: number; actor: string }[];
  } finally {
    db.close();
  }
}

// Every transaction the live doc runs from now on: its origin (a writer's key, or null), whether Yjs ran it as its
// post-apply formatting clean-up (`cleanupYTextAfterTransaction` in @y/y's Transaction.js is on the stack when it starts),
// and how many items it deleted.
interface Seen { origin: string | null; local: boolean; cleanup: boolean; deleted: number }
function watch(id: string): Seen[] {
  const seen: Seen[] = [];
  const open = new Map<unknown, Seen>();
  const live = world.service.live(id);
  live.on('beforeTransaction', (raw: unknown) => {
    const tr = raw as { origin: unknown; local: boolean };
    const origin = tr.origin === null ? null : (tr.origin as { key?: string }).key ?? String(tr.origin);
    const entry = { origin, local: tr.local, cleanup: (new Error().stack ?? '').includes('cleanupYTextAfterTransaction'), deleted: 0 };
    open.set(raw, entry);
    seen.push(entry);
  });
  live.on('afterTransaction', (raw: unknown) => {
    const entry = open.get(raw);
    if (!entry) return;
    (raw as { deleteSet: { clients: Map<number, { getIds(): { len: number }[] }> } }).deleteSet.clients.forEach((ranges) => ranges.getIds().forEach((range) => (entry.deleted += range.len)));
  });
  return seen;
}

const UNBOLD_REST = [
  { where: 'a list item', content: '- **A B** text\n\nUntouched.' },
  { where: 'a paragraph', content: '**A B** text\n\nUntouched.' },
] as const;

describe('l6-artifacts-07 (a): an agent edit that leaves a formatting marker for the clean-up', () => {
  for (const { where, content } of UNBOLD_REST) {
    it(`in ${where}: replace_text of **A B** text by B text lands as one row of the agent's, and a replace_block from the returned revision lands`, async () => {
      const doc = await created(content);
      const untouched = doc.ids[doc.ids.length - 1];
      const seen = watch(doc.id);
      const edited = json<{ revision: number }>(await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [{ op: 'replace_text', old: '**A B** text', new: 'B text' }] }));
      await world.service.whenCommitted();
      expect(rows(doc.id).filter((row) => row.seq > doc.revision)).toEqual([{ seq: edited.revision, actor: `session:${SELF}` }]);
      json(await call('artifact_edit', { artifact: doc.id, baseRevision: edited.revision, ops: [{ op: 'replace_block', id: untouched, markdown: 'Changed.' }] }));
      expect(textOf(world.service.live(doc.id), untouched)).toBe('Changed.');
      expect(seen.filter((entry) => entry.cleanup)).toEqual([]);
    });
  }

  it('control: the probe\'s own markdown, - **A** text with replace_text of **A** text by B text, lands as the agent\'s two rows, and the live doc runs no transaction but the agent\'s', async () => {
    const doc = await created('- **A** text\n\nUntouched.');
    const seen = watch(doc.id);
    const edited = json<{ revision: number }>(await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [{ op: 'replace_text', old: '**A** text', new: 'B text' }] }));
    json(await call('artifact_edit', { artifact: doc.id, baseRevision: edited.revision, ops: [{ op: 'replace_block', id: doc.ids[doc.ids.length - 1], markdown: 'Changed.' }] }));
    await world.service.whenCommitted();
    expect(rows(doc.id).filter((row) => row.seq > doc.revision).map((row) => row.actor)).toEqual([`session:${SELF}`, `session:${SELF}`]);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.filter((entry) => entry.origin !== `session:${SELF}` || entry.cleanup)).toEqual([]); // no clean-up, no other writer
  });
});

// The same markers reached through `settle`: an accepted suggestion is written by a one-off replica of the main doc
// (`writeCopy`) and the proposal's removal is an apply inside another transaction (the second probe of the list).
describe('l6-artifacts-07 (a): accepting a suggestion that removes a bold', () => {
  async function suggested(content: string, op: Record<string, unknown>) {
    const doc = await created(content);
    json(await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, mode: 'suggest', ops: [op] }));
    await world.service.whenCommitted();
    const block = DocIndex.of(world.service.live(world.service.suggestionDoc(doc.id))).find(doc.ids[0])!.node;
    let last = block._start!;
    while (last.right) last = last.right;
    return { ...doc, range: { start: block._start!.id, end: last.id } };
  }

  // One row: holding the flag off for the length of the apply alone is not enough here. The copy's edit applies the
  // proposal's deletions inside the copy's own transaction, which Yjs then treats as remote (`readUpdateV2` sets
  // `transaction.local = false` on the transaction it joins), so the clean-up runs when that transaction ends, after
  // such a hold, and reaches the live doc as a second row (the findings file, the second probe).
  it('the probe\'s own markdown in a paragraph, suggested and accepted by the person, lands as one row of the person\'s', async () => {
    const doc = await suggested('**A** text\n\nUntouched.', { op: 'replace_text', old: '**A** text', new: 'B text' });
    const before = world.service.revision(doc.id);
    const seen = watch(doc.id);
    await world.service.acceptSuggestion(doc.id, [doc.range], HUMAN);
    await world.service.whenCommitted();
    expect(textOf(world.service.live(doc.id), doc.ids[0])).toBe('B text');
    expect(rows(doc.id).filter((row) => row.seq > before).map((row) => row.actor)).toEqual(['human']);
    expect(seen.filter((entry) => entry.cleanup)).toEqual([]);
  });
});

// A restore applies the revert inside the restorer's own write (`restoreArtifact`), the same nesting as the accept's copy.
describe('l6-artifacts-07 (a): restoring a version across a bold the agent removed', () => {
  it('the agent un-bolds what is left of a bold run, the person restores the earlier version: each lands as one row', async () => {
    const doc = await created('**A B** text\n\nUntouched.');
    const versionId = (await world.store.createVersion(doc.id, { kind: 'named', actor: HUMAN, label: 'before' }))!;
    const seen = watch(doc.id);
    const edited = json<{ revision: number }>(await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [{ op: 'replace_block', id: doc.ids[0], markdown: 'B text' }] }));
    await world.store.restore(doc.id, versionId, HUMAN);
    await world.service.whenCommitted();
    expect(textOf(world.service.live(doc.id), doc.ids[0])).toBe('A B text');
    expect(rows(doc.id).filter((row) => row.seq >= edited.revision).map((row) => row.actor)).toEqual([`session:${SELF}`, 'human']);
    expect(seen.filter((entry) => entry.cleanup)).toEqual([]);
  });
});

// Who else writes while the agent edits: replicas that only receive, a duplicate, and a restart.
describe('l6-artifacts-07 (a): around an agent edit that leaves a formatting marker', () => {
  const EDIT = { op: 'replace_text', old: '**A B** text', new: 'B text' } as const;
  const until = async (test: () => boolean) => {
    for (let i = 0; i < 400 && !test(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(test()).toBe(true);
  };
  // A person's open editor's replica: a provider over a port of the service, counting the update frames it sends.
  function personReplica(artifactId: string) {
    const { port1, port2 } = new MessageChannel();
    world.service.attach(artifactId, fromNodePort(port1), HUMAN);
    const end = port2 as unknown as PortLike;
    const sent: Frame['type'][] = [];
    const counted: PortLike = {
      postMessage: (message) => {
        const { type } = decodeFrame(message);
        if (type === 'update') sent.push(type);
        end.postMessage(message);
      },
      addEventListener: (type, listener) => end.addEventListener(type, listener),
      removeEventListener: (type, listener) => end.removeEventListener(type, listener),
      start: () => end.start?.(),
      close: () => end.close(),
    };
    const provider = new PortProvider(newDoc(), { log: () => {} });
    provider.connect(counted);
    return { provider, sent };
  }

  it('a second session’s replica and a person’s replica open during the edit send nothing: the new rows are the agent’s alone', async () => {
    const doc = await created('- **A B** text\n\nUntouched.');
    const other = world.service.replica('app-other' as AppSessionId, doc.id);
    const person = personReplica(doc.id);
    try {
      await other.whenSynced();
      await until(() => person.provider.state.synced);
      const before = rows(doc.id).length;
      const edited = json<{ revision: number }>(await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [EDIT] }));
      await until(() => other.provider.state.integrated >= edited.revision && person.provider.state.integrated >= edited.revision);
      await new Promise((resolve) => setTimeout(resolve, 50)); // time for anything either sends back to arrive
      await world.service.whenCommitted();
      expect(rows(doc.id).slice(before)).toEqual([{ seq: edited.revision, actor: `session:${SELF}` }]);
      expect(person.sent).toEqual([]);
      expect([other.provider.state.unsaved, person.provider.state.unsaved]).toEqual([0, 0]);
      expect(textOf(person.provider.doc, doc.ids[0])).toBe('B text');
    } finally {
      person.provider.destroy();
    }
  });

  it('a duplicate of the edited document writes one row', async () => {
    const doc = await created('- **A B** text\n\nUntouched.');
    json(await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [EDIT] }));
    const copy = await world.store.duplicate(doc.id, {}, HUMAN);
    await world.service.whenCommitted();
    expect(rows(copy.id).map((row) => row.actor)).toEqual(['human']);
    expect(textOf(world.service.live(copy.id), doc.ids[0])).toBe('B text');
  });

  it('a fresh service on the same store loads the edited document, and a read of it gives the same markdown', async () => {
    const doc = await created('- **A B** text\n\nUntouched.');
    json(await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [EDIT] }));
    const read = json<{ revision: number; markdown: string }>(await call('artifact_read', { artifact: doc.id }));
    await world.service.whenCommitted();
    world = world.reopen();
    const again = json<{ revision: number; markdown: string }>(await call('artifact_read', { artifact: doc.id }));
    expect(again).toMatchObject({ revision: read.revision, markdown: read.markdown });
    expect(rows(doc.id).slice(-1)).toEqual([{ seq: read.revision, actor: `session:${SELF}` }]);
  });
});
