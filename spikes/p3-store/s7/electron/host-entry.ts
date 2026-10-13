// S7b harness: the engine host stand-in as a utility process (adapted from S2's spikes/p3-store/electron/host-entry.ts,
// utility mode only). It runs S2's v14 document service, SQLite storage (fullfsync on) and agent replicas in place
// (s2/v14/host/*), plus what S7 needs: agents that edit continuously at agent pace through the v14 writer (doc.ts),
// the history payload (a version state, the live state, the merged provenance), unload with GC for memory, and the
// deck import and republish through S6's publish (s6/src/publish.ts) on an agent replica.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import * as Y from '@y/y';
import * as awarenessProtocol from '@y/protocols/awareness';
import { AgentReplica } from '../../s2/v14/host/agent-replica';
import { DocumentService } from '../../s2/v14/host/document-service';
import { fromMessagePortMain, type MessagePortMainLike } from '../../s2/src/host/ports';
import { actorKey, SqliteDocumentStorage, type Actor } from '../../s2/v14/host/storage';
import { publish } from '../../s6/src/publish.ts';
import { agentBatch, body, findBlock, hasBody, idOf, prng, sentence, textBlocks } from './doc';
import { extensions, schemaFor } from './schema.mjs';
import { PatchWriter, type Op } from './writer/patch-writer.ts';
import { DocMarkdown } from './writer/markdown.ts';

const userData = process.env.S7_USER_DATA;
if (!userData) throw new Error('S7_USER_DATA is required');
const fullfsync = process.env.S7_FULLFSYNC !== '0';
mkdirSync(join(userData, 'artifacts'), { recursive: true });
const dbPath = join(userData, 'artifacts', 'store.sqlite');
const storage = new SqliteDocumentStorage(dbPath, { fullfsync });
const service = new DocumentService(storage, { log: (line) => emit({ t: 'host-log', line }) });
const schema = schemaFor({});
const exts = extensions();
const md = new DocMarkdown(schema, exts);
// S4's patch writer (copied, with S7b's `validate` option) per validation mode, bound to S3's nested prose root
const writers = { document: new PatchWriter({ schema, md, rootOf: body, validate: 'document' }), touched: new PatchWriter({ schema, md, rootOf: body, validate: 'touched' }) };
const size = (path: string) => (existsSync(path) ? statSync(path).size : 0);
const mem = () => {
  const m = process.memoryUsage();
  return { heapUsedMB: +(m.heapUsed / 1e6).toFixed(1), heapTotalMB: +(m.heapTotal / 1e6).toFixed(1), externalMB: +(m.external / 1e6).toFixed(1), arrayBuffersMB: +(m.arrayBuffers / 1e6).toFixed(1), rssMB: +(m.rss / 1e6).toFixed(1) };
};
// --expose-gc on utilityProcess.fork's execArgv does not reach V8 here: expose it through the flag API instead
setFlagsFromString('--expose-gc');
const gcFn = (globalThis as unknown as { gc?: () => void }).gc ?? (runInNewContext('gc') as () => void);
const gc = () => gcFn();
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};
const digestOf = (doc: Y.Doc) => (hasBody(doc) ? fnv(body(doc).toString()) : fnv(JSON.stringify(doc.get('slides').toJSON())));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// the host's event-loop delay: what engine supervision (stream-json, MCP, IPC on the same loop) would wait behind
const loopDelay = monitorEventLoopDelay({ resolution: 5 });
loopDelay.enable();
const loopRead = () => ({ p50: +(loopDelay.percentile(50) / 1e6).toFixed(1), p99: +(loopDelay.percentile(99) / 1e6).toFixed(1), max: +(loopDelay.max / 1e6).toFixed(1), n: loopDelay.count });
// which docs the GC actually collected (unload's question: does anything retain a dropped doc?)
const collected: string[] = [];
const finals = new FinalizationRegistry<string>((label) => collected.push(label));
const tracked = new WeakSet<object>();
const track = (o: object, label: string) => {
  if (tracked.has(o)) return;
  tracked.add(o);
  finals.register(o, label);
};

