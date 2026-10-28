// `deployment admin`: the owner's hand on a deployment's org state before O8's Org page (P5 O13 M2, Interfaces §F;
// RL DL28). It holds an admin device of its own (`init`: a channel key and a step-up key in a 0600 keys file), roots the
// deployment's org with it (`genesis`, the org's recovery key written only to an offline destination and checked back),
// or anchors an org rooted before it (`adopt`); then pairs a device (`pair`, RL §5.3 with the package's pairing code,
// MAC and fingerprint), lists and revokes devices, and signs the weekly no-change successor the endpoint's 30-day
// backstop needs (`refresh`).
//
//   deployment admin <init | genesis | adopt | refresh | pair | devices | remove-device> [--config deploy/<file>.json]
//                    [--keys <file>] [--hub <url> --user <email> [--yes]] [--recovery <path | paper>]
//                    [--class web-cards|native-mac] [--ttl <s>] [<device id>]
//
// It acts on the deployment `--config` names (production's config.json by default; `checkTestHub` does not apply, and an
// agent never runs it against production), as the signed-in owner: `DESK_ACCESS_TOKEN` on stdin, as the other commands
// take it. `--hub <loopback url> --user <email>` acts on the suites' local hub through its stand-in identity instead,
// where `--yes` may answer the confirmations. Against a deployment `genesis`, `pair` and `remove-device` open /dev/tty
// before any request and confirm there: a shell with no controlling terminal, an agent's, stops at that open and sends
// nothing. The pairing code and a paper recovery key go to the terminal alone, never to stdout, so a runner's log never
// holds them.
//
// Where it may write: the deployment's own org under the anchor `<keys>.org.json` ({hub, org, genesis, version, roots,
// recoveryPub}), written by `genesis` or `adopt`. Every other subcommand reads the chain from its genesis, verifies it
// against the anchor's pins (`verifyPinnedChain`), refuses another genesis or a head older than the anchor's version,
// and moves the version forward. A throwaway org is not an option.
import { closeSync, existsSync, openSync, readSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  base64urlEncode,
  canonicalize,
  encodePairingCode,
  endorseDevice,
  isDevice,
  keyId,
  pairingFingerprint,
  signOrgState,
  stateHash,
  verifyGenesis,
  verifyPairingMac,
  verifyPinnedChain,
  type Device,
  type OrgState,
  type SignedOrgState,
} from 'org-protocol';
import { readJsonFile } from '../fake-machine/json-file';
import { IDENTITY_HEADER } from '../local/standin';
import { ORG_STATE_PATH, PENDING_DEVICE_TTL_S, PENDING_DEVICES_PATH, type OrgStateView, type PendingDevice } from '../src/protocol/identity';
import {
  holdsRecoveryKey,
  keysPlacementProblem,
  machinePlacement,
  newRecoveryKey,
  paperText,
  readAdminKeys,
  readText,
  recoveryFileText,
  recoveryPlacementProblem,
  typedBackMatches,
  volumeOf,
  writeAdminKeys,
  writeNewFile,
  type AdminKeys,
  type Placement,
} from './admin-device';
import { checkTarget, readDeployConfig, type DeployConfig } from './config';
import { readSecrets } from './deploy';
import { Person } from './hub';
import { deviceEntry, successor } from './org-admin';

export const SUBCOMMANDS = ['init', 'genesis', 'adopt', 'refresh', 'pair', 'devices', 'remove-device'] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];
/** What signs only after the owner says so at the terminal. */
const CONFIRMING: readonly Subcommand[] = ['genesis', 'pair', 'remove-device'];
/** How often `pair` reads the pending list. */
export const PAIR_POLL_MS = 2000;
const DAY_MS = 86_400_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Where confirmations, the pairing code and a paper key go: /dev/tty against a deployment. */
export type Terminal = { write(text: string): void; readLine(): Promise<string> };

/** What the command reaches beyond the hub, each a suite's to replace. */
export type AdminIo = {
  out(line: string): void;
  err(line: string): void;
  /** The terminal: /dev/tty for a deployment (throws when the shell has none), stdin and stdout for the local hub. */
  openTerminal(deployment: boolean): Terminal;
  /** NAME=value lines on stdin (deploy.ts). */
  secrets(): Promise<Record<string, string | undefined>>;
  /** Runs a command (`tmutil`, `pbcopy`), `input` on its stdin; rejects unless it exits 0. */
  exec(command: string, args: string[], input?: string): Promise<void>;
  volumeOf(path: string): unknown;
  readText(path: string): string;
  placement: Placement;
  env: Record<string, string | undefined>;
  /** The app's directory, whose deploy/config.json is the default deployment. */
  appDir: string;
  sleep(ms: number): Promise<void>;
};

