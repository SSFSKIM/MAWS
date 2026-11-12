// UX wave, U10 · l6-artifacts-07 (a): "a formatting clean-up is never a write of its own". The probe "Does the inferred
// cause of l6-artifacts-07 (a) hold?" of docs/doperpowers/specs/2026-11-12-ux-wave/U10-artifacts.md (Probes and checks),
// written before the fix, through the real document service and the `maws` server's own tool definitions over A's real
// store (the wired suite's pattern). Findings: spikes/protocol-probe/findings-uxwave-u10-format-cleanup.txt.
//
// The `it.fails` cases are what the design asks for and fail today; vitest passes an `it.fails` whose body throws, so the
// gate stays green until the fix, when they start failing as "expected to fail" and are turned into plain `it`. The
// cases named "today" pin the cause as it stands (they pass now) and are deleted with the fix.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { textOf } from '@artifacts/document/writer.fixture';
import { DocIndex } from '@artifacts/document/block-index';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { AskTable } from './asks';
import { HostBridge } from './bridge';
import { PaneBridge } from './panes';
import type { McpToolContext, McpToolDefinition, McpToolResult } from './server';
import { mawsTools } from './tools';

const SELF = 'app-format' as AppSessionId;
const RESET = /failed and the document was reset: the live doc of \S+ was edited outside a replica/;
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

// What is left of a bold run loses its bold: the case the probe's own markdown (`- **A** text`) does not reach (see the
// control below) and the refused call of the friction entry does (`**P Q's N** fell` to `Its N fell`, the
// incident's batch replayed on its document; the findings file). A list item and a paragraph alike.
const UNBOLD_REST = [
  { where: 'a list item', content: '- **A B** text\n\nUntouched.' },
  { where: 'a paragraph', content: '**A B** text\n\nUntouched.' },
] as const;

describe('l6-artifacts-07 (a): an agent edit that leaves a formatting marker for the clean-up', () => {
  for (const { where, content } of UNBOLD_REST) {
    it.fails(`in ${where}: replace_text of **A B** text by B text lands as one row of the agent's, and a replace_block from the returned revision lands`, async () => {
      const doc = await created(content);
      const untouched = doc.ids[doc.ids.length - 1];
      const edited = json<{ revision: number }>(await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [{ op: 'replace_text', old: '**A B** text', new: 'B text' }] }));
      await world.service.whenCommitted();
      expect(rows(doc.id).filter((row) => row.seq > doc.revision)).toEqual([{ seq: edited.revision, actor: `session:${SELF}` }]);
      json(await call('artifact_edit', { artifact: doc.id, baseRevision: edited.revision, ops: [{ op: 'replace_block', id: untouched, markdown: 'Changed.' }] }));
      expect(textOf(world.service.live(doc.id), untouched)).toBe('Changed.');
    });

    it(`today, in ${where}: the batch is refused because Yjs's own clean-up in the live doc names no writer, and the next edit is refused as stale`, async () => {
      const doc = await created(content);
      const seen = watch(doc.id);
      const answer = await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [{ op: 'replace_text', old: '**A B** text', new: 'B text' }] });
      expect(answer.isError).toBe(true);
      expect(text(answer)).toMatch(RESET);
      // the agent's host replica's update, applied (not local), then the clean-up Yjs runs after it: origin null, two
      // formatting markers deleted; its update is the one `integrated` throws on
      expect(seen).toEqual([
        { origin: `session:${SELF}`, local: false, cleanup: false, deleted: 3 },
        { origin: null, local: true, cleanup: true, deleted: 2 },
      ]);
      expect(rows(doc.id).filter((row) => row.seq > doc.revision)).toEqual([]);
      const next = await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [{ op: 'replace_block', id: doc.ids[doc.ids.length - 1], markdown: 'Changed.' }] });
      expect(text(next)).toMatch(/changed since the read/);
    });
  }

  it('control: the probe\'s own markdown, - **A** text with replace_text of **A** text by B text, lands today, leaving the clean-up nothing to do', async () => {
    const doc = await created('- **A** text\n\nUntouched.');
    const seen = watch(doc.id);
    const edited = json<{ revision: number }>(await call('artifact_edit', { artifact: doc.id, baseRevision: doc.revision, ops: [{ op: 'replace_text', old: '**A** text', new: 'B text' }] }));
    json(await call('artifact_edit', { artifact: doc.id, baseRevision: edited.revision, ops: [{ op: 'replace_block', id: doc.ids[doc.ids.length - 1], markdown: 'Changed.' }] }));
    const cleanups = seen.filter((entry) => entry.cleanup);
    expect(cleanups.length).toBeGreaterThan(0); // Yjs ran its clean-up after the agent's apply
    expect(cleanups.every((entry) => entry.deleted === 0)).toBe(true); // and found nothing to remove
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

  it.fails('the probe\'s own markdown in a paragraph, suggested and accepted by the person, lands', async () => {
    const doc = await suggested('**A** text\n\nUntouched.', { op: 'replace_text', old: '**A** text', new: 'B text' });
    await world.service.acceptSuggestion(doc.id, [doc.range], HUMAN);
    expect(textOf(world.service.live(doc.id), doc.ids[0])).toBe('B text');
  });

  it('today: the accept is refused on the live doc\'s own clean-up, after the agent\'s host replica has echoed its clean-up into the live doc as the agent\'s', async () => {
    const doc = await suggested('**A** text\n\nUntouched.', { op: 'replace_text', old: '**A** text', new: 'B text' });
    const seen = watch(doc.id);
    await expect(world.service.acceptSuggestion(doc.id, [doc.range], HUMAN)).rejects.toThrow(RESET);
    // the copy (the person's), the live doc's clean-up (null), then, while that clean-up is still queued, the agent's host
    // replica's own clean-up of the relayed copy, applied to the live doc as the agent's write (deferred, so it never runs
    // before the null transaction throws)
    expect(seen.map(({ origin, cleanup }) => ({ origin, cleanup }))).toEqual([
      { origin: 'human', cleanup: false },
      { origin: null, cleanup: true },
      { origin: `session:${SELF}`, cleanup: false },
    ]);
    expect(seen[1].deleted).toBe(1);
  });
});