type Input = Record<string, unknown>;
const parentPort = (process as unknown as { parentPort: { on(e: 'message', l: (e: { data: Input & { id: number; name: string }; ports: MessagePortMainLike[] }) => void): void; postMessage(m: unknown): void } }).parentPort;
const emit = (event: Record<string, unknown>) => parentPort.postMessage({ id: -1, event });

// ---- agents at agent pace -------------------------------------------------------------------------------------------
interface Agent {
  sessionId: string;
  docId: string;
  replica: AgentReplica;
  running: boolean;
  loop: Promise<void> | null;
  target: string | null;
  avoid: Set<string>;
  intervalMs: [number, number];
  batches: { ops: string[]; saveMs: number; applyMs: number; bytes: number; cloneMs?: number; validateMs?: number; size?: number }[];
  seq: { n: number; mine: string[] };
  writer: 'document' | 'touched' | null;
}
const agents = new Map<string, Agent>();

async function agentOf(docId: string, sessionId: string): Promise<Agent> {
  const key = `${docId}/${sessionId}`;
  let a = agents.get(key);
  if (!a) {
    const replica = new AgentReplica(service, docId, { kind: 'session', appSessionId: sessionId });
    await replica.whenSynced();
    replica.provider.awareness.setLocalStateField('user', { name: `Claude ${sessionId}`, color: '#c2410c' });
    track(replica.doc, `agent replica ${sessionId}`);
    a = { sessionId, docId, replica, running: false, loop: null, target: null, avoid: new Set(), intervalMs: [800, 1600], batches: [], seq: { n: 0, mine: [] }, writer: null };
    agents.set(key, a);
  }
  return a;
}

function avoidSet(doc: Y.Doc, prefixes: string[]): Set<string> {
  const out = new Set<string>();
  if (prefixes.length === 0) return out;
  const walk = (n: Y.Node) => {
    for (const c of n.toArray() as unknown[]) {
      if (!(c instanceof Y.Node)) continue;
      const id = idOf(c);
      if (id && prefixes.some((p) => id.startsWith(p))) out.add(id);
      walk(c);
    }
  };
  walk(body(doc));
  return out;
}

// The patch writer's ops for one batch: alternately one replace_text, and five ops (two replace_text, a replace_block,
// an insert after a heading, a set_cell; a delete of an earlier insert once there are a few), on top-level paragraphs.
function writerOps(a: Agent, r: () => number): Op[] {
  const root = body(a.replica.doc);
  const paras = (root.toArray() as unknown[]).filter((c): c is Y.Node => c instanceof Y.Node && c.name === 'paragraph' && /^s\d+p[245]$/.test(idOf(c) ?? '') && !a.avoid.has(idOf(c)!));
  const pick = () => paras[Math.floor(r() * paras.length)];
  const phrase = (p: Y.Node): { block: string; old: string } => {
    const words = (p.toArray() as unknown[]).filter((x) => typeof x === 'string').join('').split(' ');
    for (let tries = 0; tries < 20; tries++) {
      const i = Math.floor(words.length / 2) + Math.floor(r() * Math.max(1, words.length / 2 - 4));
      const old = words.slice(i, i + 3).join(' ');
      if (/^[A-Za-z ]+$/.test(old) && old.split(' ').length === 3) return { block: idOf(p)!, old };
    }
    return { block: idOf(p)!, old: words.slice(2, 5).join(' ') };
  };
  const tag = `${a.sessionId.toUpperCase()}${a.seq.n}`;
  const ops: Op[] = [];
  if (a.target) {
    // the same-block case for IME: a three-word replacement near the start of the human's block
    const tb = findBlock(root, a.target);
    const words = tb ? (tb.toArray() as unknown[]).filter((x) => typeof x === 'string').join('').split(' ') : [];
    const old = words.slice(1, 4).join(' ');
    if (/^[A-Za-z0-9 ]+$/.test(old) && old.split(' ').length === 3) ops.push({ op: 'replace_text', block: a.target, old, new: `${words[1]} ${tag.toLowerCase()} ${words[3]}` });
  }
  const t1 = phrase(pick());
  ops.push({ op: 'replace_text', block: t1.block, old: t1.old, new: `${t1.old.split(' ')[0]} ${tag.toLowerCase()} edit` });
  if (a.seq.n % 2 === 1) {
    let t2 = phrase(pick());
    while (t2.block === t1.block) t2 = phrase(pick());
    ops.push({ op: 'replace_text', block: t2.block, old: t2.old, new: `${t2.old} indeed` });
    let rb = pick();
    while (idOf(rb) === t1.block || idOf(rb) === t2.block) rb = pick();
    ops.push({ op: 'replace_block', id: idOf(rb)!, markdown: `${tag} rewrote this paragraph with **some bold** and a [link](https://example.com/${a.seq.n}). ${sentence(r, 30)}` });
    const sec = Math.floor(r() * 150);
    if (a.seq.mine.length >= 4) ops.push({ op: 'delete', id: a.seq.mine.shift()! });
    else ops.push({ op: 'insert', after: `s${sec}h`, markdown: `${tag} inserted a paragraph. ${sentence(r, 25)}` });
    const tsec = 1 + 3 * Math.floor(r() * 50);
    ops.push({ op: 'set_cell', table: `s${tsec}t`, row: 1 + Math.floor(r() * 3), col: Math.floor(r() * 3), markdown: `${Math.floor(r() * 10000)}` });
  }
  return ops;
}

