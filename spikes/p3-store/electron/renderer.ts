// S2 harness: a renderer replica. It receives document ports from main (through the preload, as the app's renderer
// would), runs the environment-agnostic provider on a DOM MessagePort, and answers main's measurement commands.
import * as Y from 'yjs';
import { PortProvider, type PortLike, type SaveState } from '../s2/src/provider/port';
import { digest, newParagraph, now } from './doc-model';

interface Harness {
  report(message: unknown): void;
  onCommand(listener: (command: { id: number; name: string; input: Record<string, unknown> }) => void): void;
}
const harness = (window as unknown as { harness: Harness }).harness;
const role = new URLSearchParams(location.search).get('role') ?? '?';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let doc: Y.Doc;
let provider: PortProvider;
let localTotal = 0; // local updates since this doc was made
let ackTimes: number[] = []; // per local update index: when it became durable
let phases: { phase: string; synced: boolean; unsaved: number; t: number }[] = [];
let connects: { tMain: number; tPort: number; tSynced: number | null }[] = [];
let watch: { client: number; last: number; seen: [number, number][] } | null = null;

function fresh(): void {
  provider?.destroy();
  doc = new Y.Doc();
  localTotal = 0;
  ackTimes = [];
  phases = [];
  connects = [];
  doc.on('update', (_u: Uint8Array, origin: unknown) => {
    if (origin !== provider) localTotal += 1;
    if (watch) {
      const clock = Y.getState(doc.store, watch.client);
      if (clock > watch.last) {
        watch.last = clock;
        watch.seen.push([clock, now()]);
      }
    }
  });
  provider = new PortProvider(doc, { log: (line) => harness.report({ t: 'log', role, line }) });
  let last = '';
  provider.subscribe((s: SaveState) => {
    const durable = localTotal - s.unsaved;
    while (ackTimes.length < durable) ackTimes.push(now());
    const key = `${s.phase}/${s.synced}`;
    if (key !== last) {
      last = key;
      phases.push({ phase: s.phase, synced: s.synced, unsaved: s.unsaved, t: now() });
      const c = connects[connects.length - 1];
      if (s.synced && c && c.tSynced === null) {
        c.tSynced = now();
        harness.report({ t: 'synced', role, ...c });
      }
    }
  });
}
fresh();

const fuzzCases = (i: number): unknown[] => {
  const rand = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));
  switch (i % 6) {
    case 0: return [rand(1 + Math.floor(Math.random() * 40))];
    case 1: return [Uint8Array.from([0, 2, 0xff, 0xff, 0xff, 0xff, 0x0f])];
    case 2: return ['a string'];
    case 3: return [rand(32).buffer];
    case 4: return [{ t: 'req' }];
    default: return [Uint8Array.from([0, 1, 5, 1, 2, 3, 4, 5]), rand(9)];
  }
};

window.addEventListener('message', (event) => {
  const data = event.data as { s2?: string; tMain?: number; fuzz?: number } | null;
  if (data?.s2 !== 'doc-port') return;
  const port = event.ports[0];
  if (data.fuzz !== undefined) {
    port.start();
    for (const m of fuzzCases(data.fuzz)) port.postMessage(m);
    return;
  }
  connects.push({ tMain: data.tMain ?? 0, tPort: now(), tSynced: null });
  provider.connect(port as unknown as PortLike);
});

async function type(input: Record<string, unknown>) {
  const count = Number(input.count);
  const [minMs, maxMs] = [Number(input.minMs ?? 0), Number(input.maxMs ?? 0)];
  const flood = input.flood === true;
  const until = input.untilMs ? now() + Number(input.untilMs) : Infinity;
  const marker = String(input.marker ?? role);
  const text = newParagraph(doc);
  text.insert(0, `${marker}:`);
  const keys: { t0: number; local: number; clock: number }[] = [];
  for (let i = 0; i < count && now() < until; i++) {
    const t0 = now();
    text.insert(text.length, String.fromCharCode(97 + (i % 26)));
    keys.push({ t0, local: localTotal - 1, clock: Y.getState(doc.store, doc.clientID) });
    if (!flood) await sleep(minMs + Math.random() * (maxMs - minMs));
  }
  const deadline = now() + Number(input.ackWaitMs ?? 15000);
  while (provider.state.unsaved > 0 && now() < deadline) await sleep(20);
  return { clientId: doc.clientID, keys: keys.map((k) => ({ ...k, tAck: ackTimes[k.local] ?? null })), state: provider.state };
}

harness.onCommand(async ({ id, name, input }) => {
  try {
    let value: unknown;
    switch (name) {
      case 'reset':
        fresh();
        value = true;
        break;
      case 'type':
        value = await type(input);
        break;
      case 'watch':
        watch = { client: Number(input.client), last: Y.getState(doc.store, Number(input.client)), seen: [] };
        value = true;
        break;
      case 'watched':
        value = watch?.seen ?? [];
        break;
      case 'digest':
        value = { digest: digest(doc), sv: [...Y.decodeStateVector(Y.encodeStateVector(doc))], state: provider.state, clientId: doc.clientID, phases, connects };
        break;
      case 'memory':
        value = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory ?? null;
        if (value) value = { usedJSHeapSize: (value as { usedJSHeapSize: number }).usedJSHeapSize, totalJSHeapSize: (value as { totalJSHeapSize: number }).totalJSHeapSize };
        break;
      default:
        throw new Error(`unknown ${name}`);
    }
    harness.report({ t: 'res', id, ok: true, value });
  } catch (error) {
    harness.report({ t: 'res', id, ok: false, error: String((error as Error)?.stack ?? error) });
  }
});
harness.report({ t: 'ready', role });