/** The command's refusal: its message is the line the owner reads, and nothing was signed past the point it names. */
class Refusal extends Error {}
function refuse(message: string): never {
  throw new Refusal(message);
}

/** A person signed in through the local stand-in's test identity (local/standin.ts), in place of an Access token. */
class StandinPerson extends Person {
  constructor(
    hub: string,
    private readonly email: string,
  ) {
    super(hub, 'unused');
  }
  override get headers(): Record<string, string> {
    return { [IDENTITY_HEADER]: this.email };
  }
}

/** The anchor: what this keys file's device signs for, and the newest version it has seen. */
export type Anchor = { hub: string; org: string; genesis: string; version: number; roots: string[]; recoveryPub: string };
export const anchorFile = (keys: string) => `${keys}.org.json`;
export const genesisFile = (keys: string) => `${keys}.genesis.json`;

function readAnchor(keys: string): Anchor | null {
  const file = anchorFile(keys);
  if (!existsSync(file)) return null;
  const a = readJsonFile<Partial<Anchor> | null>(file, 'an anchor');
  const ok =
    a !== null &&
    typeof a.hub === 'string' &&
    typeof a.org === 'string' &&
    typeof a.genesis === 'string' &&
    Number.isSafeInteger(a.version) &&
    Array.isArray(a.roots) &&
    a.roots.every((r) => typeof r === 'string') &&
    typeof a.recoveryPub === 'string';
  if (!ok) refuse(`${file} is not an anchor ({hub, org, genesis, version, roots, recoveryPub})`);
  return a as Anchor;
}

/** Writes the anchor whole (a new file renamed over the old), 0600. */
function writeAnchor(keys: string, anchor: Anchor): void {
  const file = anchorFile(keys);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(anchor)}\n`, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/** "head version n, issued d days ago": every subcommand's first line, so the owner sees the backstop's clock. */
export function ageLine(head: SignedOrgState | null, now = new Date()): string {
  if (head === null) return 'head: none';
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(head.state.issued)) / DAY_MS));
  return `head version ${head.state.version}, issued ${days} day${days === 1 ? '' : 's'} ago`;
}

type Served = { chain: SignedOrgState[]; head: SignedOrgState | null; transitions: OrgStateView['transitions'] };

/** The org state the hub serves, its chain read from the genesis page by page. */
async function readServed(person: Person): Promise<Served> {
  const chain: SignedOrgState[] = [];
  let page: OrgStateView;
  for (;;) {
    page = await person.json<OrgStateView>(`${ORG_STATE_PATH}?since=${chain.at(-1)?.state.version ?? 0}`);
    chain.push(...(page.chain ?? []));
    if (!page.more || (page.chain ?? []).length === 0) break;
  }
  return { chain, head: page.head, transitions: page.transitions };
}

/**
 * The served chain verified against the anchor: its genesis the anchor's, every state verified from it and anchored to
 * the anchor's pins, the served head the chain's last, and no older than the anchor's version.
 */
async function verifiedHead(person: Person, anchor: Anchor): Promise<SignedOrgState> {
  const served = await readServed(person);
  if (served.chain.length === 0 || served.head === null) refuse(`${anchor.org} serves no org state, but this device anchors its genesis ${anchor.genesis}: refusing`);
  const genesis = await stateHash(served.chain[0].state);
  if (genesis !== anchor.genesis) refuse(`the hub's genesis hashes to ${genesis}, not the anchor's ${anchor.genesis}: not this org's chain`);
  const run = await verifyPinnedChain(served.chain, served.transitions, { roots: anchor.roots, recoveryPub: anchor.recoveryPub });
  if (!run.ok) refuse(`the hub's chain does not verify against the anchor's pins: ${run.code}`);
  if (run.adopted.length !== served.chain.length) refuse(`the hub's chain breaks at version ${run.adopted.length + 1}`);
  if (canonicalize(run.head) !== canonicalize(served.head)) refuse(`the hub's head is not its chain's last state (version ${run.head.state.version})`);
  if (run.head.state.version < anchor.version) refuse(`the hub's head is version ${run.head.state.version}, older than the version ${anchor.version} this device has seen: refusing`);
  return run.head;
}

