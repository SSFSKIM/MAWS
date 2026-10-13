import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { SendFileResultSchema } from '@shared/maws/tools';
import { MemoryDeliverableStore } from '../deliverables/store';
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

const ctx = (over: Partial<McpToolContext> = {}): McpToolContext => ({ appSessionId: 'app-1' as AppSessionId, cwd: root, toolUseId: 'toolu_01' as ToolUseId, requestId: 'r1' as RequestId, signal: new AbortController().signal, ...over });
const text = (result: McpToolResult) => (result.content[0] as { text: string }).text; // E2: content widened to image blocks
let n = 0;
const tool = (store: MemoryDeliverableStore) => sendFileTool({ deliverables: store, now: () => new Date('2026-10-05T12:00:00.000Z'), newId: () => `00000000-0000-4000-8000-00000000000${++n}` });

// P3-A (M6): each file a `file` artifact in the store, its X12 record mirrored under the same id
describe('send_file over the artifact store', () => {
  let w: World;
  beforeEach(() => {
    w = openWorld();
    writeFileSync(join(w.cwd, 'hello.txt'), 'HELLO_E1');
  });
  afterEach(() => w.close());

  it('makes each file a file artifact linked created, mirrors its X12 record under the same id, and answers those ids', async () => {
    const send = () => sendFileTool(w.deps()).call({ files: ['hello.txt', join(root, 'out', 'report.pdf')], caption: 'the greeting' }, w.ctx({ toolUseId: 'toolu_send' as ToolUseId }));
    const answer = SendFileResultSchema.parse(jsonOf(await send()));
    expect(answer.deliverables.map((d) => [d.path, d.name])).toEqual([[join(w.cwd, 'hello.txt'), 'hello.txt'], [join(root, 'out', 'report.pdf'), 'report.pdf']]);
    for (const file of answer.deliverables) {
      expect(w.store.get(file.id)).toMatchObject({ kind: 'file', title: file.name, linkedPath: file.path, createdBy: { kind: 'session', appSessionId: SELF } });
      expect(w.store.links(file.id).map((l) => l.role)).toEqual(['created']);
      expect(await w.deliverables.get(SELF, file.id)).toMatchObject({ id: file.id, kind: 'file', path: file.path, title: file.name, caption: 'the greeting', toolUseId: 'toolu_send' });
    }
    // one commit, idempotent: the replayed call answers the same ids and writes nothing again
    expect(jsonOf(await send())).toEqual(answer);
    expect(w.store.list({ kind: 'file' })).toHaveLength(2);
    expect(w.written).toHaveLength(2);
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

  it('answers two overlapping deliveries with one tool-use id alike, with one artifact and one X12 record per file', async () => {
    const tool = sendFileTool(w.deps());
    const ctx = w.ctx({ toolUseId: 'toolu_overlap' as ToolUseId });
    const [first, second] = await Promise.all([tool.call({ files: ['one.txt'] }, ctx), tool.call({ files: ['one.txt'] }, { ...ctx, requestId: w.ctx().requestId })]);
    expect(second).toEqual(first);
    expect(w.store.list({ kind: 'file' })).toHaveLength(1);
    expect(w.written).toHaveLength(1);
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

describe('send_file without the artifact store (G2, host half)', () => {
  it('records each file in place and answers the deliverable ids', async () => {
    n = 0;
    const store = new MemoryDeliverableStore();
    const result = await tool(store).call({ files: ['hello.txt', join(root, 'out', 'report.pdf')], caption: 'the greeting', urgency: 'high' }, ctx());
    expect(result.isError).toBeUndefined();
    const at = '2026-10-05T12:00:00.000Z';
    expect(store.records).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', appSessionId: 'app-1', kind: 'file', path: join(root, 'hello.txt'), title: 'hello.txt', caption: 'the greeting', versions: [{ path: join(root, 'hello.txt'), at }], toolUseId: 'toolu_01', createdAt: at },
      { id: '00000000-0000-4000-8000-000000000002', appSessionId: 'app-1', kind: 'file', path: join(root, 'out', 'report.pdf'), title: 'report.pdf', caption: 'the greeting', versions: [{ path: join(root, 'out', 'report.pdf'), at }], toolUseId: 'toolu_01', createdAt: at },
    ]);
    expect(SendFileResultSchema.parse(JSON.parse(text(result)))).toEqual({
      status: 'delivered',
      deliverables: [
        { id: '00000000-0000-4000-8000-000000000001', path: join(root, 'hello.txt'), name: 'hello.txt' },
        { id: '00000000-0000-4000-8000-000000000002', path: join(root, 'out', 'report.pdf'), name: 'report.pdf' },
      ],
    });
  });

  it('omits what the call did not carry: no caption, no tool-use id', async () => {
    const store = new MemoryDeliverableStore();
    await tool(store).call({ files: ['hello.txt'] }, ctx({ toolUseId: null }));
    expect(store.records[0]).not.toHaveProperty('caption');
    expect(store.records[0]).not.toHaveProperty('toolUseId');
  });

  it('refuses the whole call before writing anything when one path is not a file', async () => {
    const store = new MemoryDeliverableStore();
    const missing = await tool(store).call({ files: ['hello.txt', 'gone.txt'] }, ctx());
    expect(missing).toEqual({ content: [{ type: 'text', text: `send_file: not a file: ${join(root, 'gone.txt')}` }], isError: true });
    const dir = await tool(store).call({ files: ['out'] }, ctx());
    expect(text(dir)).toBe(`send_file: not a file: ${join(root, 'out')}`);
    expect(store.records).toEqual([]);
  });

  it('refuses arguments its schema refuses, naming the issue', async () => {
    const result = await tool(new MemoryDeliverableStore()).call({ files: [] }, ctx());
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^send_file: invalid arguments: files: /);
  });

  it('answers a store that refused the record as an error', async () => {
    const refusing = Object.assign(new MemoryDeliverableStore(), { write: async () => Promise.reject(new Error('EACCES')) }); // E2: the writer's surface grew
    const result = await sendFileTool({ deliverables: refusing }).call({ files: ['hello.txt'] }, ctx());
    expect(result).toEqual({ content: [{ type: 'text', text: `send_file: ${join(root, 'hello.txt')} was not recorded: EACCES` }], isError: true });
  });
});
