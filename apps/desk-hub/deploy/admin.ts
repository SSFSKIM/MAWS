// `deployment admin`: the owner's hand on a deployment's org state before O8's Org page (P5 O13 M2, Interfaces §F;
// RL DL28; P5 O14 M2, its Interfaces §C). It holds an admin device of its own (`init`: a channel key and a step-up key in
// a 0600 keys file), roots the deployment's org with it (`genesis`, the org's recovery key written only to an offline
// destination and checked back), or anchors an org rooted before it (`adopt`); then pairs a device (`pair`, RL §5.3 with
// the package's pairing code, MAC and fingerprint), lists and revokes devices, signs the weekly no-change successor
// the endpoint's 30-day backstop needs (`refresh`), and makes a native-mac device of the owner's (the app's, P5 O8 M3) a
// root beside itself (`root add`). For the cutover (O14) it enrolls and lists a machine by a code the owner carries
// (`enroll`), creates and drops the devcloud delegation and emits its provisioning code to a pipe
// (`delegation create|drop`), drops a machine however it is held (`machine drop`), revokes a phase-1 provisioning key
// (`provisioning revoke`), shows the org (`show`), drops a proposal the hub refused once the owner judged it
// (`abandon-pending`), and reads or strips a provisioning code locally (`code inspect|strip-legacy`).
//
//   deployment admin <init | genesis | adopt | refresh | pair | devices | remove-device | root | show | enroll |
//                    delegation | machine | code | provisioning | keys | abandon-pending> [--config deploy/<file>.json]
//                    [--keys <file>] [--hub <url> --user <email> [--yes]] [the verb's own options] (deploy/README.md)
//
// It acts on the deployment `--config` names (production's config.json by default; `checkTestHub` does not apply, and an
// agent never runs it against production), as the signed-in owner: `DESK_ACCESS_TOKEN` from the environment when it is
// set there (a runner's `--pipe`, whose stdin is the verb's own), else on stdin, as the other commands take it. `--hub
// <loopback url> --user <email>` acts on the suites' local hub through its stand-in identity instead, where `--yes` may
// answer the confirmations and `genesis --media-check` holds the recovery destination to a deployment's volume rules
// (another volume than the keys', on removable or external media), so a real drive meets them before a deployment does. Against a deployment every verb that signs, posts or deletes opens /dev/tty before any
// request and confirms there: a shell with no controlling terminal, an agent's, stops at that open and sends nothing.
// The pairing code, a machine's enrollment code and a paper recovery key go to the terminal alone, never to stdout, so a
// runner's log never holds them; a provisioning code goes to stdout alone, and only when stdout is not a terminal.
//
// Where it may write: the deployment's own org under the anchor `<keys>.org.json` ({hub, org, genesis, version, roots,
// recoveryPub, pending?}), written by `genesis` or `adopt`. Every other subcommand reads the chain from its genesis,
// verifies it against the anchor's pins (`verifyPinnedChain`), refuses another genesis or a head older than the anchor's
// version, and moves the version forward. A successor is kept in `pending` before its POST and settled before anything
// else is signed (`anchored`), and each subcommand but `init` and the local `code` verbs holds the anchor's lock
// throughout (`run`), `enroll` only around its reads and its signing, never across its wait; so this device never signs
// two successors of one parent. `genesis` keeps its own `<keys>.genesis.json`: version 1 has no parent, and no anchor
// exists until the hub holds it. A throwaway org is not an option.
import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  base64urlEncode,
  canonicalize,
  decodeProvisioningCodeV2,
  encodePairingCode,
  encodeProvisioningCodeV2,
  endorseDevice,
  generateSigningKey,
  isMachineName,
  isMemberEmail,
  isSignedOrgState,
  judgeEntry,
  keyId,
  machineNameKey,
  NO_CERTIFICATES,
  pairingFingerprint,
  signOrgState,
  stateHash,
  successorProblems,
  verifyEnrollmentMac,
  verifyGenesis,
  verifyPinnedChain,
  type Certificates,
  type Delegation,
  type Device,
  type OrgState,
  type ProvisioningCodeV2,
  type SignedOrgState,
} from 'org-protocol';
import { readJsonFile } from '../fake-machine/json-file';
import { IDENTITY_HEADER } from '../local/standin';
import {
  decodeProvisioningCode,
  ENROLLMENT_TTL_S,
  encodeEnrollmentCodeV2,
  MAX_ENROLLMENT_TTL_S,
  MAX_PROVISIONING_KEY_TTL_S,
  MAX_PROVISIONING_KEY_USES,
  MIN_PROVISIONING_KEY_TTL_S,
  NEVER_OFFLINE,
  NO_USE_CAP,
  ORG_KEYS_PATH,
  ORG_STATE_PATH,
  PENDING_DEVICE_TTL_S,
  PENDING_DEVICES_PATH,
  PROVISIONING_KEY_TTL_S,
  PROVISIONING_KEYS_PATH,
  type EnrollmentIssued,
  type EnrollmentKey,
  type MachineView,
  type OrgStateView,
  type PendingDevice,
  type ProvisioningKeyIssued,
  type ProvisioningKeyRecord,
} from '../src/protocol/identity';
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
  isRemovableVolume,
  volumeOf,
  writeAdminKeys,
  writeNewFile,
  type AdminKeys,
  type Placement,
} from './admin-device';
import { checkTarget, readDeployConfig, type DeployConfig } from './config';
import { readSecrets } from './deploy';
import { Person } from './hub';
import { certificateViews, machineRows, resolveMachine, table } from './admin-machines';
import { deviceEntry, purgeOrgKeys, restoreLegacyKey, retireLegacyKey, successor } from './org-admin';
import { withRunLock } from './run-lock';
import { openTerminal, type Terminal } from './terminal';

// The pairing judges live in org-protocol (O8 M4a), where the app's pairing reads them too; re-exported for admin's suites.
export { isPairedDeviceId, isRpId, judgeEntry } from 'org-protocol';

export const SUBCOMMANDS = ['init', 'genesis', 'adopt', 'refresh', 'pair', 'devices', 'remove-device', 'root', 'show', 'enroll', 'delegation', 'machine', 'code', 'provisioning', 'keys', 'abandon-pending'] as const;
/** The subcommands that name a verb of their own after them (`delegation create`). */
const GROUPS = { root: ['add'], delegation: ['create', 'publish', 'drop'], machine: ['drop'], code: ['inspect', 'strip-legacy'], provisioning: ['revoke'], keys: ['retire', 'purge'] } as const;
type Group = keyof typeof GROUPS;
type Subcommand = Exclude<(typeof SUBCOMMANDS)[number], Group> | { [G in Group]: `${G} ${(typeof GROUPS)[G][number]}` }[Group];
/** What signs, posts or deletes only after the owner says so at the terminal. */
const CONFIRMING: readonly Subcommand[] = ['genesis', 'pair', 'remove-device', 'root add', 'enroll', 'delegation create', 'delegation publish', 'delegation drop', 'machine drop', 'provisioning revoke', 'keys retire', 'keys purge', 'abandon-pending'];
/** The verbs whose stdout is a secret code, for a pipe alone: every other line they print goes to stderr. */
const SECRET_STDOUT: readonly Subcommand[] = ['delegation create', 'code strip-legacy'];
/** The local transforms: stdin to stdout, no keys, no anchor, no credential and no hub. */
const LOCAL_TRANSFORMS: readonly Subcommand[] = ['code inspect', 'code strip-legacy'];
/** The positional each verb takes, by what it names. */
const POSITIONAL: Partial<Record<Subcommand, string>> = { 'remove-device': '<device id>', 'root add': '<device id>', enroll: '<name>', 'delegation drop': '<delegation id>', 'machine drop': '<name>', 'provisioning revoke': '<provisioning key id>' };
/** How often `pair` reads the pending list. */
export const PAIR_POLL_MS = 2000;
/** How often `enroll` asks for the machine's posted key, and how long it waits for it by default. */
export const ENROLL_POLL_MS = 5000;
export const ENROLL_WAIT_S = 1800;
const DAY_MS = 86_400_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export type { Terminal };

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
  /** Whether a path is on removable or external media (diskutil); throws when it cannot be told. */
  removableVolume(path: string): boolean;
  readText(path: string): string;
  placement: Placement;
  env: Record<string, string | undefined>;
  /** The app's directory, whose deploy/config.json is the default deployment. */
  appDir: string;
  sleep(ms: number): Promise<void>;
  /** All of stdin, as text: the input of the verbs that read one (a code, a v1 code). */
  readStdin(): Promise<string>;
  /** Writes `text` to stdout as it is, resolving once it is flushed: a secret code, for a pipe alone. */
  secretOut(text: string): Promise<void>;
  /** Whether stdout is a terminal, where a secret code never goes. */
  stdoutIsTerminal: boolean;
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
export type Anchor = {
  hub: string;
  org: string;
  genesis: string;
  version: number;
  roots: string[];
  recoveryPub: string;
  /** A successor this device signed and has not yet seen at the hub: settled before anything else is signed. */
  pending?: SignedOrgState;
  /** `pending` was never posted (`delegation create`'s): abandoning it can show no machine a fork. */
  unsent?: true;
};
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
    typeof a.recoveryPub === 'string' &&
    (a.pending === undefined || isSignedOrgState(a.pending)) &&
    (a.unsent === undefined || (a.unsent === true && a.pending !== undefined));
  if (!ok) refuse(`${file} is not an anchor ({hub, org, genesis, version, roots, recoveryPub, pending?, unsent?})`);
  return a as Anchor;
}