/** Why `keys`'s device cannot sign the head's successors for `member`, or null. */
async function signerProblem(head: OrgState, member: string, keys: AdminKeys): Promise<string | null> {
  const holder = head.members.find((m) => m.devices.some((d) => d.id === keys.id));
  const device = holder?.devices.find((d) => d.id === keys.id);
  if (!holder || !device || holder.id !== member || device.channelPub !== keys.channel.pub || device.stepUpPub !== keys.stepUp.pub) {
    return `the head (version ${head.version}) does not list device ${keys.id} with these keys under ${member}`;
  }
  if (!head.root.keys.includes(await keyId(keys.stepUp.pub))) return `device ${keys.id}'s step-up key is not a root key of the head (version ${head.version})`;
  return null;
}

/** A device entry as the pending list carries it, rebuilt as the state would list it (no endorsement yet). */
function entryDevice(entry: PendingDevice): Omit<Device, 'endorsement'> {
  const device: Record<string, unknown> = { id: entry.deviceId, class: entry.class, keyStorage: entry.keyStorage, channelPub: entry.channelPub };
  if (entry.stepUpPub !== undefined) device.stepUpPub = entry.stepUpPub;
  if (entry.passkey !== undefined) device.passkey = entry.passkey;
  return device as Omit<Device, 'endorsement'>;
}

/**
 * Whether a pending entry answers this pairing: the device a state could list, of the class asked for, its MAC under
 * `k` over the org, the member and the whole entry, and not a device the head already lists. Otherwise why not.
 */
export async function judgeEntry(
  entry: PendingDevice,
  pairing: { org: string; member: string; k: Uint8Array; class: Device['class']; listed: Set<string> },
): Promise<{ ok: true; device: Omit<Device, 'endorsement'> } | { ok: false; why: string }> {
  const device = entryDevice(entry);
  if (device.class === 'web-cards' && device.stepUpPub !== undefined) return { ok: false, why: 'a web-cards entry with a step-up key, which the class never holds (RL §5.10)' };
  if (!isDevice(device)) return { ok: false, why: 'not a device entry the org state could list' };
  if (device.class !== pairing.class) return { ok: false, why: `of class ${device.class}, not ${pairing.class}` };
  if (device.class === 'web-cards' && device.passkey === undefined) return { ok: false, why: 'a web-cards entry with no passkey' };
  if (!(await verifyPairingMac(pairing.k, { org: pairing.org, member: pairing.member, device }, entry.mac))) return { ok: false, why: "its MAC is not under this code's secret" };
  if (pairing.listed.has(device.id)) return { ok: false, why: 'its id is a device the head already lists' };
  return { ok: true, device };
}

const describeEntry = (d: Omit<Device, 'endorsement'>) => `${d.id} ${d.class} ${d.keyStorage} rpId ${d.passkey?.rpId ?? '-'}`;

type Context = {
  sub: Subcommand;
  io: AdminIo;
  values: Record<string, unknown>;
  positionals: string[];
  keysPath: string;
  local: boolean;
  hub: string;
  config: DeployConfig | null;
  person: () => Promise<Person>;
  terminal: () => Terminal;
  yes: boolean;
};

/** The signed-in member as `/api/me` names them, in the org the config names (when one is given). */
async function signedIn(ctx: Context, person: Person): Promise<{ org: string; member: { id: string; email: string } }> {
  const me = await person.json<{ org: { id: string }; member: { id: string; email: string } }>('/api/me');
  if (ctx.config !== null && me.org.id !== ctx.config.org.id) refuse(`the deployment serves the org ${me.org.id}, not the config's ${ctx.config.org.id}: refusing`);
  return { org: me.org.id, member: me.member };
}

/** Asks `question` at the terminal (`--yes` answers it at the local hub); true for y or yes. */
async function confirm(ctx: Context, question: string): Promise<boolean> {
  if (ctx.yes) {
    ctx.io.out(`${question} yes (--yes)`);
    return true;
  }
  const terminal = ctx.terminal();
  terminal.write(`${question} `);
  return /^\s*y(es)?\s*$/i.test(await terminal.readLine());
}

/** Posts a signed state: `ok`, `not-head` (the head moved), or throws with the hub's refusal. */
async function post(person: Person, signed: SignedOrgState): Promise<'ok' | 'not-head'> {
  const response = await person.fetch(ORG_STATE_PATH, { body: signed });
  const text = await response.text();
  if (response.status === 201) return 'ok';
  if (response.status === 409 && text.includes('"not-head"')) return 'not-head';
  return refuse(`the hub refused version ${signed.state.version}: ${response.status} ${text.slice(0, 300)}`);
}

