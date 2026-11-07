// `deployment reach-acceptance` (P5 O18 M6; docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md, Acceptance 1–8):
// message reach shown live on the staging org. The scene is reach-items.ts's: three scratch scenes on the run's devcloud
// VM (vm/scene.sh's reach scenes: A1 and A2 the staging admin's, B1 a second member's, added for the run), a fourth (A3,
// on sminos 1.34.0) brought up for 6e, and two probe machines in this process (PA, the admin's, its RL1 hello without
// `audience`; PB, the second member's, with it), all in one fresh project whose archive is a bare repository on the VM.
// One `PASS`, `FAIL` or `NOT SHOWN` line per item, the cited clauses under theirs (`CITED 6a` on its own line); then the
// cleanup (shares removed and seats retired, every scene down, every machine out of the state and revoked, the archive
// designation cleared, the member removed) and a read-back of the head and the hub's machines: `LEFT` for anything of the
// run's still current, `KEPT` for what stays by design.
//
// Staging alone: production is refused by name, and the operator's pty path (a widening at a terminal the run controls)
// is refused for any hub but staging's and any machine outside the run's own scenes (endpoint-machine.ts's
// operatorRefusal). `--vm-setup` and `--vm-teardown` run vm/setup.sh and vm/teardown.sh's reach mode (RUN=o18) on the
// VM, which needs no MAWS checkout: the branch goes as a full bundle, staged in bounded steps, and each sminos as the
// run's own copy by commit (`git archive <commit> sminos` from the doperpowers checkout).
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { OrgState, SignedOrgState } from 'org-protocol';
import { checkTestHub, PRODUCTION_HOST, readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { addRunMember, afterEndpointCleanup, enrollScratch, endpointServing, OrgView, type Made } from './endpoint-acceptance';
import { composeScript, REACH_SCENES, ScriptRunner, VmMachine, type ReachSceneName } from './endpoint-machine';
import { RelayDialer, type RunDevice } from './endpoint-remote';
import { ItemReport, Secrets } from './endpoint-verdicts';
import { Person } from './hub';
import { loadAdminDevice, OrgAdmin } from './org-admin';
import { Cleanup, interruptible, isTestTarget, STEP_MS, type InterruptOptions } from './proof';
import { CITED, REACH_ITEMS, runReachItems, type Probe, type ReachItem, type ReachMachine, type ReachScene, type ReachSession } from './reach-items';
import { connectEndpoint, echoingEndpoint } from './rl1';

/** The sminos the scenes run, by commit (M6's pins): 1.39.0 or later for A1, A2 and B1; 1.34.0 for A3. */
export const SMINOS_FLOOR = '0759115d';
export const SMINOS_OLD = '386c4b07';
export const DOPERPOWERS = '/Users/new/Developer/GitHub/doperpowers';
/** Where the bundle is staged on the VM, root's alone, before setup.sh takes it. */
export const BUNDLE_PATH = '/var/tmp/o18-m6-stage/maws.bundle';
/** One staging step's share of the bundle: 24 MiB, 32 MiB as base64. */
export const CHUNK = 24 * 1024 * 1024;
const CLEANUP_STEP_MS = 4 * STEP_MS;
const REQUEST_MS = 30_000;

// ---- the command line -----------------------------------------------------------------------------------------------

export const OPTIONS = {
  config: { type: 'string' },
  'device-keys': { type: 'string' },
  items: { type: 'string' },
  vm: { type: 'string' },
  devcloud: { type: 'string', default: 'devcloud' },
  'direct-url': { type: 'string' },
  scratch: { type: 'string' },
  scan: { type: 'string' },
  'vm-setup': { type: 'boolean', default: false },
  'vm-teardown': { type: 'boolean', default: false },
  repo: { type: 'string' },
  doperpowers: { type: 'string', default: DOPERPOWERS },
  sminos: { type: 'string', default: SMINOS_FLOOR },
  'old-sminos': { type: 'string', default: SMINOS_OLD },
  production: { type: 'boolean', default: false },
} as const;
export type Values = { [K in keyof typeof OPTIONS]?: string | boolean };

/** The command line's mode, or why it is refused: staging's config and the admin device's keys, or the VM's setup or
 * teardown; production never, by name. */
export function reachMode(values: Values, config: { worker: string; host: string } | null): { mode: 'staging' | 'vm-setup' | 'vm-teardown' } | { refused: string } {
  if (values.production === true) return { refused: 'the reach acceptance runs on staging alone: production is never its hub' };
  if (values['vm-setup'] && values['vm-teardown']) return { refused: '--vm-setup and --vm-teardown are one at a time' };
  if (values['vm-setup'] || values['vm-teardown']) return { mode: values['vm-setup'] ? 'vm-setup' : 'vm-teardown' };
  if (config === null) return { refused: '--config <deploy config>: the hub to run against' };
  if (config.host === PRODUCTION_HOST || config.worker === 'desk-hub') return { refused: `the config names production (${config.host}): the reach acceptance runs on staging alone` };
  if (!values['device-keys']) return { refused: '--device-keys <file>: the staging admin device whose step-up key signs the org state' };
  return { mode: 'staging' };
}

/** The items a run runs, in the run's order: those named, else all. */
export function reachItemsFor(given: string | undefined): { items: ReachItem[] } | { refused: string } {
  if (given === undefined) return { items: [...REACH_ITEMS] };
  const named = given.split(',').map((item) => item.trim());
  const unknown = named.filter((item) => !(REACH_ITEMS as readonly string[]).includes(item));
  if (unknown.length) return { refused: `--items names items among ${REACH_ITEMS.join(',')} (6a is cited, not run), not ${unknown.join(',')}` };
  return { items: REACH_ITEMS.filter((item) => named.includes(item)) };
}

// ---- the VM's setup -------------------------------------------------------------------------------------------------

/** mawsd's pinned Node (packaging/mawsd/node.json), which setup.sh unpacks where the VM's is below MAWS's floor. */
export function nodePin(json: string): { version: string; x64: string; arm64: string } {
  const pin = JSON.parse(json) as { version?: unknown; sha256?: Record<string, unknown> };
  const [version, x64, arm64] = [pin.version, pin.sha256?.['linux-x64'], pin.sha256?.['linux-arm64']];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || typeof x64 !== 'string' || !/^[0-9a-f]{64}$/.test(x64) || typeof arm64 !== 'string' || !/^[0-9a-f]{64}$/.test(arm64)) throw new Error('packaging/mawsd/node.json pins no Linux Node');
  return { version, x64, arm64 };
}

