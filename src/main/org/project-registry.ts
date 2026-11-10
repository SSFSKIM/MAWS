// The registry main hands the page (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §I and M10; design §6, §11): `org.projects` and its coalesced `org.projects.changed`, the row keys the
// remote rows file a listing under, and the held removals' `org.removals.hold` and `.cancel`. It composes
// projects-records.ts (the verified records and `seen`), project-keys.ts (the key table and `moved`), held-removals.ts
// and member-grants.ts over the org session, the Registry feed, this Mac's own project rows and the RL2 roster's links.
//
// - `projects` is `assembleProjects` over the verified records, with each machine's own project left out (its name set
//   from the head, `machineProjectNames`), less the projects with no location (a project only `known` somewhere has no
//   row, the owner's second answer), and filtered to what the signed-in member may see (design §11): the locations on
//   machines they own (`acts`) or hold a grant on, and a project they see a session of (one of the rows' listings) with
//   no locations. A held removal's location is left out on this device. Name, `hub` and `renamable` are the assembly's,
//   over every location, so every device names a project alike.
// - The key table is filled at each computation from every record's locations and this Mac's own rows that are not
//   hidden. An own row's project is its `org.smnsId`; on a Mac signed in and not enrolled, a `remote:` row's is computed
//   from its key, as `joinIds` did (M10: the join is by id, and a key written in a record joins nothing).
// - The first computation waits for the persisted key table and the first own rows, so no entry is given from an empty
//   table and then replaced.
// - Each roster machine's link is watched: its transitions are `seen`; its coming up sends its held removals and reads
//   the member's grant from its ledger, read again for every link up at each new head and at each of the link's `caps`
//   (a grant delivered or withdrawn); a channel current again inside the link's grace sends the held removals too.
// - Signed out, `projects()` answers the empty value and no key is assigned.
//
// Electron-free: main injects the feed, the links, its own rows, the act's send and the emission.
import { assembleProjects, machineOwners, machineProjectNames, ownerMembers, type ProjectsRecord, type RegistryProject } from '../../../apps/org-protocol/src/index.ts';
import type { OrgProjectLocation, OrgProjects } from '@shared/ipc/schema/org';
import type { ProjectRecord } from '@shared/ipc/schema/session';
import { PROJECT_ACTS_CAPABILITY } from '@shared/ipc/schema/session';
import type { OrgKey } from '@shared/machine/org-key';
import { machineProjectId, repoProjectId } from '@shared/machine/project-ids';
import type { MachineRef } from '@shared/machine/ref';
import type { LinkState } from '../machines/manager';
import type { RemoteLink } from '../machines/remote/link';
import type { OrgFiles } from './files';
import { createHeldRemovals, type RemovalAnswer, type RemovalInput } from './held-removals';
import { createMemberGrants } from './member-grants';
import { isKeysFile, KeyTable, PROJECT_KEYS_FILE, type Carrier, type OwnRow } from './project-keys';
import { createProjectsRecords } from './projects-records';
import type { RegistryFeed } from './registry-feed';
import type { OrgSession, SignedIn } from './session';
import { orgTiming, type OrgTiming } from './timing';

/** What the registry reads of an RL2 link: its state, its channels, its `caps`, its peer's capabilities and its calls. */
export type RegistryLink = Pick<RemoteLink, 'call' | 'peerCapabilities' | 'onCaps' | 'onChannel'> & { state(): LinkState; onState(listener: (state: LinkState) => void): () => void };

export interface ProjectRegistryDeps {
  session: OrgSession;
  feed: Pick<RegistryFeed, 'onProjectsPages' | 'onProjects'>;
  /** This Mac's machine: its own rows' locations are there. */
  local: MachineRef;
  files: OrgFiles;
  /** O7's RL2 roster (`Machines.onRemote`). */
  roster(): readonly MachineRef[];
  onRoster(listener: () => void): () => void;
  link(ref: MachineRef): RegistryLink | null;
  /** This Mac's project rows, as `session.projects.list` answers them. */
  localProjects(): Promise<readonly ProjectRecord[]>;
  onLocalProjects(listener: () => void): () => void;
  /** The projects of the other machines' sessions the member sees (the remote rows' listings); `refresh` when they move. */
  sessions(): Iterable<string | null>;
  /** `session.projects.remove` over the machine's link, as main's lane B sends it. */
  remove(machine: MachineRef, input: RemovalInput): Promise<RemovalAnswer>;
  emit(projects: OrgProjects): void;
  /** Tells the person a removal they asked for was not made. */
  notify(text: string): void;
  now?(): number;
  timing?: Partial<Pick<OrgTiming, 'ROWS_COALESCE_MS' | 'ROWS_CACHE_WRITE_MS'>> & { removalRetryMs?: number };
  log(line: string): void;
}

