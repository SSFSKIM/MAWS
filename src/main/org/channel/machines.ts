// The project channel's machines (P5 O8 M7b, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7b's Main
// bullet and Interfaces §O; the Decision Log's "M7b's channel feed" and Task 2's): every machine's to-human entries for a
// project, read only while a tab holds its channel (`open`, from channel.ts), merged by time beside the log's events.
//
// - This Mac: its spine's main-only `channel.history` (plain ids), paged once at open, and `channel.changed` heard on
//   main's taps. Live once the read lands. A daemon that has no such command reads `unavailable`.
// - Each roster machine, over its link:
//   - to an endpoint that listed `rl2.channel`, one `channel` feed for the project (`{feed: 'channel', project}`): its
//     opening's snapshot (the newest page the member views), then each new entry as an `ev {entry}`; older pages are
//     read with `channel.history` from the snapshot's oldest. A feed ended `behind` opens again at once, one ended
//     `unavailable` after a backoff (FEED_BACKOFF_MS), any other end not again on that channel.
//   - to an older endpoint (Decision Log "M7b's channel feed" 3) the feed is never asked: `channel.history` is read once
//     at open, with no live updates (`read`). One that answers that `not-offered` too is `unavailable`, and the tab greys it.
// - A machine's `id`s are its own (another machine's are opaque cursors), compared only within it: each entry is held
//   once by id per machine, whatever brings it again (a snapshot, an `ev` at another seq, a history page), and its
//   content never changes. The tab's order is the entries' own time, never when they reached this Mac; entries one
//   machine said at the same time keep its journal's order (`byTime`).
// - A read is whole once it reaches the machine's last entry or the bound: then what the machine holds is exactly what
//   the read and the `ev`s since brought, so an entry the machine no longer shows the member (a share removed) goes. A
//   read cut short (the link dropped mid-page) only adds.
// - Offline: a machine that isn't live keeps its entries "as of" `asOf`, the last time it was (its feed open, or this
//   Mac's spine read), into the next run through the cache. A machine leaving the roster, while signed in, drops its
//   entries; signed out the roster empties with the session and every machine's stand as of their last time.
// - The cache, `<userData>/org/channel/<project>.machines.json`: each machine's newest CHANNEL_MACHINE_ENTRIES entries
//   and CHANNEL_MACHINE_BYTES of them, and its `asOf`, written CHANNEL_WRITE_MS after a change through the org session's
//   commit queue, last at `close()`, by the project's newest instance only. It is one reader's, the signed-in org's
//   member's, as M7a's is (each endpoint filters what it sends by member): another reader's file reads empty, signed out
//   the file's own reader's stands, and another reader's sign-in replaces every machine's entries (`reset`). Verified at
//   load against the schemas, the project, the bounds and one id per machine; anything else reads empty.
//
// Electron-free.
import { join } from 'node:path';
import * as z from 'zod';
import { HISTORY_LIMIT_MAX, HostEntrySchema, type HostEntry } from '@shared/ipc/schema/channel';
import type { ChannelHost, ChannelMachine } from '@shared/ipc/schema/org';
import { MachineRefSchema, type MachineRef } from '@shared/machine/ref';
import type { LinkState } from '../../machines/manager';
import type { RemoteLink, Subscription } from '../../machines/remote/link';
import { privateFiles, type OrgFiles } from '../files';
import type { OrgSession } from '../session';
import { orgTiming, type OrgTiming } from '../timing';

/** What the channel reads of an RL2 link. */
export type ChannelLink = Pick<RemoteLink, 'machine' | 'name' | 'peerCapabilities' | 'call' | 'subscribe'> & {
  state(): LinkState;
  onState(listener: (state: LinkState) => void): () => void;
  onCaps(listener: () => void): () => void;
};
/** This Mac's spine's answer to `channel.history`, as main's own route gives it. */
export type LocalAnswer = { ok: true; value: unknown } | { ok: false; code: string };

export type CachedMachine = { machine: MachineRef; name: string; asOf: string | null; entries: HostEntry[] };
export type MachinesCacheFile = { version: 1; org: string; member: string; project: string; machines: CachedMachine[] };
export interface MachinesStore {
  read(project: string): Promise<unknown | null>;
  write(project: string, file: MachinesCacheFile): Promise<void>;
}

