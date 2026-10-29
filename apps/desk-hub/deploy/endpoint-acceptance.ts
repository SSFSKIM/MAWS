// `deployment endpoint-acceptance` (P5 O10 M11; docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md, Acceptance 2-5, 8
// and 9): a real `mawsd` with its endpoint, enrolled by a code the staging OrgAdmin mints and listed in the org's
// state, the sminos beside it cut over to the endpoint and one terminal session under it (lane A), and the run's test
// device driving each item over the relay (the staging hub's multiplex) and over the tailnet (the direct listener).
// One `PASS <item>` line per item that showed, `FAIL` or `NOT SHOWN` otherwise; then the cleanup (the machine unlisted
// and revoked, every member and device the run added taken out, the scene on the machine ended) and a read-back of the
// head and the hub's machines for anything of the run's still there.
//
// The machine is the devcloud acceptance VM's scratch scene (endpoint-machine.ts's VmMachine, through `devcloud vm
// ssh` alone, P5 DL 103), or, in the endpoint's own suite, a local mawsd from out/main/mawsd.js
// (test/endpoint/acceptance-local.test.ts). `--vm-setup` and `--vm-teardown` run vm/setup.sh and vm/teardown.sh there.
//
// Production (acceptance item 7, O14's cutover) is a mode of its own, refused unless asked for by name twice
// (`--production --confirm-production <production's host>`): there is no admin key, the run's device pairs through
// the person's pending devices from a code the owner mints, and the owner removes it by hand at the end
// (endpoint-production.ts). staging-run.sh never asks for it.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { generateSigningKey, keyId, signOrgState, type OrgState, type RevokedKey, type SignedOrgState } from 'org-protocol';
import { machineProjectId, ORG_STATE_PATH, type OrgStateView } from '../src/protocol/identity';
import { checkTestHub, PRODUCTION_HOST, readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { Person } from './hub';
import { composeScript, ScriptRunner, VmMachine, type EndpointMachine } from './endpoint-machine';
import { HubWrites, runItems, ITEMS, type Scene } from './endpoint-items';
import { DirectPacer, RelayDialer, type RunDevice } from './endpoint-remote';
import { ItemReport, Secrets } from './endpoint-verdicts';
import { loadAdminDevice, OrgAdmin, successor, type AdminDevice, type OrgScope } from './org-admin';
import { Cleanup, interruptible, isTestTarget, STEP_MS, type InterruptOptions } from './proof';

export const DEFAULT_VM = 'dc-acceptance-7f80';
export const DEFAULT_DIRECT_URL = 'ws://100.116.205.27:47831';
const DEVCLOUD = '/Users/new/.claude/plugins/cache/doperpowers/devcloud/0.15.1/bin/devcloud';
/** A cleanup step's bound: the scene's `down` on the VM waits out its processes, longer than a hub request's. */
const CLEANUP_STEP_MS = 4 * STEP_MS;
/** How long a hub deploy may take (wrangler's upload and the Worker's rollout). */
const DEPLOY_MS = 15 * 60_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function until<T>(probe: () => Promise<T | null | undefined | false>, what: string, ms: number, every = 1000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms / 1000} s`);
    await sleep(every);
  }
}

/** The org's chain as the hub serves it, every page followed, from `after` on. */
export async function readChain(person: Person, after = 0): Promise<SignedOrgState[]> {
  const chain: SignedOrgState[] = [];
  for (let since = after; ; ) {
    const view = await person.json<OrgStateView>(`${ORG_STATE_PATH}?since=${since}`);
    chain.push(...(view.chain ?? []));
    if (!view.more || !view.chain?.length) return chain;
    since = view.chain.at(-1)!.state.version;
  }
}

/**
 * What the run made: what the read-back after its cleanup looks for (machines, members, every device id it added), and
 * what it keeps by design (`kept`: the project it wrote events in, and those events; a project's log is never pruned).
 */
export type Made = { machines: string[]; members: string[]; devices: string[]; kept: string[] };

/** What a run is given: its hub, the machine, and either the admin who writes the org's state or production's device. */
export type RunOptions = {
  target: Scene['target'];
  person: Person;
  machine: EndpointMachine;
  items: readonly string[];
  cleanup: Cleanup;
  secrets: Secrets;
  print?: (line: string) => void;
  /** The staging (or local) admin: the org's scope and the admin device whose step-up key signs its successors. */
  admin: { scope: OrgScope; device: AdminDevice } | null;
  /**
   * Production's run device: its id, named before anything is sent, and its pairing (endpoint-production.ts), made in
   * the run so the owner's removal is the cleanup's on every exit; and the owner's steps by hand.
   */
  production: { id: string; pair(): Promise<RunDevice>; ownerStep(what: string, done: () => Promise<boolean>): Promise<void> } | null;
  hubDeploy?: (() => Promise<void>) | null;
  tag?: string;
};

/**
 * The scene the items run against, built step by step, each undoing registered on the cleanup before what it undoes:
 * the machine's scene up, the second member, the machine enrolled and listed, its endpoint serving, the relay, and the
 * lane A session.
 */
export async function buildScene(o: RunOptions & { tag: string }, made: Made, log: (line: string) => void): Promise<Scene> {
  const { person, machine, cleanup, tag } = o;
  let chain = await readChain(person);
  const refresh = async () => {
    chain.push(...(await readChain(person, chain.at(-1)!.state.version)));
    return chain.at(-1)!;
  };

  let admin: OrgAdmin | null = null;
  let owner: RunDevice;
  if (o.admin !== null) {
    admin = await OrgAdmin.open(person, o.admin.scope, o.admin.device, log);
    chain = await readChain(person);
    owner = { member: admin.member, id: o.admin.device.id, clientClass: 'native-mac', channel: o.admin.device.channel, stepUp: o.admin.device.stepUp };
  } else if (o.production !== null) {
    // The obligation first: the owner removes the device, and the read-back looks for it, however the run ends.
    const { id } = o.production;
    made.devices.push(id);
    cleanup.add(`the owner removes ${id}`, async () => {
      const { head } = await person.json<{ head: SignedOrgState | null }>(ORG_STATE_PATH);
      if (head?.state.members.some((m) => m.devices.some((d) => d.id === id))) throw new Error(`${id} is still in the head: \`production-run.sh admin remove-device ${id}\``);
    });
    owner = await o.production.pair();
    chain = await readChain(person);
  } else throw new Error('a run needs an admin device or production’s paired one');

  cleanup.add(`end the scene on ${machine.label}`, async () => {
    const left = await machine.down();
    if (left.length) throw new Error(left.join('; '));
  });
  await machine.up();
  log(`${machine.label}: a fresh scratch mawsd serving, unenrolled`);

  const amend =
    admin === null
      ? null
      : async (what: string, edit: (s: OrgState) => void | boolean) => {
          const signed = await admin.amend(what, edit);
          await refresh();
          return signed;
        };
  const sign = admin === null ? null : async (edit: (s: OrgState) => void) => signOrgState(await successor((await admin.read()).state, edit), [admin.device.stepUp]);
  const post =
    admin === null
      ? null
      : async (state: SignedOrgState) => {
          await person.json(ORG_STATE_PATH, { body: state }, 201);
          await refresh();
        };

  // A second member, holding nothing on the machine: the grade refusals' asker.
  let other: RunDevice | null = null;
  if (amend !== null) {
    const id = randomBytes(16).toString('hex');
    const email = `o10-m11-${tag}@staging.invalid`;
    other = { member: id, id: `o10-s-${tag}-b1`, clientClass: 'native-mac', channel: await generateSigningKey(), stepUp: await generateSigningKey() };
    const b1 = other;
    made.members.push(id);
    made.devices.push(b1.id);
    cleanup.add(`remove the member ${email}`, async () => {
      const keys: RevokedKey[] = await Promise.all(
        [
          ['channel', b1.channel.pub],
          ['step-up', b1.stepUp!.pub],
        ].map(async ([key, pub]) => ({ keyId: await keyId(pub), holder: { member: id, device: b1.id, class: b1.clientClass, key: key as 'channel' | 'step-up' } })),
      );
      if (!(await admin!.read()).state.members.some((m) => m.id === id)) return;
      await amend(`the member ${email} removed, their device's keys revoked`, (s) => {
        s.members = s.members.filter((m) => m.id !== id);
        s.revoked.push(...keys);
      });
    });
    await amend(`the member ${email} added`, (s) => void s.members.push({ id, email, role: 'member', devices: [{ id: b1.id, class: 'native-mac', keyStorage: 'software', channelPub: b1.channel.pub, stepUpPub: b1.stepUp!.pub }] }));
  }

  // Staging's machine enrolled by the admin's code and listed; production's is the VM's own, cut over and listed
  // already (O14), and only read.
  let name: string;
  let ref: string;
  if (admin !== null) {
    name = `o10-m11-${tag}`;
    made.machines.push(name);
    ({ ref } = await admin.enrollListed(name, cleanup, (code) => machine.enroll(code, name), { admitMs: 180_000, secret: (value) => o.secrets.add(value) }));
    await refresh();
    log(`${name}: enrolled and listed, ref ${ref}`);
  } else {
    const keys = await machine.keys();
    if (keys.enrollment !== 'org-listed' || typeof keys.name !== 'string' || typeof keys.ref !== 'string') throw new Error(`${machine.label} is not org-listed: ${JSON.stringify(keys)}`);
    ({ name, ref } = keys as { name: string; ref: string });
    log(`${name}: org-listed, ref ${ref}`);
  }
  const status = await until(
    async () => {
      const s = await machine.status();
      return s.enrollment === 'org-listed' && s.hub.connected && s.listener.bound && (s.stateVersion ?? 0) >= chain.at(-1)!.state.version ? s : null;
    },
    'the endpoint org-listed, on the hub and listening at the head',
    120_000,
    2000,
  );
  log(`${name}: endpoint org-listed at version ${status.stateVersion}, on the hub (generation ${status.hub.generation ?? '?'}), the direct listener bound`);

  const relay = new RelayDialer(person.hub, ref, () => person.headers);
  cleanup.add('close the relay’s Machine socket', async () => relay.close());

  // Lane A in the machine's own project (one the hub keeps for the machine), never one of the run's making; the events
  // the run writes there are admitted by `hubWrites` and kept as its residue.
  const org = chain[0].state.org;
  const project = { id: machineProjectId(org, name), name };
  const hubWrites = o.target === 'production' ? HubWrites.production(project.id) : HubWrites.staging(project.id);
  cleanup.add('record what the run keeps on the hub', async () => void made.kept.push(...hubWrites.kept()));
  const laneA = await machine.laneA.up(project);
  log(`lane A: session ${laneA.session} (${laneA.alias}) in the machine’s project ${project.id}, launch ${laneA.launch}`);

  return {
    target: o.target,
    hub: person.hub,
    org,
    person,
    machine,
    name,
    ref,
    chain: () => chain,
    owner,
    amend,
    sign,
    post,
    other,
    laneA: { ...laneA, project: project.id },
    relay,
    pacer: new DirectPacer(),
    hubDeploy: o.hubDeploy ?? null,
    ownerStep: o.production?.ownerStep ?? null,
    cleanup,
    log,
    tag,
    made,
    hubWrites,
  };
}

