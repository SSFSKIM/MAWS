// S2 harness: the engine host stand-in. One bundle, two modes as the app's engine host (src/engine-host/index.ts):
// `process.parentPort` present → a utility process forked by main, document ports arriving as MessagePortMain;
// `--detached <dir>` → the Electron binary as Node in its own session, serving one client on a Unix socket whose
// records are JSON lines and doc frames (s2/src/socket/framing.ts). Both modes run the same document service.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import * as Y from 'yjs';
import { AgentReplica } from '../s2/src/host/agent-replica';
import { DocumentService } from '../s2/src/host/document-service';
import { fromMessagePortMain, type MessagePortMainLike } from '../s2/src/host/ports';
import { actorKey, SqliteDocumentStorage, type Actor } from '../s2/src/host/storage';
import { HostDocChannels } from '../s2/src/socket/doc-channels';
import { splitRecords } from '../s2/src/socket/framing';
import { idAt } from '../s2/src/yjs-seam';
import { digest, findMarker, newParagraph } from './doc-model';

const userData = process.env.S2_USER_DATA;
if (!userData) throw new Error('S2_USER_DATA is required');
const fullfsync = process.env.S2_FULLFSYNC === '1';
mkdirSync(join(userData, 'artifacts'), { recursive: true });
const dbPath = join(userData, 'artifacts', 'store.sqlite');
const storage = new SqliteDocumentStorage(dbPath, { fullfsync });
const logLines: string[] = [];
const log = (line: string) => {
  logLines.push(`${new Date().toISOString()} ${line}`);
  if (logLines.length > 500) logLines.shift();
};
const service = new DocumentService(storage, { log });

// commit timing (spike instrumentation): only commits that closed a batch
const commitMs: number[] = [];
const rawCommit = storage.commit.bind(storage);
storage.commit = () => {
  const open = (storage as unknown as { open: boolean }).open;
  const t = performance.now();
  rawCommit();
  if (open && commitMs.length < 100_000) commitMs.push(performance.now() - t);
};

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100;
};
const size = (path: string) => (existsSync(path) ? statSync(path).size : 0);
const agents = new Map<string, AgentReplica>();

type Input = Record<string, unknown>;

