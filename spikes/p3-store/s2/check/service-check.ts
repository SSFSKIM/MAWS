// S2: the document service, the provider and the store in one Node process (no Electron): convergence, actors per
// row, awareness, provenance across compaction, restart from the store, offline edits re-sent on reconnect, the
// handshake rule, and malformed frames. Prints one JSON summary; exits 1 on a failed check.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import * as Y from 'yjs';
import { encodeFrame } from '../src/frames';
import { AgentReplica } from '../src/host/agent-replica';
import { DocumentService } from '../src/host/document-service';
import { fromNodePort } from '../src/host/ports';
import { actorKey, SqliteDocumentStorage, type Actor } from '../src/host/storage';
import { PortProvider, type PortLike, type SaveState } from '../src/provider/port';
import { idAt } from '../src/yjs-seam';

const HUMAN: Actor = { kind: 'human' };
const AGENT: Actor = { kind: 'session', appSessionId: 's1' };
const DOC = 'doc-1';
const results: Record<string, unknown> = {};
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  results[name] = detail === undefined ? ok : { ok, detail };
  if (!ok) failed += 1;
};
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const until = (p: PortProvider, test: (s: SaveState) => boolean) =>
  new Promise<void>((resolve) => {
    if (test(p.state)) return resolve();
    const off = p.subscribe((s) => {
      if (test(s)) {
        off();
        resolve();
      }
    });
  });
const saved = (p: PortProvider) => until(p, (s) => s.phase === 'live' && s.synced && s.unsaved === 0);

const dir = mkdtempSync(join(tmpdir(), 'p3-s2-check-'));
const dbPath = join(dir, 'store.sqlite');
let storage = new SqliteDocumentStorage(dbPath);
let service = new DocumentService(storage, { log: () => {} });

function replica(svc: DocumentService, actor: Actor, doc = new Y.Doc()) {
  const { port1, port2 } = new MessageChannel();
  svc.attach(DOC, fromNodePort(port1), actor);
  const provider = new PortProvider(doc, { log: () => {} });
  provider.connect(port2 as unknown as PortLike);
  return { doc, provider, text: doc.getText('t') };
}
const reconnect = (svc: DocumentService, r: ReturnType<typeof replica>, actor: Actor) => {
  const { port1, port2 } = new MessageChannel();
  svc.attach(DOC, fromNodePort(port1), actor);
  r.provider.connect(port2 as unknown as PortLike);
};
const hostText = () => service.loaded(DOC)!.doc.getText('t').toString();

// 1. convergence and actors
const A = replica(service, HUMAN);
const B = replica(service, HUMAN);
const agent = new AgentReplica(service, DOC, AGENT);
await Promise.all([saved(A.provider), saved(B.provider), agent.whenSynced()]);
agent.doc.getText('t').insert(0, '[agent wrote this] ');
const agentRevision = await agent.whenSaved();
for (let i = 0; i < 50; i++) {
  A.text.insert(A.text.length, 'a');
  B.text.insert(0, 'b');
  if (i % 10 === 0) await tick(1);
}
await Promise.all([saved(A.provider), saved(B.provider)]);
await tick(20);
const texts = [A.text.toString(), B.text.toString(), agent.doc.getText('t').toString(), hostText()];
check('converged', new Set(texts).size === 1, { length: texts[0].length, agentRevision });
const byActor = storage.query<{ actor: string; n: number }>('SELECT actor, COUNT(*) AS n FROM updates GROUP BY actor');
check('rows carry the actor', byActor.some((r) => r.actor === 'human' && r.n >= 100) && byActor.some((r) => r.actor === actorKey(AGENT) && r.n === 1), byActor);

// 2. awareness crosses and is removed with its connection
A.provider.awareness.setLocalStateField('user', { name: 'owner', cursor: 3 });
await tick(30);
const bSeesA = [...B.provider.awareness.getStates().values()].some((s) => (s as { user?: { name: string } }).user?.name === 'owner');
const agentSeesA = [...agent.provider.awareness.getStates().values()].some((s) => (s as { user?: { name: string } }).user?.name === 'owner');
A.provider.disconnect();
await tick(30);
const bLostA = ![...B.provider.awareness.getStates().values()].some((s) => (s as { user?: { name: string } }).user?.name === 'owner');
check('awareness crosses, and leaves with its connection', bSeesA && agentSeesA && bLostA, { bSeesA, agentSeesA, bLostA });

// 3. offline edits are carried and re-sent; the handshake rule (type before the host's step 1 arrives)
for (let i = 0; i < 20; i++) A.text.insert(A.text.length, 'Q');
check('offline edits are unsaved', A.provider.state.unsaved === 20, A.provider.state);
reconnect(service, A, HUMAN);
for (let i = 0; i < 5; i++) A.text.insert(A.text.length, 'h'); // during the handshake
await saved(A.provider);
await tick(20);
check('offline and handshake edits reached the host', hostText() === A.text.toString() && B.text.toString() === A.text.toString() && service.stats.rejected.length === 0, {
  rejected: service.stats.rejected,
  revision: A.provider.state.revision,
});