/** The anchored org, the head verified, and the signed-in member's device able to sign its successors. */
async function anchored(ctx: Context, needsSigner: boolean) {
  const anchor = readAnchor(ctx.keysPath) ?? refuse('no anchor: run genesis or adopt');
  if (anchor.hub !== ctx.hub) refuse(`this device anchors ${anchor.org} at ${anchor.hub}, not ${ctx.hub}`);
  if (ctx.config?.orgGenesis !== undefined && ctx.config.orgGenesis !== anchor.genesis) refuse(`the anchor's genesis ${anchor.genesis} is not the config's orgGenesis ${ctx.config.orgGenesis}`);
  const keys = await readAdminKeys(ctx.keysPath);
  const person = await ctx.person();
  const me = await signedIn(ctx, person);
  if (me.org !== anchor.org) refuse(`the deployment serves the org ${me.org}, not the anchor's ${anchor.org}`);
  const head = await verifiedHead(person, anchor);
  ctx.io.out(ageLine(head));
  if (head.state.version > anchor.version) writeAnchor(ctx.keysPath, { ...anchor, version: head.state.version });
  if (needsSigner) {
    const problem = await signerProblem(head.state, me.member.id, keys);
    if (problem) refuse(`${problem}: this device cannot sign its successors`);
  }
  return { anchor, keys, person, me, head };
}

/**
 * A successor of the verified head, changed by `edit`, signed by the admin device and posted; a head that moved meanwhile
 * (`not-head`) is read and verified again and the edit made anew, once.
 */
async function amend(ctx: Context, from: Awaited<ReturnType<typeof anchored>>, edit: (state: OrgState) => Promise<void> | void): Promise<SignedOrgState> {
  let head = from.head;
  for (let attempt = 0; ; attempt++) {
    const next = await successor(head.state, () => {});
    await edit(next);
    const signed = await signOrgState(next, [from.keys.stepUp]);
    if ((await post(from.person, signed)) === 'ok') {
      writeAnchor(ctx.keysPath, { ...from.anchor, version: next.version });
      return signed;
    }
    if (attempt > 0) refuse(`the head moved twice while version ${next.version} was signed: run it again`);
    ctx.io.out(`the head moved (not-head): reading it again`);
    head = await verifiedHead(from.person, { ...from.anchor, version: head.state.version });
    const problem = await signerProblem(head.state, from.me.member.id, from.keys);
    if (problem) refuse(problem);
  }
}

// ---- The subcommands ------------------------------------------------------------------------------------------------

async function init(ctx: Context): Promise<number> {
  const problem = keysPlacementProblem(ctx.keysPath, ctx.io.placement);
  if (problem) refuse(`${problem}: no keys written`);
  if (existsSync(ctx.keysPath)) refuse(`${ctx.keysPath} exists: an admin device's keys are never written over`);
  const keys = await writeAdminKeys(ctx.keysPath);
  ctx.io.out(`keys written: ${ctx.keysPath} (device ${keys.id})`);
  try {
    await ctx.io.exec('tmutil', ['addexclusion', ctx.keysPath]);
  } catch (error) {
    refuse(`tmutil addexclusion ${ctx.keysPath} failed (${error instanceof Error ? error.message : String(error)}): exclude it from Time Machine before you go on`);
  }
  ctx.io.out(`excluded from Time Machine: ${ctx.keysPath}`);
  return 0;
}