/** What is still there after the cleanup: the head's members, machines and devices of the run's, the hub's machine. */
export async function afterEndpointCleanup(person: Person, made: Made, signal?: AbortSignal): Promise<string[]> {
  const { head } = await person.json<{ head: SignedOrgState | null }>(ORG_STATE_PATH, { signal });
  const problems: string[] = [];
  if (head) {
    const s = head.state;
    problems.push(...s.members.filter((m) => made.members.includes(m.id)).map((m) => `the state still lists the member ${m.email}`));
    problems.push(...s.machines.filter((m) => made.machines.includes(m.name)).map((m) => `the state still lists ${m.name}`));
    problems.push(...s.members.flatMap((m) => m.devices.filter((d) => made.devices.includes(d.id)).map((d) => `the state still lists the device ${d.id}`)));
  }
  const { machines } = await person.json<{ machines: Array<{ name: string }> }>('/api/machines', { signal });
  problems.push(...machines.filter((m) => made.machines.includes(m.name)).map((m) => `the hub still holds the machine ${m.name}`));
  return problems;
}

/**
 * The run as the command makes it, under `interruptible`: the scene, the items, the summary; then however it ends the
 * cleanup and the read-back. The command's status: 0 when every item passed and nothing was left.
 */
export function runEndpointAcceptance(o: RunOptions, interrupt: InterruptOptions = {}): Promise<number> {
  const print = o.secrets.guard(o.print ?? console.log);
  const tag = o.tag ?? randomBytes(3).toString('hex');
  const made: Made = { machines: [], members: [], devices: [], kept: [] };
  if (o.target !== 'production') checkTestHub(o.person.hub, 'run the endpoint acceptance against it');
  return interruptible(
    o.cleanup,
    async () => {
      print(`endpoint acceptance: ${o.target}, hub ${o.person.hub}, ${o.machine.label}, items ${o.items.join(',')}, tag ${tag}`);
      const scene = await buildScene({ ...o, tag }, made, print);
      const report = new ItemReport(o.items, print, o.cleanup.signal);
      await runItems(scene, report, o.items);
      return report.summary() ? 0 : 1;
    },
    async (status) => {
      // What the machine was doing when the run was interrupted settles (cancelled, each within its kill's deadline)
      // before anything is undone, so a slow step can't land after the teardown.
      await o.machine.settle();
      const failed = await o.cleanup.run();
      const left = await afterEndpointCleanup(o.person, made, AbortSignal.timeout(STEP_MS)).catch((error: unknown) => [`the check after cleanup failed: ${error instanceof Error ? error.message : String(error)}`]);
      for (const line of [...failed.map((f) => `cleanup: ${f}`), ...left]) print(`LEFT ${line}`);
      if (failed.length === 0 && left.length === 0) print(`cleanup: the head lists none of the run’s members, devices or machines, the hub holds none of its machines, and the scene on ${o.machine.label} is ended`);
      for (const line of made.kept) print(`KEPT ${line}`);
      const code = failed.length || left.length ? 1 : status;
      print(`endpoint acceptance: ${code === 0 ? 'PASS' : 'FAIL'}`);
      return code;
    },
    interrupt,
  );
}