// 4. provenance survives compaction and restart
const agentId = idAt(service.loaded(DOC)!.doc.getText('t'), hostText().indexOf('[agent'));
const humanId = idAt(service.loaded(DOC)!.doc.getText('t'), hostText().indexOf('Q'));
B.text.delete(0, 3); // a deletion by B (human) of B's own text
await saved(B.provider);
const deletedId = { client: B.doc.clientID, clock: 49 }; // B's last 'b' insert sits at index 0
const before = { agent: storage.whoInserted(DOC, agentId!.client, agentId!.clock)?.actor, human: storage.whoInserted(DOC, humanId!.client, humanId!.clock)?.actor };
const rowsBefore = storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM updates')[0].n;
const compacted = service.compact(DOC, HUMAN);
const rowsAfter = storage.query<{ n: number }>('SELECT COUNT(*) AS n FROM updates')[0].n;
const after = { agent: storage.whoInserted(DOC, agentId!.client, agentId!.clock)?.actor, human: storage.whoInserted(DOC, humanId!.client, humanId!.clock)?.actor, deletedBy: storage.whoDeleted(DOC, deletedId.client, deletedId.clock).map((r) => r.actor) };
check('who wrote it, before and after compaction', before.agent === 'session:s1' && before.human === 'human' && after.agent === 'session:s1' && after.human === 'human' && after.deletedBy[0] === 'human' && rowsAfter === 0, { before, after, rowsBefore, rowsAfter, compacted });
A.text.insert(0, 'post-compaction ');
await saved(A.provider);
await tick(10);
const liveText = hostText();
service.close();
storage.close();
storage = new SqliteDocumentStorage(dbPath);
service = new DocumentService(storage, { log: () => {} });
service.open(DOC);
check('restart from version + log equals the live doc', hostText() === liveText, { length: liveText.length, revision: service.revision(DOC) });

// 5. malformed frames from an untrusted replica
const A2 = replica(service, HUMAN, A.doc); // A's doc again, on the restarted host
A.provider.destroy();
const B2 = replica(service, HUMAN, B.doc);
await Promise.all([saved(A2.provider), saved(B2.provider)]);
const validUpdate = (() => {
  const d = new Y.Doc();
  Y.applyUpdate(d, Y.encodeStateAsUpdate(A2.doc));
  const sv = Y.encodeStateVector(d);
  d.getText('t').insert(3, 'XYZ');
  return Y.encodeStateAsUpdate(d, sv);
})();
const rand = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));
const cases: { name: string; data: unknown }[] = [];
for (let i = 0; i < 200; i++) cases.push({ name: 'random', data: rand(1 + Math.floor(Math.random() * 64)) });
const valid = encodeFrame({ type: 'update', update: validUpdate });
for (let i = 1; i < valid.length; i += Math.max(1, Math.floor(valid.length / 30))) cases.push({ name: 'truncated', data: valid.slice(0, i) });
for (let i = 0; i < 500; i++) {
  const m = valid.slice();
  const k = 1 + Math.floor(Math.random() * 3);
  for (let j = 0; j < k; j++) m[2 + Math.floor(Math.random() * (m.length - 2))] = Math.floor(Math.random() * 256);
  cases.push({ name: 'mutated', data: m });
}
const gapDoc = new Y.Doc();
gapDoc.getText('t').insert(0, 'x');
const gapSv = Y.encodeStateVector(gapDoc);
gapDoc.getText('t').insert(1, 'y');
cases.push({ name: 'gap', data: encodeFrame({ type: 'update', update: Y.encodeStateAsUpdate(gapDoc, gapSv) }) });
cases.push({ name: 'ack from replica', data: encodeFrame({ type: 'ack', frames: 1, revision: 1 }) });
cases.push({ name: 'string', data: 'hello' });
cases.push({ name: 'object', data: { t: 1 } });
cases.push({ name: 'huge length', data: Uint8Array.from([0, 2, 0xff, 0xff, 0xff, 0xff, 0x0f]) });
const outcomes: Record<string, { accepted: number; rejected: number }> = {};
for (const c of cases) {
  const { port1, port2 } = new MessageChannel();
  const before = service.stats.rejected.length;
  service.attach(DOC, fromNodePort(port1), HUMAN);
  port2.postMessage(c.data);
  await tick(1);
  const o = (outcomes[c.name] ??= { accepted: 0, rejected: 0 });
  if (service.stats.rejected.length > before) o.rejected += 1;
  else o.accepted += 1;
  port2.close();
}
await tick(30);
const evictions = service.stats.rejected.filter((r) => r.conn === 0).length;
for (const r of [A2, B2]) if (r.provider.state.phase === 'off') reconnect(service, r, HUMAN); // an eviction closed them
A2.text.insert(0, 'still alive ');
await Promise.all([saved(A2.provider), saved(B2.provider)]);
await tick(30);
const live = hostText();
const fresh = new Y.Doc();
const stored = storage.load(DOC);
if (stored.version) Y.applyUpdateV2(fresh, stored.version.state);
for (const r of stored.updates) Y.applyUpdate(fresh, r.bytes);
const roundTrip = new Y.Doc();
Y.applyUpdate(roundTrip, Y.encodeStateAsUpdate(service.loaded(DOC)!.doc));
check('malformed frames: the host lives, replicas converge, the store equals the live doc', live === A2.text.toString() && live === B2.text.toString() && fresh.getText('t').toString() === live && roundTrip.getText('t').toString() === live, {
  outcomes,
  evictions,
  liveStartsWith: live.slice(0, 40),
  pendingStructs: service.loaded(DOC)!.doc.store.pendingStructs !== null,
  pendingDs: service.loaded(DOC)!.doc.store.pendingDs !== null,
  sampleReasons: [...new Set(service.stats.rejected.map((r) => r.reason.replace(/\d+/g, 'N')))].slice(0, 12),
});

console.log(JSON.stringify({ failed, results }, null, 2));
process.exit(failed ? 1 : 0);
