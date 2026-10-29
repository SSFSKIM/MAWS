// The endpoint acceptance run's production mode (P5 O10 M11's part 2, acceptance item 7 with O14's cutover): the same
// items against the devcloud acceptance VM's real, cut-over `mawsd`, which the run neither enrolls nor lists. It holds
// no admin key: its device pairs as a person's new device does, answering a code the owner mints with `production-run.sh
// admin pair --class native-mac` (read here from the clipboard, `pbpaste`, and never printed), through the person's
// pending devices (`POST /api/devices/pending`, its entry MAC'd under the code's pairing secret `k`), and the owner
// approves it there. At the end the owner removes it (`production-run.sh admin remove-device <id>`) while the run
// watches its channel close `removed` (item 3) and the revocation reach the machine's sminos (item 5).
//
// endpoint-acceptance.ts reaches this only with `--production --confirm-production <production's host>` and a
// production config; nothing here runs otherwise. Its machine driver is vm/production.sh; the machine is pinned
// (PRODUCTION_MACHINE), and it and its sminos (checkSminosFloor) are checked before the owner is asked for anything.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { decodePairingCode, generateSigningKey, pairingFingerprint, pairingMac, base64urlDecode, type Device, type SignedOrgState } from 'org-protocol';
import { ORG_STATE_PATH, PENDING_DEVICES_PATH, type PendingDeviceRequest } from '../src/protocol/identity';
import { PRODUCTION_HOST } from './config';
import type { Person } from './hub';
import { VmMachine, type Ssh } from './endpoint-machine';
import type { RunDevice } from './endpoint-remote';
import type { Secrets } from './endpoint-verdicts';
import { runEndpointAcceptance } from './endpoint-acceptance';
import { PRODUCTION_ITEMS } from './endpoint-items';
import type { Cleanup } from './proof';

/** Where vm/production.sh would be installed on the VM (part 2's setup; never installed in part 1). */
export const PRODUCTION_SCENE = '/opt/o10-m11/production.sh';
/** The production machine the owner authorized for this run (2026-10-28), and no other: the devcloud acceptance VM's
 * cut-over mawsd, by its VM, its name and its ref. */
export const PRODUCTION_MACHINE = { vm: 'dc-acceptance-7f80', name: 'dc-acceptance-7f80', ref: '7872ff6c6ff6a58065ae0a68160b5dcb_AyQ4IqKLwVJ95-o2oc4zTA' } as const;

/** Throws unless `vm` is the authorized one and, given its `mawsd keys --json`, its machine is the pinned one, listed. */
export function checkProductionMachine(vm: string, keys?: Record<string, unknown>): void {
  if (vm !== PRODUCTION_MACHINE.vm) throw new Error(`the production run is authorized on ${PRODUCTION_MACHINE.vm} alone, not ${vm}`);
  if (keys === undefined) return;
  if (keys.enrollment !== 'org-listed') throw new Error(`${vm}'s mawsd is not org-listed (${String(keys.enrollment)})`);
  if (keys.name !== PRODUCTION_MACHINE.name) throw new Error(`${vm}'s mawsd is the machine ${String(keys.name)}, not the authorized ${PRODUCTION_MACHINE.name}`);
  if (keys.ref !== PRODUCTION_MACHINE.ref) throw new Error(`${vm}'s mawsd has the ref ${String(keys.ref)}, not the authorized ${PRODUCTION_MACHINE.ref}`);
}

/**
 * sminos on the VM at the floor lane A needs (vm/production.sh's `sminos-floor`, read only): the daemon of the owner's
 * SMINOS_HOME and the stub's copy both at 1.27.15 or later, the first that reads a session's engine files under the
 * config dir its hook recorded. Its one line; a refusal throws with that line, which names both versions.
 */
export async function checkSminosFloor(machine: VmMachine): Promise<string> {
  return (await machine.scene('sminos-floor', [], { what: 'the sminos floor' })).lines.at(-1) ?? '';
}

/** How long the owner has for a step by hand: arriving at the run included (the code on the clipboard, then the
 * approval, then the removal), so a run started ahead of the owner stays alive for them. */
const OWNER_MS = 45 * 60_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The clipboard's text, as `pbpaste` gives it: the owner's code, held in memory alone. */
export function readClipboard(command = 'pbpaste'): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(command, [], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => void (out += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.once('exit', (status) => {
      clearTimeout(timer);
      if (status === 0) done(out.trim());
      else fail(new Error(`${command} exited ${status}`));
    });
  });
}

/**
 * A device of the person's paired from `code` (a `pair --class native-mac` code): checked to be this hub's and this
 * person's, its keys made here, its entry sent to the person's pending devices with the MAC under the code's `k`, the
 * fingerprint printed for the owner to compare with the one `pair` shows, and the device returned once the head lists
 * it. The code and `k` go to `secrets` before anything else.
 */
