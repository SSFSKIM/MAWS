// P3-H Send to's live-run connector fixture (e2e/support/send-to-mcp-server.mjs), driven over stdio as the engine
// drives it: it lists one write-shaped tool, delivers a file under its allowed folder with the bytes and SHA-256 it
// read, and refuses (recording why) any path outside that folder, a symlink out of it included.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SERVER = join(__dirname, '..', '..', 'e2e', 'support', 'send-to-mcp-server.mjs');
let scratch: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-send-to-fixture-')));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

// The server over the given requests, in order; its answers by id and its delivery log.
async function exchange(allow: string, requests: { method: string; params?: unknown }[]) {
  const log = join(scratch, 'deliveries.jsonl');
  const child = spawn(process.execPath, [SERVER, '--service', 'Google Drive', '--log', log, '--allow', allow], { stdio: ['pipe', 'pipe', 'inherit'] });
  const answers = new Map<number, { result?: Record<string, unknown>; error?: { message: string } }>();
  const lines = createInterface({ input: child.stdout });
  const done = new Promise<void>((resolve) => {
    lines.on('line', (line) => {
      const message = JSON.parse(line) as { id: number; result?: Record<string, unknown>; error?: { message: string } };
      answers.set(message.id, message);
      if (answers.size === requests.length) resolve();
    });
  });
  requests.forEach((request, id) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...request })}\n`));
  await done;
  child.stdin.end();
  await new Promise((resolve) => child.once('exit', resolve));
  const deliveries = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  return { answers, deliveries: deliveries.filter((entry) => entry.tool === 'send_document') };
}

const call = (localPath: unknown) => ({ method: 'tools/call', params: { name: 'send_document', arguments: { local_path: localPath } } });

describe('the Send to connector fixture', () => {
  it('lists one write-shaped tool and delivers an allowed file with the bytes and digest it read', async () => {
    const allowed = join(scratch, 'artifacts', 'a1', 'exports');
    mkdirSync(allowed, { recursive: true });
    const file = join(allowed, '3-pdf.pdf');
    const bytes = Buffer.from('%PDF-1.7 fixture\n');
    writeFileSync(file, bytes);
    const { answers, deliveries } = await exchange(join(scratch, 'artifacts'), [{ method: 'initialize', params: {} }, { method: 'tools/list' }, call(file)]);
    const tools = (answers.get(1)!.result!.tools as { name: string; annotations: { readOnlyHint: boolean } }[]).map((t) => [t.name, t.annotations.readOnlyHint]);
    expect(tools).toEqual([['send_document', false]]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(answers.get(2)!.result!.structuredContent).toEqual({ service: 'Google Drive', name: '3-pdf.pdf', bytes: bytes.length, sha256 });
    expect(deliveries).toEqual([expect.objectContaining({ local_path: file, path: file, bytes: bytes.length, sha256 })]);
  });

  it('refuses a file outside its folder, a symlink out of it, and a missing path, reading none of them', async () => {
    const allowed = join(scratch, 'artifacts');
    mkdirSync(allowed);
    const outside = join(scratch, 'secret.txt');
    writeFileSync(outside, 'not for the connector');
    symlinkSync(outside, join(allowed, 'escape.txt'));
    const { answers, deliveries } = await exchange(allowed, [call(outside), call(join(allowed, 'escape.txt')), call(join(allowed, 'gone.pdf')), call(42)]);
    for (const id of [0, 1, 2, 3]) expect(answers.get(id)!.result!.isError, `request ${id}`).toBe(true);
    expect(deliveries.map((d) => [d.refused !== undefined, d.sha256])).toEqual([
      [true, undefined],
      [true, undefined],
      [true, undefined],
      [true, undefined],
    ]);
  });
});
