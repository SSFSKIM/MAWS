// `deployment keep-a1`: reach scene A1 brought up on the run's VM and kept up for a real member watching from their own
// MAWS (P5 O8 M6b's real-member sitting; O10's production acceptance asks the same of staging first). A1 carries a lane A
// session S and a lane B session L of the admin's (member A), and A's acts on them are made on command through A's
// relayed channel, as the reach run's items make them. The real member B (`--member`, added by `real-member add`)
// watches. Commands are lines appended to `--control`; `down`, or a SIGINT or SIGTERM, runs the undo: L's and S's shares
// with B removed, the relay closed, A1 out of the state and revoked, the scene down; then a LEFT line for anything the
// head or the hub still holds. A second signal exits at once, naming what is not yet undone (`interruptible`).
//
// Guards, as the reach harness's: staging's hub alone (checkTestHub, isTestTarget, and production's config refused
// before anything is read), scene a1 of the run's VM alone (the VM's operator refusal names the run's scenes), and B a
// member id of 32 lowercase hex characters that the head lists.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { checkTestHub, PRODUCTION_HOST, readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { afterEndpointCleanup, enrollScratch, endpointServing, OrgView, type Made } from './endpoint-acceptance';
import { REACH_SCENES, VmMachine } from './endpoint-machine';
import { openRemote, RelayDialer, testDevice, type Remote, type RunDevice } from './endpoint-remote';
import { Secrets } from './endpoint-verdicts';
import { Person } from './hub';
import { loadAdminDevice, OrgAdmin } from './org-admin';
import { Cleanup, interruptible, isTestTarget, STEP_MS } from './proof';
import { callOutput, draftOf, machineAct, readingOf, recordAct, recordPolicy, type Level, type RecordTarget, type ShareGrade } from './reach-acts';

export const LEVELS: readonly Level[] = ['private', 'listed', 'org-view', 'org-converse'];
export const GRADES: readonly ShareGrade[] = ['list', 'view', 'converse', 'approve'];
const MEMBER = /^[0-9a-f]{32}$/;
const VM = /^dc-[a-z0-9][a-z0-9-]{0,60}$/;
const DIRECT = /^wss?:\/\/([^\s/:]+)(?::\d+)?$/;
/** A1's direct listener on the VM (the reach run's port for a1). */
const A1_PORT = 47841;

const OPTIONS = {
  config: { type: 'string' },
  'device-keys': { type: 'string' },
  vm: { type: 'string' },
  'direct-url': { type: 'string' },
  member: { type: 'string' },
  control: { type: 'string' },
  devcloud: { type: 'string', default: 'devcloud' },
  scan: { type: 'string' },
} as const;

type Values = { [K in keyof typeof OPTIONS]?: string };
export type KeepA1Run = { vm: string; host: string; member: string; control: string; deviceKeys: string };

/** The run the command line asks for, or why it is refused: staging's config alone, and every argument checked
 * before a secret is read or anything reaches the hub or the VM. `exists` says whether the control file is there. */
export function keepA1Mode(values: Values, config: { worker: string; host: string }, exists: (path: string) => boolean = existsSync): { run: KeepA1Run } | { refused: string } {
  if (config.host === PRODUCTION_HOST || config.worker === 'desk-hub') return { refused: `the config names production (${config.host}): keep-a1 runs on staging alone` };
  if (!values['device-keys']) return { refused: '--device-keys <file>: the staging admin device whose step-up key signs the org state' };
  if (!values.vm || !VM.test(values.vm)) return { refused: '--vm <the run’s devcloud VM, dc-…>' };
  const host = DIRECT.exec(values['direct-url'] ?? '')?.[1];
  if (!host) return { refused: '--direct-url ws://<the VM’s tailnet address>' };
  if (!values.member || !MEMBER.test(values.member)) return { refused: '--member <B’s member id, 32 lowercase hex characters>' };
  if (!values.control || !exists(values.control)) return { refused: '--control <an existing file the commands are appended to>' };
  return { run: { vm: values.vm, host, member: values.member, control: values.control, deviceKeys: values['device-keys'] } };
}

/** One control line read as a command, or null for none of keep-a1's. */
export type Command =
  | { verb: 'down' }
  | { verb: 'access'; level: Level; target: 'S' | 'L' }
  | { verb: 'share'; grade: ShareGrade | null; target: 'S' | 'L' }
  | { verb: 'policy'; target: 'S' | 'L' }
  | { verb: 'adraft'; text: string }
  | { verb: 'aread' }
  | { verb: 'terminal-share' };