export async function pairRunDevice(person: Person, code: string, secrets: Secrets, log: (line: string) => void, { id, approveMs = OWNER_MS, check = () => {} }: { id: string; approveMs?: number; check?: () => void }): Promise<RunDevice> {
  secrets.add(code);
  const pairing = decodePairingCode(code);
  if (pairing === null) throw new Error('the clipboard holds no pairing code');
  secrets.add(pairing.k);
  if (new URL(pairing.hub).origin !== new URL(person.hub).origin) throw new Error(`the pairing code is ${new URL(pairing.hub).origin}'s, not ${new URL(person.hub).origin}'s`);
  const me = await person.json<{ org: { id: string }; member: { id: string } }>('/api/me');
  if (pairing.org !== me.org.id || pairing.member !== me.member.id) throw new Error('the pairing code is another member’s or another org’s');
  const device: RunDevice = { member: me.member.id, id, clientClass: 'native-mac', channel: await generateSigningKey(), stepUp: await generateSigningKey() };
  const entry: Device = { id: device.id, class: 'native-mac', keyStorage: 'software', channelPub: device.channel.pub, stepUpPub: device.stepUp!.pub };
  const request: PendingDeviceRequest = { deviceId: entry.id, class: entry.class, keyStorage: entry.keyStorage, channelPub: entry.channelPub, stepUpPub: entry.stepUpPub, mac: await pairingMac(base64urlDecode(pairing.k), { org: pairing.org, member: pairing.member, device: entry }) };
  await person.json(PENDING_DEVICES_PATH, { body: request }, 201);
  log(`OWNER: approve ${device.id} in \`production-run.sh admin pair\`; its fingerprint is ${await pairingFingerprint(pairing.org, pairing.member, entry)}`);
  await waitForHead(person, (state) => state.members.some((m) => m.id === device.member && m.devices.some((d) => d.id === device.id && d.channelPub === entry.channelPub)), `${device.id} in the head`, approveMs, check);
  log(`${device.id}: listed in the head`);
  return device;
}

/** Waits until the head the hub serves holds for `holds`. */
export async function waitForHead(person: Person, holds: (state: SignedOrgState['state']) => boolean, what: string, ms: number, check: () => void = () => {}): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    check();
    const { head } = await person.json<{ head: SignedOrgState | null }>(ORG_STATE_PATH);
    if (head !== null && holds(head.state)) return;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms / 1000} s`);
    await sleep(3000);
  }
}

export type ProductionOptions = {
  person: Person;
  items: readonly string[];
  cleanup: Cleanup;
  secrets: Secrets;
  ssh: Ssh;
  scratch: string;
  directUrl: string;
  log: (line: string) => void;
  /** The file whose appearance says the owner's code is on the clipboard (the controller touches it). */
  ready: string;
  readCode?: () => Promise<string>;
  readyMs?: number;
  /** The run's interruption, for the machine's steps (ScriptRunner's `gate` and `signal`). */
  interruption?: { gate: () => void; signal: AbortSignal };
};

/** Waits until `file` exists, within `ms`; `check` (the run's interruption) is asked each second. */
export async function waitForFile(file: string, ms: number, check: () => void = () => {}): Promise<void> {
  const deadline = Date.now() + ms;
  while (!existsSync(file)) {
    check();
    if (Date.now() > deadline) throw new Error(`${file} did not appear within ${ms / 60_000} min`);
    await sleep(1000);
  }
}

/**
 * The production run: refused unless the hub is production's own. The device's id is printed first and its pairing
 * made inside the run, so the owner's removal of it is the cleanup's and the read-back's however the run ends; then the
 * items production allows (endpoint-items.ts's `PRODUCTION_CLAUSES`), and the owner's removal.
 */
export async function productionRun(o: ProductionOptions): Promise<number> {
  if (new URL(o.person.hub).hostname !== PRODUCTION_HOST) throw new Error(`the production run is production's alone, not ${o.person.hub}'s`);
  checkProductionMachine(o.ssh.vm);
  const outside = o.items.filter((item) => !(PRODUCTION_ITEMS as readonly string[]).includes(item));
  if (outside.length) throw new Error(`production runs items ${PRODUCTION_ITEMS.join(',')} alone, not ${outside.join(',')}`);
  const tag = randomBytes(3).toString('hex');
  const id = `o10-p-${tag}`;
  const readyMs = o.readyMs ?? OWNER_MS;
  const check = () => o.cleanup.check();
  const pair = async () => {
    rmSync(o.ready, { force: true });
    o.log(`OWNER: the run's device will be ${id}. Run \`production-run.sh admin pair --class native-mac\`; once its code is on the clipboard, touch ${o.ready} (the run waits ${readyMs / 60_000} min, then reads the clipboard and never prints it)`);
    await waitForFile(o.ready, readyMs, check);
    rmSync(o.ready, { force: true });
    return pairRunDevice(o.person, await (o.readCode ?? readClipboard)(), o.secrets, o.log, { id, check });
  };
  const machine = new VmMachine(o.ssh, o.scratch, { directUrl: o.directUrl, log: (line) => o.log(`  vm: ${line}`), script: PRODUCTION_SCENE, label: `the production mawsd on ${o.ssh.vm}`, ...o.interruption });
  // Before the run writes anything or asks the owner for anything: a lane A that sminos cannot see would fail item 2.
  o.log(`  vm: ${await checkSminosFloor(machine)}`);
  const ownerStep = async (what: string, done: () => Promise<boolean>) => {
    o.log(`OWNER: ${what}`);
    const deadline = Date.now() + OWNER_MS;
    while (!(await done())) {
      check();
      if (Date.now() > deadline) throw new Error(`the owner's step was not taken within ${OWNER_MS / 60_000} min: ${what}`);
      await sleep(3000);
    }
  };
  return runEndpointAcceptance({ target: 'production', person: o.person, machine, items: o.items, cleanup: o.cleanup, secrets: o.secrets, print: o.log, admin: null, production: { id, pair, ownerStep, machine: PRODUCTION_MACHINE, checkMachine: (keys) => checkProductionMachine(o.ssh.vm, keys) }, tag });
}
