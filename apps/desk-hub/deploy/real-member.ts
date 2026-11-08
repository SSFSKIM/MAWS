// `deployment real-member add | pair | remove` (P5 O8 M6b's live proof, layer 2; docs/doperpowers/plans/2026-10-28-p5-o8-
// org-interface.md, Concrete Steps "The shared staging run" and Decision Log "The real-member sitting"): a real second
// member on staging, for the one sitting where a person other than the owner signs into MAWS. Each step is signed by
// the staging admin's test device (its step-up key), as the reach run's `addRunMember` is.
//
//   add      the owner's second email, read from a file, added to staging's org state as a member with no device; the
//            desk track's `access-sync` then lets Access admit it.
//   pair     a pairing code naming that member written to a new 0600 file, for the owner to paste into a second
//            scratch MAWS profile's sign-in; once that profile, signed in through Access as the second email, posts its
//            device, the entry answering the code (its MAC under the code's secret) is listed as the member's first
//            device, unendorsed, as the protocol allows a member's first device (P5 Decision Log 34; the app's own
//            edits.ts lists another member's first device so). The entries are read as the admin reads another
//            member's (H1: `GET /api/devices/pending?member=<id>`). The code's file is removed however the step ends.
//   remove   the member taken out of the state and every key of its devices revoked; `access-sync` then takes the
//            admission away.
//
// Staging alone: production is refused by name, and every step is refused for any hub but staging's host and org
// before the admin device is opened or anything is asked of the hub. The email is the owner's: it is read only from a
// file of mode 0600, outside any git checkout, and no line the steps print holds it, nor the code (each is scrubbed from
// every line, the hub's own words included, and listed for the runner's search of its log after the step).
import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, constants, existsSync, fchmodSync, fstatSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { base64urlEncode, encodePairingCode, judgeEntry, keyId, pairingFingerprint, type Device, type OrgState, type RevokedKey } from 'org-protocol';
import { PENDING_DEVICES_PATH, type PendingDevice } from '../src/protocol/identity';
import { PRODUCTION_HOST, readDeployConfig, STAGING_HOST, STAGING_ORG, type DeployConfig } from './config';
import { readSecrets } from './deploy';
import type { RunHub } from './endpoint-machine';
import { Person } from './hub';
import { loadAdminDevice, OrgAdmin } from './org-admin';
import { withExitCleanup } from './run-lock';

export const VERBS = ['add', 'pair', 'remove'] as const;
export type Verb = (typeof VERBS)[number];
/** How long `pair` waits for the second profile's device by default, and at most. */
export const PAIR_WAIT_S = 1800;
export const MAX_PAIR_WAIT_S = 3600;
const POLL_MS = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MEMBER = /^[0-9a-f]{32}$/;
/** What the steps print in the email's place. */
const SECOND_EMAIL = "the owner's second email";

// ---- what the steps refuse ------------------------------------------------------------------------------------------

/** Why a step is refused at `hub`, or null: staging's host and org alone (staging.json's, by name). */
export function realMemberHubRefusal(hub: RunHub): string | null {
  if (hub.host !== STAGING_HOST || hub.org !== STAGING_ORG) return `the real-member steps act on staging (${STAGING_HOST}, ${STAGING_ORG}) alone, not on ${hub.host} (${hub.org})`;
  return null;
}

export type Values = { 'device-keys'?: string; 'email-file'?: string; member?: string; 'code-file'?: string; wait?: string; production?: boolean };

/** The verb a command line asks for, or why it is refused. */
export function realMemberMode(positionals: readonly string[], values: Values, config: Pick<DeployConfig, 'worker' | 'host'> & { org: { id: string } } | null): { verb: Verb } | { refused: string } {
  const verb = positionals[0];
  if (positionals.length !== 1 || !(VERBS as readonly string[]).includes(verb)) return { refused: `real-member add | pair | remove: one verb (given: ${positionals.join(' ') || 'none'})` };
  if (values.production === true) return { refused: 'the real-member steps run on staging alone: production is never their hub' };
  if (config === null) return { refused: '--config <deploy config>: the hub to act on' };
  if (config.host === PRODUCTION_HOST || config.worker === 'desk-hub') return { refused: `the config names production (${config.host}): the real-member steps run on staging alone` };
  const hub = realMemberHubRefusal({ host: config.host, org: config.org.id });
  if (hub !== null) return { refused: `the config is not staging's org: ${hub}` };
  if (!values['device-keys']) return { refused: '--device-keys <file>: the staging admin device whose step-up key signs the org state' };
  if (values.member !== undefined && verb !== 'remove') return { refused: "--member is remove's alone: add and pair name the member by --email-file" };
  if (!values['email-file'] && !(verb === 'remove' && values.member !== undefined)) return { refused: `--email-file <0600 file outside any checkout>: the owner's second email${verb === 'remove' ? ' (or --member <id>)' : ''}` };
  if (verb === 'pair' && !values['code-file']) return { refused: '--code-file <a new file outside any checkout>: where the pairing code goes (0600)' };
  return { verb: verb as Verb };
}