export function commandOf(line: string): Command | null {
  const [verb, ...rest] = line.trim().split(/\s+/);
  const target = (word: string | undefined) => (word === 'S' || word === 'L' ? word : null);
  if (verb === 'down' && rest.length === 0) return { verb };
  if (verb === 'aread' && rest.length === 0) return { verb };
  if (verb === 'terminal-share' && rest.length === 0) return { verb };
  if (verb === 'adraft' && rest.length > 0) return { verb, text: rest.join(' ') };
  if (verb === 'access' && rest.length === 2 && LEVELS.includes(rest[0] as Level) && target(rest[1])) return { verb, level: rest[0] as Level, target: target(rest[1])! };
  if (verb === 'share' && rest.length === 2 && (GRADES.includes(rest[0] as ShareGrade) || rest[0] === 'none') && target(rest[1])) return { verb, grade: rest[0] === 'none' ? null : (rest[0] as ShareGrade), target: target(rest[1])! };
  if (verb === 'policy' && rest.length === 1 && target(rest[0])) return { verb, target: target(rest[0])! };
  return null;
}

/** A reader of the control file's commands: each call returns the complete lines appended since the last, none of those
 * written before the reader was made. The offset is in bytes and only whole lines are decoded: the file's size counts
 * bytes while a decoded string counts UTF-16 units, so the text sliced at the size would cut the command after a
 * non-ASCII line; and a line not yet ended by its newline is left for a later call, since an append may land in parts. */
export function controlReader(path: string): () => string[] {
  let offset = statSync(path).size;
  return () => {
    const fresh = readFileSync(path).subarray(offset);
    const end = fresh.lastIndexOf(0x0a);
    if (end < 0) return [];
    offset += end + 1;
    return fresh.subarray(0, end).toString('utf8').split('\n').map((x) => x.trim()).filter(Boolean);
  };
}

/** `line` as keep-a1 prints it: each of the head's member emails replaced, since every control line is echoed and a
 * draft's text printed, to stdout and the run's log, and a member may type an email into a draft. The longest first, so
 * an email that ends another is not masked inside it. (Secrets is not for these: it passes values under 16 characters
 * and writes each to the token scan list.) */