// ---- the command -----------------------------------------------------------------------------------------------------

/** How long one request to the hub may take, its body included. */
const REQUEST_MS = 30_000;

/** The lines setup.sh is given before its body: the bundle's base and the branch's commit, each a full object id. */
export function setupHead(base: string, commit: string): string {
  for (const [what, id] of [
    ['base', base],
    ['commit', commit],
  ]) {
    if (!/^[0-9a-f]{40}$/.test(id)) throw new Error(`the ${what} is not a full commit id: ${JSON.stringify(id).slice(0, 60)}`);
  }
  return `BASE='${base}'\nCOMMIT='${commit}'\n`;
}

/** The files vm/setup.sh's stage holds: the scene, the stub model and its API, and the branch's bundle. */
export function setupPayload(app: string, repo: string, bundle: string): Record<string, Buffer> {
  const vm = join(app, 'deploy', 'vm');
  return {
    'scene.sh': readFileSync(join(vm, 'scene.sh')),
    'production.sh': readFileSync(join(vm, 'production.sh')),
    'stub-model.mjs': readFileSync(join(vm, 'stub-model.mjs')),
    'stub-api.mjs': readFileSync(join(repo, 'spikes', 'protocol-probe', 'stub-api.mjs')),
    'maws.bundle': readFileSync(bundle),
  };
}