/** Writes the anchor whole and durably (a new file, synced, renamed over the old, its directory synced), 0600. */
function writeAnchor(keys: string, anchor: Anchor): void {
  const file = anchorFile(keys);
  const fd = openSync(`${file}.tmp`, 'w', 0o600);
  try {
    writeSync(fd, `${JSON.stringify(anchor)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(`${file}.tmp`, file);
  const dir = openSync(dirname(file), 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}

/** "head version n, issued d days ago": every subcommand's first line, so the owner sees the backstop's clock. */
export function ageLine(head: SignedOrgState | null, now = new Date()): string {
  if (head === null) return 'head: none';
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(head.state.issued)) / DAY_MS));
  return `head version ${head.state.version}, issued ${days} day${days === 1 ? '' : 's'} ago`;
}

type Served = { chain: SignedOrgState[]; head: SignedOrgState | null; transitions: OrgStateView['transitions']; certificates: Certificates };

/** The org state the hub serves, its chain read from the genesis page by page. */
async function readServed(person: Person): Promise<Served> {
  const chain: SignedOrgState[] = [];
  let page: OrgStateView;
  for (;;) {
    page = await person.json<OrgStateView>(`${ORG_STATE_PATH}?since=${chain.at(-1)?.state.version ?? 0}`);
    chain.push(...(page.chain ?? []));
    if (!page.more || (page.chain ?? []).length === 0) break;
  }
  return { chain, head: page.head, transitions: page.transitions, certificates: page.certificates ?? NO_CERTIFICATES };
}

/**
 * The served chain verified against the anchor: its genesis the anchor's, every state verified from it and anchored to
 * the anchor's pins, the served head the chain's last, and no older than the anchor's version.
 */
async function verifiedHead(person: Person, anchor: Anchor): Promise<{ head: SignedOrgState; chain: SignedOrgState[]; certificates: Certificates }> {
  const served = await readServed(person);
  if (served.chain.length === 0 || served.head === null) refuse(`${anchor.org} serves no org state, but this device anchors its genesis ${anchor.genesis}: refusing`);
  const genesis = await stateHash(served.chain[0].state);
  if (genesis !== anchor.genesis) refuse(`the hub's genesis hashes to ${genesis}, not the anchor's ${anchor.genesis}: not this org's chain`);
  const run = await verifyPinnedChain(served.chain, served.transitions, { roots: anchor.roots, recoveryPub: anchor.recoveryPub });
  if (!run.ok) refuse(`the hub's chain does not verify against the anchor's pins: ${run.code}`);
  if (run.adopted.length !== served.chain.length) refuse(`the hub's chain breaks at version ${run.adopted.length + 1}`);
  if (canonicalize(run.head) !== canonicalize(served.head)) refuse(`the hub's head is not its chain's last state (version ${run.head.state.version})`);
  if (run.head.state.version < anchor.version) refuse(`the hub's head is version ${run.head.state.version}, older than the version ${anchor.version} this device has seen: refusing`);
  return { head: run.head, chain: run.adopted, certificates: served.certificates };
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

/**
 * A hub-supplied string as it may be printed: every character outside printable ASCII, and the backslash, written as an
 * escape. What the hub serves (a device id, a relying party, a member's email, its refusal's text) could otherwise carry
 * terminal controls or a line of its own that forge or hide what the owner compares before `y`.
 */
export const printable = (text: string) => text.replace(/[^\x20-\x5b\x5d-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** `text` with every control character (C0, DEL, C1, the Unicode line separators and bidirectional controls) escaped. */
// eslint-disable-next-line no-control-regex -- matching the control characters is the point
const noControls = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const describeEntry = (d: Omit<Device, 'endorsement'>) => printable(`${d.id} ${d.class} ${d.keyStorage} rpId ${d.passkey?.rpId ?? '-'}`);

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
  return refuse(`the hub refused version ${signed.state.version}: ${response.status} ${printable(text.slice(0, 300))}`);
}

/**
 * The anchored org as a signing verb meets it: the head verified against the anchor, a pending proposal settled first,
 * and `amend`, the one way anything signs a successor (every verb's, O14's too). Called inside the anchor's lock (`run`).
 *
 * No two successors of one parent (the spec's Decision Log, 2026-10-28): `amend` writes the signed proposal into the
 * anchor's `pending` slot, durably, before it posts, and only the hub's head showing it clears the slot. Before anything
 * is signed, a pending proposal is settled: the hub's chain holds it → adopted; the hub holds no successor of its
 * parent → the same bytes sent again; the hub holds another successor of that parent → `fork`, and nothing changes. A
 * hub that stored a proposal but answered an error is therefore never handed a second, different successor of the
 * same parent.
 *
 * An `unsent` proposal (`delegation create`'s) is never settled here (the spec's Decision Log, M2 round 3): its
 * delegation takes effect only once the owner has checked the stored code, so only `delegation publish` sends it
 * (`unsent: 'publish'`, which leaves it to that verb's confirmation); a read verb names it and goes on
 * (`unsent: 'note'`); every other verb refuses, signing and sending nothing.
 */
async function anchored(ctx: Context, needsSigner: boolean, { unsent = 'refuse' }: { unsent?: 'refuse' | 'note' | 'publish' } = {}) {
  const opened = await openAnchor(ctx);
  const { keys, person, me, verified } = opened;
  let anchor = opened.anchor;
  let head = verified.head;
  const save = (next: Anchor) => writeAnchor(ctx.keysPath, (anchor = next));
  // `pending: undefined` leaves the key out of the file (JSON.stringify).
  const settled = (from: Anchor, version: number): Anchor => ({ ...from, pending: undefined, unsent: undefined, version });
  /** The delegations a settled proposal put in effect, named, since `delegation create`'s take effect here. */
  const inEffect = (proposal: SignedOrgState, before: OrgState) => {
    for (const d of proposal.state.delegations) {
      if (!before.delegations.some((x) => x.id === d.id)) ctx.io.out(`delegation ${d.id} prefix ${d.prefix} in effect from version ${proposal.state.version}`);
    }
  };

  const proposal = anchor.pending;
  if (proposal !== undefined) {
    const n = proposal.state.version;
    const { chain } = verified;
    const held = chain[n - 1];
    const stale = held !== undefined || head.state.version !== n - 1 || (await stateHash(head.state)) !== proposal.state.prev;
    const theirs = held ?? chain[n - 2] ?? head;
    const at = async () => `the hub holds version ${theirs.state.version} ${await stateHash(theirs.state)}`;
    if (held !== undefined && canonicalize(held) === canonicalize(proposal)) {
      save(settled(anchor, head.state.version));
      ctx.io.out(`pending version ${n} is the hub's: adopted`);
      inEffect(proposal, (chain[n - 2] ?? held).state);
    } else if (anchor.unsent) {
      const added = proposal.state.delegations.filter((d) => !head.state.delegations.some((x) => x.id === d.id));
      const named = `delegation ${added.map((d) => `${d.id} (prefix ${d.prefix})`).join(', ')}`;
      if (unsent === 'note') {
        ctx.io.out(
          stale
            ? `pending version ${n} lists ${named}, unsent and stale (${await at()}): admin abandon-pending drops it`
            : `pending version ${n} lists ${named}, unsent: admin delegation publish sends it once its stored code decodes under code inspect`,
        );
      } else if (stale) {
        refuse(`${await at()} where this device's unsent version ${n} ${await stateHash(proposal.state)} was signed (pending in ${anchorFile(ctx.keysPath)}): nothing was posted, and no fork exists; admin abandon-pending drops it, and the next verb signs on the hub's head`);
      } else if (unsent === 'refuse') {
        refuse(
          `version ${n} lists ${named}, signed by delegation create and unsent in ${anchorFile(ctx.keysPath)}: nothing was signed or sent. Once its stored code decodes under code inspect, admin delegation publish sends it; if the store failed, admin abandon-pending, then admin provisioning revoke ${added.map((d) => d.id).join(', ')}`,
        );
      }
    } else if (stale) {
      refuse(
        `fork: ${await at()} where this device signed version ${n} ${await stateHash(proposal.state)} (pending in ${anchorFile(ctx.keysPath)}): nothing was signed. Two successors of version ${n - 1} exist; take this to whoever runs the hub before anything else is signed`,
      );
    } else {
      ctx.io.out(`pending version ${n} is not at the hub: sent again`);
      const before = head.state;
      await send(proposal);
      head = (await verifiedHead(person, anchor)).head;
      inEffect(proposal, before);
    }
  }
  if (head.state.version > anchor.version) save({ ...anchor, version: head.state.version });

  /** Posts the proposal in the anchor's `pending` slot; clears it on the hub's 201, keeps it on anything else. */
  async function send(signed: SignedOrgState): Promise<void> {
    const n = signed.state.version;
    // From here the hub may hold it, so abandoning it is the owner's judgment of a fork.
    if (anchor.unsent) save({ ...anchor, unsent: undefined });
    let response: Response;
    let text: string;
    try {
      response = await person.fetch(ORG_STATE_PATH, { body: signed });
      text = await response.text();
    } catch (error) {
      return refuse(`version ${n} got no answer (${error instanceof Error ? error.message : String(error)}): it stays pending in ${anchorFile(ctx.keysPath)}, and the next run settles it`);
    }
    if (response.status !== 201) refuse(`the hub answered ${response.status} to version ${n} (${printable(text.slice(0, 300))}): it stays pending in ${anchorFile(ctx.keysPath)}, and the next run settles it`);
    save(settled(anchor, n));
  }

  /** A successor of the head, changed by `edit`, signed by the admin device, kept as pending, then posted. */
  async function amend(edit: (state: OrgState) => Promise<void> | void): Promise<SignedOrgState> {
    const signed = await signPending(edit, false);
    await send(signed);
    head = signed;
    return signed;
  }

  /** `amend` without the POST: the signed successor kept as pending, marked unsent, for `delegation publish` to send. */
  const propose = (edit: (state: OrgState) => Promise<void> | void) => signPending(edit, true);

  async function signPending(edit: (state: OrgState) => Promise<void> | void, unsent: boolean): Promise<SignedOrgState> {
    const next = await successor(head.state, () => {});
    await edit(next);
    // What the package would refuse once signed, refused before: the slot never holds a successor no verifier takes.
    const problems = await successorProblems(head.state, next);
    if (problems.length > 0) {
      refuse(`version ${next.version} would be refused: ${problems.map((p) => (p.detail === undefined ? p.code : `${p.code} (${printable(p.detail)})`)).join('; ')}: nothing was signed`);
    }
    const signed = await signOrgState(next, [keys.stepUp]);
    save({ ...anchor, pending: signed, ...(unsent ? { unsent: true as const } : {}) });
    return signed;
  }

  /** `delegation publish`'s send: the unsent proposal posted, the delegations it adds named in effect. */
  async function publish(): Promise<SignedOrgState> {
    const proposal = anchor.pending!;
    const before = head.state;
    await send(proposal);
    head = (await verifiedHead(person, anchor)).head;
    inEffect(proposal, before);
    return proposal;
  }

  if (needsSigner) {
    const problem = await signerProblem(head.state, me.member.id, keys);
    if (problem) refuse(`${problem}: this device cannot sign its successors`);
  }
  return { anchor, keys, person, me, head, certificates: verified.certificates, amend, propose, publish };
}

/** The anchor and the head the hub serves, verified against it, the age line printed; nothing settled or written. */
async function openAnchor(ctx: Context) {
  const anchor = readAnchor(ctx.keysPath) ?? refuse('no anchor: run genesis or adopt');
  if (anchor.hub !== ctx.hub) refuse(`this device anchors ${anchor.org} at ${anchor.hub}, not ${ctx.hub}`);
  if (ctx.config?.orgGenesis !== undefined && ctx.config.orgGenesis !== anchor.genesis) refuse(`the anchor's genesis ${anchor.genesis} is not the config's orgGenesis ${ctx.config.orgGenesis}`);
  const keys = await readAdminKeys(ctx.keysPath);
  const person = await ctx.person();
  const me = await signedIn(ctx, person);
  if (me.org !== anchor.org) refuse(`the deployment serves the org ${me.org}, not the anchor's ${anchor.org}`);
  const verified = await verifiedHead(person, anchor);
  ctx.io.out(ageLine(verified.head));
  return { anchor, keys, person, me, verified };
}

/** `run` under the anchor's lock: a lock another run holds is the command's refusal, naming its holder. */
async function locked<T>(ctx: Context, run: () => Promise<T>): Promise<T> {
  try {
    return await withRunLock(`${anchorFile(ctx.keysPath)}.lock`, run);
  } catch (error) {
    if (error instanceof Error && (error.cause as NodeJS.ErrnoException | undefined)?.code === 'EEXIST' && error.message.startsWith('another run holds ')) refuse(error.message);
    throw error;
  }
}

// ---- The subcommands ------------------------------------------------------------------------------------------------

async function init(ctx: Context): Promise<number> {
  const problem = keysPlacementProblem(ctx.keysPath, ctx.io.placement);
  if (problem) refuse(`${problem}: no keys written`);
  if (existsSync(ctx.keysPath)) refuse(`${ctx.keysPath} exists: an admin device's keys are never written over`);
  // Time Machine excludes the file while it is still empty: no key is written unless the exclusion took.
  let excluding: unknown = null;
  const exclude = (path: string) =>
    ctx.io.exec('tmutil', ['addexclusion', path]).catch((error: unknown) => {
      excluding = error;
      throw error;
    });
  let keys: AdminKeys;
  try {
    keys = await writeAdminKeys(ctx.keysPath, exclude);
  } catch (error) {
    if (excluding === null) throw error;
    return refuse(`tmutil addexclusion ${ctx.keysPath} failed (${error instanceof Error ? error.message : String(error)}): no key was written and the file was removed; run init again once Time Machine can exclude it`);
  }
  ctx.io.out(`keys written: ${ctx.keysPath} (device ${keys.id})`);
  ctx.io.out(`excluded from Time Machine: ${ctx.keysPath}`);
  return 0;
}

async function genesis(ctx: Context): Promise<number> {
  const recovery = ctx.values.recovery as string | undefined;
  if (!recovery) return refuse('genesis --recovery <path on the removable volume | paper>');
  const paper = recovery === 'paper';
  if (!paper) {
    const problem = recoveryPlacementProblem(recovery, ctx.keysPath, ctx.io.placement, { of: ctx.io.volumeOf, removable: ctx.io.removableVolume, required: !ctx.local || ctx.values['media-check'] === true });
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
    if (servedGenesis === hash) {
      // The first run's POST landed: the served chain is verified from this genesis, as adopt verifies one, and the
      // anchor takes only a head that chain reaches.
      const run = await verifyPinnedChain(served.chain, served.transitions, { roots: pending.state.root.keys, recoveryPub: pending.state.root.recoveryPub });
      if (!run.ok) refuse(`the hub's chain does not verify from this genesis: ${run.code}`);
      if (run.adopted.length !== served.chain.length) refuse(`the hub's chain breaks at version ${run.adopted.length + 1}`);
      if (served.head === null || canonicalize(run.head) !== canonicalize(served.head)) refuse(`the hub's head is not its chain's last state (version ${run.head.state.version})`);
      return finish(pending, run.head.state.version, 'genesis already at the hub');
    }
    if (!(await confirm(ctx, `root ${me.org} at ${ctx.hub}? [y/N]`))) refuse('not rooted: nothing was posted');
    if ((await post(person, pending)) !== 'ok') refuse('the hub took a state meanwhile: run genesis again to see which');
    return finish(pending, 1, 'genesis posted');
  }

  if (served.head !== null) refuse(`the hub holds a state (version ${served.head.state.version}): genesis roots an org with none`);
  // The genesis writes the admin's email as `/api/me` names it, so it must be an address, as a successor's must.
  if (!isMemberEmail(me.member.email)) {
    refuse(`the hub names this member's email "${printable(me.member.email)}", which is not an address (one @, no space or control character, at most 64 characters before it and 253 after): nothing was written or signed`);
  }
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
  const signed = await from.amend(() => {});
  ctx.io.out(`refreshed: version ${signed.state.version} (no change)`);
  return 0;
}

async function devices(ctx: Context): Promise<number> {
  const { head, me, keys } = await anchored(ctx, false, { unsent: 'note' });
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
  const signed = await from.amend(async (s) => {
    const m = s.members.find((x) => x.id === from.me.member.id);
    const d = m?.devices.find((x) => x.id === id);
    if (!m || !d) return refuse(`${id} left the head meanwhile: nothing to revoke`);
    m.devices = m.devices.filter((x) => x.id !== id);
    s.revoked.push({ keyId: await keyId(d.channelPub), holder: { member: m.id, device: d.id, class: d.class, key: 'channel' } });
    if (d.stepUpPub !== undefined) {
      const kid = await keyId(d.stepUpPub);
      s.revoked.push({ keyId: kid, holder: { member: m.id, device: d.id, class: d.class, key: 'step-up' } });
      // A root key leaves the root set with its device (org-state.ts: the root set is admin devices' step-up keys).
      s.root.keys = s.root.keys.filter((k) => k !== kid);
    }
  });
  ctx.io.out(`revoked: version ${signed.state.version}`);
  return 0;
}

/**
 * `root add ID`: a device of this admin's own member made a root beside this admin device (P5 O8 M3, the co-root), its
 * step-up key's kid appended to `root.keys`. Only a native-mac device with a step-up key signs org states, as this
 * device does; a device under another member is not this verb's, so every root it adds is one `remove-device` removes.
 * Either root then signs any successor alone (`verifySuccessor` asks one signature of the parent's root set).
 */
async function rootAdd(ctx: Context): Promise<number> {
  const id = ctx.positionals[0];
  const from = await anchored(ctx, true);
  const { state } = from.head;
  const member = state.members.find((m) => m.id === from.me.member.id)!;
  const device = member.devices.find((d) => d.id === id) ?? refuse(`${from.me.member.id} has no device ${printable(id)} in the head (version ${state.version})`);
  if (device.class !== 'native-mac' || device.stepUpPub === undefined) refuse(`${printable(id)} is a ${device.class} device: only a native-mac device with a step-up key signs org states`);
  const kid = await keyId(device.stepUpPub);
  if (state.root.keys.includes(kid)) refuse(`${printable(id)} is a root already (step-up ${kid})`);
  // What `pair` showed when the device was approved: the same entry, so the same fingerprint (its endorsement left out).
  const fingerprint = await pairingFingerprint(from.anchor.org, member.id, device);
  const question = `make ${describeEntry(device)} of ${printable(member.email)} (fingerprint ${fingerprint}, step-up ${kid}) a root of ${from.anchor.org}? [y/N]`;
  if (!(await confirm(ctx, question))) refuse('not made a root: nothing was signed');
  const signed = await from.amend((s) => void s.root.keys.push(kid));
  ctx.io.out(`root added: ${printable(id)}, step-up ${kid} (version ${signed.state.version})`);
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
    terminal.write(`pairing code for a ${cls} device of ${printable(from.me.member.email)} (on the clipboard too; paste it into the device):\n\n${code}\n\n`);
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
      if (!named.has(seen)) ctx.io.out(`not this pairing's: ${printable(String(entry.deviceId))} (${judged.why})`);
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
  const signed = await from.amend(async (s) => {
    const m = s.members.find((x) => x.id === member)!;
    if (m.devices.some((d) => d.id === device.id)) return refuse(`${device.id} is listed already`);
    m.devices.push({ ...device, endorsement: await endorseDevice(org, member, device, from.keys.stepUp.privateKey, from.keys.stepUp.pub) });
  });
  ctx.io.out(`listed: version ${signed.state.version}`);
  return 0;
}

// ---- O14's verbs (P5 O14 M2, Interfaces §C) --------------------------------------------------------------------------

/** The whole number `--<name>` gives, `min` to `max` (in `unit`), or `fallback` when it is not given. */
function whole(ctx: Context, name: string, fallback: number, min: number, max: number, unit = 'seconds'): number {
  const given = ctx.values[name];
  const value = given === undefined ? fallback : Number(given);
  if (!Number.isSafeInteger(value) || value < min || value > max) refuse(`--${name} is whole ${unit}, ${min} to ${max}`);
  return value;
}

const sameName = (name: string) => (m: { name: string }) => machineNameKey(m.name) === machineNameKey(name);

/** The hub's machine rows (`GET /api/machines`). */
async function hubRows(person: Person): Promise<MachineView[]> {
  return (await person.json<{ machines: MachineView[] }>('/api/machines')).machines;
}

/** A hub request's answer as `[status, text]`, the text cut and made printable for a refusal. */
async function answered(person: Person, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; text: string; said: string }> {
  const response = await person.fetch(path, init);
  const text = await response.text();
  return { status: response.status, text, said: `${response.status} ${printable(text.slice(0, 300))}` };
}

/** Why `prefix` cannot be a new delegation's in `state` (RL DL 25, 26; org-state.ts's name namespaces), or null. */
function prefixProblem(state: OrgState, prefix: string): string | null {
  const key = machineNameKey(prefix);
  const held = [
    ...state.delegations.map((d) => ({ id: d.id, prefix: d.prefix, dropped: false })),
    ...state.revoked.flatMap((r) => ('delegation' in r.holder ? [{ id: r.holder.delegation, prefix: r.holder.prefix, dropped: true }] : [])),
  ];
  for (const d of held) {
    const theirs = machineNameKey(d.prefix);
    const whose = d.dropped ? `the dropped delegation ${d.id}'s` : `delegation ${d.id}'s`;
    const reserved = d.dropped ? ', reserved for the life of the org' : '';
    if (theirs === key) return `the prefix ${prefix} is ${whose}${reserved}`;
    if (theirs.startsWith(key) || key.startsWith(theirs)) return `the prefix ${prefix} nests with ${whose} ${d.prefix}${reserved}`;
  }
  const under = [...state.machineNames, ...state.machines].find((m) => machineNameKey(m.name).startsWith(key));
  return under ? `the machine ${under.name} is named under the prefix ${prefix}` : null;
}

/** The delegation whose prefix `name` falls under, live or dropped: a certificate's name, never an enrolled one. */
function delegationOver(state: OrgState, name: string): string | null {
  const key = machineNameKey(name);
  const prefixes = [...state.delegations.map((d) => d.prefix), ...state.revoked.flatMap((r) => ('delegation' in r.holder ? [r.holder.prefix] : []))];
  return prefixes.find((p) => key.startsWith(machineNameKey(p))) ?? null;
}

/**
 * One line per root of the state: its step-up key id and the device listed in the head that holds the key. A verified
 * head lists a device for every root; `no listed device` is for a head that somehow does not.
 */
export async function rootLines(state: OrgState): Promise<string[]> {
  const holders = new Map<string, string>();
  for (const m of state.members) for (const d of m.devices) if (d.stepUpPub !== undefined) holders.set(await keyId(d.stepUpPub), `${printable(m.email)} device ${printable(d.id)}`);
  return state.root.keys.map((kid) => `root ${printable(kid)} (${holders.get(kid) ?? 'no listed device'})`);
}

async function show(ctx: Context): Promise<number> {
  const { head, keys, person, certificates } = await anchored(ctx, false, { unsent: 'note' });
  const state = head.state;
  for (const m of state.members) {
    ctx.io.out(`member ${m.id} ${printable(m.email)} ${m.role}`);
    for (const d of m.devices) ctx.io.out(`  device ${describeEntry(d)}${d.id === keys.id ? ' (this admin device)' : ''}`);
  }
  for (const line of await rootLines(state)) ctx.io.out(line);
  const rows = await machineRows(state, await certificateViews(state, certificates), await hubRows(person));
  if (rows.length === 0) ctx.io.out('machines: none');
  else {
    ctx.io.out('machines:');
    for (const line of table(['NAME', 'STATE', 'REF', 'KEY', 'ONLINE', 'SEEN'], rows.map((r) => [r.name, r.state, r.ref, r.key, r.online, r.seen].map(printable)))) ctx.io.out(line);
  }
  if (state.delegations.length === 0) ctx.io.out('delegations: none');
  for (const d of state.delegations) {
    const owners = d.owners === 'org' ? 'org' : d.owners.join(',');
    ctx.io.out(`delegation ${d.id} prefix ${d.prefix} expires ${d.expires}${d.maxUses === NO_USE_CAP ? '' : ` max-uses ${d.maxUses}`} owners ${owners}`);
  }
  for (const r of state.revoked) if ('delegation' in r.holder) ctx.io.out(`dropped delegation ${r.holder.delegation} prefix ${r.holder.prefix} (reserved)`);
  const retired = state.legacyRetired;
  if (retired) ctx.io.out(`legacyRetired version ${retired.version} at ${retired.at}`);
  return 0;
}

/**
 * `enroll NAME`: a machine listed by a code the owner carries (RL §5.3). Under the anchor's lock, the head is verified
 * and the name's place in it read; without it, the token is minted, the code shown on the terminal (and the clipboard,
 * against a deployment) and the machine's key waited for, its MAC checked under the code's `k`, its name, ref and key id
 * shown for the owner to compare with `mawsd keys --json` on the machine; then, under the lock again and on a head read
 * afresh, the successor listing it is signed. A `refresh` during the wait signs; this signs after it, on its head.
 */
async function enroll(ctx: Context): Promise<number> {
  const name = ctx.positionals[0];
  if (!isMachineName(name)) refuse(`${printable(name)} is not an admitted machine name`);
  const ttl = whole(ctx, 'ttl', ENROLLMENT_TTL_S, 1, MAX_ENROLLMENT_TTL_S);
  const wait = whole(ctx, 'wait', ENROLL_WAIT_S, 1, 86_400);
  const replace = ctx.values.replace === true;

  const first = await locked(ctx, () => anchored(ctx, true));
  const listed = first.head.state.machines.find(sameName(name));
  if (listed && !replace) refuse(`${name} is listed (ref ${listed.ref}): re-enroll it with --replace`);
  const prefix = delegationOver(first.head.state, name);
  if (prefix !== null) refuse(`${name} falls under the delegation prefix ${prefix}: a name there is a certificate's, never an enrolled machine's`);
  if (!replace && (await hubRows(first.person)).some(sameName(name))) {
    refuse(`the hub holds a row named ${name} (a phase-1 machine's, or one not yet listed): re-enroll it in place with --replace, or drop the row first (machine drop ${name})`);
  }
  const minted = await answered(first.person, '/api/enrollments', { body: { ttl_s: ttl, ...(replace ? { machine: name } : {}) } });
  if (minted.status !== 201) refuse(`the hub refused the enrollment: ${minted.said}`);
  const issued = JSON.parse(minted.text) as EnrollmentIssued;
  const k = crypto.getRandomValues(new Uint8Array(32));
  const { root } = first.head.state;
  const code = encodeEnrollmentCodeV2({ hub: ctx.hub, token: issued.token, roots: root.keys, recoveryPub: root.recoveryPub, k: base64urlEncode(k), machine: name });
  const terminal = ctx.terminal();
  terminal.write(`enrollment code for ${name}${ctx.local ? '' : ' (on the clipboard too)'}; paste it at mawsd enroll's prompt on ${name}:\n\n${code}\n\n`);
  if (!ctx.local) await ctx.io.exec('pbcopy', [], code).catch((error: unknown) => terminal.write(`(not copied to the clipboard: ${error instanceof Error ? error.message : String(error)})\n`));
  ctx.io.out(`waiting up to ${wait} s for ${name} to post its key (the code's token lapses at ${issued.enrollment.expires})`);

  const deadline = Date.now() + wait * 1000;
  let key: EnrollmentKey | null = null;
  for (;;) {
    const asked = await answered(first.person, `/api/enrollments/${issued.enrollment.id}/key`);
    if (asked.status === 200) key = JSON.parse(asked.text) as EnrollmentKey;
    else if (!(asked.status === 404 && asked.text.includes('"no-key"'))) refuse(`the hub answered ${asked.said} for the machine's key: nothing was signed`);
    if (key !== null || Date.now() >= deadline) break;
    await ctx.io.sleep(Math.min(ENROLL_POLL_MS, Math.max(0, deadline - Date.now())));
  }
  if (key === null) refuse(`no key from ${name} within ${wait} s: nothing was signed (the code's token lapses at ${issued.enrollment.expires})`);
  if (machineNameKey(key.machine) !== machineNameKey(name)) refuse(`the code was redeemed under the name ${printable(key.machine)}, not ${name}: nothing was signed`);
  if (!(await verifyEnrollmentMac(k, { name: key.machine, machinePub: key.pub, ref: key.ref, tokenId: issued.enrollment.id }, key.mac))) {
    refuse(`the key posted for ${name}: its MAC is not under this code's secret: nothing was signed`);
  }
  const shown = `machine ${printable(key.machine)} ref ${printable(key.ref)} key ${await keyId(key.pub)}`;
  ctx.io.out(shown);
  if (!(await confirm(ctx, `${ctx.local ? '' : `${shown}\n`}compare with mawsd keys --json on ${name}, then list it? [y/N]`))) {
    refuse(`not listed: nothing was signed (the code is spent; the hub's row for ${name} goes with machine drop ${name})`);
  }

  const posted = key;
  return locked(ctx, async () => {
    const from = await anchored(ctx, true);
    const s = from.head.state;
    const bound = s.machineNames.find(sameName(name));
    if (bound && bound.ref !== posted.ref) refuse(`${name} is bound to ref ${bound.ref} for the life of the org, and this machine posted ref ${printable(posted.ref)}: nothing was signed`);
    const entry = s.machines.find(sameName(name));
    if (entry && !replace) refuse(`${name} was listed meanwhile (ref ${entry.ref}): nothing was signed`);
    const signed = await from.amend(async (next) => {
      const held = next.machines.find(sameName(name));
      if (held) {
        // Re-enrolled in place: the new key under the same ref, the old one retired as of now (its private half is gone).
        if (held.pub === posted.pub) return;
        next.retired.push({ keyId: await keyId(held.pub), pub: held.pub, notAfter: new Date().toISOString(), holder: { machine: held.ref } });
        held.pub = posted.pub;
        return;
      }
      next.machines.push({ name: posted.machine, ref: posted.ref, pub: posted.pub, owners: [from.me.member.id] });
      if (!next.machineNames.some((p) => sameName(name)(p) && p.ref === posted.ref)) next.machineNames.push({ name: posted.machine, ref: posted.ref });
    });
    ctx.io.out(`listed: version ${signed.state.version}`);
    return 0;
  });
}

/** How far the hub's clock may stand from this one's when its mint answer states the key's expiry. */
const MINT_SKEW_MS = 60_000;

/** Where the hub's answer to a provisioning key's mint differs from what the owner approved; empty when it does not. */
function mintDisagrees(issued: ProvisioningKeyIssued, approved: { prefix: string; ttl: number; maxUses: number | null; before: number; after: number }): string[] {
  const key = issued?.key;
  if (typeof key !== 'object' || key === null) return ['no key in it'];
  const out: string[] = [];
  if (typeof key.id !== 'string' || !/^[0-9a-f]{32}$/.test(key.id)) out.push(`its id ${printable(String(key.id))} is not 32 hex`);
  if (key.prefix !== approved.prefix) out.push(`its prefix ${printable(String(key.prefix))}, not the ${approved.prefix} you approved`);
  const expires = typeof key.expires === 'string' ? Date.parse(key.expires) : NaN;
  const earliest = approved.before + approved.ttl * 1000 - MINT_SKEW_MS;
  const latest = approved.after + approved.ttl * 1000 + MINT_SKEW_MS;
  if (!(expires >= earliest && expires <= latest)) {
    out.push(`it expires at ${printable(String(key.expires))}, not within ${MINT_SKEW_MS / 1000} s of ${new Date(approved.before + approved.ttl * 1000).toISOString()}`);
  }
  if (key.max_uses !== approved.maxUses) {
    const theirs = key.max_uses === null ? 'no use limit' : `a limit of ${printable(String(key.max_uses))} uses`;
    out.push(`${theirs}, not the ${approved.maxUses === null ? 'no limit' : approved.maxUses} you approved`);
  }
  if (typeof issued.token !== 'string' || issued.token === '') out.push('no token');
  return out;
}

/**
 * `delegation create`: the devcloud delegation and its provisioning code (RL §5.3). The owner confirms first; then the
 * provisioning key is minted at the hub, a key pair made for the delegation, and the successor holding it signed. The
 * code goes to stdout and nowhere else: a pipe into Secret Manager. What is signed is what the owner approved (the
 * prefix, the expiry, the use limit), and a mint answer that disagrees is refused before anything is signed.
 *
 * It posts nothing (the spec's Decision Log, M2 round 2): the successor is signed into the anchor's pending slot,
 * unsent, and the code written; the store takes it when this command exits and closes the pipe, and
 * `delegation publish` (once the owner's `code inspect` of the stored code decodes) posts the proposal, the delegation
 * in effect from then; until then every other signing verb refuses (round 3). A run killed anywhere here leaves nothing at the hub, so the delegation cannot take effect without its
 * code stored; what it leaves is undone by `abandon-pending` and `provisioning revoke`.
 */
async function delegationCreate(ctx: Context): Promise<number> {
  const label = ctx.values.label;
  const prefix = ctx.values.prefix;
  if (typeof label !== 'string' || label.length < 1 || label.length > 100) refuse('delegation create --label <1 to 100 characters>');
  if (typeof prefix !== 'string' || !isMachineName(prefix)) refuse('delegation create --prefix <an admitted machine name, such as dc->');
  const ttl = whole(ctx, 'ttl', PROVISIONING_KEY_TTL_S, MIN_PROVISIONING_KEY_TTL_S, MAX_PROVISIONING_KEY_TTL_S);
  const maxUses = ctx.values['max-uses'] === undefined ? null : whole(ctx, 'max-uses', 0, 1, MAX_PROVISIONING_KEY_USES, 'uses');
  let legacy: ProvisioningCodeV2['legacy'];
  if (ctx.values['legacy-from-v1-code'] === true) {
    // The org key, from the artifact that already holds it and from nothing else.
    let v1: ReturnType<typeof decodeProvisioningCode>;
    try {
      v1 = decodeProvisioningCode((await ctx.io.readStdin()).trim());
    } catch {
      return refuse('stdin holds no v1 provisioning code (smns-provision-v1): nothing was sent');
    }
    if (new URL(v1.hub).origin !== ctx.hub) refuse(`the v1 code is for ${printable(v1.hub)}, not ${ctx.hub}: nothing was sent`);
    legacy = { org: v1.org, key: v1.key };
  }
  const from = await anchored(ctx, true);
  if (legacy && legacy.org !== from.anchor.org) refuse(`the v1 code is the org ${printable(legacy.org)}'s, not ${from.anchor.org}'s: nothing was minted`);
  const problem = prefixProblem(from.head.state, prefix);
  if (problem) refuse(`${problem}: nothing was minted`);
  if (!(await confirm(ctx, `delegate ${prefix} for ${ttl} s? [y/N]`))) refuse('not delegated: nothing was minted');
  const before = Date.now();
  const minted = await answered(from.person, PROVISIONING_KEYS_PATH, { body: { label, prefix, ttl_s: ttl, ...(maxUses === null ? {} : { max_uses: maxUses }) } });
  const after = Date.now();
  if (minted.status !== 201) refuse(`the hub refused the provisioning key: ${minted.said}`);
  const issued = JSON.parse(minted.text) as ProvisioningKeyIssued;
  // What is signed is what the owner approved: the hub's answer is checked against it, never signed from.
  const disagrees = mintDisagrees(issued, { prefix, ttl, maxUses, before, after });
  if (disagrees.length > 0) {
    const id = typeof issued.key?.id === 'string' ? printable(issued.key.id) : '<its id>';
    refuse(`the hub's answer to the mint disagrees with what you approved (${disagrees.join('; ')}): nothing was signed; revoke the key it minted (provisioning revoke ${id})`);
  }
  const pair = await generateSigningKey(true);
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const delegation: Delegation = {
    id: issued.key.id,
    pub: pair.pub,
    prefix,
    expires: new Date(before + ttl * 1000).toISOString(),
    maxUses: maxUses ?? NO_USE_CAP,
    offlineRevokeS: NEVER_OFFLINE,
    owners: [from.me.member.id],
  };
  const { root } = from.head.state;
  const code = `${encodeProvisioningCodeV2({
    hub: ctx.hub,
    org: from.anchor.org,
    roots: root.keys,
    recoveryPub: root.recoveryPub,
    token: issued.token,
    delegation: { id: delegation.id, prefix: delegation.prefix, privateJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d } },
    ...(legacy ? { legacy } : {}),
  })}\n`;
  const signed = await from.propose((s) => void s.delegations.push(delegation));
  const n = signed.state.version;
  ctx.io.out(`version ${n} lists delegation ${delegation.id} (prefix ${prefix}, expires ${delegation.expires}), signed and pending in ${anchorFile(ctx.keysPath)}: nothing was posted`);
  try {
    await ctx.io.secretOut(code);
  } catch (error) {
    // Unsent, the proposal is this run's to drop: no hub has seen it, and its delegation's key is lost.
    writeAnchor(ctx.keysPath, { ...readAnchor(ctx.keysPath)!, pending: undefined, unsent: undefined });
    return refuse(`the code could not be written to stdout (${error instanceof Error ? error.message : String(error)}): the proposal was dropped and nothing was posted; run provisioning revoke ${delegation.id}`);
  }
  ctx.io.out(`its code went to stdout`);
  ctx.io.out(`next: the store (gcloud secrets create) takes the code once this command exits; check the stored code with code inspect; then admin delegation publish sends version ${n}, and delegation ${delegation.id} is in effect`);
  ctx.io.out(`if the store failed or the stored code does not decode: admin abandon-pending (nothing was posted), then admin provisioning revoke ${delegation.id}`);
  return 0;
}

/** `delegation publish`: the unsent proposal `delegation create` left pending, sent on the owner's word. */
async function delegationPublish(ctx: Context): Promise<number> {
  const from = await anchored(ctx, false, { unsent: 'publish' });
  const proposal = from.anchor.pending;
  if (proposal === undefined || from.anchor.unsent !== true) refuse('no unsent delegation is pending (delegation create leaves one): nothing was sent');
  const ids = proposal!.state.delegations.filter((d) => !from.head.state.delegations.some((x) => x.id === d.id)).map((d) => d.id);
  if (!(await confirm(ctx, `publish delegation ${ids.join(', ')}? [y/N]`))) refuse('not published: it stays pending, unsent');
  const sent = await from.publish();
  ctx.io.out(`published: version ${sent.state.version}`);
  return 0;
}

/** `delegation drop ID`: its key revoked by its id and prefix, which stay reserved; its certificates' too; its key at the hub revoked. */
async function delegationDrop(ctx: Context): Promise<number> {
  const id = ctx.positionals[0];
  const from = await anchored(ctx, true);
  const d = from.head.state.delegations.find((x) => x.id === id);
  if (!d) {
    const dropped = from.head.state.revoked.some((r) => 'delegation' in r.holder && r.holder.delegation === id);
    refuse(dropped ? `delegation ${printable(id)} was dropped already` : `the head (version ${from.head.state.version}) holds no delegation ${printable(id)}`);
  }
  if (!(await confirm(ctx, `drop ${id} (its prefix ${d!.prefix} stays reserved)? [y/N]`))) refuse('not dropped: nothing was signed');
  const signed = await from.amend(async (s) => {
    s.delegations = s.delegations.filter((x) => x.id !== id);
    s.revoked.push({ keyId: await keyId(d!.pub), holder: { delegation: id, prefix: d!.prefix } });
    // Its certificates go with it, history included (org-state.ts): an admin's retirement of one moves to `revoked`.
    const ours = (r: OrgState['retired'][number]) => 'machine' in r.holder && r.holder.machine.startsWith(`${id}_`);
    for (const r of s.retired.filter(ours)) s.revoked.push({ keyId: r.keyId, holder: r.holder });
    s.retired = s.retired.filter((r) => !ours(r));
  });
  ctx.io.out(`dropped: delegation ${id} (version ${signed.state.version}); its prefix ${d!.prefix} stays reserved`);
  const revoked = await answered(from.person, `${PROVISIONING_KEYS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (revoked.status === 200) ctx.io.out(`revoked at the hub: provisioning key ${id} enrolls nothing more`);
  else if (revoked.status === 404) ctx.io.out(`the hub holds no provisioning key ${id}`);
  else refuse(`the hub answered ${revoked.said} to revoking provisioning key ${id}: run delegation drop's revocation again as provisioning revoke once the delegation is gone`);
  return 0;
}

/**
 * `machine drop NAME`: whatever holds the name taken out. An entry of the head: a successor retiring its key (`--revoke`:
 * revoking it) and the hub row deleted. A live certificate: an admin's retirement of its key under its ref (RL §5.2),
 * and the row deleted, so a recreated VM may take the name. A hub row alone: the DELETE alone.
 */
async function machineDrop(ctx: Context): Promise<number> {
  const name = ctx.positionals[0];
  const how = ctx.values.revoke === true ? 'revoked' : 'retired';
  const from = await anchored(ctx, true);
  const held = resolveMachine(name, from.head.state, await certificateViews(from.head.state, from.certificates), await hubRows(from.person));
  if (held === null) refuse(`nothing is named ${printable(name)}: not in the head, no live certificate, no hub row`);
  const what =
    held!.kind === 'listed'
      ? `listed, ref ${held!.entry.ref}, key ${await keyId(held!.entry.pub)}: ${how}`
      : held!.kind === 'certified'
        ? held!.certs.map((c) => `a certificate of delegation ${c.delegation}, ref ${c.ref}, key ${c.kid}: ${how}`).join('; ')
        : 'a hub row with no key in the head: deleted';
  const rowName = held!.kind === 'listed' ? held!.entry.name : held!.kind === 'certified' ? held!.certs[0].name : held!.row.name;
  if (!(await confirm(ctx, `drop ${printable(rowName)} (${what})? [y/N]`))) refuse('not dropped: nothing was signed or deleted');
  if (held!.kind !== 'row') {
    const now = new Date().toISOString();
    const gone = held!.kind === 'listed' ? [{ ref: held!.entry.ref, pub: held!.entry.pub }] : held!.certs.map((c) => ({ ref: c.ref, pub: c.pub }));
    const signed = await from.amend(async (s) => {
      if (held!.kind === 'listed') s.machines = s.machines.filter((m) => m.ref !== held!.entry.ref);
      for (const { ref, pub } of gone) {
        const kid = await keyId(pub);
        if (how === 'revoked') s.revoked.push({ keyId: kid, holder: { machine: ref } });
        else s.retired.push({ keyId: kid, pub, notAfter: now, holder: { machine: ref } });
      }
    });
    ctx.io.out(`${how}: ${rowName}'s key in version ${signed.state.version}`);
  }
  const deleted = await answered(from.person, `/api/machines/${encodeURIComponent(rowName)}`, { method: 'DELETE' });
  if (deleted.status === 200) ctx.io.out(`deleted: the hub's row for ${printable(rowName)}`);
  else if (deleted.status === 404) ctx.io.out(`the hub holds no row for ${printable(rowName)}`);
  else refuse(`the hub answered ${deleted.said} to deleting ${printable(rowName)}'s row: run machine drop again`);
  return 0;
}

/** `provisioning revoke ID`: a provisioning key that enrolls nothing more (the phase-1 key; a delegation's goes with it). */
async function provisioningRevoke(ctx: Context): Promise<number> {
  const id = ctx.positionals[0];
  const from = await anchored(ctx, false);
  const d = from.head.state.delegations.find((x) => x.id === id);
  if (d) refuse(`${id} is delegation ${d.prefix}'s: delegation drop ${id} revokes it with the delegation`);
  const { keys } = await from.person.json<{ keys: ProvisioningKeyRecord[] }>(PROVISIONING_KEYS_PATH);
  const key = keys.find((k) => k.id === id) ?? refuse(`the hub holds no provisioning key ${printable(id)}`);
  if (key.revoked !== null) {
    ctx.io.out(`provisioning key ${id} was revoked at ${key.revoked}`);
    return 0;
  }
  if (!(await confirm(ctx, `revoke provisioning key ${id} (${printable(key.label)}, prefix ${printable(key.prefix)}, ${key.uses} uses)? It enrolls nothing more [y/N]`))) {
    refuse('not revoked: nothing was sent');
  }
  const revoked = await answered(from.person, `${PROVISIONING_KEYS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (revoked.status !== 200) refuse(`the hub answered ${revoked.said} to revoking provisioning key ${id}`);
  ctx.io.out(`revoked: provisioning key ${id}`);
  return 0;
}

/**
 * `abandon-pending`: the anchor's pending proposal dropped, after the owner judged why the hub never took it (a courtesy
 * check's refusal, say). Refused while the hub's chain holds it, which the next run adopts. Nothing else is settled.
 */
async function abandonPending(ctx: Context): Promise<number> {
  const { anchor, verified } = await openAnchor(ctx);
  const proposal = anchor.pending;
  if (proposal === undefined) {
    ctx.io.out('nothing pending');
    return 0;
  }
  const n = proposal.state.version;
  const held = verified.chain[n - 1];
  if (held !== undefined && canonicalize(held) === canonicalize(proposal)) refuse(`the hub holds pending version ${n}: the next run adopts it; nothing was abandoned`);
  const hash = await stateHash(proposal.state);
  const head = verified.head.state;
  const unsent = anchor.unsent === true;
  ctx.io.out(
    unsent
      ? `pending version ${n} ${hash} was never sent: nothing was posted`
      : held === undefined
        ? `the hub's head is version ${head.version}; pending version ${n} ${hash} is not at the hub`
        : `the hub holds version ${n} ${await stateHash(held.state)} where this device signed version ${n} ${hash}: a fork`,
  );
  const question = unsent
    ? `abandon version ${n} ${hash}? It was never posted, so nothing can show it as a fork [y/N]`
    : `abandon version ${n} ${hash}? A later verb may sign another successor of version ${n - 1}, which a hub that kept these bytes could show a machine as a fork: abandon it only once you know why the hub refused it [y/N]`;
  if (!(await confirm(ctx, question))) refuse('not abandoned: the proposal stays pending');
  writeAnchor(ctx.keysPath, { ...anchor, pending: undefined, unsent: undefined, version: Math.max(anchor.version, head.version) });
  // A delegation the proposal added never took effect, but `delegation create` minted its key and wrote its code.
  for (const d of proposal.state.delegations) {
    if (head.delegations.some((x) => x.id === d.id)) continue;
    ctx.io.out(
      unsent
        ? `the abandoned proposal held delegation ${d.id} (prefix ${d.prefix}), never posted: its provisioning key is minted at the hub; run provisioning revoke ${d.id}, and delete its code if it was stored`
        : `the abandoned proposal held delegation ${d.id} (prefix ${d.prefix}), never in effect: its provisioning key is minted at the hub and its code may be in your secret store; run provisioning revoke ${d.id} and delete the stored code`,
    );
  }
  ctx.io.out(`abandoned: version ${n} ${hash}`);
  return 0;
}

/**
 * `keys retire [--undo]`: the DX1 org key retired in a signed successor (`legacyRetired`, O14 M5a), or that retirement
 * undone while the hub still holds the wrapped copies; a head already so signs nothing.
 */
async function keysRetire(ctx: Context): Promise<number> {
  const from = await anchored(ctx, true);
  const { version, legacyRetired } = from.head.state;
  if (ctx.values.undo !== true) {
    if (legacyRetired) {
      ctx.io.out(`the head (version ${version}) retires the legacy org key already: nothing was signed`);
      return 0;
    }
    if (!(await confirm(ctx, 'retire the legacy org key? Machines stop using it; until keys purge, keys retire --undo takes it back [y/N]'))) refuse('not retired: nothing was signed');
    const signed = await from.amend(retireLegacyKey);
    ctx.io.out(`retired: the legacy org key, at version ${signed.state.version}`);
    return 0;
  }
  if (!legacyRetired) {
    ctx.io.out(`the head (version ${version}) retires no legacy org key: nothing was signed`);
    return 0;
  }
  // The hub refuses the undo once it purged the copies (409 key-purged); asked first, nothing is left pending.
  if ((await wrappedCopies(from.person, 'signed')) === 'purged') refuse("the hub purged the org key's wrapped copies: the retirement stands (a successor without legacyRetired is refused 409 key-purged); nothing was signed");
  if (!(await confirm(ctx, `undo the legacy org key's retirement (version ${legacyRetired.version})? [y/N]`))) refuse('not undone: nothing was signed');
  const signed = await from.amend(restoreLegacyKey);
  ctx.io.out(`restored: the legacy org key in use again, at version ${signed.state.version}`);
  return 0;
}

/** `keys purge`: every wrapped copy of the org key deleted at the hub, on a head that retires it. Irreversible. */
async function keysPurge(ctx: Context): Promise<number> {
  const from = await anchored(ctx, false);
  const { version, legacyRetired } = from.head.state;
  // The hub refuses it too (409 not-retired); refused here first.
  if (!legacyRetired) refuse(`the head (version ${version}) does not retire the legacy org key (legacyRetired): keys retire first; nothing was purged`);
  const held = await wrappedCopies(from.person, 'purged');
  if (held === 'purged') {
    ctx.io.out('the hub holds no wrapped copy of the org key: purged already');
    return 0;
  }
  const copies = `${held} wrapped ${held === 1 ? 'copy' : 'copies'}`;
  if (!(await confirm(ctx, `purge the ${copies} of the org key at ${ctx.hub}? This cannot be undone: the hub keeps no copy, and the retirement can never be taken back [y/N]`))) refuse('not purged: the copies stay');
  let purged: Awaited<ReturnType<typeof purgeOrgKeys>>;
  try {
    purged = await purgeOrgKeys(from.person);
  } catch (error) {
    return refuse(`the purge failed (${printable(error instanceof Error ? error.message : String(error))}): keys purge again says whether the hub took it`);
  }
  ctx.io.out(`purged: ${copies} of the org key, under version ${purged.purged.version} at ${purged.purged.at}`);
  return 0;
}

/** How many wrapped copies of the org key the hub holds, or `purged` (its `410 retired`); `nothing` names what a refusal left undone. */
async function wrappedCopies(person: Person, nothing: 'signed' | 'purged'): Promise<number | 'purged'> {
  const held = await answered(person, ORG_KEYS_PATH);
  if (held.status === 410) return 'purged';
  if (held.status !== 200) refuse(`the hub did not list the org key's wrapped copies: ${held.said}; nothing was ${nothing}`);
  return (JSON.parse(held.text) as { keys: unknown[] }).keys.length;
}

/** A provisioning code read from stdin, or the decoder's refusal. */
async function stdinCode(ctx: Pick<Context, 'io'>): Promise<ProvisioningCodeV2> {
  try {
    return decodeProvisioningCodeV2((await ctx.io.readStdin()).trim());
  } catch (error) {
    return refuse(`stdin: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `code inspect`: a provisioning code's fields, every key and token elided. */
async function codeInspect(ctx: Pick<Context, 'io'>): Promise<number> {
  const code = await stdinCode(ctx);
  for (const line of [
    'smns-provision-v2 code',
    `hub ${code.hub}`,
    `org ${code.org}`,
    `roots ${code.roots.join(', ')}`,
    `recoveryPub ${code.recoveryPub}`,
    'token (elided)',
    `delegation ${code.delegation.id} prefix ${code.delegation.prefix} privateJwk (elided)`,
    code.legacy ? `legacy org ${code.legacy.org} key (elided)` : 'legacy none',
  ]) {
    ctx.io.out(printable(line));
  }
  return 0;
}

/** `code strip-legacy`: the same code without its `legacy` field, to stdout (a pipe alone). */
async function codeStripLegacy(ctx: Pick<Context, 'io'>): Promise<number> {
  const { legacy, ...rest } = await stdinCode(ctx);
  await ctx.io.secretOut(`${encodeProvisioningCodeV2(rest)}\n`);
  ctx.io.err(legacy ? 'strip-legacy: the legacy field is dropped' : 'strip-legacy: the code holds no legacy field; it is unchanged');
  return 0;
}

const RUN: Record<Subcommand, (ctx: Context) => Promise<number>> = {
  init,
  genesis,
  adopt,
  refresh,
  pair,
  devices,
  'remove-device': removeDevice,
  'root add': rootAdd,
  show,
  enroll,
  'delegation create': delegationCreate,
  'delegation publish': delegationPublish,
  'keys retire': keysRetire,
  'keys purge': keysPurge,
  'delegation drop': delegationDrop,
  'machine drop': machineDrop,
  'provisioning revoke': provisioningRevoke,
  'abandon-pending': abandonPending,
  'code inspect': codeInspect,
  'code strip-legacy': codeStripLegacy,
};

/** The command over `argv`, its world reached through `io`. Its exit status. */
export async function runAdmin(argv: string[], given: AdminIo): Promise<number> {
  // Every line out is one line, with no terminal control in it, whatever a hub-supplied part of it held.
  const io: AdminIo = { ...given, out: (line) => given.out(noControls(line)), err: (line) => given.err(noControls(line)) };
  try {
    return await run(argv, io);
  } catch (error) {
    io.err(`admin: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof Refusal ? 1 : 2;
  }
}

async function run(argv: string[], given: AdminIo): Promise<number> {
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
      'media-check': { type: 'boolean' },
      class: { type: 'string' },
      ttl: { type: 'string' },
      replace: { type: 'boolean' },
      wait: { type: 'string' },
      label: { type: 'string' },
      prefix: { type: 'string' },
      'code-to-stdout': { type: 'boolean' },
      'max-uses': { type: 'string' },
      'legacy-from-v1-code': { type: 'boolean' },
      revoke: { type: 'boolean' },
      undo: { type: 'boolean' },
    },
  });
  const [name, ...more] = positionals;
  if (!(SUBCOMMANDS as readonly string[]).includes(name)) return usage(given);
  const group = name in GROUPS ? GROUPS[name as Group] : null;
  if (group !== null && !(group as readonly string[]).includes(more[0])) return usage(given);
  const sub = (group === null ? name : `${name} ${more[0]}`) as Subcommand;
  const rest = group === null ? more : more.slice(1);
  if (rest.length !== (POSITIONAL[sub] === undefined ? 0 : 1)) {
    if (sub === 'remove-device' && rest.length === 0) refuse('remove-device <device id>');
    if (POSITIONAL[sub] !== undefined) refuse(`${sub} ${POSITIONAL[sub]}`);
    return usage(given);
  }
  const only: Array<[string, Subcommand[]]> = [
    ['recovery', ['genesis']],
    ['media-check', ['genesis']],
    ['class', ['pair']],
    ['ttl', ['pair', 'enroll', 'delegation create']],
    ['replace', ['enroll']],
    ['wait', ['enroll']],
    ['label', ['delegation create']],
    ['prefix', ['delegation create']],
    ['code-to-stdout', ['delegation create']],
    ['max-uses', ['delegation create']],
    ['legacy-from-v1-code', ['delegation create']],
    ['revoke', ['machine drop']],
    ['undo', ['keys retire']],
  ];
  for (const [option, subs] of only) if (values[option as keyof typeof values] !== undefined && !subs.includes(sub)) refuse(`--${option} is ${subs.join(' and ')}'s option`);
  // A secret code on stdout: for a pipe alone, named so (`--code-to-stdout`), and every other line on stderr.
  if (sub === 'delegation create' && values['code-to-stdout'] !== true) refuse('delegation create --code-to-stdout: its code goes to stdout alone, into a pipe (… | gcloud secrets create <id> --data-file=-)');
  if (SECRET_STDOUT.includes(sub) && given.stdoutIsTerminal) refuse(`stdout is a terminal: the code goes only to a pipe (into Secret Manager); nothing was sent`);
  const io: AdminIo = SECRET_STDOUT.includes(sub) ? { ...given, out: given.err } : given;
  // Dispatched before the keys, the deployment and the credential are read: they need none of them.
  if (LOCAL_TRANSFORMS.includes(sub)) return (sub === 'code inspect' ? codeInspect : codeStripLegacy)({ io });
  if ((values.config?.length ?? 0) > 1 || (values.keys?.length ?? 0) > 1) refuse('name one --config and one --keys');
  const local = values.hub !== undefined;
  // The deployment's volume rules at the local hub: the owner's check of a real drive before a deployment's genesis.
  if (values['media-check'] && !local) refuse('--media-check is for the local hub (--hub): a deployment checks the recovery destination\'s media always');
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
  // A verb whose stdin and stdout are a pipe asks at /dev/tty at the local hub too.
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
  // The token: the environment's when set there (a runner's `--pipe`), else stdin's; never stdin's when stdin is the
  // verb's own input.
  const stdinIsInput = sub === 'delegation create' && values['legacy-from-v1-code'] === true;
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
    terminal: () => (terminal ??= io.openTerminal(!local || SECRET_STDOUT.includes(sub))),
    person: async () => {
      if (person) return person;
      if (local) return (person = new StandinPerson(hub, values.user!));
      let token = io.env.DESK_ACCESS_TOKEN;
      if (!token && stdinIsInput) refuse('DESK_ACCESS_TOKEN in the environment: this verb\'s stdin is its input (production-run.sh admin --pipe sets it)');
      token ||= (await io.secrets()).DESK_ACCESS_TOKEN;
      if (!token) refuse('DESK_ACCESS_TOKEN on stdin: the owner\'s Access token for the deployment');
      return (person = new Person(hub, token!));
    },
  };
  if (sub === 'init') return RUN.init(ctx);
  // `enroll` holds the lock for its reads and its signing alone, never across its wait.
  if (sub === 'enroll') return RUN.enroll(ctx);
  // One run at a time per anchor, from its first read to its last write: a held lock is never taken over.
  return locked(ctx, () => RUN[sub](ctx));
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
  io.err('  genesis --recovery <path | paper> [--media-check, at --hub]; pair --class web-cards|native-mac [--ttl <s>]; remove-device <device id>; root add <device id>');
  io.err('  enroll <name> [--replace] [--ttl <s>] [--wait <s>]; delegation create --label <l> --prefix <p> --code-to-stdout [--ttl <s>] [--max-uses <n>] [--legacy-from-v1-code]');
  io.err('  delegation drop <id>; machine drop <name> [--revoke]; provisioning revoke <id>; code inspect | strip-legacy (stdin to stdout) (deploy/README.md)');
  return 2;
}

// ---- The machine's own io ---------------------------------------------------------------------------------------------

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
    removableVolume: isRemovableVolume,
    readText,
    placement: machinePlacement(env, home),
    env,
    appDir: process.env.DESK_HUB_APP!,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString('utf8');
    },
    // The stream's 'error' (EPIPE: the store went away) is the write's failure, not an uncaught crash.
    secretOut: (text) =>
      new Promise<void>((resolve, reject) => {
        process.stdout.once('error', reject);
        process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
      }),
    stdoutIsTerminal: process.stdout.isTTY === true,
  };
}

export async function main(argv: string[]): Promise<number> {
  return runAdmin(argv, machineIo());
}