export interface ChannelMachinesDeps {
  session: OrgSession;
  local: MachineRef;
  localName: string;
  /** This Mac's spine: `channel.history` through main's own route (main-only). */
  history(input: { project: string; before?: string; limit: number }): Promise<LocalAnswer>;
  /** This Mac's spine's `channel.changed`, on main's taps. */
  onChanged(listener: (payload: { project: string; entry: HostEntry }) => void): () => void;
  /** O7's RL2 roster (`Machines.onRemote`) and its links (`Machines.remote`). */
  roster(): readonly MachineRef[];
  onRoster(listener: () => void): () => void;
  link(ref: MachineRef): ChannelLink | null;
  store: MachinesStore;
  /** The org session's commit queue. */
  commit<T>(body: () => Promise<T>): Promise<T>;
  timing?: Partial<OrgTiming>;
  now?(): number;
  log(line: string): void;
}

/** One project's machines, while a channel holds it. */
export interface ProjectHosts {
  /** The cache read, and the sources started. */
  readonly loaded: Promise<void>;
  /** Every machine's entries, oldest first: by time, then machine, then each machine's journal order. */
  entries(): ChannelHost[];
  /** This Mac first, then the others by name. */
  machines(): ChannelMachine[];
  /** Something changed; `reset`: every entry was replaced (another reader). */
  onChanged(listener: (reset: boolean) => void): () => void;
  /** Its feeds and reads stop; resolves once its last cache write is entered in the commit queue. */
  close(): Promise<void>;
}

export interface ChannelMachines {
  open(project: string): ProjectHosts;
  /** Every project still open closes. */
  close(): Promise<void>;
}

type Reader = { org: string; member: string };
type Page = { entries: HostEntry[]; more: boolean };
type Failed = { failed: string };
/** `order`: where the entry stands in its machine's journal among those it said at the same time (below). */
type Held = { entry: HostEntry; host: ChannelHost; bytes: number; order: number };
/** `next` and `low`: the places a later entry and an older page's entry take, above and below every entry held. */
type Hold = { name: string; asOf: string | null; entries: Map<string, Held>; reading: Set<string> | null; next: number; low: number };
type MachineState = ChannelMachine['state'];
type Source = { state: MachineState; timer: ReturnType<typeof setTimeout> | null; backoff: number; stop(): void };
type Remote = Source & {
  link: ChannelLink;
  sub: Subscription | null;
  live: boolean;
  /** An older peer's one read at open is done. */
  readOnce: boolean;
  reading: boolean;
  /** The `h2` list of a channel whose peer ended the feed `not-offered`: history is read there instead. */
  feedRefusedOn: readonly string[] | null;
  /** The `h2` list of a channel that has nothing more to give: neither is asked again while it is current. */
  refusedOn: readonly string[] | null;
};

const PageSchema = z.strictObject({ entries: z.array(z.unknown()), more: z.boolean() });
const CachedMachineSchema = z.strictObject({ machine: MachineRefSchema, name: z.string().max(256), asOf: z.iso.datetime({ offset: true }).nullable(), entries: z.array(HostEntrySchema) });
/** Far more machines than any org's roster; a file past it is no file of ours. */
const MACHINES_MAX = 256;
const CacheFileSchema = z.strictObject({ version: z.literal(1), org: z.string(), member: z.string(), project: z.string(), machines: z.array(CachedMachineSchema).max(MACHINES_MAX) });

const sizeOf = (entry: HostEntry): number => Buffer.byteLength(JSON.stringify(entry), 'utf8');
const timeOf = (at: string): number => {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
};
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Oldest first: the entry's own time, then (one machine's) its id. */
/**
 * Oldest first: the entry's own time, then, within one machine, its place in the journal. An id from another machine
 * is an opaque cursor that sorts nothing, so each entry takes a place as it is first held, in its journal's order: a
 * read's first page (newest first) from its oldest and each `ev` and tap as it comes (the journal's order) take the next
 * places above every entry held; a read's older pages, from their newest, the next below every entry held; a cached
 * file, in the order it was written. The questions of one ask, said at one time, keep the order they were asked in,
 * a page boundary between them included. The place goes to the renderer (`ChannelHost.order`), which orders by it too.
 */