/** Runs `command` to its end within `ms`, its output through `print` line by line; throws on a non-zero status. */
function run(command: string, args: string[], print: (line: string) => void, ms: number, options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let rest = '';
    const out = (chunk: Buffer) => {
      rest += chunk.toString();
      const lines = rest.split('\n');
      rest = lines.pop()!;
      for (const line of lines) print(`  ${line}`);
    };
    child.stdout.on('data', out);
    child.stderr.on('data', out);
    const timer = setTimeout(() => child.kill('SIGTERM'), ms);
    child.once('exit', (status, signal) => {
      clearTimeout(timer);
      if (rest) print(`  ${rest}`);
      if (status === 0) done();
      else fail(new Error(`${command.split('/').at(-1)} ${args[0] ?? ''} ${signal ? `was stopped (${signal}) after ${ms / 1000} s` : `exited ${status}`}`));
    });
    child.stdin.end(options.input ?? '');
  });
}

export const OPTIONS = {
  config: { type: 'string' },
  'device-keys': { type: 'string' },
  items: { type: 'string', default: ITEMS.join(',') },
  vm: { type: 'string', default: DEFAULT_VM },
  devcloud: { type: 'string', default: DEVCLOUD },
  'direct-url': { type: 'string', default: DEFAULT_DIRECT_URL },
  scratch: { type: 'string' },
  scan: { type: 'string' },
  'hub-deploy': { type: 'string' },
  'vm-setup': { type: 'boolean', default: false },
  'vm-teardown': { type: 'boolean', default: false },
  repo: { type: 'string' },
  base: { type: 'string' },
  production: { type: 'boolean', default: false },
  'confirm-production': { type: 'string' },
  /** Production: the file the controller touches once the owner's pairing code is on the clipboard. */
  'code-ready': { type: 'string' },
} as const;

