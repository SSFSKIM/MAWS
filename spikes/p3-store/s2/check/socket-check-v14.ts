// S2: the socket's record framing (JSON lines beside doc frames) under arbitrary read boundaries, and the doc
// channels' backpressure reset against a real Unix socket whose reader stops reading. Prints one JSON summary.
import { mkdtempSync } from 'node:fs';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentReplica } from '../v14/host/agent-replica';
import { DocumentService } from '../v14/host/document-service';
import { SqliteDocumentStorage } from '../v14/host/storage';
import { HostDocChannels } from '../src/socket/doc-channels';
import { encodeDocFrame, splitRecords } from '../src/socket/framing';

const results: Record<string, unknown> = {};
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  results[name] = { ok, detail };
  if (!ok) failed += 1;
};

// 1. framing: 2,000 records, payloads full of 0x00 and 0x0A, one 7 MB frame, fed in random slices (1 byte to 64 KB)
{
  const sent: ({ kind: 'line'; text: string } | { kind: 'doc'; channel: number; bytes: Uint8Array })[] = [];
  const parts: Buffer[] = [];
  for (let i = 0; i < 2000; i++) {
    if (i % 3 === 0) {
      const text = JSON.stringify({ t: 'evt', name: 'session.event', input: { i, s: 'é\n한글\u0000' } });
      sent.push({ kind: 'line', text });
      parts.push(Buffer.from(`${text}\n`));
    } else {
      const n = i === 1000 ? 7 * 1024 * 1024 : Math.floor(Math.random() * 300);
      const bytes = Uint8Array.from({ length: n }, (_, k) => (k % 7 === 0 ? 0x0a : k % 5 === 0 ? 0 : (k * 31) & 0xff));
      sent.push({ kind: 'doc', channel: i % 17, bytes });
      parts.push(encodeDocFrame(i % 17, bytes));
    }
  }
  const all = Buffer.concat(parts);
  const got: typeof sent = [];
  const splitter = splitRecords({
    line: (text) => got.push({ kind: 'line', text }),
    doc: (channel, bytes) => got.push({ kind: 'doc', channel, bytes }),
    overflow: (why) => got.push({ kind: 'line', text: `OVERFLOW ${why}` }),
  });
  const started = performance.now();
  for (let at = 0; at < all.length; ) {
    const n = 1 + Math.floor(Math.random() * (Math.random() < 0.5 ? 16 : 65536));
    splitter.push(all.subarray(at, at + n));
    at += n;
  }
  const ms = performance.now() - started;
  const same =
    got.length === sent.length &&
    sent.every((s, i) => {
      const g = got[i];
      if (s.kind !== g.kind) return false;
      if (s.kind === 'line') return g.kind === 'line' && g.text === s.text;
      return g.kind === 'doc' && g.channel === s.channel && Buffer.compare(Buffer.from(g.bytes), Buffer.from(s.bytes)) === 0 && g.bytes.byteLength === g.bytes.buffer.byteLength;
    });
  check('framing: every record back in order, exact-size frames', same, { records: sent.length, bytes: all.length, ms: Math.round(ms) });
}

// 2. backpressure: a client that stops reading; the host resets the channel instead of queuing past the mark
{
  const dir = mkdtempSync(join(tmpdir(), 'p3-s2-sock-'));
  const service = new DocumentService(new SqliteDocumentStorage(join(dir, 'store.sqlite')), { log: () => {} });
  const path = join(dir, 's.sock');
  const events: unknown[] = [];
  let channels: HostDocChannels | null = null;
  const server = createServer((socket: Socket) => {
    channels = new HostDocChannels(socket, service, (name, input) => {
      events.push({ name, input });
      socket.write(`${JSON.stringify({ t: 'evt', name, input })}\n`);
    }, 1024 * 1024);
    channels.open(1, 'bp', { kind: 'human' });
  });
  await new Promise<void>((r) => server.listen(path, r));
  const client = createConnection(path);
  await new Promise<void>((r) => client.once('connect', r));
  client.pause(); // the reader stops
  await new Promise((r) => setTimeout(r, 50));
  const agent = new AgentReplica(service, 'bp', { kind: 'session', appSessionId: 'flood' });
  await agent.whenSynced();
  const chunk = 'x'.repeat(4096);
  let i = 0;
  while (i < 4000 && channels!.counts.resets === 0) {
    agent.doc.get('t').insert(0, chunk);
    i += 1;
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 1));
  }
  await agent.whenSaved();
  check('backpressure: the stalled channel is reset, the doc goes on', channels!.counts.resets === 1 && (events[0] as { input: { reason: string } }).input.reason === 'reset', {
    updatesBeforeReset: i,
    framesOut: channels!.counts.framesOut,
    events,
    agentRevision: agent.provider.state.revision,
  });
  client.destroy();
  server.close();
  agent.close();
}

console.log(JSON.stringify({ failed, results }, null, 2));
process.exit(failed ? 1 : 0);
