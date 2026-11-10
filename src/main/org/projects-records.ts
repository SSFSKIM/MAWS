// The machines' projects records in main (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §I, "The records", and M10's decisions; design §4, §6): what the app's Registry feed brings of them (the
// hub's `projects-all` pages after the listings, then each `projects` frame) verified against the held org head and kept
// in `<userData>/org/projects.json`, so a relaunch with the hub out of reach still lists them. The hub confers nothing
// (constraint 6): every record is verified here (`verifyProjectsRecord`).
//
// - Each machine keeps a mark of the newest record accepted for it: its revision, the SHA-256 of its canonical form and
//   the key id that signed it (§H's mark rules). A record below the mark is passed by; one at the mark with another hash
//   is a conflict, passed by and logged; one above it is verified and replaces the machine's record.
// - Unlike listings, the hub's snapshot removes nothing: a machine it lacks keeps its last verified record (unknown is
//   not empty, constraint 4). A record leaves only when it stops verifying, judged again at each new head or
//   certificate set and at the soonest delegation's `expires` ahead (a delegated machine's authority ends then, with
//   neither, and an expiry reached signed out is judged at the next sign-in, the record hidden from that moment on
//   whatever the queue's progress); its mark goes only when the head retires or revokes the key that signed it, so an older revision can
//   never return, and a mark of such a key is not taken from the file either.
// - A record that does not verify when it arrives (its machine enrolled by a head this app has not adopted yet) waits,
//   the newest per machine, and is tried again at each change of the session.
// - The file is one org's. Read at the start, its records count once they verify again under the signed-in head;
//   another org's file is discarded. Signed out nothing is read and what is held stays for the next sign-in.
// - `seen` (§I): per machine, the later of the last time this device's link to it was up (`linkSeen`, kept in the same
//   file) and the `issued` of its newest record.
//
// Electron-free: vitest's node project runs it.
import { createHash } from 'node:crypto';
import { canonicalize, isProjectsRecord, isSigned, verifyProjectsRecord, type Certificates, type OrgState, type ProjectsRecord, type Signed, type SignedOrgState } from '../../../apps/org-protocol/src/index.ts';
import type { OrgFiles } from './files';
import type { RegistryFeed } from './registry-feed';
import type { OrgSession, SignedIn } from './session';
import { orgTiming, type OrgTiming } from './timing';

export const PROJECTS_FILE = 'projects.json';

/** A machine's high-water mark: the newest record accepted for it. */
export type ProjectsMark = { revision: number; hash: string; kid: string };
export type ProjectsFile = { version: 1; org: string; records: Signed<ProjectsRecord>[]; marks: Record<string, ProjectsMark>; seen: Record<string, string> };