export type Parsed = { values: { [K in keyof typeof OPTIONS]?: string | boolean } };

/**
 * The command line's mode, or why it is refused: production only with `--production` and `--confirm-production`
 * naming production's host exactly, and never with a config that is a test target's (or a test target's mode with
 * production's); staging with a test target's config and the admin device's keys.
 */
export function mode(values: Parsed['values'], config: { worker: string; host: string } | null): { mode: 'staging' | 'production' | 'vm-setup' | 'vm-teardown' } | { refused: string } {
  const asked = values.production === true || values['confirm-production'] !== undefined;
  if (values['vm-setup'] && values['vm-teardown']) return { refused: '--vm-setup and --vm-teardown are one at a time' };
  if (values['vm-setup'] || values['vm-teardown']) {
    if (asked) return { refused: 'the VM scene’s setup and teardown name no hub: --production does not go with them' };
    return { mode: values['vm-setup'] ? 'vm-setup' : 'vm-teardown' };
  }
  if (config === null) return { refused: '--config <deploy config>: the hub to run against' };
  const production = config.host === PRODUCTION_HOST;
  if (asked) {
    if (values.production !== true || values['confirm-production'] !== PRODUCTION_HOST) return { refused: `production is run only with --production and --confirm-production ${PRODUCTION_HOST}` };
    if (!production) return { refused: `--production with a config whose host is ${config.host}, not production's` };
    return { mode: 'production' };
  }
  if (production) return { refused: `the config names production (${config.host}): the endpoint acceptance runs there only with --production --confirm-production ${PRODUCTION_HOST}` };
  if (!values['device-keys']) return { refused: '--device-keys <file>: the staging admin device whose step-up key signs the org state' };
  return { mode: 'staging' };
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: OPTIONS }) as unknown as Parsed;
  const app = process.env.DESK_HUB_APP!;
  const configPath = (values.config as string | undefined) ?? (values['vm-setup'] || values['vm-teardown'] ? undefined : join(app, 'deploy', 'config.json'));
  const config = configPath === undefined ? null : readDeployConfig(configPath);
  const chosen = mode(values, config);
  if ('refused' in chosen) {
    console.error(chosen.refused);
    return 2;
  }
  const items = (values.items as string).split(',').map((item) => item.trim());
  if (items.some((item) => !(ITEMS as readonly string[]).includes(item))) {
    console.error(`--items names items among ${ITEMS.join(',')}`);
    return 2;
  }
  const scratch = (values.scratch as string | undefined) ?? join(process.env.HOME ?? '/tmp', '.local', 'share', 'o10-m11-scratch');
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  const ssh = { devcloud: values.devcloud as string, vm: values.vm as string };
  const print = (line: string) => console.log(line);

  if (chosen.mode === 'vm-setup' || chosen.mode === 'vm-teardown') {
    const runner = new ScriptRunner(ssh, scratch, print);
    let script: string;
    if (chosen.mode === 'vm-setup') {
      const repo = (values.repo as string | undefined) ?? resolve(app, '..', '..');
      if (typeof values.base !== 'string' || values.base === '') {
        console.error('--base <commit>: a commit the VM’s MAWS checkout holds, which the branch’s bundle is cut from');
        return 2;
      }
      // Both go into a root script on the VM: each resolved here to a full object id and checked to be one.
      const base = await gitOut(repo, ['rev-parse', '--verify', '--end-of-options', `${values.base}^{commit}`]);
      const commit = await gitOut(repo, ['rev-parse', '--verify', 'HEAD^{commit}']);
      const bundle = join(scratch, `maws-${process.pid}.bundle`);
      await run('git', ['-C', repo, 'bundle', 'create', bundle, `${base}..HEAD`], print, 120_000);
      const files = setupPayload(app, repo, bundle);
      rmSync(bundle, { force: true });
      script = composeScript(`${setupHead(base, commit)}${readFileSync(join(app, 'deploy', 'vm', 'setup.sh'), 'utf8')}`, files, { trace: 'setup' });
    } else script = readFileSync(join(app, 'deploy', 'vm', 'teardown.sh'), 'utf8');
    const result = await runner.step(chosen.mode, script, { root: true, ms: 30 * 60_000, composed: chosen.mode === 'vm-setup' });
    for (const line of result.lines) print(line);
    return result.rc === 0 ? 0 : 1;
  }

  const secrets = new Secrets((values.scan as string | undefined) ?? null);
  const read = await readSecrets();
  if (!read.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  secrets.add(read.DESK_ACCESS_TOKEN);
  const cleanup = new Cleanup(CLEANUP_STEP_MS);
  const person = new Person(`https://${config!.host}`, read.DESK_ACCESS_TOKEN, () => cleanup.check(), { requestMs: REQUEST_MS, signal: cleanup.signal });
  const interruption = { gate: () => cleanup.check(), signal: cleanup.signal };
  const log = secrets.guard(print);

  if (chosen.mode === 'production') {
    const { productionRun } = await import('./endpoint-production');
    return productionRun({ person, items, cleanup, secrets, ssh, scratch, directUrl: values['direct-url'] as string, log, ready: (values['code-ready'] as string | undefined) ?? join(scratch, 'code-ready'), interruption });
  }

  if (!isTestTarget(config!)) return 2;
  const device = await loadAdminDevice(values['device-keys'] as string);
  const machine = new VmMachine(ssh, scratch, { directUrl: values['direct-url'] as string, log: (line) => log(`  vm: ${line}`), ...interruption });
  const deployScript = values['hub-deploy'] as string | undefined;
  const hubDeploy = deployScript === undefined ? null : () => run('zsh', [deployScript, 'deploy'], log, DEPLOY_MS);
  return runEndpointAcceptance({
    target: 'staging',
    person,
    machine,
    items,
    cleanup,
    secrets,
    print,
    admin: { scope: { org: config!.org.id, pinnedGenesis: config!.orgGenesis }, device },
    production: null,
    hubDeploy,
  });
}

function gitOut(repo: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => void (out += chunk.toString()));
    child.once('exit', (status) => (status === 0 ? done(out.trim()) : fail(new Error(`git ${args.join(' ')} exited ${status}`))));
  });
}