async function genesis(ctx: Context): Promise<number> {
  const recovery = ctx.values.recovery as string | undefined;
  if (!recovery) return refuse('genesis --recovery <path on the removable volume | paper>');
  const paper = recovery === 'paper';
  if (!paper) {
    const problem = recoveryPlacementProblem(recovery, ctx.keysPath, ctx.io.placement, { of: ctx.io.volumeOf, required: !ctx.local });
    if (problem) refuse(`${problem}: nothing was written`);
  }
  if (readAnchor(ctx.keysPath)) refuse(`${anchorFile(ctx.keysPath)} exists: this device anchors an org already, and genesis runs once`);
  const keys = await readAdminKeys(ctx.keysPath);
  const person = await ctx.person();
  const me = await signedIn(ctx, person);
  const served = await readServed(person);
  ctx.io.out(ageLine(served.head));
  const pending = existsSync(genesisFile(ctx.keysPath)) ? await pendingGenesis(ctx, keys, me.org) : null;
  const servedGenesis = served.chain.length > 0 ? await stateHash(served.chain[0].state) : null;

  // The recovery key's private half, read back from its destination or typed back, against `recoveryPub`.
  const checkBack = async (recoveryPub: string) => {
    if (paper) {
      const terminal = ctx.terminal();
      terminal.write('type the recovery key back, to check it: ');
      if (!typedBackMatches(await terminal.readLine(), recoveryPub)) refuse('the key typed back is not the recovery key shown: nothing was signed');
      ctx.io.out('recovery key typed back: matches recoveryPub');
    } else {
      if (!holdsRecoveryKey(ctx.io.readText(recovery), recovery, recoveryPub)) refuse(`the key read back from ${recovery} is not recoveryPub's pair: nothing was signed`);
      ctx.io.out(`recovery key written to ${recovery} and read back: matches recoveryPub`);
    }
  };
  const finish = async (signed: SignedOrgState, headVersion: number, said: string) => {
    const hash = await stateHash(signed.state);
    writeAnchor(ctx.keysPath, { hub: ctx.hub, org: me.org, genesis: hash, version: headVersion, roots: signed.state.root.keys, recoveryPub: signed.state.root.recoveryPub });
    rmSync(genesisFile(ctx.keysPath), { force: true });
    ctx.io.out(`${said}: version 1, orgGenesis ${hash}`);
    ctx.io.out(`recoveryPub ${signed.state.root.recoveryPub} kept in ${anchorFile(ctx.keysPath)}; set orgGenesis in the deployment's config and commit it`);
    return 0;
  };

  if (pending !== null) {
    // A run that stopped after building its genesis: the same bytes, never a second genesis.
    const hash = await stateHash(pending.state);
    if (servedGenesis !== null && servedGenesis !== hash) refuse(`the hub holds another genesis (${servedGenesis}, version ${served.head?.state.version}), not the one ${genesisFile(ctx.keysPath)} holds (${hash})`);
    await checkBack(pending.state.root.recoveryPub);
    if (servedGenesis === hash) return finish(pending, served.head!.state.version, 'genesis already at the hub');
    if (!(await confirm(ctx, `root ${me.org} at ${ctx.hub}? [y/N]`))) refuse('not rooted: nothing was posted');
    if ((await post(person, pending)) !== 'ok') refuse('the hub took a state meanwhile: run genesis again to see which');
    return finish(pending, 1, 'genesis posted');
  }

  if (served.head !== null) refuse(`the hub holds a state (version ${served.head.state.version}): genesis roots an org with none`);
  if (!paper && existsSync(recovery)) refuse(`${recovery} exists: the recovery key is never written over a file; move it aside or name another path`);
  const key = await newRecoveryKey();
  if (paper) {
    ctx.terminal().write(`the org's recovery key for ${me.org}, shown once and kept nowhere on this machine; write it down:\n\n    ${paperText(key)}\n\n`);
  } else {
    try {
      writeNewFile(recovery, recoveryFileText(key, me.org, ctx.hub));
    } catch (error) {
      refuse(`the recovery key could not be written to ${recovery} (${(error as NodeJS.ErrnoException).code ?? String(error)}): is the volume mounted? Nothing was signed`);
    }
  }
  await checkBack(key.pub);
  const state: OrgState = {
    org: me.org,
    version: 1,
    prev: null,
    issued: new Date().toISOString(),
    root: { keys: [await keyId(keys.stepUp.pub)], recoveryPub: key.pub },
    members: [{ id: me.member.id, email: me.member.email, role: 'admin', devices: [deviceEntry(keys)] }],
    machines: [],
    machineNames: [],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  if (!(await confirm(ctx, `root ${me.org} at ${ctx.hub}? [y/N]`))) {
    refuse(`not rooted: nothing was posted${paper ? '' : `; the recovery key at ${recovery} was never used, delete it before running genesis again`}`);
  }
  const signed = await signOrgState(state, [keys.stepUp]);
  writeNewFile(genesisFile(ctx.keysPath), `${JSON.stringify(signed)}\n`);
  if ((await post(person, signed)) !== 'ok') refuse('the hub took a state meanwhile: run genesis again to see which');
  return finish(signed, 1, 'genesis posted');
}

/** The genesis an interrupted run wrote: this device's, for this org, and one that verifies. */
async function pendingGenesis(ctx: Context, keys: AdminKeys, org: string): Promise<SignedOrgState> {
  const file = genesisFile(ctx.keysPath);
  const signed = readJsonFile<SignedOrgState>(file, 'a genesis');
  const verdict = await verifyGenesis(signed);
  const signer = await keyId(keys.stepUp.pub);
  if (!verdict.ok || signed.state.org !== org || !signed.state.root.keys.includes(signer)) refuse(`${file} is not a genesis of ${org} this device signed: move it aside`);
  return signed;
}

async function adopt(ctx: Context): Promise<number> {
  const pinned = ctx.config?.orgGenesis ?? refuse("adopt anchors an org its config pins: this config has no orgGenesis (or name one with --config)");
  if (readAnchor(ctx.keysPath)) refuse(`${anchorFile(ctx.keysPath)} exists: this device anchors an org already`);
  const keys = await readAdminKeys(ctx.keysPath);
  const person = await ctx.person();
  const me = await signedIn(ctx, person);
  const served = await readServed(person);
  ctx.io.out(ageLine(served.head));
  if (served.chain.length === 0 || served.head === null) refuse(`${me.org} serves no org state: nothing to adopt`);
  const genesisState = served.chain[0];
  const hash = await stateHash(genesisState.state);
  if (hash !== pinned) refuse(`the hub's genesis hashes to ${hash}, not the config's orgGenesis ${pinned}: not this org's chain`);
  // Pinned to the genesis's own root keys: the genesis the config names is the one these roots signed.
  const run = await verifyPinnedChain(served.chain, served.transitions, { roots: genesisState.state.root.keys, recoveryPub: genesisState.state.root.recoveryPub });
  if (!run.ok) refuse(`the hub's chain does not verify from its genesis: ${run.code}`);
  if (run.adopted.length !== served.chain.length) refuse(`the hub's chain breaks at version ${run.adopted.length + 1}`);
  if (canonicalize(run.head) !== canonicalize(served.head)) refuse(`the hub's head is not its chain's last state (version ${run.head.state.version})`);
  const problem = await signerProblem(run.head.state, me.member.id, keys);
  if (problem) refuse(`${problem}: not adopted`);
  writeAnchor(ctx.keysPath, { hub: ctx.hub, org: me.org, genesis: hash, version: run.head.state.version, roots: run.head.state.root.keys, recoveryPub: genesisState.state.root.recoveryPub });
  ctx.io.out(`adopted: genesis ${hash} (config's orgGenesis), head version ${run.head.state.version}, device ${keys.id} signs`);
  return 0;
}

async function refresh(ctx: Context): Promise<number> {
  const from = await anchored(ctx, true);
  const signed = await amend(ctx, from, () => {});
  ctx.io.out(`refreshed: version ${signed.state.version} (no change)`);
  return 0;
}

async function devices(ctx: Context): Promise<number> {
  const { head, me, keys } = await anchored(ctx, false);
  const member = head.state.members.find((m) => m.id === me.member.id);
  for (const d of member?.devices ?? []) ctx.io.out(`${describeEntry(d)}${d.id === keys.id ? ' (this admin device)' : ''}`);
  if (!member) ctx.io.out(`${me.member.id} is not a member of the head`);
  return 0;
}

async function removeDevice(ctx: Context): Promise<number> {
  const id = ctx.positionals[0] ?? refuse('remove-device <device id>');
  const from = await anchored(ctx, true);
  const member = from.head.state.members.find((m) => m.id === from.me.member.id)!;
  const device = member.devices.find((d) => d.id === id) ?? refuse(`${from.me.member.id} has no device ${id} in the head (version ${from.head.state.version})`);
  if (id === from.keys.id) refuse(`${id} is this admin device: it is revoked from the app that replaces it (O8), never by itself`);
  if (!(await confirm(ctx, `revoke ${describeEntry(device)}? [y/N]`))) refuse('not revoked: nothing was signed');
  const signed = await amend(ctx, from, async (s) => {
    const m = s.members.find((x) => x.id === from.me.member.id);
    const d = m?.devices.find((x) => x.id === id);
    if (!m || !d) return refuse(`${id} left the head meanwhile: nothing to revoke`);
    m.devices = m.devices.filter((x) => x.id !== id);
    s.revoked.push({ keyId: await keyId(d.channelPub), holder: { member: m.id, device: d.id, class: d.class, key: 'channel' } });
    if (d.stepUpPub !== undefined) s.revoked.push({ keyId: await keyId(d.stepUpPub), holder: { member: m.id, device: d.id, class: d.class, key: 'step-up' } });
  });
  ctx.io.out(`revoked: version ${signed.state.version}`);
  return 0;
}

async function pair(ctx: Context): Promise<number> {
  const cls = ctx.values.class;
  if (cls !== 'web-cards' && cls !== 'native-mac') return refuse('pair --class web-cards|native-mac');
  const ttl = ctx.values.ttl === undefined ? PENDING_DEVICE_TTL_S : Number(ctx.values.ttl);
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > PENDING_DEVICE_TTL_S) refuse(`--ttl is whole seconds, 1 to ${PENDING_DEVICE_TTL_S}`);
  const from = await anchored(ctx, true);
  const { org } = from.anchor;
  const member = from.me.member.id;
  const k = crypto.getRandomValues(new Uint8Array(16));
  const { root } = from.head.state;
  const code = encodePairingCode({ hub: ctx.hub, org, member, roots: root.keys, recoveryPub: root.recoveryPub, k: base64urlEncode(k) });
  if (ctx.local) {
    ctx.io.out(`pairing code: ${code}`);
  } else {
    const terminal = ctx.terminal();
    terminal.write(`pairing code for a ${cls} device of ${from.me.member.email} (on the clipboard too; paste it into the device):\n\n${code}\n\n`);
    await ctx.io.exec('pbcopy', [], code).catch((error: unknown) => terminal.write(`(not copied to the clipboard: ${error instanceof Error ? error.message : String(error)})\n`));
  }
  ctx.io.out(`waiting up to ${ttl} s for a ${cls} device to answer the code`);

  const named = new Set<string>();
  const answering = async () => {
    const { pending } = await from.person.json<{ pending: PendingDevice[] }>(PENDING_DEVICES_PATH);
    const listed = new Set(from.head.state.members.flatMap((m) => m.devices.map((d) => d.id)));
    const found: Array<Omit<Device, 'endorsement'>> = [];
    for (const entry of pending) {
      const judged = await judgeEntry(entry, { org, member, k, class: cls, listed });
      if (judged.ok) {
        found.push(judged.device);
        continue;
      }
      const seen = `${entry.deviceId} ${entry.mac}`;
      if (!named.has(seen)) ctx.io.out(`not this pairing's: ${entry.deviceId} (${judged.why})`);
      named.add(seen);
    }
    if (found.length > 1) refuse('two devices answered this code: start over (the code is spent)');
    return found[0] ?? null;
  };

  const deadline = Date.now() + ttl * 1000;
  let device: Omit<Device, 'endorsement'> | null = null;
  for (;;) {
    device = await answering();
    if (device !== null || Date.now() >= deadline) break;
    await ctx.io.sleep(Math.min(PAIR_POLL_MS, Math.max(0, deadline - Date.now())));
  }
  if (device === null) refuse(`no ${cls} device answered this code within ${ttl} s: start over (the code is spent)`);
  const fingerprint = await pairingFingerprint(org, member, device);
  const shown = `pending: ${describeEntry(device)} fingerprint ${fingerprint}`;
  ctx.io.out(shown);
  if (!(await confirm(ctx, `${ctx.local ? '' : `${shown}\n`}compare the fingerprint with the device's, then approve? [y/N]`))) refuse('not approved: nothing was signed (the code is spent)');
  // What is signed is what was shown: the list read again, one entry answering, the same one.
  const still = await answering();
  if (still === null || canonicalize(still) !== canonicalize(device)) refuse('the entry changed after it was shown: start over (the code is spent)');
  const signed = await amend(ctx, from, async (s) => {
    const m = s.members.find((x) => x.id === member)!;
    if (m.devices.some((d) => d.id === device.id)) return refuse(`${device.id} is listed already`);
    m.devices.push({ ...device, endorsement: await endorseDevice(org, member, device, from.keys.stepUp.privateKey, from.keys.stepUp.pub) });
  });
  ctx.io.out(`listed: version ${signed.state.version}`);
  return 0;
}

