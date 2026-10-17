// `deployment counts`: the per-writer comparison of a project's log that the composite's Parent-Level Acceptance 10
// asks for ("the counts of events per writer agree between each machine's log files and the hub after reconnection").
//
// Read-only, so unlike the proof commands it runs against the owner's org: it opens the project's socket as the person
// whose Access token it is given, resumes the log from offset 0 until `caught-up` (following `more` pages), and sends
// nothing else — no `visibility`, `human`, `rpc`, or `subscribe` — then closes. It keeps every `log` frame and the
// audit record's latest rows, which the hub replays after `caught-up` (up to 100: `decided`, `rejected`, `refused`).
//
// Per writer it reports the count, the last seq, the seqs missing below it, the seqs held twice, and a fingerprint
// (SHA-256 over `<seq>\t<kind>\t<ts>\n` in seq order), the same as `machine-counts.py` computes from a machine's log
// files. Given those files (`--machine`, one per machine), it compares each machine with the hub writer by writer and
// names the differences that are refusals, not losses: a position a daemon refused (the audit's `rejected`, DX2, or the
// machine's own `spent` list) and a writer the hub never held because it is not under the machine's enrolled name (a
// former name's, DX2 `writer-not-yours`).
//
// stdin or the environment: DESK_ACCESS_TOKEN (`cloudflared access token -app=https://<host>`).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { writerMachine } from '../src/protocol/log';
import { readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { Person, sleep } from './hub';

export type WriterCounts = { count: number; last: number; holes: number[]; repeats: number[]; fingerprint: string };

/** One side's view of a project's log: the hub's (`side` "hub") or a machine's (`side` its name, from machine-counts.py). */
export type Snapshot = {
  v: 1;
  side: string;
  project: string;
  at: string;
  /** The machine's enrolled name (a machine's snapshot), which its own writers begin with. */
  machine?: string | null;
  writers: Record<string, WriterCounts>;
  /** The hub's: the audit rows it replayed after `caught-up`, newest last. */
  audit?: AuditRow[];
  /** A machine's: the positions it refused on import and skipped past (its uplink.json's `spent`). */
  spent?: Record<string, number[]>;
  /** The hub's: `X-Desk-Build` of the deployment that answered. */
  build?: string | null;
};

export type AuditRow = { kind: 'decided' | 'rejected' | 'refused'; entry: Record<string, unknown> };

export type Verdict = 'agrees' | 'explained' | 'differs';
export type Finding = { writer: string; machine: string; verdict: Verdict; hub: string; there: string; detail: string };

type Countable = { writer?: unknown; seq?: unknown; kind?: unknown; ts?: unknown };

/** Per-writer counts of a list of events, as both sides compute them. */
export function countWriters(events: Countable[]): Record<string, WriterCounts> {
  const by = new Map<string, Array<{ seq: number; kind: string; ts: string; at: number }>>();
  events.forEach((e, at) => {
    if (typeof e.writer !== 'string' || typeof e.seq !== 'number' || !Number.isSafeInteger(e.seq)) return;
    const list = by.get(e.writer) ?? [];
    list.push({ seq: e.seq, kind: typeof e.kind === 'string' ? e.kind : '', ts: typeof e.ts === 'string' ? e.ts : '', at });
    by.set(e.writer, list);
  });
  const out: Record<string, WriterCounts> = {};
  for (const writer of [...by.keys()].sort()) {
    const list = by.get(writer)!.sort((a, b) => a.seq - b.seq || a.at - b.at);
    const seen = new Map<number, number>();
    for (const { seq } of list) seen.set(seq, (seen.get(seq) ?? 0) + 1);
    const last = list.length ? list[list.length - 1].seq : 0;
    const holes: number[] = [];
    for (let seq = 1; seq <= last; seq++) if (!seen.has(seq)) holes.push(seq);
    const repeats = [...seen].filter(([, n]) => n > 1).map(([seq]) => seq);
    const hash = createHash('sha256');
    for (const { seq, kind, ts } of list) hash.update(`${seq}\t${kind}\t${ts}\n`, 'utf8');
    out[writer] = { count: list.length, last, holes, repeats, fingerprint: hash.digest('hex') };
  }
  return out;
}

const present = (c: WriterCounts | undefined): Set<number> => {
  const out = new Set<number>();
  if (!c) return out;
  const holes = new Set(c.holes);
  for (let seq = 1; seq <= c.last; seq++) if (!holes.has(seq)) out.add(seq);
  return out;
};
const show = (c: WriterCounts | undefined) => (c ? `${c.count}/${c.last}` : '-');
const ranges = (seqs: number[]) => {
  const sorted = [...seqs].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(',');
};

/** Each machine against the hub, writer by writer. */
export function compare(hub: Snapshot, machines: Snapshot[]): Finding[] {
  const refusedBy = new Map<string, Map<string, string>>();
  for (const row of hub.audit ?? []) {
    if (row.kind !== 'rejected') continue;
    const { machine, event, reason } = row.entry as { machine?: unknown; event?: { writer?: unknown; seq?: unknown } | null; reason?: unknown };
    if (typeof machine !== 'string' || !event || typeof event.writer !== 'string' || typeof event.seq !== 'number') continue;
    const mine = refusedBy.get(machine) ?? new Map<string, string>();
    mine.set(`${event.writer}\t${event.seq}`, String(reason));
    refusedBy.set(machine, mine);
  }
  const findings: Finding[] = [];
  for (const m of machines) {
    const name = m.machine ?? m.side;
    const refused = new Map(refusedBy.get(name) ?? []);
    for (const [writer, seqs] of Object.entries(m.spent ?? {})) for (const seq of seqs) if (!refused.has(`${writer}\t${seq}`)) refused.set(`${writer}\t${seq}`, 'spent there');
    const writers = [...new Set([...Object.keys(hub.writers), ...Object.keys(m.writers)])].sort();
    for (const writer of writers) {
      const h = hub.writers[writer];
      const t = m.writers[writer];
      const finding = (verdict: Verdict, detail: string) => findings.push({ writer, machine: m.side, verdict, hub: show(h), there: show(t), detail });
      if (h && t && h.count === t.count && h.last === t.last && h.fingerprint === t.fingerprint && t.repeats.length === 0) {
        finding('agrees', '');
        continue;
      }
      if (t?.repeats.length) {
        finding('differs', `held twice there: ${ranges(t.repeats)}`);
        continue;
      }
      if (!h) {
        const owner = writerMachine(writer);
        if (m.machine && owner !== null && owner !== m.machine) finding('explained', `local only: not under ${m.machine}/, so the hub never takes it (a former name's writer)`);
        else finding('differs', 'held there, not at the hub');
        continue;
      }
      const atHub = present(h);
      const there = present(t);
      const missing = [...atHub].filter((seq) => !there.has(seq));
      const extra = [...there].filter((seq) => !atHub.has(seq));
      if (extra.length) {
        finding('differs', `there, not at the hub: ${ranges(extra)}`);
        continue;
      }
      if (missing.length === 0) {
        finding('differs', 'the same positions, different events (seq, kind, or ts)');
        continue;
      }
      const unexplained = missing.filter((seq) => !refused.has(`${writer}\t${seq}`));
      if (unexplained.length === 0) {
        const reasons = [...new Set(missing.map((seq) => refused.get(`${writer}\t${seq}`)))].join(', ');
        finding('explained', `refused there (${reasons}): ${ranges(missing)}`);
      } else {
        finding('differs', `at the hub, not there: ${ranges(unexplained)}${unexplained.length < missing.length ? ` (and refused there: ${ranges(missing.filter((s) => refused.has(`${writer}\t${s}`)))})` : ''}`);
      }
    }
  }
  return findings;
}

/** The hub's log of one project and its replayed audit rows, read through a project socket. */
export async function readHub(person: Person, project: string, settleMs = 1500): Promise<Snapshot> {
  const me = await person.fetch('/api/me');
  if (me.status !== 200) throw new Error(`/api/me: ${me.status} ${(await me.text()).slice(0, 200)}`);
  const build = me.headers.get('X-Desk-Build');
  await me.body?.cancel();
  const socket = await person.socket(`/api/projects/${project}/socket`);
  try {
    socket.send({ t: 'resume', after: 0 });
    await socket.next((f) => f.t === 'caught-up', 'caught-up', 120_000);
    // The audit rows follow `caught-up` at once; live events may follow too, and are the hub's log as much.
    await sleep(settleMs);
  } finally {
    socket.close();
  }
  const events = new Map<number, Countable>();
  const audit: AuditRow[] = [];
  for (const { frame } of socket.frames) {
    if (frame.t === 'log') for (const { offset, event } of frame.events as Array<{ offset: number; event: Countable }>) events.set(offset, event);
    else if (frame.t === 'decided') audit.push({ kind: 'decided', entry: frame.decision as Record<string, unknown> });
    else if (frame.t === 'rejected') audit.push({ kind: 'rejected', entry: frame.rejection as Record<string, unknown> });
    else if (frame.t === 'refused') audit.push({ kind: 'refused', entry: frame.refusal as Record<string, unknown> });
  }
  const ordered = [...events].sort(([a], [b]) => a - b).map(([, e]) => e);
  return { v: 1, side: 'hub', project, at: new Date().toISOString(), writers: countWriters(ordered), audit, build };
}

const USAGE = `usage: deployment counts --project <id> [--machine <file>]... [--audit] [--json] [--hub <url>]
  --machine <file>   machine-counts.py's output for one machine; repeat for each
  --audit            also print the audit rows the hub replayed (decided, rejected, refused)
  --json             print the hub's snapshot as JSON (with its audit rows) instead of the table
  --hub <url>        the hub (default: config.json's host)
stdin or environment: DESK_ACCESS_TOKEN=<cloudflared access token -app=<hub>>`;

export async function main(argv: string[], person?: Person): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        config: { type: 'string', default: join(process.env.DESK_HUB_APP!, 'deploy', 'config.json') },
        project: { type: 'string' },
        machine: { type: 'string', multiple: true, default: [] },
        audit: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        hub: { type: 'string' },
      },
    }));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (!values.project || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(values.project)) {
    console.error(`--project <the .smns project id> is required\n${USAGE}`);
    return 2;
  }
  let machines: Snapshot[];
  try {
    machines = values.machine!.map((path) => JSON.parse(readFileSync(path, 'utf8')) as Snapshot);
  } catch (error) {
    console.error(`reading --machine: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  for (const m of machines) {
    if (m.project !== values.project) {
      console.error(`${m.side}'s snapshot is of project ${m.project}, not ${values.project}`);
      return 2;
    }
  }
  if (!person) {
    const secrets = await readSecrets();
    if (!secrets.DESK_ACCESS_TOKEN) {
      console.error(`DESK_ACCESS_TOKEN on stdin or in the environment\n${USAGE}`);
      return 2;
    }
    person = new Person(values.hub ?? `https://${readDeployConfig(values.config!).host}`, secrets.DESK_ACCESS_TOKEN);
  }
  const hub = await readHub(person, values.project);
  if (values.json) {
    console.log(JSON.stringify(hub, null, 2));
    return 0;
  }
  const total = Object.values(hub.writers).reduce((n, c) => n + c.count, 0);
  console.log(`hub ${person.hub} (${hub.build ?? 'build unknown'}), project ${values.project}, at ${hub.at}: ${Object.keys(hub.writers).length} writers, ${total} events`);
  for (const [writer, c] of Object.entries(hub.writers)) {
    const flags = [c.holes.length ? `missing ${ranges(c.holes)}` : '', c.repeats.length ? `held twice ${ranges(c.repeats)}` : ''].filter(Boolean).join('; ');
    console.log(`  ${writer}  ${c.count}/${c.last}${flags ? `  ${flags}` : ''}`);
  }
  for (const m of machines) {
    const own = Object.values(m.writers).reduce((n, c) => n + c.count, 0);
    console.log(`${m.side} (machine ${m.machine ?? 'not enrolled'}), read ${m.at}: ${Object.keys(m.writers).length} writers, ${own} events`);
  }
  if (values.audit) {
    console.log('audit (latest rows the hub replays):');
    for (const row of hub.audit ?? []) console.log(`  ${row.kind} ${JSON.stringify(row.entry)}`);
  }
  if (machines.length === 0) return 0;
  const findings = compare(hub, machines);
  console.log('writer  machine  hub(count/last)  machine(count/last)  verdict');
  for (const f of findings) console.log(`  ${f.writer}  ${f.machine}  ${f.hub}  ${f.there}  ${f.verdict}${f.detail ? `: ${f.detail}` : ''}`);
  const differs = findings.filter((f) => f.verdict === 'differs').length;
  const explained = findings.filter((f) => f.verdict === 'explained').length;
  console.log(differs ? `DIFFERS: ${differs} writer view(s) disagree with the hub (${explained} explained)` : `AGREE: every machine matches the hub writer by writer (${explained} explained by the audit)`);
  return differs ? 1 : 0;
}
