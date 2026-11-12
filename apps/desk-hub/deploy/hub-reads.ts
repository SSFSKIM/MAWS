// `deployment hub-reads` (the desk track's staging proof before production's hub goes to a build with the project
// registry's M2 and the key-bound machine removal): the two behaviour changes production would get, shown on staging
// at that build, through two probe machines P and Q the staging admin device enrolls and lists (reach-acceptance.ts's
// `listProbe`). One PASS or FAIL line per claim:
// - welcome-projects: each probe's RL1 welcome advertises `projects` (the Relay adds it once the Registry answers its
//   probe);
// - snapshot-last: each probe's socket, welcomed with it, gets the `projects-all` snapshot after its welcome, its pages
//   ending `last: true`;
// - record-live: a projects record P's endpoint stores (signed by P's key, no locations) reaches Q's socket live;
// - keyed-wrong-refused: P's removal bound to its ref and a key that is not its posted one leaves P held (the hub's
//   designed answer is 200 `{revoked}` with nothing touched; a hub before it removes P);
// - keyed-removed: P's removal bound to its ref and posted key removes it;
// - plain-removed: Q's removal by name alone removes it.
// Then, however the run ends (a failure, SIGINT, SIGTERM or SIGHUP), its cleanup: the sockets closed, both out of the state with
// their keys retired, both revoked at the hub (gone already counts); a read-back of the head and the hub's machines says
// `LEFT …` for anything still there. Staging alone (production refused by name before a credential is read); the admin
// device's anchor lock (admin.ts's `<keys>.org.json.lock`) is held for the run, so no admin verb signs meanwhile.
// A successor whose POST had no definite answer (none within its deadline, the run interrupted under it, or a 5xx) may
// still land: from then on the run signs nothing more, and unless the head is then seen to hold it, it is LEFT.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { generateSigningKey, stateHash, type ProjectsRecord, type Signed, type SignedOrgState } from 'org-protocol';
import { projectsRecord } from '../fake-machine/org';
import { ORG_STATE_PATH, type OrgStateView } from '../src/protocol/identity';
import { checkTestHub, PRODUCTION_HOST, readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { afterEndpointCleanup, type Made } from './endpoint-acceptance';
import { Secrets } from './endpoint-verdicts';
import { Person } from './hub';
import { loadAdminDevice, OrgAdmin, type AdminDevice, type OrgScope } from './org-admin';
import { Cleanup, interruptible, isTestTarget, revokeKeyed, STEP_MS, type InterruptOptions } from './proof';
import { listProbe } from './reach-acceptance';
import type { Probe } from './reach-items';
import { takeRunLock } from './run-lock';

export const CLAIMS = ['welcome-projects', 'snapshot-last', 'record-live', 'keyed-wrong-refused', 'keyed-removed', 'plain-removed'] as const;
export type Claim = (typeof CLAIMS)[number];
/** The probes' names: `hr-p-<tag>` and `hr-q-<tag>` (sweep-leftovers takes them, for a run killed outright). */
export const probeName = (which: 'p' | 'q', tag: string) => `hr-${which}-${tag}`;

type Frame = { t: string } & Record<string, unknown>;

export type HubReadsOptions = {
  person: Person;
  scope: OrgScope;
  device: AdminDevice;
  cleanup: Cleanup;
  secrets: Secrets;
  print?: (line: string) => void;
  tag?: string;
  /** How long a frame the hub owes (a snapshot's last page, the live record) is waited for. */
  frameMs?: number;
};

/** A successor this run posted with no definite answer: it may land yet. `listing` names the probe it lists. */
type Uncertain = { signed: SignedOrgState; listing: string | null };

/**
 * Watches `person`'s org-state POSTs (OrgAdmin.amend's): one that throws (no answer within its deadline, the run's
 * interruption, the network) or is answered 5xx is kept in `uncertain`, and while any is kept every later POST is
 * refused before it is sent, so no successor is signed beside one that may still land (two of one version, a fork).
 */
export function watchStatePosts(person: Person, listing: () => string | null, uncertain: Uncertain[]): void {
  const fetch = person.fetch.bind(person);
  person.fetch = async (path, init = {}) => {
    if (path !== ORG_STATE_PATH || init.body === undefined || (init.method ?? 'POST') !== 'POST') return fetch(path, init);
    if (uncertain.length) throw new Error(`not signed: the successor version ${uncertain[0].signed.state.version}'s POST had no answer and may still land`);
    const kept = { signed: init.body as SignedOrgState, listing: listing() };
    try {
      const response = await fetch(path, init);
      if (response.status >= 500) uncertain.push(kept);
      return response;
    } catch (error) {
      uncertain.push(kept);
      throw error;
    }
  };
}

/** Each uncertain successor the head's chain is now seen to hold, taken off `uncertain` (it landed): a line for each. */
async function settleLanded(person: Person, uncertain: Uncertain[]): Promise<string[]> {
  const lines: string[] = [];
  for (const u of [...uncertain]) {
    const v = u.signed.state.version;
    const { head, chain = [] } = await person.json<OrgStateView>(`${ORG_STATE_PATH}?since=${v - 1}`);
    const at = [...chain, ...(head ? [head] : [])].find((s) => s.state.version === v);
    if (at && (await stateHash(at.state)) === (await stateHash(u.signed.state))) {
      uncertain.splice(uncertain.indexOf(u), 1);
      lines.push(`settled: the successor version ${v}${u.listing ? ` listing ${u.listing}` : ''}, whose POST had no answer, is the hub's`);
    }
  }
  return lines;
}

/** The names the hub holds now. */
async function held(person: Person): Promise<string[]> {
  return (await person.json<{ machines: Array<{ name: string }> }>('/api/machines')).machines.map((m) => m.name);
}

/** Whether the hub stops holding `name` within `ms`. */
async function goneWithin(person: Person, name: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (!(await held(person)).includes(name)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** A probe's snapshot after its welcome: the frame index just past its last page, its pages and records. */
async function snapshotOf(probe: Probe, ms: number): Promise<{ end: number; pages: number; records: number }> {
  const frames = probe.endpoint.frames as Frame[];
  const from = frames.indexOf(probe.welcome as unknown as Frame);
  const last = await probe.endpoint.next((f) => f.t === 'projects-all' && f.last === true, `${probe.name}'s last projects-all page`, from, ms);
  const end = frames.indexOf(last) + 1;
  const pages = frames.slice(from, end).filter((f) => f.t === 'projects-all');
  return { end, pages: pages.length, records: pages.reduce((n, p) => n + (Array.isArray(p.records) ? p.records.length : 0), 0) };
}

/** The run under `interruptible`: the claims, each printed as it is judged; then however it ends, any claim not reached
 * printed FAIL, the cleanup and the read-back. Its status: 0 when every claim passed and nothing was left. */
export function runHubReads(o: HubReadsOptions, interrupt: InterruptOptions = {}): Promise<number> {
  const print = o.secrets.guard(o.print ?? console.log);
  const tag = o.tag ?? randomBytes(3).toString('hex');
  const frameMs = o.frameMs ?? 20_000;
  const made: Made = { machines: [], members: [], devices: [], kept: [] };
  const verdicts = new Map<Claim, boolean>();
  const judge = (claim: Claim, pass: boolean, detail: string) => {
    verdicts.set(claim, pass);
    print(`${pass ? 'PASS' : 'FAIL'} ${claim}: ${detail}`);
  };
  let recordSent = false;
  checkTestHub(o.person.hub, 'run hub-reads against it');
  const { person, cleanup } = o;
  const uncertain: Uncertain[] = [];
  let listing: string | null = null;
  watchStatePosts(person, () => listing, uncertain);
  const settle = async () => {
    for (const line of await settleLanded(person, uncertain).catch((error: unknown) => [`the head could not be read to settle a POST with no answer: ${error instanceof Error ? error.message : String(error)}`])) print(line);
  };
  return interruptible(
    cleanup,
    async () => {
      print(`hub-reads: hub ${person.hub}, org ${o.scope.org}, tag ${tag}`);
      const admin = await OrgAdmin.open(person, o.scope, o.device, print);
      const probe = async (which: 'p' | 'q') => {
        const name = probeName(which, tag);
        made.machines.push(name);
        listing = name;
        const listed = await listProbe(admin, person.hub, name, admin.member, undefined, cleanup, (value) => o.secrets.add(value)).finally(() => (listing = null));
        print(`${name}: enrolled, listed and connected (ref ${listed.machine.ref}, generation ${listed.welcome.generation})`);
        return listed;
      };
      const P = await probe('p');
      const Q = await probe('q');

      const caps = (p: Probe) => p.welcome.capabilities ?? [];
      judge('welcome-projects', caps(P).includes('projects') && caps(Q).includes('projects'), `${P.name}'s welcome [${caps(P).join(',')}], ${Q.name}'s [${caps(Q).join(',')}]`);

      const snapshots = await Promise.allSettled([snapshotOf(P, frameMs), snapshotOf(Q, frameMs)]);
      const said = snapshots.map((s, i) => `${[P, Q][i].name}: ${s.status === 'fulfilled' ? `${s.value.pages} page(s), ${s.value.records} record(s), the last \`last: true\`` : (s.reason as Error).message}`);
      judge('snapshot-last', snapshots.every((s) => s.status === 'fulfilled'), said.join('; '));

      // P's record, stored once both snapshots are in, so Q can get it only live.
      const qFrom = snapshots[1].status === 'fulfilled' ? snapshots[1].value.end : Q.endpoint.frames.length;
      const pFrom = P.endpoint.frames.length;
      const record = await projectsRecord(P.machine, 1);
      P.endpoint.sendText({ t: 'projects', record });
      recordSent = true;
      const arrived = await Q.endpoint
        .next((f) => f.t === 'projects' && (f.record as Signed<ProjectsRecord>).sig.value === record.sig.value, `${P.name}'s record at ${Q.name}`, qFrom, frameMs)
        .then(
          () => null,
          (error: unknown) => (error as Error).message,
        );
      const refusal = (P.endpoint.frames as Frame[]).slice(pFrom).find((f) => f.t === 'refusal' && f.frame === 'projects');
      judge(
        'record-live',
        arrived === null,
        arrived === null
          ? `${P.name}'s record (revision 1, no locations) reached ${Q.name}'s socket live`
          : `${refusal ? `${P.name}'s record was refused ${String(refusal.status)} ${String(refusal.error)}; ` : ''}${arrived.slice(0, 300)}`,
      );

      // The key-bound removal: another key first (P must stay), then P's own.
      const wrong = (await generateSigningKey()).pub;
      const refused = await revokeKeyed(person, P.name, { ref: P.machine.ref, pub: wrong });
      const stillHeld = (await held(person)).includes(P.name);
      judge(
        'keyed-wrong-refused',
        refused.status === 200 && stillHeld,
        `DELETE ${P.name} bound to its ref and another key answered ${refused.status} ${refused.text}; the hub ${stillHeld ? 'still holds' : 'NO LONGER holds'} ${P.name}, its RL1 socket ${P.endpoint.isOpen ? 'open' : 'closed'}`,
      );
      const removed = await revokeKeyed(person, P.name, { ref: P.machine.ref, pub: P.machine.key.pub });
      const pGone = removed.status === 200 && (await goneWithin(person, P.name, 10_000));
      judge('keyed-removed', pGone, `DELETE ${P.name} bound to its ref and posted key answered ${removed.status} ${removed.text}; the hub ${pGone ? 'holds it no more' : 'still holds it (or the answer was not 200)'}`);

      const plain = await person.fetch(`/api/machines/${encodeURIComponent(Q.name)}`, { method: 'DELETE' });
      const plainText = (await plain.text()).slice(0, 200);
      const qGone = plain.status === 200 && (await goneWithin(person, Q.name, 10_000));
      judge('plain-removed', qGone, `DELETE ${Q.name} by name answered ${plain.status} ${plainText}; the hub ${qGone ? 'holds it no more' : 'still holds it (or the answer was not 200)'}`);
      return CLAIMS.every((c) => verdicts.get(c) === true) ? 0 : 1;
    },
    async (status) => {
      const why = status === 1 ? 'the run failed before it (its FAIL line above)' : `the run was interrupted (${status}) before it`;
      for (const claim of CLAIMS) if (!verdicts.has(claim)) judge(claim, false, `not reached: ${why}`);
      cleanup.interrupt(status === 0 ? 'the run ended' : 'the run failed');
      // A POST with no answer that the hub has taken meanwhile is the head, and the cleanup signs on it as on any other.
      await settle();
      const failed = await cleanup.run();
      await settle();
      const left = await afterEndpointCleanup(person, made, AbortSignal.timeout(STEP_MS)).catch((error: unknown) => [`the check after cleanup failed: ${error instanceof Error ? error.message : String(error)}`]);
      const unsettled = uncertain.map((u) =>
        u.listing
          ? `${u.listing}: its listing POST had no answer; it may still land — run sweep-leftovers ${u.listing} once it has, or check the head`
          : `the successor version ${u.signed.state.version}: its POST had no answer; it may still land — check the head`,
      );
      for (const line of [...failed.map((f) => `cleanup: ${f}`), ...left, ...unsettled]) print(`LEFT ${line}`);
      if (failed.length === 0 && left.length === 0 && unsettled.length === 0) print(made.machines.length ? `cleanup: the head lists none of ${made.machines.join(', ')}, and the hub holds none of them` : 'cleanup: the run made no machine');
      if (recordSent) print(`KEPT ${probeName('p', tag)}'s projects record at the hub (no path removes one; every reader refuses it once its key is retired)`);
      if (made.machines.length) print(`KEPT the probes' names in machineNames and their retired keys; the state's new versions`);
      const code = failed.length || left.length || unsettled.length ? 1 : status;
      print(`hub-reads: ${code === 0 ? 'PASS' : 'FAIL'}`);
      return code;
    },
    interrupt,
  );
}

/**
 * The admin device's anchor lock (admin.ts's `<keys>.org.json.lock`), taken for the run, or why not: another run holds
 * it, or the anchor holds a successor an `admin` verb signed and has not seen settled (`pending`), which a successor
 * signed here on the same head would fork.
 */
export function holdAnchorLock(keys: string): { release: () => void } | { refused: string } {
  let release: () => void;
  try {
    release = takeRunLock(`${keys}.org.json.lock`);
  } catch (error) {
    return { refused: error instanceof Error ? error.message : String(error) };
  }
  let pending = false;
  try {
    pending = (JSON.parse(readFileSync(`${keys}.org.json`, 'utf8')) as { pending?: unknown }).pending !== undefined;
  } catch (error) {
    // No anchor (admin adopt never ran) holds nothing pending; one that does not parse is admin's to refuse.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      release();
      return { refused: `${keys}.org.json does not parse as the admin device's anchor` };
    }
  }
  if (pending) {
    release();
    return { refused: `${keys}.org.json holds a pending successor an admin verb signed and the hub has not been seen to hold: the next signing admin verb settles it first (or admin abandon-pending drops it); run hub-reads after` };
  }
  return { release };
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { config: { type: 'string' }, 'device-keys': { type: 'string' }, scan: { type: 'string' } } });
  const config = readDeployConfig(values.config ?? join(process.env.DESK_HUB_APP!, 'deploy', 'staging.json'));
  if (config.host === PRODUCTION_HOST || config.worker === 'desk-hub') {
    console.error(`the config names production (${config.host}): hub-reads runs on staging alone`);
    return 2;
  }
  const keys = values['device-keys'];
  if (!keys) {
    console.error('--device-keys <file>: the staging admin device whose step-up key signs the org state');
    return 2;
  }
  if (!isTestTarget(config)) return 2;
  const secrets = new Secrets(values.scan ?? null);
  const read = await readSecrets();
  if (!read.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  secrets.add(read.DESK_ACCESS_TOKEN);
  const device = await loadAdminDevice(keys);
  // From the lock's taking to interruptible's signal handlers, nothing awaits: no signal can end the run between them.
  const lock = holdAnchorLock(keys);
  if ('refused' in lock) {
    console.error(`${lock.refused}: stop. Nothing was changed.`);
    return 2;
  }
  const { release } = lock;
  try {
    const cleanup = new Cleanup();
    const person = new Person(`https://${config.host}`, read.DESK_ACCESS_TOKEN, () => cleanup.check(), { requestMs: 30_000, signal: cleanup.signal });
    return await runHubReads(
      { person, scope: { org: config.org.id, pinnedGenesis: config.orgGenesis }, device, cleanup, secrets },
      // A second signal exits at once: the lock goes first, so it is never what such an exit leaves. A closed terminal
      // (SIGHUP) runs the cleanup as Ctrl-C does.
      {
        hangup: true,
        exit: (status) => {
          release();
          process.exit(status);
        },
      },
    );
  } finally {
    release();
  }
}