async function runAgent(a: Agent): Promise<void> {
  const r = prng(a.sessionId.split('').reduce((n, c) => n * 31 + c.charCodeAt(0), 7) & 0x7fffffff);
  const doc = a.replica.doc;
  while (a.running) {
    let bytes = 0;
    const onUpdate = (u: Uint8Array) => (bytes += u.length);
    doc.on('update', onUpdate);
    const t0 = performance.now();
    let ids: string[];
    let ops: string[];
    let extra: { cloneMs?: number; validateMs?: number; size?: number } = {};
    if (a.writer) {
      const w = writers[a.writer];
      const batch = writerOps(a, r);
      a.seq.n += 1;
      try {
        const res = w.apply(doc, batch, { origin: 'patch-writer' });
        for (const x of res.results) for (const n of x.newIds) if (x.line.startsWith('inserted')) a.seq.mine.push(n);
        ids = res.results.map((x) => x.target);
      } catch (e) {
        emit({ t: 'writer-error', message: String((e as Error).message).slice(0, 300) });
        ids = [];
      }
      ops = batch.map((o) => o.op);
      const tm = w.timings[w.timings.length - 1];
      extra = { cloneMs: +tm.cloneMs.toFixed(2), validateMs: +tm.validateMs.reduce((x, y) => x + y, 0).toFixed(2), size: batch.length };
    } else ({ ids, ops } = agentBatch(doc, schema, r, a.sessionId.toUpperCase(), a.seq, { avoid: a.avoid, target: a.target }));
    const t1 = performance.now();
    doc.off('update', onUpdate);
    a.replica.provider.awareness.setLocalStateField('editing', { blocks: ids });
    await a.replica.whenSaved();
    const t2 = performance.now();
    a.batches.push({ ops, applyMs: +(t1 - t0).toFixed(2), saveMs: +(t2 - t1).toFixed(2), bytes, ...extra });
    emit({ t: 'agent-acked', sessionId: a.sessionId, clientId: doc.clientID, clock: doc.store.getClock(doc.clientID), at: performance.timeOrigin + performance.now() });
    const [lo, hi] = a.intervalMs;
    await sleep(lo + r() * (hi - lo));
  }
}

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100;
};

// ---- deck agents (S6's publish on an agent replica) -------------------------------------------------------------
const deckAgents = new Map<string, { running: boolean; loop: Promise<void>; publishes: { ms: number; saveMs: number; writes: number }[] }>();

