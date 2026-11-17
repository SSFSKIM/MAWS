// A document's page through the document tools (UX wave U10b, M2; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md
// §B.1 to §B.3, decisions 1 to 3 and 6): `artifact_edit`'s `set_page` over A's real store, each write read back from the
// store's file, and `artifact_read`'s `page` on a live read, a version's read and after a restore.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { docPage } from '@artifacts/document/meta';
import { nodeOf, textOf } from '@artifacts/document/writer.fixture';
import { stateV2, transact } from '@artifacts/yjs';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { SET_PAGE_REFUSALS } from '@shared/maws/document-tools';
import { HUMAN, openDocumentWorld, type DocumentWorld } from '../documents/kinds/document-world.fixture';
import { artifactEditTool, documentReadTool, DocumentToolSession, type DocumentToolDeps } from './documents';
import type { McpToolContext, McpToolResult } from './server';

const SELF = 'app-pager' as AppSessionId;
let world: DocumentWorld;
let session: DocumentToolSession;
let calls = 0;

beforeEach(() => {
  world = openDocumentWorld();
  session = new DocumentToolSession();
});
afterEach(() => world.close());

const deps = (): DocumentToolDeps => ({ artifacts: () => world.store, session, presenceEditingMs: 20 });
const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: SELF, cwd: world.dir, toolUseId: `toolu_page${++calls}` as ToolUseId, requestId: `r${calls}` as RequestId, signal: new AbortController().signal, fromSubagent: false, ...over });
const textOfResult = (result: McpToolResult): string => (result.content[0] as { text: string }).text;
const json = <T = Record<string, unknown>>(result: McpToolResult): T => {
  if (result.isError) throw new Error(`a refusal: ${textOfResult(result)}`);
  return JSON.parse(textOfResult(result)) as T;
};
const read = (args: Record<string, unknown>) => documentReadTool(deps()).call(args, ctx());
const edit = (args: Record<string, unknown>, over: Partial<McpToolContext> = {}) => artifactEditTool(deps()).call(args, ctx(over));
type Read = { revision: number; page?: { size: string; density: string }; changed?: string[]; deleted?: string[] };

/** The committed rows of `id`, read from the store's file: their seq and the actor each is credited to. */
async function rows(id: string): Promise<Array<{ seq: number; actor: string }>> {
  await world.service.whenCommitted();
  const db = new DatabaseSync(join(world.dir, 'artifacts', 'store.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT seq, actor FROM artifact_updates WHERE artifactId = ? ORDER BY seq').all(id) as Array<{ seq: number; actor: string }>;
  } finally {
    db.close();
  }
}

/** A seeded document the session has read; answers the id and the read. */
async function readSeed(): Promise<{ id: string; first: Read }> {
  const id = await world.seeded();
  return { id, first: json<Read>(await read({ artifact: id })) };
}

