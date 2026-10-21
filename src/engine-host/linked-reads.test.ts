// P4-A3 lever 2: a human message that links artifacts carries their reads. The rule (`withLinkedReads`, a fake read)
// and the wiring on a scripted EngineSession over the real store: the frame written carries the session's own
// artifact_read answer, the queue keeps the human's message, and a read gone stale is caught by the edit's revision.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { linkedReadBlock, linkedReadOf, LINKED_READ_CAP_BYTES, utf8Bytes } from '@shared/maws/linked-read';
import type { StdinFrame } from '@shared/wire/frames';
import { scriptedSession } from './conformance/session-harness';
import { openDocumentWorld, type DocumentWorld } from './documents/kinds/document-world.fixture';
import { withLinkedReads, type LinkedReader } from './linked-reads';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import { AskTable } from './tool-server/asks';
import { HostBridge } from './tool-server/bridge';
import { PaneBridge } from './tool-server/panes';
import { mawsTools } from './tool-server/tools';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
// A reader over fixed answers: each link's text, admitted or not as `withLinkedReads` decides.
const reader = (answer: (artifactId: string) => string | null, asked: string[] = []): LinkedReader => async (link, admit) => {
  asked.push(link.artifactId);
  return admit(answer(link.artifactId));
};
const readOf = (artifactId: string, revision: number, body = 'x') => JSON.stringify({ status: 'read', artifactId, kind: 'document', title: `T ${artifactId.slice(0, 1)}`, revision, markdown: body }, null, 2);

describe('withLinkedReads', () => {
  it('leaves a message that links nothing as it is, the same content', async () => {
    const content = 'no link';
    const out = await withLinkedReads(content, reader(() => readOf(A, 1)));
    expect(out.content).toBe(content);
    expect(out.attached).toEqual([]);
  });

  it('attaches each linked artifact once, in link order, after the human’s words; a refused read is skipped', async () => {
    const asked: string[] = [];
    const reads: Record<string, string | null> = { [A]: readOf(A, 4), [B]: null, [C]: readOf(C, 9) };
    const out = await withLinkedReads(`See [c](maws-artifact:${C}#block=p1), [b](maws-artifact:${B}) and [a](maws-artifact:${A}), and [c](maws-artifact:${C}) again.`, reader((id) => reads[id]!, asked));
    expect(asked).toEqual([C, B, A]);
    expect(out.attached.map(({ artifactId, revision }) => [artifactId, revision])).toEqual([[C, 9], [A, 4]]);
    expect(out.skipped).toEqual([{ artifactId: B, why: 'refused' }]);
    const blocks = out.content as { type: string; text: string }[];
    expect(blocks[0]).toEqual({ type: 'text', text: expect.stringContaining('See [c]') });
    expect(blocks.slice(1).map((b) => linkedReadOf(b.text)?.artifactId)).toEqual([C, A]);
    expect(blocks[1]!.text).toBe(linkedReadBlock(reads[C]!));
  });

  it('holds the reads’ total within the cap: one too large is skipped and a smaller later one still goes', async () => {
    const big = readOf(B, 2, '가'.repeat(LINKED_READ_CAP_BYTES / 3)); // token-dense: a byte bound, never a guess per character
    const out = await withLinkedReads([{ type: 'image', source: {} }, { type: 'text', text: `[a](maws-artifact:${A}) [b](maws-artifact:${B}) [c](maws-artifact:${C})` }], reader((id) => (id === B ? big : readOf(id, 1))));
    expect(out.attached.map((a) => a.artifactId)).toEqual([A, C]);
    expect(out.skipped).toEqual([{ artifactId: B, why: 'over the cap' }]);
    expect(out.attached.reduce((sum, a) => sum + a.bytes, 0)).toBeLessThanOrEqual(LINKED_READ_CAP_BYTES);
    expect(out.attached[0]!.bytes).toBe(utf8Bytes(linkedReadBlock(readOf(A, 1))));
    expect((out.content as { type: string }[]).map((b) => b.type)).toEqual(['image', 'text', 'text', 'text']);
  });

  it('keeps the attached reads’ effects when their frame is written, and undoes them, latest first, when it is not', async () => {
    const undone: string[] = [];
    const read: LinkedReader = async (link, admit) => ({ ...admit(readOf(link.artifactId, 1)), undo: () => undone.push(link.artifactId) });
    const words = `[a](maws-artifact:${A}) [c](maws-artifact:${C})`;
    (await withLinkedReads(words, read)).settle(true);
    expect(undone).toEqual([]);
    (await withLinkedReads(words, read)).settle(false);
    expect(undone).toEqual([C, A]);
  });

  it('attaches nothing a cap cannot hold, and leaves the message as it is', async () => {
    const out = await withLinkedReads(`[a](maws-artifact:${A})`, reader(() => readOf(A, 1)), 10);
    expect(out.content).toBe(`[a](maws-artifact:${A})`);
    expect(out.skipped).toEqual([{ artifactId: A, why: 'over the cap' }]);
  });
});