async function handle(name: string, input: Input): Promise<unknown> {
  const docId = String(input.docId ?? '');
  switch (name) {
    case 'import': {
      if (storage.revision(docId) > 0) return { imported: false };
      storage.importVersion(docId, readFileSync(String(input.file)), Date.now(), { kind: 'human' });
      return { imported: true };
    }
    case 'loop.reset':
      loopDelay.reset();
      return true;
    case 'loop.read':
      return loopRead();
    case 'stats': {
      if (input.gc) {
        for (let i = 0; i < 3; i++) {
          gc();
          await sleep(50);
        }
      }
      const loaded = service.loaded(docId);
      return {
        pid: process.pid,
        fullfsync,
        mem: mem(),
        store: { db: size(dbPath), wal: size(`${dbPath}-wal`) },
        rows: storage.rowCounts(),
        revision: service.revision(docId),
        loadMs: loaded?.loadMs ?? null,
        loaded: !!loaded,
        service: { ...service.stats, rejected: service.stats.rejected.length, rejectedReasons: service.stats.rejected.slice(-5) },
        collected: [...collected],
        gcExposed: typeof (globalThis as unknown as { gc?: unknown }).gc === 'function',
      };
    }
    case 'load': {
      // the cold load alone (what open does first), timed
      const t = performance.now();
      service.open(docId);
      return { ms: performance.now() - t, loadMs: service.loaded(docId)!.loadMs };
    }
    case 'reload': {
      const fresh = new Y.Doc();
      const stored = storage.load(docId);
      const t = performance.now();
      if (stored.version) Y.applyUpdateV2(fresh, stored.version.state);
      for (const row of stored.updates) Y.applyUpdate(fresh, row.bytes);
      const ms = performance.now() - t;
      return { digest: digestOf(fresh), sv: [...Y.decodeStateVector(Y.encodeStateVector(fresh))], ms, rows: stored.updates.length, versionSeq: stored.version?.seq ?? null };
    }
    case 'live': {
      const loaded = service.loaded(docId);
      if (!loaded) return null;
      return { digest: digestOf(loaded.doc), sv: [...Y.decodeStateVector(Y.encodeStateVector(loaded.doc))] };
    }
    case 'encodings': {
      // item 8: what V1 (the wire) against V2 costs at the host for this doc's first sync
      const doc = service.open(docId).doc;
      let t = performance.now();
      const v1 = Y.encodeStateAsUpdate(doc);
      const v1Ms = performance.now() - t;
      t = performance.now();
      const v2 = Y.encodeStateAsUpdateV2(doc);
      const v2Ms = performance.now() - t;
      return { v1Bytes: v1.length, v2Bytes: v2.length, v1EncodeMs: +v1Ms.toFixed(1), v2EncodeMs: +v2Ms.toFixed(1), v1, v2 };
    }
    case 'agents.start': {
      const list = input.agents as { sessionId: string; intervalMs?: [number, number]; target?: string | null; avoidPrefixes?: string[]; writer?: 'document' | 'touched' }[];
      for (const spec of list) {
        const a = await agentOf(docId, spec.sessionId);
        a.intervalMs = spec.intervalMs ?? a.intervalMs;
        a.target = spec.target ?? null;
        a.writer = spec.writer ?? null;
        a.avoid = avoidSet(a.replica.doc, spec.avoidPrefixes ?? []);
        a.batches = [];
        if (!a.running) {
          a.running = true;
          a.loop = runAgent(a);
        }
      }
      return { started: list.map((s) => s.sessionId) };
    }
    case 'agents.retarget': {
      for (const a of agents.values()) if (a.docId === docId) a.target = (input.target as string | null) ?? null;
      return true;
    }
    case 'agents.stop': {
      const out: Record<string, unknown> = {};
      for (const a of agents.values()) {
        if (a.docId !== docId) continue;
        a.running = false;
        await a.loop;
        const save = a.batches.map((b) => b.saveMs);
        const apply = a.batches.map((b) => b.applyMs);
        const opCounts: Record<string, number> = {};
        for (const b of a.batches) for (const o of b.ops) opCounts[o] = (opCounts[o] ?? 0) + 1;
        const bySize = (n: number) => a.batches.filter((b) => b.size === n);
        const writerStats = a.writer
          ? Object.fromEntries([1, 5].map((n) => [`size${n}`, { n: bySize(n).length, applyMs: { p50: pct(bySize(n).map((b) => b.applyMs), 50), p95: pct(bySize(n).map((b) => b.applyMs), 95), max: pct(bySize(n).map((b) => b.applyMs), 100) }, cloneMs: { p50: pct(bySize(n).map((b) => b.cloneMs!), 50), max: pct(bySize(n).map((b) => b.cloneMs!), 100) }, validateMs: { p50: pct(bySize(n).map((b) => b.validateMs!), 50), p95: pct(bySize(n).map((b) => b.validateMs!), 95), max: pct(bySize(n).map((b) => b.validateMs!), 100) } }]))
          : null;
        out[a.sessionId] = { writer: a.writer, writerStats, batches: a.batches.length, ops: opCounts, applyMs: { p50: pct(apply, 50), p95: pct(apply, 95), max: pct(apply, 100) }, batchToAckMs: { p50: pct(save, 50), p95: pct(save, 95), max: pct(save, 100) }, bytes: { p50: pct(a.batches.map((b) => b.bytes), 50), max: pct(a.batches.map((b) => b.bytes), 100) } };
      }
      return out;
    }
    case 'agents.close': {
      for (const [key, a] of agents) {
        if (a.docId !== docId) continue;
        a.running = false;
        await a.loop;
        a.replica.close();
        // S2's provider.destroy leaves the awareness it created running (its check interval keeps the doc alive);
        // `input.destroyAwareness` does what P3-A's provider must: destroy the awareness it created
        if (input.destroyAwareness) a.replica.provider.awareness.destroy();
        agents.delete(key);
      }
      return true;
    }
    case 'version': {
      // an auto version now: S2's compaction (the version row, the log folded, provenance merged, never dropped)
      const t = performance.now();
      const out = service.compact(docId, { kind: 'human' });
      return { ...out, ms: performance.now() - t };
    }
    case 'history': {
      // what the renderer's history preview needs: the version state, the live state and the merged provenance
      const doc = service.open(docId).doc;
      const v = storage.query<{ seq: number; state: Uint8Array }>('SELECT seq, state FROM versions WHERE docId = ? AND seq = ?', docId, Number(input.versionSeq))[0];
      let t = performance.now();
      const nextState = Y.encodeStateAsUpdateV2(doc);
      const liveMs = performance.now() - t;
      t = performance.now();
      (storage as unknown as { merged: Map<string, unknown> }).merged.delete(docId); // time the merge, not the cache
      const attributions = Y.encodeContentMap(storage.attribution(docId));
      const provenanceMs = performance.now() - t;
      return { prevState: v.state, nextState, attributions, timings: { liveEncodeMs: +liveMs.toFixed(1), provenanceMergeMs: +provenanceMs.toFixed(1) }, bytes: { prev: v.state.length, next: nextState.length, attributions: attributions.length } };
    }
    case 'unload': {
      // S2's service has no unload: what one would recover (the doc, its awareness, its connections dropped, GC'd)
      const before = mem();
      const docs = (service as unknown as { docs: Map<string, { doc: Y.Doc; awareness: awarenessProtocol.Awareness; conns: Set<unknown> }> }).docs;
      const hostDoc = docs.get(docId);
      const conns = hostDoc?.conns.size ?? 0;
      if (hostDoc) {
        track(hostDoc.doc, 'host doc');
        hostDoc.awareness.destroy();
        hostDoc.doc.destroy();
        docs.delete(docId);
      }
      gc();
      await sleep(50);
      // measured by the next `stats {gc}` call: this function's own frame would keep `hostDoc` alive
      return { before, connsAtUnload: conns };
    }
    case 'deck.import': {
      // the deck's files published whole by an agent replica (S6's publish: one transaction), then saved
      const files = JSON.parse(readFileSync(String(input.file), 'utf8')) as Record<string, string>;
      const replica = new AgentReplica(service, docId, { kind: 'session', appSessionId: 'deck-agent' });
      await replica.whenSynced();
      const t = performance.now();
      const res = publish(replica.doc, files, { seed: 'import' });
      const publishMs = performance.now() - t;
      await replica.whenSaved();
      const savedMs = performance.now() - t;
      const state = Y.encodeStateAsUpdateV2(replica.doc);
      replica.close();
      return { publishMs: +publishMs.toFixed(1), savedMs: +savedMs.toFixed(1), writes: res.writes, v2Bytes: state.length, v1Bytes: Y.encodeStateAsUpdate(service.open(docId).doc).length };
    }
    case 'deck.agent.start': {
      // an agent republishing one slide at a time (a word changed in its title) every interval
      const files = JSON.parse(readFileSync(String(input.file), 'utf8')) as Record<string, string>;
      const replica = new AgentReplica(service, docId, { kind: 'session', appSessionId: 'deck-agent-2' });
      await replica.whenSynced();
      const state = { running: true, loop: Promise.resolve(), publishes: [] as { ms: number; saveMs: number; writes: number }[] };
      const slides = Object.keys(files).filter((k) => k.includes('/slides/'));
      const interval = Number(input.intervalMs ?? 1000);
      state.loop = (async () => {
        let n = 0;
        while (state.running) {
          const path = slides[(n * 7) % slides.length];
          const src = files[path].replace(/(<h[12][^>]*>)([^<]*)/, `$1Republished ${n} $2`);
          const t = performance.now();
          const res = publish(replica.doc, { [path]: src }, { seed: `rp${n}` });
          const t1 = performance.now();
          await replica.whenSaved();
          state.publishes.push({ ms: +(t1 - t).toFixed(2), saveMs: +(performance.now() - t1).toFixed(2), writes: res.writes });
          n += 1;
          await sleep(interval);
        }
        replica.close();
      })();
      deckAgents.set(docId, state);
      return true;
    }
    case 'deck.agent.stop': {
      const s = deckAgents.get(docId);
      if (!s) return null;
      s.running = false;
      await s.loop;
      deckAgents.delete(docId);
      return { publishes: s.publishes.length, publishMs: { p50: pct(s.publishes.map((p) => p.ms), 50), max: pct(s.publishes.map((p) => p.ms), 100) }, saveMs: { p50: pct(s.publishes.map((p) => p.saveMs), 50), max: pct(s.publishes.map((p) => p.saveMs), 100) } };
    }
    case 'textBlocks': {
      // ids of the body's text blocks in order (main picks the human's target from these)
      const doc = service.open(docId).doc;
      return textBlocks(body(doc)).map((b) => idOf(b));
    }
    default:
      throw new Error(`unknown command ${name}`);
  }
}

parentPort.on('message', ({ data, ports }) => {
  const { id, name } = data;
  if (name === 'open') {
    const t = performance.now();
    const conn = service.attach(String(data.docId), fromMessagePortMain(ports[0]), data.actor as Actor);
    parentPort.postMessage({ id, ok: true, value: { conn: conn.id, revision: service.revision(String(data.docId)), loadMs: service.loaded(String(data.docId))?.loadMs, attachMs: performance.now() - t } });
    return;
  }
  handle(name, data).then(
    (value) => parentPort.postMessage({ id, ok: true, value }),
    (error) => parentPort.postMessage({ id, ok: false, error: String(error?.stack ?? error) }),
  );
});
parentPort.postMessage({ id: 0, ok: true, value: { started: process.pid, actor: actorKey({ kind: 'human' }) } });