/** The git checkout `dir` is in (an ancestor holding `.git`, a checkout's directory or a worktree's file), or null. */
function checkoutOf(dir: string): string | null {
  for (let at = dir; ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) return at;
    if (dirname(at) === at) return null;
  }
}

/** A file as a refusal names it: by its directory alone, since its name may be what the file must keep. */
const namedByDirectory = (path: string) => `the file in ${dirname(resolve(path))}`;

/**
 * The text of the private file at `path`: a regular file of this user's, mode exactly 0600 (no special bit beside it),
 * in no git checkout; else throws why, never quoting what the file holds nor naming it but by its directory (its name
 * may be the address itself). The path is opened once, never following a
 * symlink, and every check but the checkout's is made on that descriptor and the text read from it, so a file put in the
 * path's place after the check is never the one read; the checkout's check is made on the path the descriptor's file
 * resolves to, which must still be that file. A parent directory swapped between those steps is outside what this
 * guards: the file lives in the desk track's own home directory, whose parents no one else can write. `opened` runs
 * once the descriptor is open (a suite's seam for the race).
 */
export function readPrivateFile(path: string, opened: () => void = () => {}): string {
  const file = namedByDirectory(path);
  let fd: number;
  try {
    // O_NONBLOCK: a FIFO in the file's place answers at once rather than holding the step open.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EMLINK') throw new Error(`${file} is a symlink: name the file itself`, { cause: error });
    if (code === 'ENOENT') throw new Error(`${file} does not exist`, { cause: error });
    throw new Error(`${file} can't be opened (${code})`, { cause: error });
  }
  try {
    opened();
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${file} is not a regular file`);
    if ((stat.mode & 0o7777) !== 0o600) throw new Error(`${file} must be mode 0600, not 0${(stat.mode & 0o7777).toString(8)}`);
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`${file} is another user's`);
    let resolved: string;
    try {
      resolved = realpathSync(path);
      const now = statSync(resolved);
      if (now.dev !== stat.dev || now.ino !== stat.ino) throw new Error('another file');
    } catch (error) {
      throw new Error(`${file} changed while it was read: nothing was read`, { cause: error });
    }
    const repo = checkoutOf(dirname(resolved));
    if (repo !== null) throw new Error(`${file} is inside the git checkout ${repo}: keep it outside any checkout`);
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/** Why `path` can't be read as a private file (`readPrivateFile`'s refusal), or null. */
export function privateFileRefusal(path: string): string | null {
  try {
    readPrivateFile(path);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Why the pairing code can't be written to `path` (a new file, in an existing directory in no git checkout), or null. */
export function codeFileRefusal(path: string): string | null {
  if (existsSync(path)) return `${path} exists: the code goes to a new file`;
  const dir = dirname(resolve(path));
  if (!existsSync(dir)) return `no directory ${dir}`;
  const repo = checkoutOf(realpathSync(dir));
  if (repo !== null) return `${path} is inside the git checkout ${repo}: keep it outside any checkout`;
  return null;
}

/** The one email address the private file at `path` holds; a refusal never quotes what the file holds, nor its name. */
export function readEmail(path: string, opened?: () => void): string {
  const text = readPrivateFile(path, opened);
  const email = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (!EMAIL.test(email) || email.length > 320) throw new Error(`${namedByDirectory(path)} must hold one email address and nothing else`);
  return email;
}

// ---- the steps ------------------------------------------------------------------------------------------------------

/** What the steps use of the staging admin (org-admin.ts's OrgAdmin). */
export type RealMemberAdmin = Pick<OrgAdmin, 'member' | 'read' | 'amend'>;

export type RealMemberIo = {
  /** A line for the operator and the step's log; every line passes the scrub first. */
  print(line: string): void;
  /** A value no line may hold: scrubbed from each, and listed for the runner's search of the log after the step. */
  secret(value: string): void;
  sleep(ms: number): Promise<void>;
  /** The pairing code's whole text written to its file's descriptor. */
  write(fd: number, text: string): void;
};

export type RealMemberOptions = {
  verb: Verb;
  /** The hub the step acts on, by host and org: staging's alone. */
  hub: RunHub;
  /** Its base URL, which the pairing code names. */
  hubUrl: string;
  emailFile?: string;
  member?: string;
  codeFile?: string;
  waitS: number;
  /** The staging admin, opened only once the hub is staging's and the files are read. */
  open(): Promise<RealMemberAdmin>;
  /** The pending device entries of `member`, as an admin reads another member's (H1). */
  pending(member: string): Promise<PendingDevice[]>;
  io: RealMemberIo;
};

class Refused extends Error {}
const refuse = (why: string): never => {
  throw new Refused(why);
};

/** The member whose email is `email` in `state`, compared as Access compares them (case aside). */
const byEmail = (state: OrgState, email: string) => state.members.find((m) => m.email.toLowerCase() === email.toLowerCase());

async function add(admin: RealMemberAdmin, email: string, io: RealMemberIo): Promise<number> {
  const { state } = await admin.read();
  const own = state.members.find((m) => m.id === admin.member);
  if (own !== undefined && own.email.toLowerCase() === email.toLowerCase()) refuse(`${SECOND_EMAIL} is the admin's own: a second member needs an email of its own`);
  const held = byEmail(state, email);
  if (held !== undefined) refuse(`${SECOND_EMAIL} is already a member (${held.id}): nothing was changed`);
  const id = randomBytes(16).toString('hex');
  const signed = await admin.amend(`${SECOND_EMAIL} added as the member ${id}`, (s) => {
    if (byEmail(s, email) !== undefined) return false;
    s.members.push({ id, email, role: 'member', devices: [] });
  });
  if (signed === null) refuse(`${SECOND_EMAIL} became a member meanwhile: nothing was changed`);
  io.print(`added: ${SECOND_EMAIL} is the member ${id} (version ${signed!.state.version}), with no device yet`);
  io.print(`next: staging-run.sh access-sync, so staging's Access admits ${SECOND_EMAIL}; then real-member pair`);
  return 0;
}

async function pair(o: RealMemberOptions, admin: RealMemberAdmin, email: string): Promise<number> {
  const { io } = o;
  const codeFile = o.codeFile!;
  const head = await admin.read();
  const member = byEmail(head.state, email) ?? refuse(`the head (version ${head.state.version}) lists no member with ${SECOND_EMAIL}: run real-member add first`);
  if (member.devices.length > 0) refuse(`the member ${member.id} lists a device already: this step lists a member's first device alone`);
  const where = codeFileRefusal(codeFile);
  if (where !== null) refuse(where);
  const k = crypto.getRandomValues(new Uint8Array(16));
  const { root, org } = head.state;
  const code = encodePairingCode({ hub: o.hubUrl, org, member: member.id, roots: root.keys, recoveryPub: root.recoveryPub, k: base64urlEncode(k) });
  io.secret(code);
  // Created only if absent, never through a symlink; from here on the file is removed however the step ends: a write
  // failing partway, a throw, the wait's end, or a SIGINT, SIGHUP or SIGTERM (run-lock.ts's withExitCleanup: the sitting
  // runs this step in the background and stops it with SIGTERM, and a file left behind would refuse a retry at its path).
  const fd = openSync(codeFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    return await withExitCleanup(
      () => rmSync(codeFile, { force: true }),
      () => waitForDevice(o, admin, { head: head.state, member, k, code, fd }),
    );
  } finally {
    io.print(`the pairing code's file is removed: the code is spent`);
  }
}

/** What pair's wait works from: the head it read, the member it pairs, the code's secret, and the code's open file. */
type Pairing = { head: OrgState; member: OrgState['members'][number]; k: Uint8Array; code: string; fd: number };

/** pair's wait, once its code's file is made: the code written, then B's pending entries read until one answers it. */
async function waitForDevice(o: RealMemberOptions, admin: RealMemberAdmin, { head, member, k, code, fd }: Pairing): Promise<number> {
  const { io } = o;
  const { org } = head;
  try {
    fchmodSync(fd, 0o600);
    io.write(fd, `${code}\n`);
  } finally {
    closeSync(fd);
  }
  io.print(`the pairing code for the member ${member.id} is in ${o.codeFile} (0600): paste it into the second profile's Settings › Org, its Pairing code row, and Sign in`);
  io.print(`waiting up to ${o.waitS} s for its device`);
  const listed = new Set(head.members.flatMap((m) => m.devices.map((d) => d.id)));
  const named = new Set<string>();
  const deadline = Date.now() + o.waitS * 1000;
  for (;;) {
    const found: Array<Omit<Device, 'endorsement'>> = [];
    for (const entry of await o.pending(member.id)) {
      const judged = await judgeEntry(entry, { org, member: member.id, k, class: 'native-mac', listed });
      if (judged.ok) found.push(judged.device);
      else if (!named.has(`${entry.deviceId} ${entry.mac}`)) {
        named.add(`${entry.deviceId} ${entry.mac}`);
        io.print(`not this pairing's: ${String(entry.deviceId).slice(0, 64)} (${judged.why})`);
      }
    }
    if (found.length > 1) refuse('two devices answered this code: run pair again (the code is spent)');
    if (found.length === 1) {
      const device = found[0];
      io.print(`pending: ${device.id} ${device.class} ${device.keyStorage} fingerprint ${await pairingFingerprint(org, member.id, device)} (the second profile shows the same)`);
      const signed = await admin.amend(`the member ${member.id}'s first device ${device.id} listed, unendorsed`, (s) => {
        const m = s.members.find((x) => x.id === member.id);
        if (m === undefined || m.devices.length > 0) return false;
        m.devices.push({ ...device });
      });
      if (signed === null) refuse(`the head no longer lists the member ${member.id} without a device: nothing was listed`);
      io.print(`listed: the member ${member.id}'s first device ${device.id} (version ${signed!.state.version}); the second profile signs in once it reads that head`);
      return 0;
    }
    if (Date.now() >= deadline) refuse(`no device answered the code within ${o.waitS} s: run pair again (the code is spent)`);
    await io.sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

async function remove(admin: RealMemberAdmin, who: { email: string } | { member: string }, io: RealMemberIo): Promise<number> {
  const { state } = await admin.read();
  const member = 'email' in who ? byEmail(state, who.email) : state.members.find((m) => m.id === who.member);
  if (member === undefined) {
    io.print(`nothing to remove: the head (version ${state.version}) lists no such member`);
    return 0;
  }
  // Known to the scrubber and the search before anything else, whichever way the member was found (by --member, the
  // email was never read): a refusal, or the hub's own words, may quote it.
  io.secret(member.email);
  const id = member.id;
  const isAdmin = (m: OrgState['members'][number]) => m.id === admin.member || m.role === 'admin';
  if (isAdmin(member)) refuse(`the member ${id} is an admin: this step removes the second member alone`);
  // What the removal revokes and whether it removes at all are the head's being amended (amend replays the edit on a
  // head that moved): the edit is synchronous and key ids are not, so each key id is worked out first, and an edit that
  // meets a key it has none for (a device listed meanwhile) posts nothing, and the removal starts again from that head.
  const kids = new Map<string, string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = attempt === 0 ? state : (await admin.read()).state;
    for (const m of head.members.filter((x) => x.id === id)) for (const device of m.devices) for (const pub of [device.channelPub, device.stepUpPub]) if (pub !== undefined && !kids.has(pub)) kids.set(pub, await keyId(pub));
    // Why the edit posted nothing, as the last head it was given read (amend calls it once per head).
    let ended = null as 'gone' | 'admin' | 'unknown key' | null;
    let counted = { devices: 0, keys: 0 };
    const signed = await admin.amend(`the member ${id} removed, its devices' keys revoked`, (s) => {
      ended = null;
      const m = s.members.find((x) => x.id === id);
      if (m === undefined || isAdmin(m)) {
        ended = m === undefined ? 'gone' : 'admin';
        return false;
      }
      const keys: RevokedKey[] = [];
      for (const device of m.devices) {
        for (const [key, pub] of [
          ['channel', device.channelPub],
          ['step-up', device.stepUpPub],
        ] as const) {
          if (pub === undefined) continue;
          const kid = kids.get(pub);
          if (kid === undefined) {
            ended = 'unknown key';
            return false;
          }
          keys.push({ keyId: kid, holder: { member: id, device: device.id, class: device.class, key } });
        }
      }
      s.members = s.members.filter((x) => x.id !== id);
      s.revoked.push(...keys.filter((k) => !s.revoked.some((r) => r.keyId === k.keyId)));
      counted = { devices: m.devices.length, keys: keys.length };
    });
    if (signed !== null) {
      io.print(`removed: the member ${id}, its ${counted.devices} device(s)' ${counted.keys} key(s) revoked (version ${signed.state.version})`);
      break;
    }
    if (ended === 'gone') {
      io.print(`nothing to remove: the member ${id} left the head meanwhile`);
      return 0;
    }
    if (ended === 'admin') refuse(`the member ${id} is an admin in the head now: this step removes the second member alone; nothing was removed`);
    if (attempt === 2) refuse(`the member ${id}'s devices kept changing under the removal: run remove again; nothing was removed`);
  }
  io.print(`next: staging-run.sh access-sync, so staging's Access no longer admits ${SECOND_EMAIL}`);
  return 0;
}

/** One step: refused (2) before anything is read or asked unless the hub is staging's and the files are as they must be. */
export async function runRealMember(o: RealMemberOptions): Promise<number> {
  const { io } = o;
  const hub = realMemberHubRefusal(o.hub);
  if (hub !== null) {
    io.print(`refused: ${hub}. Nothing was changed.`);
    return 2;
  }
  let email: string | null = null;
  try {
    if (o.emailFile !== undefined) {
      email = readEmail(o.emailFile);
      io.secret(email);
    }
    if (o.verb === 'pair') {
      const where = o.codeFile === undefined ? '--code-file is pair’s' : codeFileRefusal(o.codeFile);
      if (where !== null) throw new Error(where);
    }
    if (o.member !== undefined && !MEMBER.test(o.member)) throw new Error('--member <id>: 32 lowercase hex characters');
  } catch (error) {
    io.print(`refused: ${(error as Error).message}. Nothing was changed.`);
    return 2;
  }
  try {
    const admin = await o.open();
    if (o.verb === 'add') return await add(admin, email!, io);
    if (o.verb === 'pair') return await pair(o, admin, email!);
    return await remove(admin, email !== null ? { email } : { member: o.member! }, io);
  } catch (error) {
    io.print(`${error instanceof Refused ? 'refused' : 'failed'}: ${(error as Error).message}`);
    return 1;
  }
}

/**
 * The command's printing: every line scrubbed of what the step must never print (the email, in any case, and the code),
 * however short, before `out` has it; each one also appended to `scan` for the runner's search of the log after the step
 * (staging-run.sh's secret_scan).
 */
export function scrubbingIo(out: (line: string) => void, scan?: string): Pick<RealMemberIo, 'print' | 'secret' | 'write'> {
  const secrets: Array<[RegExp, string]> = [];
  const held = new Set<string>();
  return {
    print: (line) => out(secrets.reduce((text, [value, shown]) => text.replace(value, shown), line)),
    secret: (value) => {
      if (held.has(value)) return;
      held.add(value);
      secrets.push([new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), value.includes('@') ? `<${SECOND_EMAIL}>` : '<the pairing code>']);
      if (scan !== undefined) appendFileSync(scan, `${value}\n`, { mode: 0o600 });
    },
    write: (fd, text) => writeFileSync(fd, text),
  };
}

// ---- the command ----------------------------------------------------------------------------------------------------

const OPTIONS = {
  config: { type: 'string' },
  'device-keys': { type: 'string' },
  'email-file': { type: 'string' },
  member: { type: 'string' },
  'code-file': { type: 'string' },
  wait: { type: 'string' },
  scan: { type: 'string' },
  production: { type: 'boolean', default: false },
} as const;

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const app = process.env.DESK_HUB_APP!;
  const config: DeployConfig | null = readDeployConfig((values.config as string | undefined) ?? join(app, 'deploy', 'staging.json'));
  const chosen = realMemberMode(positionals, values as Values, config);
  if ('refused' in chosen) {
    console.error(chosen.refused);
    return 2;
  }
  const waitS = values.wait === undefined ? PAIR_WAIT_S : Number(values.wait);
  if (!Number.isSafeInteger(waitS) || waitS < 1 || waitS > MAX_PAIR_WAIT_S) {
    console.error(`--wait is whole seconds, 1 to ${MAX_PAIR_WAIT_S}`);
    return 2;
  }
  const io: RealMemberIo = { ...scrubbingIo((line) => console.log(line), values.scan as string | undefined), sleep: (ms) => new Promise((done) => setTimeout(done, ms)) };
  const read = await readSecrets();
  if (!read.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  const person = new Person(`https://${config!.host}`, read.DESK_ACCESS_TOKEN, () => {}, { requestMs: 30_000 });
  return runRealMember({
    verb: chosen.verb,
    hub: { host: config!.host, org: config!.org.id },
    hubUrl: person.hub,
    emailFile: values['email-file'] as string | undefined,
    member: values.member as string | undefined,
    codeFile: values['code-file'] as string | undefined,
    waitS,
    open: async () => OrgAdmin.open(person, { org: config!.org.id, pinnedGenesis: config!.orgGenesis }, await loadAdminDevice(values['device-keys'] as string), print),
    pending: async (member) => (await person.json<{ pending: PendingDevice[] }>(`${PENDING_DEVICES_PATH}?member=${encodeURIComponent(member)}`)).pending,
    io,
  });
}