export interface ProjectsRecords {
  /** The held records that verify under the signed-in head, one per machine; none signed out. */
  records(): ProjectsRecord[];
  /** Per machine ref, when it was last seen (ISO): its link's last up, or its newest record's issue, the later. */
  seen(): Record<string, string>;
  /** This device's link to `ref` is up, or was until now. */
  linkSeen(ref: string): void;
  onChanged(listener: () => void): () => void;
  /** The file read and, if signed in then, applied. */
  loaded: Promise<void>;
  /** Resolves once everything received so far is applied. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

export interface ProjectsRecordsDeps {
  session: OrgSession;
  feed: Pick<RegistryFeed, 'onProjectsPages' | 'onProjects'>;
  files: OrgFiles;
  now?(): number;
  timing?: Partial<Pick<OrgTiming, 'ROWS_CACHE_WRITE_MS'>>;
  log(line: string): void;
}

/** The hash a mark keeps: of the record's canonical form, so the same record in another key order is the same. */
export const projectsHash = (record: Signed<ProjectsRecord>): string => createHash('sha256').update(canonicalize(record)).digest('base64url');

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMark = (value: unknown): value is ProjectsMark =>
  isObject(value) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 1 && typeof value.hash === 'string' && typeof value.kid === 'string';
const isFile = (value: unknown): value is ProjectsFile => isObject(value) && value.version === 1 && typeof value.org === 'string' && Array.isArray(value.records) && isObject(value.marks);
/** Whether the head is signed evidence that the key can never speak again: the one reason a mark drops. */
const keyEnded = (state: OrgState, kid: string): boolean => state.retired.some((r) => r.keyId === kid) || state.revoked.some((r) => r.keyId === kid);
/** The longest a timer waits (setTimeout's bound); a later expiry is looked at again then. */
const LONGEST_WAIT_MS = 2 ** 31 - 1;
/** A log's view of a hub-supplied ref: bounded, quoted. */
const shown = (ref: string) => JSON.stringify(ref.length > 64 ? `${ref.slice(0, 64)}…` : ref);

export function createProjectsRecords(deps: ProjectsRecordsDeps): ProjectsRecords {
  const timing = orgTiming(deps.timing);
  const now = () => deps.now?.() ?? Date.now();
  const log = (line: string) => deps.log(`[org-projects] ${line}`);

  /** The org the marks and records belong to: the signed-in org's, once one signed in. */
  let dataOrg: string | null = null;
  const marks = new Map<string, ProjectsMark>();
  /** The record of each machine at its mark, verified under the head last judged against. */
  const held = new Map<string, Signed<ProjectsRecord>>();
  /** Records that did not verify, the newest per machine. */
  const waiting = new Map<string, Signed<ProjectsRecord>>();
  /** When this device's link to each machine was last up. */
  const linkUp = new Map<string, string>();
  let file: ProjectsFile | null = null;
  /** What the held records were last verified against, and the soonest delegation `expires` then ahead (ms). */
  let judgedAgainst: { head: SignedOrgState; certificates: Certificates; until: number } | null = null;
  /**
   * Per held record's machine, when the authority it verified under ends: its certifying delegation's `expires` (a
   * machine the head enrolls has no end). A record past it is not exposed, before it is verified again and dropped.
   */
  const authorityEnds = new Map<string, number>();
  const listeners = new Set<() => void>();
  let closed = false;
  let dirty = false;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();
  /** The next check of the held records, at the soonest delegation's `expires` still ahead. */
  let expiry: ReturnType<typeof setTimeout> | null = null;

  let queue: Promise<void> = (async () => {
    const raw = await deps.files.read(PROJECTS_FILE);
    if (raw === null) return;
    if (isFile(raw)) file = raw;
    else log(`${PROJECTS_FILE} is not a projects file, treated as absent`);
  })().catch((error: unknown) => log(`${PROJECTS_FILE} did not read: ${(error as Error).message}`));

  function enqueue(what: string, step: () => Promise<void> | void): Promise<void> {
    const run = queue.then(async () => {
      if (closed) return;
      try {
        await step();
      } catch (error) {
        log(`${what} failed: ${(error as Error).message}`);
      }
    });
    queue = run;
    return run;
  }

  function changed(): void {
    dirty = true;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        log(`a listener failed: ${(error as Error).message}`);
      }
    }
    if (closed || writeTimer !== null) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      void write();
    }, timing.ROWS_CACHE_WRITE_MS);
    (writeTimer as { unref?: () => void }).unref?.();
  }

  const signedIn = (): SignedIn | null => {
    const current = deps.session.current();
    return current !== null && current.identity.org === dataOrg ? current : null;
  };

  function authorityEnd(current: SignedIn, machine: string): number {
    const state = current.view.head().state;
    if (state.machines.some((m) => m.ref === machine)) return Infinity;
    const cert = current.view.certificates().certs.find((c) => c.body.machine === machine);
    const delegation = cert === undefined ? undefined : state.delegations.find((d) => d.id === cert.body.delegation);
    return delegation === undefined ? Infinity : Date.parse(delegation.expires);
  }
  /** The soonest delegation `expires` ahead of now under the signed-in head (Infinity: none). */
  function soonestExpiry(current: SignedIn): number {
    const at = now();
    const ahead = current.view.head().state.delegations.map((d) => Date.parse(d.expires)).filter((expires) => expires > at);
    return ahead.length === 0 ? Infinity : Math.min(...ahead);
  }
  function hold(current: SignedIn, machine: string, record: Signed<ProjectsRecord>): void {
    held.set(machine, record);
    authorityEnds.set(machine, authorityEnd(current, machine));
  }
  function release(machine: string): void {
    held.delete(machine);
    authorityEnds.delete(machine);
  }

  async function verifies(current: SignedIn, record: Signed<ProjectsRecord>): Promise<boolean> {
    return (await verifyProjectsRecord(current.view.head().state, record, current.view.certificates(), new Date(now()))).ok;
  }

  /** One record against its machine's mark, then the head. */
  async function judge(current: SignedIn, record: unknown): Promise<void> {
    if (!isSigned(record, isProjectsRecord) || record.body.org !== current.identity.org) return;
    const { machine, revision } = record.body;
    const mark = marks.get(machine);
    const hash = projectsHash(record);
    if (mark !== undefined) {
      if (revision < mark.revision) return;
      if (revision === mark.revision) {
        if (hash !== mark.hash) return void log(`a conflicting projects record of machine ${shown(machine)} at revision ${revision} ignored`);
        if (held.has(machine)) return;
      }
    }
    if (keyEnded(current.view.head().state, record.sig.kid)) return;
    if (!(await verifies(current, record))) {
      if ((waiting.get(machine)?.body.revision ?? 0) < revision) waiting.set(machine, record);
      return;
    }
    marks.set(machine, { revision, hash, kid: record.sig.kid });
    hold(current, machine, record);
    if ((waiting.get(machine)?.body.revision ?? 0) <= revision) waiting.delete(machine);
    changed();
  }

  /** Drops every mark (and its record) whose key the head has ended; every held record verified again. */
  async function judgeAgain(current: SignedIn): Promise<void> {
    const state = current.view.head().state;
    for (const [machine, mark] of [...marks]) {
      if (!keyEnded(state, mark.kid)) continue;
      marks.delete(machine);
      release(machine);
      changed();
    }
    for (const [machine, record] of [...waiting]) if (keyEnded(state, record.sig.kid)) waiting.delete(machine);
    for (const [machine, record] of [...held]) {
      if (held.get(machine) !== record) continue;
      if (await verifies(current, record)) {
        if (held.get(machine) === record) authorityEnds.set(machine, authorityEnd(current, machine));
        continue;
      }
      release(machine);
      log(`the projects record of machine ${shown(machine)} no longer verifies; dropped`);
      changed();
    }
  }

  /** While a record is held, the held records verified again at the soonest delegation's `expires` still ahead. */
  function armExpiry(): void {
    if (expiry !== null) clearTimeout(expiry);
    expiry = null;
    const current = signedIn();
    if (closed || current === null || held.size === 0) return;
    const at = now();
    const ahead = current.view.head().state.delegations.map((d) => Date.parse(d.expires)).filter((expires) => expires > at);
    if (ahead.length === 0) return;
    expiry = setTimeout(
      () => {
        expiry = null;
        void enqueue('a delegation’s expiry', async () => {
          const signed = signedIn();
          if (signed === null) return; // judged at the next sign-in: `judgedAgainst.until` has passed
          if (judgedAgainst !== null) judgedAgainst = { ...judgedAgainst, until: soonestExpiry(signed) };
          await judgeAgain(signed);
          armExpiry();
        });
      },
      Math.min(Math.min(...ahead) - at + 1, LONGEST_WAIT_MS),
    );
    (expiry as { unref?: () => void }).unref?.();
  }

  async function applyFile(current: SignedIn, kept: ProjectsFile): Promise<void> {
    if (kept.org !== current.identity.org) return void log(`${PROJECTS_FILE} holds another org's records, discarded`);
    const state = current.view.head().state;
    // a mark of a key the head has ended since the file was written is not taken: that key's revisions are over
    for (const [machine, mark] of Object.entries(kept.marks)) if (isMark(mark) && !marks.has(machine) && !keyEnded(state, mark.kid)) marks.set(machine, mark);
    if (isObject(kept.seen)) for (const [ref, at] of Object.entries(kept.seen)) if (typeof at === 'string' && !linkUp.has(ref)) linkUp.set(ref, at);
    for (const record of kept.records) {
      if (!isSigned(record, isProjectsRecord)) continue;
      const mark = marks.get(record.body.machine);
      if (mark === undefined || mark.revision !== record.body.revision || mark.hash !== projectsHash(record)) continue;
      await judge(current, record);
    }
    changed();
  }

  async function sessionChanged(): Promise<void> {
    const current = deps.session.current();
    if (current === null) return;
    if (dataOrg !== current.identity.org) {
      if (dataOrg !== null) {
        log('the signed-in org changed: the projects records held for the last one are dropped');
        marks.clear();
        held.clear();
        authorityEnds.clear();
        waiting.clear();
        linkUp.clear();
        changed();
      }
      dataOrg = current.identity.org;
      judgedAgainst = null;
    }
    const at = { head: current.view.head(), certificates: current.view.certificates() };
    // judged again at a new head or certificate set, and once a delegation's `expires` passed since (one reached signed
    // out had no judgement: its timer found no session)
    if (judgedAgainst === null || judgedAgainst.head !== at.head || judgedAgainst.certificates !== at.certificates || now() >= judgedAgainst.until) {
      judgedAgainst = { ...at, until: soonestExpiry(current) };
      await judgeAgain(current);
      for (const record of [...waiting.values()]) await judge(current, record);
    }
    if (file !== null) {
      const kept = file;
      file = null;
      await applyFile(current, kept);
    }
    armExpiry();
    for (const listener of [...listeners]) listener(); // signed in again: what is held reads again
  }

  async function take(records: readonly unknown[]): Promise<void> {
    const current = signedIn();
    if (current === null) return;
    for (const record of records) await judge(current, record);
    armExpiry();
  }

  function write(): Promise<void> {
    writing = writing.then(async () => {
      if (!dirty || dataOrg === null) return;
      dirty = false;
      const out: ProjectsFile = { version: 1, org: dataOrg, records: [...held.values()], marks: Object.fromEntries(marks), seen: Object.fromEntries(linkUp) };
      try {
        const check = await deps.files.check();
        if (check === null || !check.ok) return void log(`${PROJECTS_FILE} not written: ${check === null ? `${deps.files.dir} does not exist` : check.detail}`);
        await deps.files.write(PROJECTS_FILE, out);
      } catch (error) {
        log(`${PROJECTS_FILE} not written: ${(error as Error).message}`);
      }
    });
    return writing;
  }

  const unsubscribe = [
    deps.session.onChanged(() => void enqueue('a session change', sessionChanged)),
    deps.feed.onProjectsPages(({ records }) => void enqueue('a projects page', () => take(Array.isArray(records) ? records : []))),
    deps.feed.onProjects((record) => void enqueue('a projects record', () => take([record]))),
  ];
  const loaded = enqueue('the file', sessionChanged);

  return {
    records() {
      if (signedIn() === null) return [];
      const at = now();
      return [...held]
        .filter(([machine]) => (authorityEnds.get(machine) ?? Infinity) > at) // past its authority: hidden until dropped
        .map(([, r]) => r.body)
        .sort((a, b) => (a.machine < b.machine ? -1 : a.machine > b.machine ? 1 : 0));
    },
    seen() {
      if (signedIn() === null) return {};
      const out: Record<string, string> = Object.fromEntries(linkUp);
      for (const [ref, record] of held) if (out[ref] === undefined || out[ref] < record.body.issued) out[ref] = record.body.issued;
      return out;
    },
    linkSeen(ref) {
      void enqueue('a link seen', () => {
        if (dataOrg === null) return;
        linkUp.set(ref, new Date(now()).toISOString());
        changed();
      });
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    loaded,
    settled: () => queue,
    async close() {
      if (closed) return;
      for (const off of unsubscribe) off();
      await queue;
      closed = true;
      if (writeTimer !== null) clearTimeout(writeTimer);
      if (expiry !== null) clearTimeout(expiry);
      writeTimer = expiry = null;
      await write();
    },
  };
}