/** The lines setup.sh's reach mode is given before its body, each a checked id. */
export function reachSetupHead(o: { commit: string; bundleSha256: string; sminosNew: string; sminosOld: string; node: { version: string; x64: string; arm64: string } }): string {
  for (const [what, id] of [
    ['commit', o.commit],
    ['new sminos', o.sminosNew],
    ['old sminos', o.sminosOld],
  ]) if (!/^[0-9a-f]{40}$/.test(id)) throw new Error(`the ${what} is not a full commit id: ${JSON.stringify(id).slice(0, 60)}`);
  if (!/^[0-9a-f]{64}$/.test(o.bundleSha256)) throw new Error('the bundle’s sha256 is not one');
  return `RUN=o18\nCOMMIT='${o.commit}'\nBUNDLE='${BUNDLE_PATH}'\nBUNDLE_SHA256='${o.bundleSha256}'\nSMINOS_NEW='${o.sminosNew}'\nSMINOS_OLD='${o.sminosOld}'\nNODE_PIN='${o.node.version}'\nNODE_SHA256_X64='${o.node.x64}'\nNODE_SHA256_ARM64='${o.node.arm64}'\n`;
}

/** The bundle staged on the VM in bounded steps: each a body appending one chunk (the first truncating the file). */
export function bundleSteps(bundle: Buffer, chunk = CHUNK): string[] {
  const steps: string[] = [];
  for (let at = 0, i = 0; at < bundle.length; at += chunk, i++) {
    const part = bundle.subarray(at, at + chunk).toString('base64').replace(/(.{76})/g, '$1\n');
    const open = i === 0 ? `install -d -m 700 ${BUNDLE_PATH.slice(0, BUNDLE_PATH.lastIndexOf('/'))} && : > ${BUNDLE_PATH} && chmod 600 ${BUNDLE_PATH} || exit 1\n` : `[[ -f ${BUNDLE_PATH} ]] || exit 1\n`;
    steps.push(`${open}base64 -d >> ${BUNDLE_PATH} <<'O18_M6_B64' || exit 1\n${part}\nO18_M6_B64\nstat -c 'staged %s bytes' ${BUNDLE_PATH}`);
  }
  return steps;
}