const byTime = (a: Held, b: Held): number => timeOf(a.entry.at) - timeOf(b.entry.at) || a.order - b.order;
const sameReader = (a: Reader | null, b: Reader | null): boolean => a !== null && b !== null && a.org === b.org && a.member === b.member;

/** The file as this project's, within the bounds, one id per machine and one entry per machine id; else null. */
export function checkMachinesFile(raw: unknown, project: string, limits: { entries: number; bytes: number }): MachinesCacheFile | null {
  const parsed = CacheFileSchema.safeParse(raw);
  if (!parsed.success || parsed.data.project !== project) return null;
  const refs = new Set<string>();
  for (const machine of parsed.data.machines) {
    if (refs.has(machine.machine)) return null;
    refs.add(machine.machine);
    if (machine.entries.length > limits.entries) return null;
    if (new Set(machine.entries.map((e) => e.id)).size !== machine.entries.length) return null;
    if (machine.entries.some((e) => e.project !== project)) return null;
    if (machine.entries.reduce((sum, e) => sum + sizeOf(e), 0) > limits.bytes) return null;
  }
  return parsed.data as MachinesCacheFile;
}

/** `<org>/channel/<project>.machines.json`, beside M7a's `<project>.json`, made only once `org/` passes its checks. */
export function machinesStore(files: OrgFiles, log: (line: string) => void): MachinesStore {
  const dir = privateFiles({ dir: join(files.dir, 'channel'), log });
  return {
    read: async (project) => ((await dir.check()) === null ? null : dir.read(`${project}.machines.json`)),
    async write(project, file) {
      const org = await files.check();
      if (org === null || !org.ok) throw new Error(org === null ? `${files.dir} does not exist` : org.detail);
      const made = await dir.ensure();
      if (!made.ok) throw new Error(made.detail);
      await dir.write(`${project}.machines.json`, file);
    },
  };
}