describe('a human message on an EngineSession (scripted, the real store)', () => {
  let cwd: string;
  let documents: DocumentWorld;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'maws-a3-cwd-'));
    documents = openDocumentWorld();
  });
  afterEach(() => {
    documents.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('is written with the session’s own read of what it links; the queue keeps the human’s words; a stale read is refused at the edit', async () => {
    const queueStore = new MemorySessionStateStore();
    const run = scriptedSession({ spec: { cwd }, session: { appVersion: '0.9.0', artifacts: () => documents.store, store: queueStore } });
    await run.session.start();
    let n = 0;
    const call = (name: string, args: unknown) => {
      const id = `mcp-${++n}` as RequestId;
      run.transport.push({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args, _meta: { 'claudecode/toolUseId': `toolu_${n}` } } } } });
      return id;
    };
    const answer = async (id: RequestId) => {
      for (let i = 0; i < 2000; i++) {
        const w = run.transport.writes.find((f) => f.type === 'control_response' && (f as { response: { request_id: string } }).response.request_id === id) as { response: { response: { mcp_response: { result: { content: { text: string }[]; isError?: boolean } } } } } | undefined;
        if (w) return w.response.response.mcp_response.result;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error(`no answer to ${id}`);
    };
    const created = JSON.parse((await answer(call('artifact_create', { kind: 'document', title: 'Plan', content: '# Plan ^h1\n\nWe meet on Friday. ^p1' }))).content[0]!.text) as { artifactId: string; revision: number };
    const read = (await answer(call('artifact_read', { artifact: created.artifactId }))).content[0]!.text;

    const words = `In [the plan](maws-artifact:${created.artifactId}#block=p1), change Friday to Monday.`;
    await run.session.send(words);
    const users = () => run.transport.writes.filter((f): f is Extract<StdinFrame, { type: 'user' }> => f.type === 'user');
    for (let i = 0; i < 2000 && users().length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    const content = users()[0]!.message.content as { type: string; text: string }[];
    expect(content[0]).toEqual({ type: 'text', text: words });
    expect(content[1]!.text).toBe(linkedReadBlock(read)); // the read tool's own answer, whole
    expect(linkedReadOf(content[1]!.text)).toMatchObject({ artifactId: created.artifactId, title: 'Plan', revision: JSON.parse(read).revision });
    const kept = await queueStore.loadQueue(run.session.status().appSessionId);
    expect(kept.entries.map((e) => e.content)).toEqual([words]); // the entry the queue keeps and shows is the human's message

    // the block changes after the read went out: an edit from the attached revision that replaces it is refused
    const attachedRevision = JSON.parse(read).revision as number;
    const moved = await answer(call('artifact_edit', { artifact: created.artifactId, baseRevision: attachedRevision, ops: [{ op: 'replace_block', id: 'p1', markdown: 'We meet on Tuesday.' }] }));
    expect(moved.isError, moved.content[0]!.text).toBeUndefined();
    const stale = await answer(call('artifact_edit', { artifact: created.artifactId, baseRevision: attachedRevision, ops: [{ op: 'replace_block', id: 'p1', markdown: 'We meet on Monday.' }] }));
    expect(stale.isError).toBe(true);
    expect(stale.content[0]!.text).toContain('p1');
    run.transport.exit(0);
    await run.session.exited;
  });

  it('leaves the session’s memory of an artifact as it was when its read is not attached: a page it never saw stays unread', async () => {
    // two html pages another session made: one small, one over the cap
    const other = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => documents.store });
    const make = async (content: string) => {
      const result = await other.find((t) => t.name === 'artifact_create')!.call({ title: 'Page', content }, { appSessionId: 'app-other' as AppSessionId, cwd, toolUseId: `toolu_o${content.length}` as ToolUseId, requestId: `ro${content.length}` as RequestId, signal: new AbortController().signal, fromSubagent: false });
      return JSON.parse((result.content[0] as { text: string }).text) as { artifactId: string; revision: number };
    };
    const small = await make('<p>small</p>');
    const big = await make(`<p>${'x'.repeat(LINKED_READ_CAP_BYTES)}</p>`);
    const run = scriptedSession({ spec: { cwd }, session: { appVersion: '0.9.0', artifacts: () => documents.store } });
    await run.session.start();
    await run.session.send(`Look at [one](maws-artifact:${small.artifactId}) and [two](maws-artifact:${big.artifactId}).`);
    const users = () => run.transport.writes.filter((f): f is Extract<StdinFrame, { type: 'user' }> => f.type === 'user');
    for (let i = 0; i < 2000 && users().length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect((users()[0]!.message.content as unknown as { text: string }[]).slice(1).map((b) => linkedReadOf(b.text)?.artifactId)).toEqual([small.artifactId]);
    let n = 0;
    const publish = async (artifactId: string, revision: number) => {
      const id = `mcp-p${++n}` as RequestId;
      run.transport.push({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'artifact_publish', arguments: { artifact: artifactId, baseRevision: revision, files: { 'index.html': '<p>mine</p>' } }, _meta: { 'claudecode/toolUseId': `toolu_p${n}` } } } } });
      for (let i = 0; i < 2000; i++) {
        const w = run.transport.writes.find((f) => f.type === 'control_response' && (f as { response: { request_id: string } }).response.request_id === id) as { response: { response: { mcp_response: { result: { content: { text: string }[]; isError?: boolean } } } } } | undefined;
        if (w) return w.response.response.mcp_response.result;
        await new Promise((r) => setTimeout(r, 5));
      }
      throw new Error('no answer');
    };
    expect((await publish(small.artifactId, small.revision)).isError).toBeUndefined(); // the attached read is the session's read
    const unread = await publish(big.artifactId, big.revision);
    expect(unread.isError).toBe(true); // the read not attached left no base: refused as never read, as without the link
    run.transport.exit(0);
    await run.session.exited;
  });

  it('beside an agent call it cannot tell apart, clears the memory it cannot restore: the next publish is refused as never read, never judged from a view the agent lacks', async () => {
    const other = mawsTools({ bridge: new PaneBridge({ show: () => {} }), capture: new HostBridge({ send: () => {}, answerMs: 1_000 }), asks: new AskTable(), askCancelled: () => {}, artifacts: () => documents.store });
    const made = await other.find((t) => t.name === 'artifact_create')!.call({ title: 'Page', content: `<p>${'x'.repeat(LINKED_READ_CAP_BYTES)}</p>` }, { appSessionId: 'app-other' as AppSessionId, cwd, toolUseId: 'toolu_big' as ToolUseId, requestId: 'rbig' as RequestId, signal: new AbortController().signal, fromSubagent: false });
    const big = JSON.parse((made.content[0] as { text: string }).text) as { artifactId: string; revision: number };
    const run = scriptedSession({ spec: { cwd }, session: { appVersion: '0.9.0', artifacts: () => documents.store } });
    await run.session.start();
    const answerOf = (id: string) => run.transport.writes.find((f) => f.type === 'control_response' && (f as { response: { request_id: string } }).response.request_id === id) as { response: { response: { mcp_response: { result: { isError?: boolean; content: { text: string }[] } } } } } | undefined;
    const call = (id: string, name: string, args: unknown) => run.transport.push({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args, _meta: { 'claudecode/toolUseId': `toolu_${id}` } } } } });
    // the agent's own read (a background agent's, the main turn idle) and the human's message linking the same page, at once
    call('own-read', 'artifact_read', { artifact: big.artifactId });
    await run.session.send(`Look at [it](maws-artifact:${big.artifactId}).`);
    for (let i = 0; i < 2000 && !answerOf('own-read'); i++) await new Promise((r) => setTimeout(r, 5));
    call('publish', 'artifact_publish', { artifact: big.artifactId, baseRevision: big.revision, files: { 'index.html': '<p>mine</p>' } });
    for (let i = 0; i < 2000 && !answerOf('publish'); i++) await new Promise((r) => setTimeout(r, 5));
    const answer = answerOf('publish')!.response.response.mcp_response.result;
    expect(answer.isError).toBe(true); // refused, and the page is as it was: the agent reads again
    expect(answer.content[0]!.text).toContain('read');
    const check = await other.find((t) => t.name === 'artifact_read')!.call({ artifact: big.artifactId }, { appSessionId: 'app-other' as AppSessionId, cwd, toolUseId: 'toolu_check' as ToolUseId, requestId: 'rcheck' as RequestId, signal: new AbortController().signal, fromSubagent: false });
    expect((JSON.parse((check.content[0] as { text: string }).text) as { revision: number }).revision).toBe(big.revision);
    run.transport.exit(0);
    await run.session.exited;
  });
});