/** The files setup.sh's reach stage holds. */
export function reachSetupPayload(app: string, repo: string, sminos: { new: Buffer; old: Buffer }): Record<string, Buffer> {
  const vm = join(app, 'deploy', 'vm');
  return {
    'scene.sh': readFileSync(join(vm, 'scene.sh')),
    'stub-model.mjs': readFileSync(join(vm, 'stub-model.mjs')),
    'stub-api.mjs': readFileSync(join(repo, 'spikes', 'protocol-probe', 'stub-api.mjs')),
    'sminos-new.tar': sminos.new,
    'sminos-old.tar': sminos.old,
  };
}

function output(command: string, args: string[], { binary = false }: { binary?: boolean } = {}): Promise<Buffer> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.resume();
    child.once('exit', (status) => (status === 0 ? done(Buffer.concat(chunks)) : fail(new Error(`${command} ${args.slice(0, 3).join(' ')}${binary ? '' : ' …'} exited ${status}`))));
  });
}
const gitId = async (repo: string, rev: string) => (await output('git', ['-C', repo, 'rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`])).toString().trim();

async function vmSetup(o: { app: string; repo: string; doperpowers: string; sminos: string; oldSminos: string; runner: ScriptRunner; scratch: string; print: (line: string) => void }): Promise<number> {
  const commit = await gitId(o.repo, 'HEAD');
  const sminosNew = await gitId(o.doperpowers, o.sminos);
  const sminosOld = await gitId(o.doperpowers, o.oldSminos);
  const floor = await gitId(o.doperpowers, SMINOS_FLOOR);
  if (sminosNew !== floor && (await output('git', ['-C', o.doperpowers, 'merge-base', '--is-ancestor', floor, sminosNew]).then(() => false, () => true))) {
    o.print(`--sminos ${o.sminos} is not ${SMINOS_FLOOR} (sminos 1.39.0) or later`);
    return 2;
  }
  const tar = async (id: string) => output('git', ['-C', o.doperpowers, 'archive', '--format=tar', id, 'sminos'], { binary: true });
  const bundleFile = join(o.scratch, `maws-${process.pid}.bundle`);
  await output('git', ['-C', o.repo, 'bundle', 'create', bundleFile, 'HEAD']);
  const bundle = readFileSync(bundleFile);
  rmSync(bundleFile, { force: true });
  const sha = createHash('sha256').update(bundle).digest('hex');
  const steps = bundleSteps(bundle);
  o.print(`the branch at ${commit.slice(0, 12)}: a full bundle of ${bundle.length} bytes in ${steps.length} step(s); sminos ${sminosNew.slice(0, 12)} and ${sminosOld.slice(0, 12)}`);
  for (const [i, body] of steps.entries()) {
    const r = await o.runner.step(`stage-bundle-${i + 1}-of-${steps.length}`, body, { root: true, ms: 15 * 60_000 });
    if (r.rc !== 0) {
      for (const line of r.lines.slice(-5)) o.print(line);
      return 1;
    }
  }
  const head = reachSetupHead({ commit, bundleSha256: sha, sminosNew, sminosOld, node: nodePin(readFileSync(join(o.repo, 'packaging', 'mawsd', 'node.json'), 'utf8')) });
  const files = reachSetupPayload(o.app, o.repo, { new: await tar(sminosNew), old: await tar(sminosOld) });
  const script = composeScript(`${head}${readFileSync(join(o.app, 'deploy', 'vm', 'setup.sh'), 'utf8')}`, files, { trace: 'o18-setup' });
  const result = await o.runner.step('reach-setup', script, { root: true, ms: 45 * 60_000, composed: true });
  for (const line of result.lines) o.print(line);
  return result.rc === 0 ? 0 : 1;
}

// ---- the scene ------------------------------------------------------------------------------------------------------

export type ReachRunOptions = {
  person: Person;
  config: { host: string; org: { id: string }; orgGenesis?: string };
  device: Awaited<ReturnType<typeof loadAdminDevice>>;
  vm: (scene: ReachSceneName) => VmMachine;
  items: readonly ReachItem[];
  cleanup: Cleanup;
  secrets: Secrets;
  print?: (line: string) => void;
  tag?: string;
};

/** The run's scene, each undoing registered on the cleanup before what it undoes (reach-items.ts's ReachScene). */
export async function buildReachScene(o: ReachRunOptions & { tag: string }, made: Made, log: (line: string) => void): Promise<{ scene: ReachScene; machines: VmMachine[] }> {
  const { person, cleanup, tag } = o;
  const admin = await OrgAdmin.open(person, { org: o.config.org.id, pinnedGenesis: o.config.orgGenesis }, o.device, log);
  const view = new OrgView(person);
  await view.reread();
  const amend = async (what: string, edit: (s: OrgState) => void | boolean): Promise<SignedOrgState | null> => {
    const signed = await admin.amend(what, edit);
    await view.refresh();
    return signed;
  };
  const me = await person.json<{ member: { id: string; email: string } }>('/api/me');
  const a = { member: admin.member, email: me.member.email, device: { member: admin.member, id: o.device.id, clientClass: 'native-mac', channel: o.device.channel, stepUp: o.device.stepUp } as RunDevice };
  const bEmail = `o18-m6-${tag}@staging.invalid`;
  const bDevice = await addRunMember(admin, amend, cleanup, made, { email: bEmail, deviceId: `o18-${tag}-b1` });
  const b = { member: bDevice.member, email: bEmail, device: bDevice };
  const project = { id: randomUUID(), name: `o18-m6-${tag}` };
  const vms: VmMachine[] = [];
  const sessions: string[] = [];

  const sceneUp = async (name: ReachSceneName, owner: string): Promise<ReachMachine> => {
    const vm = o.vm(name);
    vms.push(vm);
    cleanup.add(`end the scene ${name}`, async () => {
      const left = await vm.down();
      if (left.length) throw new Error(left.join('; '));
    });
    cleanup.add(`recover the sessions the scene ${name} started`, async () => {
      for (const id of await vm.laneA.started()) if (!sessions.includes(id)) sessions.push(id);
    });
    await vm.up();
    const machineName = `o18-${name}-${tag}`;
    const { ref } = await enrollScratch(admin, view, vm, machineName, made, cleanup, (value) => o.secrets.add(value), owner === a.member ? undefined : [owner]);
    const { status, bound } = await endpointServing(vm, view);
    log(`${machineName} (scene ${name}): enrolled and listed for ${owner === a.member ? 'the admin' : 'B'}, ref ${ref}, at version ${status.stateVersion}, the direct listener ${bound}`);
    return { scene: name, vm, name: machineName, ref, owner };
  };
  const sessionUp = async (label: string, m: ReachMachine): Promise<ReachSession> => {
    const up = await m.vm.laneA.up(project);
    sessions.push(up.session);
    log(`${label}: session ${up.session} (${up.alias}${up.short ? `#${up.short}` : ''}) on ${m.name}`);
    return { label, session: up.session, alias: up.alias, ...(up.short === undefined ? {} : { short: up.short }), machine: m };
  };
  const probe = async (name: string, owner: string, capabilities: string[] | undefined): Promise<Probe> => {
    made.machines.push(name);
    const machine = await admin.listedMachine(name, cleanup, undefined, { owners: [owner] });
    o.secrets.add(machine.credentials.clientSecret);
    await view.refresh();
    const endpoint = echoingEndpoint(person.hub, machine, capabilities === undefined ? {} : { capabilities });
    cleanup.add(`close ${name}'s RL1 socket`, async () => endpoint.close());
    const welcome = await connectEndpoint(endpoint);
    log(`${name}: a probe machine of ${owner === a.member ? 'the admin' : 'B'}'s, its hello ${capabilities ? `advertising ${capabilities.join(',')}` : 'advertising nothing'}`);
    return { name, machine, endpoint, welcome };
  };

  // The undoing the run's own acts need, registered before them: the archive designation cleared, then S's share with B
  // and the seats (the cleanup runs last-added first, so these run before the scenes end).
  let designated = false;
  const designate = async (machine: string | null) => {
    if (machine !== null) designated = true;
    await person.json(`/api/projects/${project.id}/archive`, { method: 'PUT', body: { machine } });
    log(`the project's archive ${machine === null ? 'designation cleared' : `designated to ${machine}`}`);
  };

  const machines = { a1: await sceneUp('a1', a.member), a2: await sceneUp('a2', a.member), b1: await sceneUp('b1', b.member) };
  // The head moved with each enrollment: every endpoint at the last one before anything runs on it.
  for (const m of Object.values(machines)) await endpointServing(m.vm, view);
  const pa = await probe(`o18-pa-${tag}`, a.member, undefined);
  const pb = await probe(`o18-pb-${tag}`, b.member, ['audience']);
  const relayA1 = new RelayDialer(person.hub, machines.a1.ref, () => person.headers);
  cleanup.add('close the relay to A1', async () => relayA1.close());

  cleanup.add('clear the archive designation', async () => void (designated && (await designate(null))));
  const S = await sessionUp('S', machines.a1);
  const T = await sessionUp('T', machines.a2);
  const U = await sessionUp('U', machines.b1);
  const seats: ReachScene['seats'] = {};
  cleanup.add('remove S’s share with B and retire the seats', async () => {
    const r = await S.machine.vm.asSession(S.session, { share: { member: S.session, person: b.member, grade: 'none' } });
    const failed = r.rc === 0 ? [] : [`S's share: ${r.lines.slice(-2).join(' / ')}`];
    for (const seat of [seats.L1, seats.C1]) if (seat) await seat.machine.vm.laneA.sminos.retire(seat.alias).catch((e: unknown) => failed.push(`${seat.alias}: ${String(e)}`));
    if (failed.length) throw new Error(failed.join('; '));
  });

  let a3: ReachSession | null = null;
  const run = { hub: { host: new URL(person.hub).host, org: o.config.org.id }, scenes: [...REACH_SCENES] as string[] };
  const scene: ReachScene = {
    hub: person.hub,
    org: view.chain[0].state.org,
    person,
    view,
    a,
    b,
    machines,
    bringA3: async () => (a3 ??= await sessionUp('A3', await sceneUp('a3', a.member))),
    pa,
    pb,
    project,
    S,
    T,
    U,
    seats,
    relayA1,
    designate,
    run,
    cleanup,
    log,
    tag,
    privateTokens: [],
  };
  made.kept.push(`the project ${project.id} (${project.name}) on staging and its log: plain writers, audience streams and tombstones; its registry rows and the bindings of the run’s sessions (${S.session}, ${T.session}, ${U.session} and the seats)`);
  return { scene, machines: vms };
}

// ---- the run --------------------------------------------------------------------------------------------------------

/** The run under `interruptible`: the scene, the items, the summary; then however it ends the cleanup and read-back. */
export function runReachAcceptance(o: ReachRunOptions, interrupt: InterruptOptions = {}): Promise<number> {
  const print = o.secrets.guard(o.print ?? console.log);
  const tag = o.tag ?? randomBytes(3).toString('hex');
  const made: Made = { machines: [], members: [], devices: [], kept: [] };
  checkTestHub(o.person.hub, 'run the reach acceptance against it');
  let vms: VmMachine[] = [];
  return interruptible(
    o.cleanup,
    async () => {
      print(`reach acceptance: hub ${o.person.hub}, items ${o.items.join(',')}, tag ${tag}`);
      const report = new ItemReport(['scene', ...o.items], print, o.cleanup.signal);
      const built = await buildReachScene({ ...o, tag }, made, print);
      vms = built.machines;
      await runReachItems(built.scene, report, o.items);
      const ok = report.summary();
      print(`CITED 6a: ${CITED['6a']}`);
      return ok ? 0 : 1;
    },
    async (status) => {
      o.cleanup.interrupt(status === 0 ? 'the run ended' : 'the run failed');
      for (const vm of vms) for (const step of await vm.settle()) print(`the step ${step} on ${vm.label} still ran when the run ended; the scene’s down stops it there`);
      const failed = await o.cleanup.run();
      const left = await afterEndpointCleanup(o.person, made, AbortSignal.timeout(STEP_MS)).catch((error: unknown) => [`the check after cleanup failed: ${error instanceof Error ? error.message : String(error)}`]);
      for (const line of [...failed.map((f) => `cleanup: ${f}`), ...left]) print(`LEFT ${line}`);
      if (failed.length === 0 && left.length === 0) print('cleanup: the head lists none of the run’s members, devices or machines, the hub holds none of its machines, and every scene is ended');
      for (const line of [...made.kept, 'the machines’ names in machineNames and their retired keys; the state’s new versions; staging at the M6 build']) print(`KEPT ${line}`);
      const code = failed.length || left.length ? 1 : status;
      print(`reach acceptance: ${code === 0 ? 'PASS' : 'FAIL'}`);
      return code;
    },
    interrupt,
  );
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: OPTIONS }) as unknown as { values: Values };
  const app = process.env.DESK_HUB_APP!;
  const configPath = (values.config as string | undefined) ?? (values['vm-setup'] || values['vm-teardown'] ? undefined : join(app, 'deploy', 'staging.json'));
  const config = configPath === undefined ? null : readDeployConfig(configPath);
  const chosen = reachMode(values, config);
  if ('refused' in chosen) {
    console.error(chosen.refused);
    return 2;
  }
  const chosenItems = reachItemsFor(values.items as string | undefined);
  if ('refused' in chosenItems) {
    console.error(chosenItems.refused);
    return 2;
  }
  if (typeof values.vm !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(values.vm)) {
    console.error('--vm <name>: the devcloud VM the scenes run on');
    return 2;
  }
  const scratch = (values.scratch as string | undefined) ?? join(process.env.HOME ?? '/tmp', '.local', 'share', 'o18-m6-scratch');
  mkdirSync(scratch, { recursive: true, mode: 0o700 });
  const ssh = { devcloud: values.devcloud as string, vm: values.vm };
  const print = (line: string) => console.log(line);

  if (chosen.mode === 'vm-setup') {
    const repo = (values.repo as string | undefined) ?? resolve(app, '..', '..');
    return vmSetup({ app, repo, doperpowers: values.doperpowers as string, sminos: values.sminos as string, oldSminos: values['old-sminos'] as string, runner: new ScriptRunner(ssh, scratch, print), scratch, print });
  }
  if (chosen.mode === 'vm-teardown') {
    const result = await new ScriptRunner(ssh, scratch, print).step('reach-teardown', `RUN=o18\n${readFileSync(join(app, 'deploy', 'vm', 'teardown.sh'), 'utf8')}`, { root: true, ms: 15 * 60_000 });
    for (const line of result.lines) print(line);
    return result.rc === 0 ? 0 : 1;
  }

  // The direct listeners are the scenes' own ports on the VM's tailnet address.
  const direct = values['direct-url'] as string | undefined;
  const host = direct === undefined ? null : /^wss?:\/\/([^\s/:]+|\[[0-9a-f:]+\])(?::\d+)?$/.exec(direct)?.[1];
  if (host === null || host === undefined) {
    console.error('--direct-url ws://<the VM’s tailnet address>: each scene’s direct listener is its own port there');
    return 2;
  }
  const secrets = new Secrets((values.scan as string | undefined) ?? null);
  const read = await readSecrets();
  if (!read.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  secrets.add(read.DESK_ACCESS_TOKEN);
  if (!isTestTarget(config!)) return 2;
  const cleanup = new Cleanup(CLEANUP_STEP_MS);
  const person = new Person(`https://${config!.host}`, read.DESK_ACCESS_TOKEN, () => cleanup.check(), { requestMs: REQUEST_MS, signal: cleanup.signal });
  const log = secrets.guard(print);
  const PORTS: Record<ReachSceneName, number> = { a1: 47841, a2: 47842, b1: 47843, a3: 47844 };
  return runReachAcceptance({
    person,
    config: config!,
    device: await loadAdminDevice(values['device-keys'] as string),
    vm: (scene) => new VmMachine(ssh, scratch, { directUrl: `ws://${host}:${PORTS[scene]}`, scene, log: (line) => log(`  vm ${scene}: ${line}`), gate: () => cleanup.check(), signal: cleanup.signal }),
    items: chosenItems.items,
    cleanup,
    secrets,
    print,
  });
}
