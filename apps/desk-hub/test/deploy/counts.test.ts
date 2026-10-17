// `deployment counts` (deploy/counts.ts) and its machine half (deploy/machine-counts.py): the per-writer comparison
// of Parent-Level Acceptance 10. The hub half reads only (a resume from offset 0), the two halves count alike, and the
// comparison names what the audit explains. Run against the local hub only: never the deployment.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeMachine } from '../../fake-machine';
import { compare, countWriters, main, readHub, type Snapshot } from '../../deploy/counts.ts';
import { Person } from '../../deploy/hub.ts';
import { IDENTITY_HEADER } from '../../local/standin.ts';
import { enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

process.env.DESK_HUB_APP ??= join(import.meta.dirname, '../..');
const MACHINE_COUNTS = join(import.meta.dirname, '../../deploy/machine-counts.py');

let hub: LocalHub;
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(() => hub?.close());

class LocalPerson extends Person {
  get headers(): Record<string, string> {
    return { [IDENTITY_HEADER]: ADMIN };
  }
}

const ev = (writer: string, seq: number, kind = 'say', ts = `2026-10-16T00:00:0${seq % 10}.000Z`) => ({ writer, seq, kind, ts });
const snap = (side: string, events: ReturnType<typeof ev>[], extra: Partial<Snapshot> = {}): Snapshot => ({
  v: 2,
  side,
  project: 'p',
  at: '',
  writers: countWriters(events),
  ...extra,
});

describe('counting and comparing', () => {
  it('counts each writer: count, last, holes, repeats, rows', () => {
    const counts = countWriters([ev('a/s', 3), ev('a/s', 1), ev('a/s', 3, 'message'), ev('b/t', 1)]);
    expect(counts['a/s']).toMatchObject({ count: 3, last: 3, holes: [2], repeats: [3] });
    expect(counts['a/s'].rows).toEqual([[1, 'say', ev('a/s', 1).ts], [3, 'say', ev('a/s', 3).ts], [3, 'message', ev('a/s', 3).ts]]);
    expect(counts['b/t']).toMatchObject({ count: 1, last: 1, holes: [], repeats: [] });
  });

  it('agrees when every writer matches, and names each kind of difference', () => {
    const hubEvents = [ev('sk/s1', 1), ev('sk/s1', 2), ev('hub/m', 1, 'human'), ev('hub/m', 2, 'human'), ev('mini/s2', 1)];
    const audit = [{ kind: 'rejected' as const, entry: { machine: 'mini', event: { writer: 'hub/m', seq: 1 }, reason: 'bad-code' } }];
    const atHub = snap('hub', hubEvents, { audit });
    const sk = snap('sk', hubEvents, { machine: 'sk' });
    // mini refused hub/m:1 (the audit says so), lost sk/s1:2, and keeps a former name's writer the hub never takes.
    const mini = snap('mini', [ev('sk/s1', 1), ev('hub/m', 2, 'human'), ev('mini/s2', 1), ev('Mac-mini.local/s0', 1)], { machine: 'mini', former: ['Mac-mini.local'] });
    const findings = compare(atHub, [sk, mini]);
    expect(findings.filter((f) => f.machine === 'sk').every((f) => f.verdict === 'agrees')).toBe(true);
    const of = (writer: string) => findings.find((f) => f.machine === 'mini' && f.writer === writer)!;
    expect(of('hub/m')).toMatchObject({ verdict: 'explained' });
    expect(of('hub/m').detail).toMatch(/bad-code.*1/);
    expect(of('sk/s1')).toMatchObject({ verdict: 'differs', detail: 'at the hub, not there: 2' });
    expect(of('mini/s2')).toMatchObject({ verdict: 'agrees' });
    expect(of('Mac-mini.local/s0')).toMatchObject({ verdict: 'explained' });
    // Past the audit's window, the machine's own spent list explains a hole too.
    const spentThere = compare(snap('hub', hubEvents), [{ ...mini, spent: { 'hub/m': [1] } }]).find((f) => f.writer === 'hub/m')!;
    expect(spentThere).toMatchObject({ verdict: 'explained', detail: 'refused there (spent there): 1' });
  });

  it('calls a duplicate, an extra event, and a changed event a difference', () => {
    const atHub = snap('hub', [ev('sk/s', 1), ev('sk/s', 2)]);
    const twice = compare(atHub, [snap('m', [ev('sk/s', 1), ev('sk/s', 2), ev('sk/s', 2)], { machine: 'm' })])[0];
    expect(twice).toMatchObject({ verdict: 'differs', detail: 'held twice there: 2' });
    const extra = compare(atHub, [snap('m', [ev('sk/s', 1), ev('sk/s', 2), ev('sk/s', 3)], { machine: 'm' })])[0];
    expect(extra).toMatchObject({ verdict: 'differs', detail: 'there, not at the hub: 3' });
    const changed = compare(atHub, [snap('m', [ev('sk/s', 1), ev('sk/s', 2, 'message')], { machine: 'm' })])[0];
    expect(changed.verdict).toBe('differs');
    const own = compare(snap('hub', []), [snap('m', [ev('m/s', 1)], { machine: 'm' })])[0];
    expect(own).toMatchObject({ verdict: 'differs', detail: 'held there, not at the hub' });
  });

  it("explains a writer absent at the hub only under the machine's own former names", () => {
    // mini imports sk's writers, and sk was once SK.local: a writer of either the hub lost is a loss, not mini's former name.
    const there = snap('mini', [ev('sk/s9', 1), ev('SK.local/s8', 1), ev('Mac-mini.local/s0', 1)], { machine: 'mini', former: ['Mac-mini.local'] });
    const findings = compare(snap('hub', []), [there]);
    const of = (writer: string) => findings.find((f) => f.writer === writer)!;
    expect(of('sk/s9')).toMatchObject({ verdict: 'differs', detail: 'held there, not at the hub' });
    expect(of('SK.local/s8')).toMatchObject({ verdict: 'differs', detail: 'held there, not at the hub' });
    expect(of('Mac-mini.local/s0')).toMatchObject({ verdict: 'explained' });
    // A snapshot that names no former names explains nothing.
    expect(compare(snap('hub', []), [{ ...there, former: undefined }]).every((f) => f.verdict === 'differs')).toBe(true);
  });

  it('compares every position both sides hold, even where a refusal explains a missing one', () => {
    const atHub = snap('hub', [ev('hub/m', 1, 'human'), ev('hub/m', 2, 'human'), ev('hub/m', 3, 'human')], {
      audit: [{ kind: 'rejected', entry: { machine: 'mini', event: { writer: 'hub/m', seq: 1 }, reason: 'bad-code' } }],
    });
    const refusedOnly = snap('mini', [ev('hub/m', 2, 'human'), ev('hub/m', 3, 'human')], { machine: 'mini' });
    expect(compare(atHub, [refusedOnly])[0]).toMatchObject({ verdict: 'explained', detail: 'refused there (bad-code): 1' });
    // 1 refused, and 3 another event there: the refusal no longer hides the change.
    const changed = snap('mini', [ev('hub/m', 2, 'human'), ev('hub/m', 3, 'human', '2026-10-16T09:00:00.000Z')], { machine: 'mini' });
    expect(compare(atHub, [changed])[0]).toMatchObject({ verdict: 'differs', detail: 'another event there (kind or ts): 3 (and refused there: 1)' });
    // A machine's spent list explains a missing position, not an extra one.
    const extra = snap('mini', [ev('hub/m', 2, 'human'), ev('hub/m', 3, 'human'), ev('hub/m', 4, 'human')], { machine: 'mini', spent: { 'hub/m': [1, 4] } });
    expect(compare(atHub, [extra])[0]).toMatchObject({ verdict: 'differs', detail: 'there, not at the hub: 4 (and refused there: 1)' });
  });

  it('calls a machine log with lines that are not events a difference, whatever its counts say', () => {
    const events = [ev('sk/s', 1), ev('sk/s', 2)];
    const findings = compare(snap('hub', events), [snap('m', events, { machine: 'm', unreadable: ['sk.s.jsonl:3'] })]);
    expect(findings.find((f) => f.writer === 'sk/s')).toMatchObject({ verdict: 'agrees' });
    expect(findings.find((f) => f.writer === '(log files)')).toMatchObject({ verdict: 'differs', detail: 'not events there: sk.s.jsonl:3' });
  });
});

describe('the machine half', () => {
  // A home whose path holds glob metacharacters, as a real SMINOS_HOME may: its log files are found all the same.
  const machineHome = (hubJson: object) => {
    const home = mkdtempSync(join(tmpdir(), 'counts-[x]*-'));
    const pid = randomUUID();
    const log = join(home, 'projects', pid, 'log');
    mkdirSync(log, { recursive: true });
    mkdirSync(join(home, 'daemon'));
    writeFileSync(join(home, 'daemon', 'hub.json'), JSON.stringify(hubJson));
    return { home, pid, log };
  };

  it('counts a log directory as the hub half counts the same events, and reads only the enrolled and former names', () => {
    const { home, pid, log } = machineHome({ machine: 'sk', former: { 'SK.local': ['not-printed-session'] }, key: 'not printed', client_secret: 'not printed' });
    try {
      const events = [ev('sk/s1', 1, 'joined'), ev('sk/s1', 2, 'message'), ev('hub/m', 1, 'human'), ev('hub/m', 3, 'human')];
      writeFileSync(join(log, 'sk.s1.jsonl'), events.slice(0, 2).map((e) => JSON.stringify({ ...e, text: 'é' })).join('\n') + '\n');
      writeFileSync(join(log, 'hub.m.jsonl'), events.slice(2).map((e) => JSON.stringify(e)).join('\n') + '\n');
      writeFileSync(join(home, 'projects', pid, 'uplink.json'), JSON.stringify({ spent: { 'hub/m': [2] }, unreported: [{ not: 'read' }] }));
      const out = execFileSync('python3', [MACHINE_COUNTS, '--project', pid, '--home', home], { encoding: 'utf8' });
      expect(out).not.toMatch(/not printed|not-printed/);
      const snapshot = JSON.parse(out) as Snapshot;
      expect(snapshot).toMatchObject({ v: 2, side: 'sk', machine: 'sk', former: ['SK.local'], project: pid });
      expect(snapshot.writers).toEqual(countWriters(events));
      expect(snapshot.writers['hub/m'].holes).toEqual([2]);
      expect(snapshot.spent).toEqual({ 'hub/m': [2] });
      expect(snapshot.unreadable).toBeUndefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('writes its snapshot over a damaged log, names each line that is not an event, and exits 1', () => {
    const { home, pid, log } = machineHome({ machine: 'sk' });
    try {
      const lines = [JSON.stringify(ev('sk/s1', 1)), '{"writer":"sk/s1","seq":2,"ki', '[]', '', JSON.stringify(ev('sk/s1', 3))];
      writeFileSync(join(log, 'sk.s1.jsonl'), lines.join('\n') + '\n');
      const run = spawnSync('python3', [MACHINE_COUNTS, '--project', pid, '--home', home], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('sk.s1.jsonl:2, sk.s1.jsonl:3');
      const snapshot = JSON.parse(run.stdout) as Snapshot;
      expect(snapshot.unreadable).toEqual(['sk.s1.jsonl:2', 'sk.s1.jsonl:3']);
      expect(snapshot.writers['sk/s1']).toMatchObject({ count: 2, last: 3, holes: [2] });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('the hub half', () => {
  it('reads a project log through a resume, sending nothing but resume, and compares', async () => {
    const name = `counts-${Math.random().toString(36).slice(2, 7)}`;
    const project = randomUUID();
    const credentials = await enroll(hub, ADMIN, name);
    const fm = new FakeMachine({ hub: hub.url, machine: name, credentials, orgKey: new Uint8Array(32).fill(7), project, projectName: 'counts' });
    await fm.connect();
    const writer = `${name}/${randomUUID()}`;
    for (const text of ['one', 'two', 'three']) await fm.write(text, writer, { kind: 'say', from: 'x', to: '*', text });
    const person = new LocalPerson(hub.url, 'unused');
    const sent: unknown[] = [];
    const open = person.socket.bind(person);
    vi.spyOn(person, 'socket').mockImplementation(async (path: string) => {
      const socket = await open(path);
      const send = socket.send.bind(socket);
      socket.send = (frame: object) => {
        sent.push(frame);
        send(frame);
      };
      return socket;
    });
    const atHub = await readHub(person, project, 200);
    expect(sent).toEqual([{ t: 'resume', after: 0 }]);
    expect(atHub.writers[writer]).toMatchObject({ count: 3, last: 3, holes: [], repeats: [] });
    const machine = { ...atHub, side: name, machine: name, audit: undefined };
    expect(compare(atHub, [machine]).every((f) => f.verdict === 'agrees')).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'counts-'));
    try {
      const file = join(dir, `${name}.json`);
      writeFileSync(file, JSON.stringify(machine));
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(await main(['--project', project, '--machine', file], new LocalPerson(hub.url, 'unused'))).toBe(0);
      expect(log.mock.calls.flat().join('\n')).toMatch(/AGREE/);
      log.mockClear();
      const kept = machine.writers[writer].rows.slice(0, 2).map(([seq, kind, ts]) => ({ writer, seq, kind, ts }));
      writeFileSync(file, JSON.stringify({ ...machine, writers: countWriters(kept) }));
      expect(await main(['--project', project, '--machine', file], new LocalPerson(hub.url, 'unused'))).toBe(1);
      expect(log.mock.calls.flat().join('\n')).toMatch(/at the hub, not there: 3[\s\S]*DIFFERS/);
      log.mockClear();
      // Every count agrees, and the machine's log has a line that is not an event.
      writeFileSync(file, JSON.stringify({ ...machine, unreadable: ['x.jsonl:4'] }));
      expect(await main(['--project', project, '--machine', file], new LocalPerson(hub.url, 'unused'))).toBe(1);
      expect(log.mock.calls.flat().join('\n')).toMatch(/not events there: x\.jsonl:4[\s\S]*DIFFERS/);
      log.mockRestore();
      // A snapshot of the earlier shape (no rows, no former names) is refused, not compared.
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
      writeFileSync(file, JSON.stringify({ ...machine, v: 1 }));
      expect(await main(['--project', project, '--machine', file], new LocalPerson(hub.url, 'unused'))).toBe(2);
      expect(quiet.mock.calls.flat().join('\n')).toMatch(/version 1, not 2/);
      quiet.mockRestore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    await fm.close();
  });

  it('needs a project id', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main([], new LocalPerson(hub.url, 'unused'))).toBe(2);
    expect(await main(['--project', 'not-a-uuid'], new LocalPerson(hub.url, 'unused'))).toBe(2);
    quiet.mockRestore();
  });
});