const RUN: Record<Subcommand, (ctx: Context) => Promise<number>> = { init, genesis, adopt, refresh, pair, devices, 'remove-device': removeDevice };

/** The command over `argv`, its world reached through `io`. Its exit status. */
export async function runAdmin(argv: string[], io: AdminIo): Promise<number> {
  try {
    return await run(argv, io);
  } catch (error) {
    io.err(`admin: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof Refusal ? 1 : 2;
  }
}

async function run(argv: string[], io: AdminIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', multiple: true },
      keys: { type: 'string', multiple: true },
      hub: { type: 'string' },
      user: { type: 'string' },
      yes: { type: 'boolean', default: false },
      recovery: { type: 'string' },
      class: { type: 'string' },
      ttl: { type: 'string' },
    },
  });
  const [name, ...rest] = positionals;
  if (!(SUBCOMMANDS as readonly string[]).includes(name)) return usage(io);
  const sub = name as Subcommand;
  if (rest.length > (sub === 'remove-device' ? 1 : 0)) return usage(io);
  const only: Array<[string, Subcommand[]]> = [
    ['recovery', ['genesis']],
    ['class', ['pair']],
    ['ttl', ['pair']],
  ];
  for (const [option, subs] of only) if (values[option as keyof typeof values] !== undefined && !subs.includes(sub)) refuse(`--${option} is ${subs.join(' and ')}'s option`);
  if ((values.config?.length ?? 0) > 1 || (values.keys?.length ?? 0) > 1) refuse('name one --config and one --keys');
  const local = values.hub !== undefined;
  if (values.yes && !local) refuse('--yes answers the confirmations only at the local hub (--hub): against a deployment they are the owner\'s, at /dev/tty');
  if (local !== (values.user !== undefined)) refuse('--hub and --user go together: the local hub and its stand-in identity');
  const keysPath = values.keys?.[0] ?? io.env.DESK_ADMIN_KEYS ?? refuse('--keys <file> (or DESK_ADMIN_KEYS): the admin device\'s keys');

  let hub: string;
  let config: DeployConfig | null = null;
  if (local) {
    hub = localHub(values.hub!);
    if (values.config) config = readDeployConfig(values.config[0]);
  } else {
    config = readDeployConfig(values.config?.[0] ?? join(io.appDir, 'deploy', 'config.json'));
    checkTarget(config, 'act on its org state');
    hub = `https://${config.host}`;
  }

  // Against a deployment, the terminal is opened before any request: a shell with none stops here, having sent nothing.
  let terminal: Terminal | null = null;
  if (!local && CONFIRMING.includes(sub)) {
    try {
      terminal = io.openTerminal(true);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const why = code === 'ENXIO' ? 'Device not configured: no controlling terminal' : (code ?? String(error));
      return refuse(`cannot open /dev/tty (${why}): ${sub} asks the owner there before it signs anything; nothing was sent`);
    }
  }
  let person: Person | null = null;
  const ctx: Context = {
    sub,
    io,
    values,
    positionals: rest,
    keysPath,
    local,
    hub,
    config,
    yes: values.yes === true,
    terminal: () => (terminal ??= io.openTerminal(!local)),
    person: async () => {
      if (person) return person;
      if (local) return (person = new StandinPerson(hub, values.user!));
      const { DESK_ACCESS_TOKEN: token } = await io.secrets();
      if (!token) refuse('DESK_ACCESS_TOKEN on stdin: the owner\'s Access token for the deployment');
      return (person = new Person(hub, token!));
    },
  };
  return RUN[sub](ctx);
}

/** The local hub's origin: loopback only, so `--yes` and the stand-in identity never reach a deployment. */
function localHub(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refuse(`--hub ${text} is not a URL`);
  }
  if (!LOOPBACK.has(url.hostname) || !['http:', 'https:'].includes(url.protocol)) refuse(`--hub names the suites' local hub on loopback, not ${url.origin}`);
  return url.origin;
}

function usage(io: AdminIo): number {
  io.err(`usage: deployment admin <${SUBCOMMANDS.join(' | ')}> [--config deploy/<file>.json] [--keys <file>] [--hub <url> --user <email> [--yes]]`);
  io.err('  genesis --recovery <path | paper>; pair --class web-cards|native-mac [--ttl <s>]; remove-device <device id> (deploy/README.md)');
  return 2;
}

// ---- The machine's own io ---------------------------------------------------------------------------------------------

/** A line read from `fd`, byte by byte, so nothing after it is consumed. */
function readLineFrom(fd: number): string {
  const bytes: number[] = [];
  const one = Buffer.alloc(1);
  for (;;) {
    let n: number;
    try {
      n = readSync(fd, one, 0, 1, null);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EAGAIN') continue;
      throw error;
    }
    if (n === 0 || one[0] === 0x0a) return Buffer.from(bytes).toString('utf8');
    bytes.push(one[0]);
  }
}

function openTerminal(deployment: boolean): Terminal {
  if (!deployment) return { write: (text) => void process.stdout.write(text), readLine: async () => readLineFrom(0) };
  const fd = openSync('/dev/tty', 'r+');
  process.once('exit', () => closeSync(fd));
  return { write: (text) => void writeSync(fd, text), readLine: async () => readLineFrom(fd) };
}

function exec(command: string, args: string[], input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}${stderr ? `: ${stderr.trim().slice(0, 200)}` : ''}`))));
    if (input !== undefined) child.stdin!.end(input);
  });
}

export function machineIo(): AdminIo {
  const env = process.env;
  const home = env.HOME ?? homedir();
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    openTerminal,
    secrets: readSecrets,
    exec,
    volumeOf,
    readText,
    placement: machinePlacement(env, home),
    env,
    appDir: process.env.DESK_HUB_APP!,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export async function main(argv: string[]): Promise<number> {
  return runAdmin(argv, machineIo());
}
