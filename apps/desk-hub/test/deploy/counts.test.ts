// `deployment counts` (deploy/counts.ts) and its machine half (deploy/machine-counts.py): the per-writer comparison
// of Parent-Level Acceptance 10. The hub half reads only (a resume from offset 0), the two halves count alike, and the
// comparison names what the audit explains. Run against the local hub only: never the deployment.
import { execFileSync } from 'node:child_process';
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
  v: 1,
  side,
  project: 'p',
  at: '',
  writers: countWriters(events),
  ...extra,
});

describe('counting and comparing', () => {
  it('counts each writer: count, last, holes, repeats', () => {
    const counts = countWriters([ev('a/s', 1), ev('a/s', 3), ev('a/s', 3), ev('b/t', 1)]);
    expect(counts['a/s']).toMatchObject({ count: 3, last: 3, holes: [2], repeats: [3] });
    expect(counts['b/t']).toMatchObject({ count: 1, last: 1, holes: [], repeats: [] });
  });

  it('agrees when every writer matches, and names each kind of difference', () => {
    const hubEvents = [ev('sk/s1', 1), ev('sk/s1', 2), ev('hub/m', 1, 'human'), ev('hub/m', 2, 'human'), ev('mini/s2', 1)];
    const audit = [{ kind: 'rejected' as const, entry: { machine: 'mini', event: { writer: 'hub/m', seq: 1 }, reason: 'bad-code' } }];
    const atHub = snap('hub', hubEvents, { audit });
    const sk = snap('sk', hubEvents, { machine: 'sk' });
    // mini refused hub/m:1 (the audit says so), lost sk/s1:2, and keeps a former name's writer the hub never takes.
    const mini = snap('mini', [ev('sk/s1', 1), ev('hub/m', 2, 'human'), ev('mini/s2', 1), ev('Mac-mini.local/s0', 1)], { machine: 'mini' });
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
});

describe('the machine half', () => {
  it('counts a log directory as the hub half counts the same events, and reads only the enrolled name', () => {
    const home = mkdtempSync(join(tmpdir(), 'counts-'));
    try {
      const pid = randomUUID();
      const log = join(home, 'projects', pid, 'log');
      mkdirSync(log, { recursive: true });
      mkdirSync(join(home, 'daemon'));
      writeFileSync(join(home, 'daemon', 'hub.json'), JSON.stringify({ machine: 'sk', key: 'not printed', client_secret: 'not printed' }));
      const events = [ev('sk/s1', 1, 'joined'), ev('sk/s1', 2, 'message'), ev('hub/m', 1, 'human'), ev('hub/m', 3, 'human')];
      writeFileSync(join(log, 'sk.s1.jsonl'), events.slice(0, 2).map((e) => JSON.stringify({ ...e, text: 'é' })).join('\n') + '\n');
      writeFileSync(join(log, 'hub.m.jsonl'), events.slice(2).map((e) => JSON.stringify(e)).join('\n') + '\n');
      writeFileSync(join(home, 'projects', pid, 'uplink.json'), JSON.stringify({ spent: { 'hub/m': [2] }, unreported: [{ not: 'read' }] }));
      const out = execFileSync('python3', [MACHINE_COUNTS, '--project', pid, '--home', home], { encoding: 'utf8' });
      expect(out).not.toMatch(/not printed/);
      const snapshot = JSON.parse(out) as Snapshot;
      expect(snapshot).toMatchObject({ side: 'sk', machine: 'sk', project: pid });
      expect(snapshot.writers).toEqual(countWriters(events));
      expect(snapshot.writers['hub/m'].holes).toEqual([2]);
      expect(snapshot.spent).toEqual({ 'hub/m': [2] });
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
      const short = { ...machine, writers: { [writer]: { ...machine.writers[writer], count: 2, last: 2 } } };
      writeFileSync(file, JSON.stringify(short));
      expect(await main(['--project', project, '--machine', file], new LocalPerson(hub.url, 'unused'))).toBe(1);
      expect(log.mock.calls.flat().join('\n')).toMatch(/DIFFERS/);
      log.mockRestore();
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
