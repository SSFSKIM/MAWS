import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId, ToolUseId } from '@shared/graph/ids';
import { SendFileResultSchema } from '@shared/maws/tools';
import { MemoryDeliverableStore } from '../deliverables/store';
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

describe('send_file (G2, host half)', () => {
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