describe('set_page through artifact_edit', () => {
  it('alone is one row credited to the agent, and moves the revision once', async () => {
    const { id, first } = await readSeed();
    const before = await rows(id);
    const answer = json<{ revision: number; results: unknown[] }>(await edit({ artifact: id, baseRevision: first.revision, ops: [{ op: 'set_page', size: 'a4', density: 'compact' }] }));
    const after = await rows(id);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual([{ seq: answer.revision, actor: `session:${SELF}` }]);
    expect(answer.revision).toBeGreaterThan(first.revision);
    expect(world.store.revision(id)).toBe(answer.revision);
    expect(answer.results).toEqual([{ op: 'set_page', size: 'a4', density: 'compact' }]);
    expect(docPage(world.service.live(id))).toEqual({ size: 'a4', density: 'compact' });
  });

  it('with a text op is still one row, and a repeated tool-use id answers the first result and writes nothing more', async () => {
    const { id, first } = await readSeed();
    const before = (await rows(id)).length;
    const toolUseId = 'toolu_page_once' as ToolUseId;
    const args = { artifact: id, baseRevision: first.revision, ops: [{ op: 'replace_text', block: 'p1', old: 'lazy', new: 'sleepy' }, { op: 'set_page', density: 'compact' }] };
    const a = json(await edit(args, { toolUseId }));
    const b = json(await edit(args, { toolUseId }));
    expect(b).toEqual(a);
    expect((await rows(id)).length).toBe(before + 1);
    expect(textOf(world.service.live(id), 'p1')).toContain('sleepy');
    expect(docPage(world.service.live(id))).toEqual({ density: 'compact' });
  });

  it('beside a refused op leaves the page and the document as they were', async () => {
    const { id, first } = await readSeed();
    const before = (await rows(id)).length;
    const state = stateV2(world.service.live(id));
    const refused = await edit({ artifact: id, baseRevision: first.revision, ops: [{ op: 'set_page', size: 'a4' }, { op: 'replace_text', block: 'p1', old: 'no such words', new: 'x' }] });
    expect(refused.isError).toBe(true);
    expect(docPage(world.service.live(id))).toEqual({});
    expect(stateV2(world.service.live(id))).toEqual(state);
    expect((await rows(id)).length).toBe(before);
  });

  it.each(['mode', 'setting'] as const)('on a batch that would land as suggestions (%s) is refused whole with its sentence, nothing written to either document', async (route) => {
    const { id, first } = await readSeed();
    if (route === 'setting') await world.store.update(id, { agentEditsAsSuggestions: true });
    const main = stateV2(world.service.live(id));
    const before = [(await rows(id)).length, (await rows(world.service.suggestionDoc(id))).length];
    const refused = await edit({ artifact: id, baseRevision: first.revision, ...(route === 'mode' && { mode: 'suggest' }), ops: [{ op: 'replace_block', id: 'p1', markdown: 'Suggested.' }, { op: 'set_page', size: 'a4' }] });
    expect(refused.isError).toBe(true);
    expect(textOfResult(refused).startsWith(`artifact_edit: ${SET_PAGE_REFUSALS.suggestion} {`)).toBe(true);
    expect(SET_PAGE_REFUSALS.suggestion).toBe('set_page cannot be a suggestion; send it in a batch that is not suggested, or ask the user to set the page in the Export menu');
    expect(stateV2(world.service.live(id))).toEqual(main);
    expect([(await rows(id)).length, (await rows(world.service.suggestionDoc(id))).length]).toEqual(before);
  });
});

describe('a document’s page in artifact_read', () => {
  it('names the system’s page at standard density until the document sets one, then the setting', async () => {
    const { id, first } = await readSeed();
    expect(first.page).toEqual({ size: 'system', density: 'standard' });
    json(await edit({ artifact: id, baseRevision: first.revision, ops: [{ op: 'set_page', density: 'compact' }] }));
    expect(json<Read>(await read({ artifact: id })).page).toEqual({ size: 'system', density: 'compact' });
  });

  it('after a revision that set only the page: sinceRevision shows no block changed, and the read names the page', async () => {
    const { id, first } = await readSeed();
    json(await edit({ artifact: id, baseRevision: first.revision, ops: [{ op: 'set_page', size: 'letter' }] }));
    const since = json<Read>(await read({ artifact: id, sinceRevision: first.revision }));
    expect([since.changed, since.deleted]).toEqual([[], []]);
    expect(since.page).toEqual({ size: 'letter', density: 'standard' });
  });

  it('of a version made before a set_page reads the old page, and a restore of it puts the old page back', async () => {
    const { id, first } = await readSeed();
    const set = json<{ revision: number }>(await edit({ artifact: id, baseRevision: first.revision, ops: [{ op: 'set_page', size: 'letter' }] }));
    const versionId = (await world.store.createVersion(id, { kind: 'named', actor: HUMAN, label: 'letter' }))!;
    json(await edit({ artifact: id, baseRevision: set.revision, ops: [{ op: 'set_page', size: 'a4', density: 'compact' }] }));
    expect(json<Read>(await read({ artifact: id, version: versionId })).page).toEqual({ size: 'letter', density: 'standard' });
    expect(json<Read>(await read({ artifact: id })).page).toEqual({ size: 'a4', density: 'compact' });
    await world.store.restore(id, versionId, HUMAN);
    expect(docPage(world.service.live(id))).toEqual({ size: 'letter' });
    expect(json<Read>(await read({ artifact: id })).page).toEqual({ size: 'letter', density: 'standard' });
  });

  it('keeps the page through a person’s text edit after it', async () => {
    const { id, first } = await readSeed();
    json(await edit({ artifact: id, baseRevision: first.revision, ops: [{ op: 'set_page', size: 'a4' }] }));
    const person = world.connect(id, HUMAN);
    person.edit((doc) => transact(doc, () => nodeOf(doc, 'p1').insert(0, 'Note: ')));
    await world.service.whenCommitted();
    expect(json<Read>(await read({ artifact: id })).page).toEqual({ size: 'a4', density: 'standard' });
  });
});