export interface ProjectRegistry {
  /** The last computed value (the empty one signed out, and until the first). */
  projects(): OrgProjects;
  /** The project registry's M12: the held head's machines, by ref and name; null while signed out. */
  machines(): Array<{ ref: MachineRef; name: string }> | null;
  /** The row key of a project id on this device; null for an id the table has not given one. */
  keyOf(project: string): OrgKey | null;
  onKeys(listener: () => void): () => void;
  hold(input: { machine: MachineRef; pid: string }): Promise<void>;
  cancel(input: { id: string }): Promise<void>;
  /** The rows' listings moved: what the member sees is computed again. */
  refresh(): void;
  loaded: Promise<void>;
  settled(): Promise<void>;
  close(): Promise<void>;
}

const empty = (): OrgProjects => ({ projects: [], keys: {}, moved: {}, removals: [], seen: {} });

/** An own row's project: its `org.smnsId`, else for a `remote:` label the id its key derives in `org`. */
function ownProject(org: string, row: ProjectRecord): string | null {
  const label = row.org;
  if (label === undefined) return null;
  if (label.smnsId !== null) return label.smnsId;
  return label.key.startsWith('remote:') ? repoProjectId(org, label.key.slice('remote:'.length)) : null;
}

export function createProjectRegistry(deps: ProjectRegistryDeps): ProjectRegistry {
  const timing = orgTiming(deps.timing);
  const now = () => deps.now?.() ?? Date.now();
  const log = (line: string) => deps.log(`[org-registry] ${line}`);

  const records = createProjectsRecords({ session: deps.session, feed: deps.feed, files: deps.files, now, timing, log: deps.log });
  const grants = createMemberGrants({
    session: deps.session,
    files: deps.files,
    call: (ref, name, input) => {
      const link = deps.link(ref as MachineRef);
      return link === null || link.state() !== 'up' ? null : link.call(name, input);
    },
    log: deps.log,
  });
  /** The assembled projects last computed, for the removals' `locate`. */
  let assembled: RegistryProject[] = [];
  const removals = createHeldRemovals({
    session: deps.session,
    files: deps.files,
    locate: (machine, pid) => {
      for (const p of assembled) for (const l of p.locations) if (l.machine === machine && l.pid === pid) return { path: l.path, project: p.id };
      return null;
    },
    ready: (machine) => {
      const link = deps.link(machine);
      return link !== null && link.state() === 'up' && (link.peerCapabilities() ?? []).includes(PROJECT_ACTS_CAPABILITY);
    },
    name: (machine) => deps.session.current()?.view.head().state.machines.find((m) => m.ref === machine)?.name ?? machine,
    send: (machine, input) => deps.remove(machine, input),
    notify: (text) => deps.notify(text),
    now,
    retryMs: deps.timing?.removalRetryMs,
    log: deps.log,
  });

  let table = new KeyTable(null);
  const keyListeners = new Set<() => void>();
  let keysTold = JSON.stringify({});
  let local: readonly ProjectRecord[] = [];
  let localRead = 0;
  let latest = empty();
  let latestText = JSON.stringify(latest);
  let closed = false;
  let computing: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();
  /**
   * The owners' member ids of each machine under the head and certificates last read, by machine ref, until the soonest
   * delegation's `expires` then ahead (a delegated machine's owners end with it, with no new head).
   */
  let owners: { head: unknown; certificates: unknown; until: number; by: Map<string, readonly string[]> } = { head: null, certificates: null, until: 0, by: new Map() };

  const keysRead = (async () => {
    const raw = await deps.files.read(PROJECT_KEYS_FILE).catch(() => null);
    if (raw === null) return;
    if (isKeysFile(raw)) table = new KeyTable(raw);
    else log(`${PROJECT_KEYS_FILE} is not a key table, treated as absent`);
  })();
  /**
   * What the first computation waits for: the persisted key table and the first own rows. Computed from an empty table,
   * an entry the file holds would be given otherwise first, then replaced (§I: an entry never changes).
   */
  const inputsRead = Promise.all([keysRead, readLocal()]);

  function writeKeys(): void {
    if (closed || writeTimer !== null) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      void flushKeys();
    }, timing.ROWS_CACHE_WRITE_MS);
    (writeTimer as { unref?: () => void }).unref?.();
  }
  function flushKeys(): Promise<void> {
    const file = table.file();
    writing = writing.then(async () => {
      try {
        const check = await deps.files.check();
        if (check === null || !check.ok) return void log(`${PROJECT_KEYS_FILE} not written: ${check === null ? `${deps.files.dir} does not exist` : check.detail}`);
        await deps.files.write(PROJECT_KEYS_FILE, file);
      } catch (error) {
        log(`${PROJECT_KEYS_FILE} not written: ${(error as Error).message}`);
      }
    });
    return writing;
  }

  async function ownersOf(current: SignedIn, refs: Iterable<string>): Promise<Map<string, readonly string[]>> {
    const head = current.view.head();
    const certificates = current.view.certificates();
    const at = new Date(now());
    if (owners.head !== head || owners.certificates !== certificates || at.getTime() >= owners.until) {
      const ahead = head.state.delegations.map((d) => Date.parse(d.expires)).filter((expires) => expires > at.getTime());
      owners = { head, certificates, until: ahead.length === 0 ? Infinity : Math.min(...ahead), by: new Map() };
    }
    for (const ref of refs) {
      if (owners.by.has(ref)) continue;
      const of = await machineOwners(head.state, ref, certificates, at);
      owners.by.set(ref, of === null ? [] : ownerMembers(head.state, of));
    }
    return owners.by;
  }

  async function compute(): Promise<void> {
    await inputsRead;
    const current = deps.session.current();
    if (current === null) {
      assembled = [];
      return publish(empty());
    }
    const org = current.identity.org;
    const member = current.identity.member;
    const { state } = current.view.head();
    const machineProjects = new Set(machineProjectNames(state, current.view.certificates(), new Date(now())).map((name) => machineProjectId(org, name)));
    const held: ProjectsRecord[] = records.records();
    assembled = assembleProjects(held, machineProjects).filter((p) => p.locations.length > 0);

    // the key table: every record's locations, and this Mac's rows that are not hidden
    const carriers: Carrier[] = held.flatMap((r) => r.locations.map((l) => ({ machine: r.machine, pid: l.pid, id: machineProjects.has(l.id) ? null : l.id })));
    const mine: OwnRow[] = local.flatMap((row) =>
      row.hidden === true || row.org === undefined ? [] : [{ machine: deps.local, pid: row.id, id: ownProject(org, row), key: row.org.key, declared: row.discovered !== true, linked: row.stated === 'linked' }],
    );
    if (table.update(carriers, mine)) writeKeys();
    const keysText = JSON.stringify(table.keys());
    if (keysText !== keysTold) {
      // the table as `keyOf` answers it, told once it moves from what was last told (the file's entries at the first)
      keysTold = keysText;
      for (const listener of [...keyListeners]) listener();
    }

    const by = await ownersOf(current, new Set(assembled.flatMap((p) => p.locations.map((l) => l.machine))));
    const seenSessions = new Set([...deps.sessions()].filter((id): id is string => id !== null));
    const projects: OrgProjects['projects'] = [];
    for (const p of assembled) {
      const kept = p.locations.filter((l) => !removals.holds(l.machine, l.pid));
      if (kept.length === 0) continue;
      const locations: OrgProjectLocation[] = [];
      for (const l of kept) {
        const owns = by.get(l.machine)?.includes(member) ?? false;
        if (!owns && !grants.granted(l.machine)) continue;
        locations.push({
          machine: l.machine as MachineRef,
          pid: l.pid,
          path: l.path,
          key: l.key as OrgKey,
          name: l.name,
          source: l.source,
          ...(l.stated === undefined ? {} : { stated: l.stated }),
          ...(l.state === undefined ? {} : { state: l.state }),
          ...(l.remote === undefined ? {} : { remote: l.remote, remoteProject: repoProjectId(org, l.remote) }), // M11: the page's Link (it has no uuid5)
          acts: owns,
        });
      }
      if (locations.length === 0 && !seenSessions.has(p.id)) continue;
      projects.push({ id: p.id, name: p.name, hub: p.hub, renamable: p.renamable, locations });
    }
    publish({ projects, keys: table.keys(), moved: table.moved(carriers, mine), removals: removals.list(), seen: records.seen() });
  }

  function publish(next: OrgProjects): void {
    const text = JSON.stringify(next);
    if (text === latestText) return;
    latest = next;
    latestText = text;
    deps.emit(next);
  }

  function schedule(): void {
    if (closed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      computing = computing.then(() => (closed ? undefined : compute())).catch((error: unknown) => log(`the registry did not compute: ${(error as Error).message}`));
    }, timing.ROWS_COALESCE_MS);
    (timer as { unref?: () => void }).unref?.();
  }

  async function readLocal(): Promise<void> {
    const mine = ++localRead;
    try {
      const list = await deps.localProjects();
      if (mine === localRead) local = list;
    } catch (error) {
      log(`the local projects did not read: ${(error as Error).message}`);
    }
    schedule();
  }

  // ---- the links ----

  type Watch = { link: RegistryLink; up: boolean; off: () => void };
  const watched = new Map<MachineRef, Watch>();
  function watchRoster(): void {
    if (closed) return;
    const roster = new Set(deps.roster());
    for (const [ref, watch] of watched) {
      if (roster.has(ref) && deps.link(ref) === watch.link) continue;
      watch.off();
      watched.delete(ref);
    }
    for (const ref of roster) {
      if (watched.has(ref)) continue;
      const link = deps.link(ref);
      if (link === null) continue;
      const watch: Watch = { link, up: false, off: () => {} };
      watched.set(ref, watch);
      const onState = (state: LinkState) => {
        const was = watch.up;
        watch.up = state === 'up';
        if (watch.up === was) return;
        records.linkSeen(ref);
        if (watch.up) {
          removals.linkUp(ref);
          grants.read(ref);
        }
      };
      const offs = [
        link.onState(onState),
        // a channel current again inside the link's grace (`up` all along, no peers meanwhile): what waited for one goes
        link.onChannel((event) => {
          if (event === 'current' && watch.up) removals.linkUp(ref);
        }),
        // a grant delivered or withdrawn reaches main as a `caps` (the endpoint's `refreshCaps`): read it again
        link.onCaps(() => {
          if (watch.up) grants.read(ref);
        }),
      ];
      watch.off = () => offs.forEach((off) => off());
      onState(link.state());
    }
  }

  let headRead: unknown = null;
  function sessionChanged(): void {
    const head = deps.session.current()?.view.head() ?? null;
    if (head !== null && head !== headRead) {
      headRead = head;
      for (const [ref, watch] of watched) if (watch.up) grants.read(ref);
    }
    schedule();
  }

  const unsubscribe = [
    records.onChanged(schedule),
    removals.onChanged(schedule),
    grants.onChanged(schedule),
    deps.session.onChanged(sessionChanged),
    deps.onRoster(() => {
      watchRoster();
      schedule();
    }),
    deps.onLocalProjects(() => void readLocal()),
  ];

  const loaded = Promise.all([records.loaded, removals.loaded, grants.loaded, inputsRead]).then(async () => {
    watchRoster();
    sessionChanged();
    await settled();
  });

  async function settled(): Promise<void> {
    // each part's work may schedule a computation, and a computation may start a part's work: until neither moves
    for (let round = 0; round < 10; round++) {
      await records.settled();
      await removals.settled();
      await grants.settled();
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        computing = computing.then(() => (closed ? undefined : compute())).catch((error: unknown) => log(`the registry did not compute: ${(error as Error).message}`));
      }
      const at = computing;
      await at;
      if (timer === null && at === computing) return;
    }
  }

  return {
    projects: () => latest,
    machines() {
      const head = deps.session.current()?.view.head() ?? null;
      return head === null ? null : head.state.machines.map((m) => ({ ref: m.ref as MachineRef, name: m.name }));
    },
    keyOf: (project) => table.keyOf(project),
    onKeys(listener) {
      keyListeners.add(listener);
      return () => void keyListeners.delete(listener);
    },
    hold: (input) => removals.hold(input),
    cancel: (input) => removals.cancel(input),
    refresh: schedule,
    loaded,
    settled,
    async close() {
      if (closed) return;
      for (const off of unsubscribe) off();
      for (const watch of watched.values()) watch.off();
      watched.clear();
      await computing;
      closed = true;
      if (timer !== null) clearTimeout(timer);
      if (writeTimer !== null) clearTimeout(writeTimer);
      timer = writeTimer = null;
      await flushKeys();
      await Promise.all([records.close(), removals.close(), grants.close()]);
    },
  };
}
