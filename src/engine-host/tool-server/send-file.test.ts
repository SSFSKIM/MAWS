import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { SendFileResultSchema, TOOL_ERRORS } from '@shared/maws/tools';
import { jsonOf, openWorld, SELF, type World } from './artifact-world.fixture';
import type { McpToolContext, McpToolResult } from './server';
import { sendFileTool } from './send-file';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-send-file-'));
  writeFileSync(join(root, 'hello.txt'), 'HELLO_E1');
  mkdirSync(join(root, 'out'));
  writeFileSync(join(root, 'out', 'report.pdf'), '%PDF');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: 'app-1' as AppSessionId, cwd: root, toolUseId: 'toolu_01' as ToolUseId, requestId: 'r1' as RequestId, signal: new AbortController().signal, fromSubagent: false, ...over });
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text; // E2: content widened to image blocks

// P3-A (M6): each file a `file` artifact in the store (P3-L M6b: no X12 record mirrored)
describe('send_file over the artifact store', () => {
  let w: World;
  beforeEach(() => {
    w = openWorld();
    writeFileSync(join(w.cwd, 'hello.txt'), 'HELLO_E1');
  });
  afterEach(() => w.close());

  it('makes each file a file artifact linked created and answers those ids', async () => {
    const send = () => sendFileTool(w.deps()).call({ files: ['hello.txt', join(root, 'out', 'report.pdf')], caption: 'the greeting' }, w.ctx({ toolUseId: 'toolu_send' as ToolUseId }));
    const answer = SendFileResultSchema.parse(jsonOf(await send()));
    expect(answer.deliverables.map((d) => [d.path, d.name])).toEqual([[join(w.cwd, 'hello.txt'), 'hello.txt'], [join(root, 'out', 'report.pdf'), 'report.pdf']]);
    for (const file of answer.deliverables) {
      expect(w.store.get(file.id)).toMatchObject({ kind: 'file', title: file.name, linkedPath: file.path, createdBy: { kind: 'session', appSessionId: SELF } });
      expect(w.store.links(file.id).map((l) => l.role)).toEqual(['created']);
    }
    // one commit, idempotent: the replayed call answers the same ids and writes nothing again
    expect(jsonOf(await send())).toEqual(answer);
    expect(w.store.list({ kind: 'file' })).toHaveLength(2);
  });

  it('hashes each file before the delivery’s batch opens, never synchronously inside it, and records its digest', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 7);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 251;
    writeFileSync(join(w.cwd, 'big.bin'), big);
    const inBatch: boolean[] = [];
    const hashInPlace = w.store.files.describe.bind(w.store.files);
    vi.spyOn(w.store.files, 'describe').mockImplementation((path) => (inBatch.push(w.storage.batchOpen), hashInPlace(path)));
    const answer = SendFileResultSchema.parse(jsonOf(await sendFileTool(w.deps()).call({ files: ['big.bin', 'hello.txt'] }, w.ctx())));
    expect(inBatch.filter(Boolean)).toEqual([]);
    const refs = answer.deliverables.map((file) => w.store.contentRef(file.id).ref);
    expect(refs.map((ref) => [ref.name, ref.size, ref.sha256])).toEqual([
      ['big.bin', big.length, createHash('sha256').update(big).digest('hex')],
      ['hello.txt', 8, createHash('sha256').update('HELLO_E1').digest('hex')],
    ]);
  });
});

describe('send_file over the artifact store: replays and failures', () => {
  let w: World;
  beforeEach(() => {
    w = openWorld();
    writeFileSync(join(w.cwd, 'one.txt'), 'one');
    writeFileSync(join(w.cwd, 'two.txt'), 'two');
  });
  afterEach(() => w.close());

  it('answers a repeated delivery from its ledger even after a file is gone', async () => {
    const ctx = w.ctx({ toolUseId: 'toolu_twice' as ToolUseId });
    const first = await sendFileTool(w.deps()).call({ files: ['one.txt'] }, ctx);
    rmSync(join(w.cwd, 'one.txt'));
    expect(await sendFileTool(w.deps()).call({ files: ['one.txt'] }, ctx)).toEqual(first);
  });

  it('answers two overlapping deliveries with one tool-use id alike, with one artifact per file', async () => {
    const tool = sendFileTool(w.deps());
    const ctx = w.ctx({ toolUseId: 'toolu_overlap' as ToolUseId });
    const [first, second] = await Promise.all([tool.call({ files: ['one.txt'] }, ctx), tool.call({ files: ['one.txt'] }, { ...ctx, requestId: w.ctx().requestId })]);
    expect(second).toEqual(first);
    expect(w.store.list({ kind: 'file' })).toHaveLength(1);
  });

  it('a delivery whose second file fails leaves no artifact and no op, and its retry delivers each file once', async () => {
    const original = w.store.create.bind(w.store);
    const createAll = w.store.createAll?.bind(w.store);
    const vanish = (titles: string[]) => {
      if (titles.includes('two.txt')) rmSync(join(w.cwd, 'two.txt'));
    };
    w.store.create = ((input, ...rest) => (vanish([input.title]), original(input, ...rest))) as typeof w.store.create;
    if (createAll) w.store.createAll = ((inputs, ...rest) => (vanish(inputs.map((i) => i.title)), createAll(inputs, ...rest))) as typeof w.store.createAll;
    const ctx = w.ctx({ toolUseId: 'toolu_fail' as ToolUseId });
    const failed = await sendFileTool(w.deps()).call({ files: ['one.txt', 'two.txt'] }, ctx).catch((error: unknown) => error);
    expect(failed instanceof Error || (failed as { isError?: boolean }).isError).toBeTruthy();
    w.service.commitNow();
    expect(w.store.list({ kind: 'file' })).toEqual([]);
    w.store.create = original;
    if (createAll) w.store.createAll = createAll;
    writeFileSync(join(w.cwd, 'two.txt'), 'two');
    jsonOf(await sendFileTool(w.deps()).call({ files: ['one.txt', 'two.txt'] }, ctx));
    expect(w.store.list({ kind: 'file' }).map((a) => a.title).sort()).toEqual(['one.txt', 'two.txt']);
  });
});

describe('send_file’s refusals', () => {
  let w: World;
  beforeEach(() => {
    w = openWorld();
  });
  afterEach(() => w.close());

  it('refuses the whole call before writing anything when one path is not a file', async () => {
    const missing = await sendFileTool(w.deps()).call({ files: ['hello.txt', 'gone.txt'] }, ctx());
    expect(missing).toEqual({ content: [{ type: 'text', text: `send_file: not a file: ${join(root, 'gone.txt')}` }], isError: true });
    const dir = await sendFileTool(w.deps()).call({ files: ['out'] }, ctx());
    expect(text(dir)).toBe(`send_file: not a file: ${join(root, 'out')}`);
    expect(w.store.list()).toEqual([]);
  });

  it('refuses arguments its schema refuses, naming the issue', async () => {
    const result = await sendFileTool(w.deps()).call({ files: [] }, ctx());
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^send_file: invalid arguments: files: /);
  });

  // P3-L M6b: E1's X12 record stood in for a store that did not open; with X12 gone nothing is delivered, and the model
  // reads why
  it('delivers nothing without the artifact store, and says so', async () => {
    for (const artifacts of [undefined, () => null]) {
      const result = await sendFileTool({ artifacts }).call({ files: ['hello.txt'], caption: 'the greeting' }, ctx());
      expect(result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.deliveryUnavailable }], isError: true });
    }
  });
});