export function createChannelMachines(deps: ChannelMachinesDeps): ChannelMachines {
  const timing = orgTiming(deps.timing);
  const now = deps.now ?? Date.now;
  const limits = { entries: timing.CHANNEL_MACHINE_ENTRIES, bytes: timing.CHANNEL_MACHINE_BYTES };
  const backoffs = timing.FEED_BACKOFF_MS;
  const generations = new Map<string, number>();
  const open = new Set<ProjectHosts>();

  function openProject(project: string): ProjectHosts {
    const log = (line: string) => deps.log(`[org-channel] ${project.slice(0, 8)}: ${line}`);
    const generation = (generations.get(project) ?? 0) + 1;
    generations.set(project, generation);
    const nowIso = () => new Date(now()).toISOString();
    const listeners = new Set<(reset: boolean) => void>();
    const holds = new Map<MachineRef, Hold>();
    const remotes = new Map<MachineRef, Remote>();
    let local: Source | null = null;
    let reader: Reader | null = null;
    /** Moves at each reset: work begun under another epoch lands nowhere. */
    let epoch = 0;
    let stopped = false;
    let dirty = false;
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    const offs: Array<() => void> = [];

    const readerNow = (): Reader | null => {
      const current = deps.session.current();
      return current === null ? null : { org: current.identity.org, member: current.identity.member };
    };

    function changed(reset = false): void {
      if (stopped) return;
      dirty = true;
      for (const listener of [...listeners]) listener(reset);
      if (writeTimer !== null) return;
      writeTimer = setTimeout(() => {
        writeTimer = null;
        enterWrite();
      }, timing.CHANNEL_WRITE_MS);
      (writeTimer as { unref?: () => void }).unref?.();
    }

    function holdOf(ref: MachineRef, name: string): Hold {
      let hold = holds.get(ref);
      if (hold === undefined) holds.set(ref, (hold = { name, asOf: null, entries: new Map(), reading: null, next: 0, low: -1 }));
      hold.name = name;
      return hold;
    }

    const hostOf = (ref: MachineRef, e: HostEntry, order: number): ChannelHost => ({
      key: `${ref} ${e.id}`,
      machine: ref,
      id: e.id,
      lane: e.lane,
      session: e.lane === 'A' ? e.engineSessionId : e.appSessionId,
      kind: e.kind,
      text: e.text,
      ...(e.choices === undefined ? {} : { choices: e.choices }),
      at: e.at,
      src: e.src,
      order,
    });

    /** The newest entries within both bounds, by the entry's own time. */
    function trim(hold: Hold): void {
      let bytes = 0;
      for (const held of hold.entries.values()) bytes += held.bytes;
      if (hold.entries.size <= limits.entries && bytes <= limits.bytes) return;
      const newest = [...hold.entries.values()].sort((a, b) => byTime(b, a));
      hold.entries = new Map();
      let kept = 0;
      for (const held of newest) {
        if (hold.entries.size >= limits.entries || kept + held.bytes > limits.bytes) break;
        kept += held.bytes;
        hold.entries.set(held.entry.id, held);
      }
    }

    /**
     * Each entry not yet held, once by its id, at its place (`byTime`): `live`, in the journal's order, above every entry
     * held; `newest`, a read's first page (newest first), the same from its end; `older`, a read's later page, below
     * every entry held, from its newest. True when anything was. A read in flight hears each id.
     */
    function add(ref: MachineRef, entries: readonly HostEntry[], place: 'live' | 'newest' | 'older' = 'live'): boolean {
      const hold = holds.get(ref);
      if (hold === undefined) return false;
      let added = false;
      for (const entry of place === 'newest' ? [...entries].reverse() : entries) {
        hold.reading?.add(entry.id);
        if (entry.project !== project || hold.entries.has(entry.id)) continue;
        const order = place === 'older' ? hold.low-- : hold.next++;
        hold.entries.set(entry.id, { entry, host: hostOf(ref, entry, order), bytes: sizeOf(entry), order });
        added = true;
      }
      if (added) trim(hold);
      return added;
    }

    /** One page as this build reads it: its entries of this project that read, the rest left out (logged). */
    function pageOf(value: unknown, from: string): Page | null {
      const page = PageSchema.safeParse(value);
      if (!page.success) {
        log(`${from}: a page of entries doesn’t read`);
        return null;
      }
      const entries: HostEntry[] = [];
      for (const raw of page.data.entries) {
        const entry = HostEntrySchema.safeParse(raw);
        if (entry.success && entry.data.project === project) entries.push(entry.data);
      }
      if (entries.length !== page.data.entries.length) log(`${from}: ${page.data.entries.length - entries.length} entries didn’t read; left out`);
      return { entries, more: page.data.more };
    }

    /**
     * The machine's newest entries, from `first` (a feed's snapshot) or the first page, paged older from each page's oldest
     * to the bound. Whole, the hold is what the read and what came meanwhile brought; cut short, it only added.
     */
    async function readNewest(ref: MachineRef, first: Page | null, page: (before: string | undefined, limit: number) => Promise<Page | Failed>, alive: () => boolean): Promise<'done' | 'stopped' | Failed> {
      const hold = holds.get(ref);
      if (hold === undefined) return 'stopped';
      const seen = new Set<string>();
      hold.reading = seen; // a later read of the machine supersedes this one
      const current = () => alive() && holds.get(ref) === hold && hold.reading === seen;
      try {
        let next: Page | Failed = first ?? (await page(undefined, Math.min(HISTORY_LIMIT_MAX, limits.entries)));
        let place: 'newest' | 'older' = 'newest';
        for (;;) {
          if (!current()) return 'stopped';
          if ('failed' in next) return next;
          if (add(ref, next.entries, place)) changed();
          place = 'older';
          const before = next.entries.at(-1)?.id;
          if (!next.more || seen.size >= limits.entries || before === undefined) break;
          next = await page(before, Math.min(HISTORY_LIMIT_MAX, limits.entries - seen.size));
        }
        let removed = false;
        for (const id of [...hold.entries.keys()]) {
          if (seen.has(id)) continue;
          hold.entries.delete(id);
          removed = true;
        }
        if (removed) changed();
        return 'done';
      } finally {
        if (hold.reading === seen) hold.reading = null;
      }
    }

    function retry(source: Source, run: () => void): void {
      const delay = backoffs[Math.min(source.backoff, backoffs.length - 1)];
      source.backoff += 1;
      source.timer = setTimeout(() => {
        source.timer = null;
        run();
      }, delay);
      (source.timer as { unref?: () => void }).unref?.();
    }

    // ---- this Mac ----

    function startLocal(): void {
      const at = epoch;
      holdOf(deps.local, deps.localName);
      const source: Source = {
        state: 'offline',
        timer: null,
        backoff: 0,
        stop() {
          if (source.timer !== null) clearTimeout(source.timer);
          source.timer = null;
          off();
          const hold = holds.get(deps.local);
          if (source.state === 'live' && hold !== undefined) hold.asOf = nowIso();
        },
      };
      local = source;
      const alive = () => !stopped && epoch === at && local === source;
      const off = deps.onChanged((payload) => {
        if (!alive() || payload.project !== project) return;
        if (source.state === 'live') holds.get(deps.local)!.asOf = nowIso();
        if (add(deps.local, [payload.entry])) changed();
      });
      const page = async (before: string | undefined, limit: number): Promise<Page | Failed> => {
        const answer = await deps.history({ project, ...(before === undefined ? {} : { before }), limit }).catch((error: unknown): LocalAnswer => ({ ok: false, code: (error as Error).message }));
        if (!answer.ok) return { failed: answer.code };
        return pageOf(answer.value, 'this Mac') ?? { failed: 'malformed' };
      };
      const read = async () => {
        const result = await readNewest(deps.local, null, page, alive);
        if (result === 'stopped' || !alive()) return;
        if (result === 'done') {
          source.state = 'live';
          source.backoff = 0;
          holds.get(deps.local)!.asOf = nowIso();
        } else if (result.failed === 'unknown_command' || result.failed === 'not-offered') {
          source.state = 'unavailable';
          log(`this Mac’s spine has no channel.history (${result.failed})`);
        } else {
          log(`this Mac’s entries didn’t read (${result.failed}); read again`);
          retry(source, () => void read());
        }
        changed();
      };
      void read();
    }

    // ---- the roster's machines ----

    async function historyPage(link: ChannelLink, before: string | undefined, limit: number): Promise<Page | Failed> {
      const answer = await link.call('channel.history', { project, ...(before === undefined ? {} : { before }), limit }).catch((error: unknown) => ({ ok: false as const, error: { code: (error as Error).message } }));
      if (!answer.ok) return { failed: answer.error.code };
      return pageOf(answer.output, link.name) ?? { failed: 'malformed' };
    }

    function attach(ref: MachineRef, link: ChannelLink): void {
      const at = epoch;
      const hold = holdOf(ref, link.name);
      const remote: Remote = {
        link,
        state: 'offline',
        timer: null,
        backoff: 0,
        sub: null,
        live: false,
        readOnce: false,
        reading: false,
        feedRefusedOn: null,
        refusedOn: null,
        stop() {
          if (remote.timer !== null) clearTimeout(remote.timer);
          remote.timer = null;
          const sub = remote.sub;
          remote.sub = null;
          sub?.close();
          offState();
          offCaps();
          if (remote.live) hold.asOf = nowIso();
          remote.live = false;
        },
      };
      remotes.set(ref, remote);
      const alive = () => !stopped && epoch === at && remotes.get(ref) === remote;

      /** Not live now: its entries stand as of the last time it was. */
      const notLive = () => {
        if (remote.live) hold.asOf = nowIso();
        remote.live = false;
        if (remote.state !== 'unavailable') remote.state = 'offline';
      };

      const readHistory = async () => {
        remote.reading = true;
        const result = await readNewest(ref, null, (before, limit) => historyPage(link, before, limit), alive);
        remote.reading = false;
        if (result === 'stopped' || !alive()) return;
        if (result === 'done') {
          remote.readOnce = true;
          remote.backoff = 0;
          remote.state = link.state() === 'up' ? 'read' : 'offline';
          hold.asOf = nowIso();
        } else if (result.failed === 'not-offered') {
          remote.refusedOn = link.peerCapabilities();
          remote.state = 'unavailable';
          log(`${link.name} offers no channel.history: its entries are unavailable`);
        } else {
          log(`${link.name}’s entries didn’t read (${result.failed}); read again`);
          retry(remote, ensure);
        }
        changed();
      };

      const subscribe = () => {
        const mine = () => alive() && remote.sub === sub;
        const sub: Subscription = link.subscribe(
          { feed: 'channel', project },
          {
            subbed: () => {
              if (mine()) remote.backoff = 0;
            },
            snapshot: (_at, value) => {
              if (!mine()) return;
              const page = pageOf(value, link.name);
              if (page === null) return;
              remote.live = true;
              remote.state = 'live';
              hold.asOf = nowIso();
              changed();
              void readNewest(ref, page, (before, limit) => historyPage(link, before, limit), mine).then((result) => {
                if (typeof result === 'object') log(`${link.name}’s older entries didn’t read (${result.failed})`);
              });
            },
            event: (_at, body) => {
              if (!mine()) return;
              const entry = HostEntrySchema.safeParse((body as { entry?: unknown } | null)?.entry);
              if (!entry.success) return log(`${link.name}: an entry doesn’t read; left out`);
              if (remote.live) hold.asOf = nowIso();
              if (add(ref, [entry.data])) changed();
            },
            paused: () => {
              if (!mine()) return;
              notLive();
              changed();
            },
            resumed: () => {},
            ended: (reason) => {
              if (!mine()) return;
              remote.sub = null;
              notLive();
              changed();
              if (reason === 'behind') {
                remote.timer = setTimeout(() => {
                  remote.timer = null;
                  ensure();
                }, 0);
              } else if (reason === 'unavailable') retry(remote, ensure);
              else if (reason === 'not-offered') {
                remote.feedRefusedOn = link.peerCapabilities(); // a peer without the feed on this channel: its history instead
                ensure();
              } else {
                log(`${link.name}’s channel feed ended ${reason}: not asked again on this channel`);
                remote.refusedOn = link.peerCapabilities();
              }
            },
          },
        );
        remote.sub = sub;
      };

      /** The feed, or an older peer's one read, if the link is up and its channel hasn't refused them. */
      function ensure(): void {
        if (!alive() || remote.timer !== null) return;
        const peers = link.peerCapabilities();
        if (link.state() !== 'up' || peers === null || peers === remote.refusedOn) return;
        if (peers.includes('rl2.feeds') && peers.includes('rl2.channel') && peers !== remote.feedRefusedOn) {
          if (remote.sub === null) subscribe();
          return;
        }
        if (!remote.readOnce && !remote.reading) void readHistory();
      }

      const offState = link.onState((state) => {
        if (!alive()) return;
        if (state !== 'up' && (remote.live || remote.state === 'read')) {
          notLive();
          changed();
        } else if (state === 'up' && remote.readOnce && remote.state === 'offline') {
          remote.state = 'read';
          changed();
        }
        ensure();
      });
      const offCaps = link.onCaps(() => {
        if (!alive()) return;
        if (link.peerCapabilities() === null) remote.refusedOn = remote.feedRefusedOn = null;
        ensure();
      });
      ensure();
    }

    function stopSources(): void {
      local?.stop();
      local = null;
      for (const remote of remotes.values()) remote.stop();
      remotes.clear();
    }

    /** The roster as it stands: links attached, replaced or let go; signed in, a machine gone from it is dropped. */
    function rosterChanged(drop: boolean): void {
      if (stopped) return;
      const refs = new Set(deps.roster());
      let moved = false;
      for (const [ref, remote] of [...remotes]) {
        const link = refs.has(ref) ? deps.link(ref) : null;
        if (link === remote.link) continue;
        remote.stop();
        remotes.delete(ref);
        moved = true;
        if (link !== null) attach(ref, link);
      }
      if (drop) {
        for (const ref of [...holds.keys()]) {
          if (ref === deps.local || refs.has(ref)) continue;
          holds.delete(ref);
          moved = true;
        }
      }
      for (const ref of refs) {
        if (remotes.has(ref) || ref === deps.local) continue;
        const link = deps.link(ref);
        if (link === null) continue;
        attach(ref, link);
        moved = true;
      }
      if (moved) changed();
    }

    function start(): void {
      startLocal();
      // at open, a roster already known (signed in, and reported) drops what it no longer lists; an empty one may not be
      // reported yet, and drops nothing
      rosterChanged(deps.session.current() !== null && deps.roster().length > 0);
    }

    /** Another reader signed in: every machine's entries are theirs to read again. */
    function reset(next: Reader): void {
      epoch += 1;
      stopSources();
      holds.clear();
      reader = next;
      log('another reader is signed in: every machine’s entries are read again');
      changed(true);
      start();
    }

    // ---- the cache ----

    const stateOf = (ref: MachineRef): MachineState => (ref === deps.local ? (local?.state ?? 'offline') : (remotes.get(ref)?.state ?? 'offline'));

    function fileOf(owner: Reader): MachinesCacheFile {
      return {
        version: 1,
        org: owner.org,
        member: owner.member,
        project,
        machines: [...holds].map(([ref, hold]) => ({
          machine: ref,
          name: hold.name,
          asOf: stateOf(ref) === 'live' ? nowIso() : hold.asOf,
          entries: [...hold.entries.values()].sort(byTime).map((held) => held.entry),
        })),
      };
    }

    function enterWrite(): void {
      if (!dirty || reader === null) return;
      if (generations.get(project) !== generation) return void log('a newer channel holds the machines’ cache: the last snapshot is let go');
      dirty = false;
      const file = fileOf(reader);
      deps.commit(() => deps.store.write(project, file)).catch((error: unknown) => log(`the machines’ cache was not written: ${(error as Error).message}`));
    }

    const loaded = (async () => {
      const raw = await deps.store.read(project).catch((error: unknown) => {
        log(`the machines’ cache did not read: ${(error as Error).message}`);
        return null;
      });
      if (stopped) return;
      const file = raw === null ? null : checkMachinesFile(raw, project, limits);
      if (raw !== null && file === null) log('the machines’ cache is damaged: read again from each machine');
      const current = readerNow();
      if (file !== null && (current === null || sameReader(current, file))) {
        reader = { org: file.org, member: file.member };
        for (const machine of file.machines) {
          const hold = holdOf(machine.machine, machine.name);
          hold.asOf = machine.asOf;
          for (const entry of machine.entries) {
            const order = hold.next++;
            hold.entries.set(entry.id, { entry, host: hostOf(machine.machine, entry, order), bytes: sizeOf(entry), order });
          }
        }
      } else reader = current;
      offs.push(
        deps.session.onChanged(() => {
          const next = readerNow();
          if (stopped || next === null || sameReader(reader, next)) return; // signed out, the held reader's stand
          if (reader === null) reader = next; // nothing of anyone's was held but this Mac's own
          else reset(next);
        }),
        deps.onRoster(() => rosterChanged(deps.session.current() !== null)),
      );
      start();
    })();

    const hosts: ProjectHosts = {
      loaded,
      entries() {
        const out: Held[] = [];
        for (const hold of holds.values()) for (const held of hold.entries.values()) out.push(held);
        return out.sort((a, b) => timeOf(a.entry.at) - timeOf(b.entry.at) || compare(a.host.machine, b.host.machine) || a.order - b.order).map((held) => held.host);
      },
      machines() {
        return [...holds]
          .map(([ref, hold]): ChannelMachine => ({ machine: ref, name: hold.name, state: stateOf(ref), asOf: hold.asOf }))
          .sort((a, b) => Number(b.machine === deps.local) - Number(a.machine === deps.local) || compare(a.name, b.name) || compare(a.machine, b.machine));
      },
      onChanged(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      async close() {
        if (stopped) return;
        await loaded;
        if (local?.state === 'live' || [...remotes.values()].some((remote) => remote.live)) dirty = true; // their "as of" is now
        stopSources();
        stopped = true;
        if (writeTimer !== null) clearTimeout(writeTimer);
        writeTimer = null;
        for (const off of offs.splice(0)) off();
        listeners.clear();
        open.delete(hosts);
        enterWrite();
      },
    };
    open.add(hosts);
    return hosts;
  }

  return {
    open: openProject,
    async close() {
      await Promise.all([...open].map((hosts) => hosts.close()));
    },
  };
}