async function handle(name: string, input: Input): Promise<unknown> {
  const docId = String(input.docId ?? '');
  switch (name) {
    case 'import': {
      if (storage.revision(docId) > 0 || storage.load(docId).version) return { imported: false };
      storage.importVersion(docId, readFileSync(String(input.file)), Date.now(), { kind: 'human' });
      return { imported: true };
    }
    case 'stats': {
      const loaded = service.loaded(docId);
      return {
        pid: process.pid,
        fullfsync,
        mem: process.memoryUsage(),
        store: { db: size(dbPath), wal: size(`${dbPath}-wal`) },
        rows: storage.rowCounts(),
        provenanceBytes: storage.provenanceBytes(docId),
        revision: service.revision(docId),
        loadMs: loaded?.loadMs ?? null,
        stateV2: loaded ? Y.encodeStateAsUpdateV2(loaded.doc).length : null,
        service: { ...service.stats, rejected: service.stats.rejected.length, rejectedReasons: service.stats.rejected.slice(-10) },
        commits: { n: commitMs.length, p50: pct(commitMs, 50), p95: pct(commitMs, 95), max: pct(commitMs, 100) },
        log: logLines.slice(-20),
      };
    }
    case 'reload': {
      // the store alone, through a fresh doc: what a restart would load
      const fresh = new Y.Doc();
      const stored = storage.load(docId);
      const t = performance.now();
      if (stored.version) Y.applyUpdateV2(fresh, stored.version.state);
      for (const row of stored.updates) Y.applyUpdate(fresh, row.bytes);
      return { digest: digest(fresh), sv: [...Y.decodeStateVector(Y.encodeStateVector(fresh))], ms: performance.now() - t, rows: stored.updates.length, versionSeq: stored.version?.seq ?? null };
    }
    case 'live': {
      const loaded = service.loaded(docId);
      if (!loaded) return null;
      return { digest: digest(loaded.doc), sv: [...Y.decodeStateVector(Y.encodeStateVector(loaded.doc))] };
    }
    case 'who': {
      service.open(docId);
      const found = findMarker(service.loaded(docId)!.doc, String(input.marker));
      if (!found) return { found: false };
      const id = idAt(found.text, found.index + Number(input.offset ?? 0));
      if (!id) return { found: false };
      return { found: true, ...id, inserted: storage.whoInserted(docId, id.client, id.clock) };
    }
    case 'actors':
      return storage.query('SELECT actor, COUNT(*) AS rows, MIN(at) AS firstAt, MAX(at) AS lastAt FROM updates WHERE docId = ? GROUP BY actor', docId);
    case 'provenanceActors':
      return storage.provenanceSummary(docId);
    case 'compact': {
      const before = storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM updates WHERE docId = ?', docId)[0].n;
      const t = performance.now();
      const out = service.compact(docId, { kind: 'human' });
      return { ...out, rowsFolded: before, ms: performance.now() - t, rowsLeft: storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM updates WHERE docId = ?', docId)[0].n };
    }
    case 'thin': {
      // v14 only: the merged attribution's times bucketed (the v13 storage has no thinning)
      const s = storage as unknown as { thin?: (d: string, seq: number, ms: number) => void };
      if (!s.thin) return null;
      const before = storage.provenanceBytes(docId);
      s.thin(docId, service.revision(docId), Number(input.bucketMs ?? 60_000));
      return { bytesBefore: before, bytesAfter: storage.provenanceBytes(docId), summary: storage.provenanceSummary(docId) };
    }
    case 'agent': {
      const actor: Actor = { kind: 'session', appSessionId: String(input.sessionId) };
      let agent = agents.get(`${docId}/${actorKey(actor)}`);
      if (!agent) {
        agent = new AgentReplica(service, docId, actor);
        agents.set(`${docId}/${actorKey(actor)}`, agent);
        await agent.whenSynced();
      }
      const count = Number(input.sentences ?? 10);
      const interval = Number(input.intervalMs ?? 100);
      const text = newParagraph(agent.doc);
      const started = Date.now();
      for (let i = 0; i < count; i++) {
        text.insert(text.length, `${String(input.marker ?? 'AGENT')}-${i} wrote a sentence while ${String(input.note ?? 'working')}. `);
        if (interval > 0) await new Promise((r) => setTimeout(r, interval));
      }
      const revision = await agent.whenSaved();
      return { revision, clientId: agent.doc.clientID, sentences: count, ms: Date.now() - started };
    }
    default:
      throw new Error(`unknown command ${name}`);
  }
}

const detachedAt = process.argv.indexOf('--detached');
const parentPort = (process as unknown as { parentPort?: { on(e: 'message', l: (e: { data: Input & { id: number; name: string }; ports: MessagePortMainLike[] }) => void): void; postMessage(m: unknown): void } }).parentPort;

if (parentPort) {
  // utility mode: control messages on the parent port; `open` carries the document port
  parentPort.on('message', ({ data, ports }) => {
    const { id, name } = data;
    if (name === 'open') {
      const conn = service.attach(String(data.docId), fromMessagePortMain(ports[0]), data.actor as Actor);
      parentPort.postMessage({ id, ok: true, value: { conn: conn.id, revision: service.revision(String(data.docId)), loadMs: service.loaded(String(data.docId))?.loadMs } });
      return;
    }
    handle(name, data).then(
      (value) => parentPort.postMessage({ id, ok: true, value }),
      (error) => parentPort.postMessage({ id, ok: false, error: String(error?.stack ?? error) }),
    );
  });
  parentPort.postMessage({ id: 0, ok: true, value: { started: process.pid } });
} else if (detachedAt !== -1) {
  const dir = process.argv[detachedAt + 1];
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const socketPath = join(dir, 'h.sock');
  const token = randomBytes(16).toString('hex');
  writeFileSync(join(dir, 'token'), token, { mode: 0o600 });
  const out = (line: string) => writeFileSync(join(dir, 'host.log'), `${new Date().toISOString()} ${line}\n`, { flag: 'a' });
  out(`detached host pid ${process.pid} starting; fullfsync ${fullfsync}`);
  process.on('uncaughtException', (e) => out(`uncaught: ${e.stack}`));
  process.on('SIGTERM', () => {
    service.close();
    storage.close();
    process.exit(0);
  });

  const agentArg = process.argv.indexOf('--agent');
  const seedArg = process.argv.indexOf('--seed');
  const boot = async () => {
    if (seedArg !== -1) {
      const [docId, file] = process.argv[seedArg + 1].split('=');
      await handle('import', { docId, file });
    }
    if (agentArg !== -1) {
      // docId:session:sentences:intervalMs — the agent edits while no client (no main) is connected
      const [docId, sessionId, sentences, intervalMs] = process.argv[agentArg + 1].split(':');
      void handle('agent', { docId, sessionId, sentences, intervalMs, marker: 'DETACHED', note: 'main was absent' }).then((r) => out(`agent done ${JSON.stringify(r)}`));
    }
  };

  let client: Socket | null = null;
  const server = createServer((socket) => {
    if (client) {
      socket.end(`${JSON.stringify({ t: 'refuse', reason: 'busy' })}\n`);
      return;
    }
    let welcomed = false;
    let channels: HostDocChannels | null = null;
    const write = (message: unknown) => socket.write(`${JSON.stringify(message)}\n`);
    const splitter = splitRecords({
      line: (text) => {
        let message: { t: string; id?: number; name?: string; input?: Input; protocol?: number; token?: string };
        try {
          message = JSON.parse(text);
        } catch {
          return void socket.destroy();
        }
        if (!welcomed) {
          // the handshake stays JSON lines; protocol 2 is the first that may carry doc frames
          if (message.t !== 'hello' || message.token !== token || message.protocol !== 2) {
            write({ t: 'refuse', reason: message.token !== token ? 'token' : 'protocol' });
            return void socket.end();
          }
          welcomed = true;
          client = socket;
          channels = new HostDocChannels(socket, service, (name, input) => write({ t: 'evt', name, input }));
          write({ t: 'welcome', protocol: 2, pid: process.pid });
          out('client welcomed');
          return;
        }
        if (message.t !== 'req') return;
        const { id, name, input = {} } = message;
        if (name === 'documents.open') return void channels!.open(Number(input.channel), String(input.docId), input.actor as Actor);
        if (name === 'documents.close') return void channels!.end(Number(input.channel), 'client');
        if (name === 'exit') {
          write({ t: 'res', id, ok: true });
          service.close();
          storage.close();
          return void setTimeout(() => process.exit(0), 50);
        }
        handle(String(name), input).then(
          (value) => write({ t: 'res', id, ok: true, value }),
          (error) => write({ t: 'res', id, ok: false, error: String(error?.stack ?? error) }),
        );
      },
      doc: (channel, frame) => {
        if (welcomed) channels!.deliver(channel, frame);
        else socket.destroy();
      },
      overflow: (why) => {
        out(`closed the client: ${why}`);
        socket.destroy();
      },
    });
    socket.on('data', (chunk) => splitter.push(chunk));
    socket.on('error', () => {});
    socket.on('close', () => {
      channels?.endAll();
      if (client === socket) client = null;
      out('client left');
    });
  });
  void boot().then(() =>
    server.listen(socketPath, () => {
      out(`listening on ${socketPath}`);
    }),
  );
} else {
  throw new Error('run as a utility process or with --detached <dir>');
}