export function maskEmails(emails: readonly string[], line: string): string {
  return [...emails].filter(Boolean).sort((x, y) => y.length - x.length).reduce((out, email) => out.replaceAll(email, '<a member’s email>'), line);
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: OPTIONS }) as unknown as { values: Values };
  const config = readDeployConfig(values.config ?? join(process.env.DESK_HUB_APP!, 'deploy', 'staging.json'));
  const mode = keepA1Mode(values, config);
  if ('refused' in mode) {
    console.error(mode.refused);
    return 2;
  }
  if (!isTestTarget(config)) return 2;
  const { run: given } = mode;
  const secrets = new Secrets(values.scan ?? null);
  const read = await readSecrets();
  if (!read.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  secrets.add(read.DESK_ACCESS_TOKEN);
  // Filled once the head is read; the lines printed before that name no member's email.
  const emails: string[] = [];
  const print = secrets.guard((line: string) => console.log(maskEmails(emails, line)));
  const cleanup = new Cleanup(4 * STEP_MS);
  const person = new Person(`https://${config.host}`, read.DESK_ACCESS_TOKEN, () => cleanup.check(), { requestMs: 30_000, signal: cleanup.signal });
  checkTestHub(person.hub, 'keep scene A1 up against it');
  const made: Made = { machines: [], members: [], devices: [], kept: [] };
  const b = given.member;

  return interruptible(
    cleanup,
    async () => {
      const device = await loadAdminDevice(given.deviceKeys);
      const admin = await OrgAdmin.open(person, { org: config.org.id, pinnedGenesis: config.orgGenesis }, device, print);
      const view = new OrgView(person);
      await view.reread();
      emails.push(...view.chain.at(-1)!.state.members.map((m) => m.email));
      if (!view.chain.at(-1)!.state.members.some((m) => m.id === b)) throw new Error(`the head lists no member ${b}: run real-member add first`);
      const a: RunDevice = { member: admin.member, id: device.id, clientClass: 'native-mac', channel: device.channel, stepUp: device.stepUp } as RunDevice;
      const vm = new VmMachine({ devcloud: values.devcloud ?? 'devcloud', vm: given.vm }, join(process.env.HOME ?? '/tmp', '.local', 'share', 'o18-m6-scratch'), {
        directUrl: `ws://${given.host}:${A1_PORT}`,
        scene: 'a1',
        laneB: true,
        log: (line) => print(`  vm a1: ${line}`),
        gate: () => cleanup.check(),
        signal: cleanup.signal,
      });
      cleanup.add('end the scene a1', async () => {
        const left = await vm.down();
        if (left.length) throw new Error(left.join('; '));
      });
      await vm.up();
      const tag = randomBytes(3).toString('hex');
      const name = `o18-a1-${tag}`;
      const { ref } = await enrollScratch(admin, view, vm, name, made, cleanup, (value) => secrets.add(value), undefined);
      const { status: st, bound } = await endpointServing(vm, view);
      print(`${name}: enrolled and listed for the admin, ref ${ref}, at version ${st.stateVersion}, the direct listener ${bound}`);
      const project = { id: randomUUID(), name: `o8-sitting-${tag}` };
      const s = await vm.laneA.up(project);
      print(`S: lane A session ${s.session} (${s.alias}) on ${name}, project ${project.name}`);
      if (!vm.laneB) throw new Error('A1 has no lane B source');
      const l = await vm.laneB.up(tag);
      print(`L: lane B app session ${l.app} (engine ${l.engine}, ${l.alias}) on ${name}`);
      const relay = new RelayDialer(person.hub, ref, () => person.headers);
      cleanup.add('close the relay to A1', async () => relay.close());
      const withA = async <T>(act: (remote: Remote) => Promise<T>): Promise<T> => {
        const remote = await openRemote(testDevice(view.chain[0].state.org, a, { chain: view.chain, certificates: view.certificates }, { build: 'keep-a1' }), ref, () => relay.dial());
        try {
          return await act(remote);
        } finally {
          remote.close();
        }
      };
      const targets: Record<'S' | 'L', RecordTarget> = { S: { session: s.session }, L: { appSessionId: l.app } };
      cleanup.add('remove S’s and L’s shares with B', async () => {
        for (const t of Object.values(targets)) await withA((remote) => recordAct(remote, ref, t, { member: b, grade: null }));
      });
      const run = { hub: { host: new URL(person.hub).host, org: config.org.id }, scenes: [...REACH_SCENES] as string[] };
      print(`keep-a1: READY. Commands, one a line in ${given.control}: access <${LEVELS.join('|')}> <S|L> · share <${GRADES.join('|')}|none> <S|L> · policy <S|L> · adraft <text> · aread · terminal-share · down`);

      const control = controlReader(given.control);
      let before = '';
      while (!cleanup.signal.aborted) {
        const lines = control();
        if (lines.length === 0) {
          await new Promise((done) => setTimeout(done, 1000));
          continue;
        }
        for (const line of lines) {
          print(`> ${line}`);
          const c = commandOf(line);
          if (c === null) {
            print(`not a command: ${line}`);
            continue;
          }
          if (c.verb === 'down') return 0;
          try {
            if (c.verb === 'access') {
              const r = await withA((remote) => recordAct(remote, ref, targets[c.target], { access: c.level }));
              print(`access ${c.target} ${c.level}: changed ${r.changed}, policyRev ${r.policyRev}`);
            } else if (c.verb === 'share') {
              const r = await withA((remote) => recordAct(remote, ref, targets[c.target], { member: b, grade: c.grade }));
              print(`share ${c.target} with B ${c.grade ?? 'none'}: changed ${r.changed}, policyRev ${r.policyRev}`);
            } else if (c.verb === 'policy') {
              print(`policy ${c.target}: ${JSON.stringify(await withA((remote) => recordPolicy(remote, c.target === 'S' ? s.session : l.app)))}`);
            } else if (c.verb === 'adraft') {
              const reading = await withA(async (remote) => {
                const saved = await machineAct(remote, ref, 'session.drafts.set', { appSessionId: l.app, draft: draftOf(c.text) });
                if ((saved as { state?: unknown }).state !== 'done') throw new Error(`A's draft: ${JSON.stringify(saved)}`);
                return readingOf(await callOutput(remote, 'session.get', { appSessionId: l.app }));
              });
              before = JSON.stringify(reading);
              print(`A's draft on L saved; A's reading ${before}`);
            } else if (c.verb === 'aread') {
              const [reading, draft] = await withA(async (remote) => [readingOf(await callOutput(remote, 'session.get', { appSessionId: l.app })), await callOutput(remote, 'session.drafts.get', { appSessionId: l.app })] as const);
              const now = JSON.stringify(reading);
              print(`A's reading on L ${now}${before ? (now === before ? ' (unchanged)' : ` (MOVED from ${before})`) : ''}; A's draft ${JSON.stringify(draft).slice(0, 300)}`);
            } else {
              const r = await vm.operator({ share: { member: s.session, person: b, grade: 'view' } }, run);
              print(`the terminal's share of S with B at view: exit ${r.rc}`);
              for (const x of r.lines.slice(-8)) print(`  | ${x}`);
            }
          } catch (error) {
            print(`failed: ${line}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      return 0;
    },
    async (status) => {
      cleanup.interrupt(status === 0 ? 'keep-a1 going down' : 'keep-a1 failed');
      const failed = await cleanup.run();
      const left = await afterEndpointCleanup(person, made, AbortSignal.timeout(STEP_MS)).catch((error: unknown) => [`the check after cleanup failed: ${error instanceof Error ? error.message : String(error)}`]);
      for (const line of [...failed.map((f) => `cleanup: ${f}`), ...left]) print(`LEFT ${line}`);
      if (failed.length === 0 && left.length === 0) print('cleanup: the head lists none of the driver’s machines, the hub holds none of them, and the scene is ended');
      return failed.length || left.length ? 1 : status;
    },
  );
}
