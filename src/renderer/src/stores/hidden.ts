// The sessions hidden from the sidebar (UX wave U7, O-16; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// M3 and Interfaces §E). A hidden session leaves its project's list for the project's "Hidden · N" row; nothing is sent
// to any machine, so it works alike for this Mac's sessions and for another machine's, open here or only listed.
//
// Reading and writing, after `stores/people.ts` with one difference: a read that failed is not an empty set. The key
// `sidebar.hidden` is read once at first use; until a read has answered, an act is drawn at once and remembered (and so is
// what a look at it changes), nothing is written, and a refused read is asked again at the next act, so one refused read
// and one Hide never replace the stored set with one entry. Once read, the whole value is written 250 ms after the last change (an act, an arming, a
// return, a drop) and at once when the page unloads; a refused write is logged, and the next change writes it again.
//
// When a hidden session returns is one pure function of an entry and a look (`afterLook`; the architect's ruling of
// 2026-11-13): it returns when a turn of its began after the hide; where no datum says when a turn began, the window must
// have seen it not working since the hide (its entry *armed*, which is stored) before it counts it as working again. The
// connection (`connectHidden`) gathers each session's look from the sessions store and applies the answer at the first
// look of a run and at each change of the digests, the records, the listings or the loaded machines.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge, SessionDigest } from '@shared/ipc/schema';
import { SidebarHiddenSchema } from '@shared/ipc/schema/layout';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { useMachines } from './machines';
import { useSessions, type SessionsState } from './sessions';

export const HIDDEN_KEY = 'sidebar.hidden';
export const HIDDEN_WRITE_DELAY_MS = 250;
export const HIDDEN_MAX = 500;
export const QUIET_MS = 120_000;

/** When a session was hidden, and since when its entry is armed (ISO-8601; null: not armed). */
export type HiddenEntry = { at: string; armedAt: string | null };

/** What the window knows of a session at one look. */
export type Look =
  | { route: 'runs'; working: boolean; turnStartedAt: string | null } // a session MAWS runs on this Mac (its record's holder is `self`)
  | { route: 'says'; working: boolean } // any other record whose phase says its turns; a listing
  | { route: 'transcript'; newestAt: string | null } // a record whose phase is `foreign`: nothing says its turns
  | { route: 'nothing' }; // neither a digest nor a listing at this look

const iso = (ms: number) => new Date(ms).toISOString();
const later = (time: string | null, than: string): boolean => time !== null && Date.parse(time) > Date.parse(than);
// When a transcript look found working is found at rest, if no record comes before.
const quietAfter = (newestAt: string) => Date.parse(newestAt) + QUIET_MS + 1;

/** Whether the look finds the session working; null when it cannot say. */
export function working(look: Look, now: number): boolean | null {
  switch (look.route) {
    case 'runs':
    case 'says':
      return look.working;
    case 'transcript':
      return look.newestAt !== null && Date.parse(look.newestAt) > now - QUIET_MS;
    case 'nothing':
      return null;
  }
}

/** The entry a hide makes at `now`. */
export function entryAt(look: Look, now: number): HiddenEntry {
  const at = iso(now);
  return { at, armedAt: working(look, now) === false ? at : null };
}

/** One look at a hidden session: it returns, or its entry as it is afterwards (the same object when nothing changed). */
export function afterLook(entry: HiddenEntry, look: Look, now: number): 'returns' | HiddenEntry {
  if (look.route === 'nothing') return entry;
  if (look.route === 'runs' && later(look.turnStartedAt, entry.at)) return 'returns';
  const seen = working(look, now);
  if (entry.armedAt === null) return seen === false ? { ...entry, armedAt: iso(now) } : entry;
  switch (look.route) {
    case 'runs':
      return entry; // only a turn start later than the hide returns it
    case 'transcript':
      return later(look.newestAt, entry.armedAt) ? 'returns' : entry;
    case 'says':
      return seen ? 'returns' : entry;
  }
}

/** Where the store's looks come from: the connection's view of the sessions store and the machines store. */
export interface HiddenSources {
  lookOf(id: AppSessionId): Look;
  gone(id: AppSessionId): boolean; // its entry goes without a return (this Mac's session, with this Mac loaded and no record at it)
  turnEndedAt(id: AppSessionId): string | null; // a session MAWS runs: its digest's last turn end, which ends its lead
}
const NO_SOURCES: HiddenSources = { lookOf: () => ({ route: 'nothing' }), gone: () => false, turnEndedAt: () => null };

export interface HiddenStore {
  hidden: ReadonlyMap<AppSessionId, HiddenEntry>;
  leading: ReadonlySet<AppSessionId>; // unhidden in this run, until its next turn ends; never stored
  acts: number; // counts hide and unhide, for the sidebar's held order
  load(): Promise<void>; // the first call reads; later calls share it; after a refused read, the next call reads again
  hide(id: AppSessionId): void;
  unhide(id: AppSessionId): void;
  attach(sources: HiddenSources): () => void; // the connection's: where looks come from; looks at once
  review(): void; // one look at every hidden session and every lead
}

// An unhidden session's lead (§E, "When a lead ends"): when it was unhidden, and whether a look since found it working.
interface Lead {
  at: number;
  sawWorking: boolean;
}

/** The value written, at most `HIDDEN_MAX` entries: other machines' sessions go first, oldest `at` first; this Mac's oldest only when no other is left. */
export function bounded(hidden: ReadonlyMap<AppSessionId, HiddenEntry>, local: MachineRef): ReadonlyMap<AppSessionId, HiddenEntry> {
  if (hidden.size <= HIDDEN_MAX) return hidden;
  const mine = (id: AppSessionId) => (isAddress(id) && machineOf(id) === local ? 1 : 0);
  const age = (entry: HiddenEntry) => Date.parse(entry.at) || 0;
  const order = [...hidden].sort(([a, x], [b, y]) => mine(a) - mine(b) || age(x) - age(y));
  const dropped = new Set(order.slice(0, hidden.size - HIDDEN_MAX).map(([id]) => id));
  return new Map([...hidden].filter(([id]) => !dropped.has(id)));
}

// Tests only: each store's way back to its first state (`resetHidden`).
const resets = new WeakMap<object, () => void>();

export function createHiddenStore(client: MawsBridge, options: { writeDelayMs?: number; now?: () => number } = {}): UseBoundStore<StoreApi<HiddenStore>> {
  const delay = options.writeDelayMs ?? HIDDEN_WRITE_DELAY_MS;
  const now = options.now ?? Date.now;
  let reading: Promise<void> | null = null;
  let loaded = false;
  const early = new Map<AppSessionId, HiddenEntry | null>(); // each address acted on before a read answered: its entry, or null for not hidden
  const leads = new Map<AppSessionId, Lead>();
  let sources = NO_SOURCES;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: ReturnType<typeof setTimeout> | null = null;
  let unloadHooked = false;

  const store = create<HiddenStore>()((set, get) => {
    const write = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const value = { version: 1 as const, hidden: Object.fromEntries(get().hidden) };
      void client.invoke('layout.set', { key: HIDDEN_KEY, value }).then(
        (result) => void (!result.ok && console.error(`[hidden] layout.set ${HIDDEN_KEY} failed`, result.error)),
        (error: unknown) => console.error(`[hidden] layout.set ${HIDDEN_KEY} failed`, error),
      );
    };
    const schedule = () => {
      if (!unloadHooked && typeof window !== 'undefined') {
        unloadHooked = true;
        window.addEventListener('beforeunload', () => timer !== null && write());
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(write, delay);
    };
    const refused = (error: unknown) => {
      console.error(`[hidden] layout.get ${HIDDEN_KEY} failed; hides stay drawn and the next one reads again`, error);
      reading = null;
    };
    const answered = (stored: unknown) => {
      const parsed = stored === null ? null : SidebarHiddenSchema.safeParse(stored);
      if (parsed && !parsed.success) console.warn(`[hidden] ${HIDDEN_KEY} is not a valid value; read as nothing hidden`);
      const hidden = new Map(parsed?.success ? (Object.entries(parsed.data.hidden) as [AppSessionId, HiddenEntry][]) : []);
      for (const [id, entry] of early) {
        if (entry === null) hidden.delete(id);
        else hidden.set(id, entry);
      }
      const acted = early.size > 0;
      early.clear();
      loaded = true;
      set({ hidden: bounded(hidden, client.localMachine) });
      if (acted) schedule();
      get().review(); // the first look of the run
    };
    // An act on one address: drawn at once; written once a read has answered, else remembered and the read asked.
    const act = (id: AppSessionId, entry: HiddenEntry | null) => {
      const hidden = new Map(get().hidden);
      if (entry === null) {
        hidden.delete(id);
        leads.set(id, { at: now(), sawWorking: false });
      } else {
        hidden.set(id, entry);
        leads.delete(id);
      }
      set({ hidden: loaded ? bounded(hidden, client.localMachine) : hidden, leading: new Set(leads.keys()), acts: get().acts + 1 }); // one write, so the sidebar settles its order on the new ranks
      if (loaded) schedule();
      else early.set(id, entry);
      get().review();
      if (!loaded) void get().load();
    };
    // A `foreign` record found working (a hidden entry not armed, a lead) is found at rest only once QUIET_MS has passed
    // with nothing written, which changes no store: the store looks again then.
    const wakeAt = (times: number[]) => {
      if (wake !== null) clearTimeout(wake);
      wake = null;
      if (times.length > 0) wake = setTimeout(() => get().review(), Math.max(0, Math.min(...times) - now()));
    };

    return {
      hidden: new Map(),
      leading: new Set(),
      acts: 0,

      load() {
        reading ??= client.invoke('layout.get', { key: HIDDEN_KEY }).then((result) => (result.ok ? answered(result.value.value) : refused(result.error)), refused);
        return reading;
      },

      hide(id) {
        if (get().hidden.has(id)) return;
        act(id, entryAt(sources.lookOf(id), now()));
      },

      unhide(id) {
        if (!get().hidden.has(id)) return;
        act(id, null);
      },

      attach(given) {
        sources = given;
        get().review();
        return () => {
          if (sources === given) sources = NO_SOURCES;
        };
      },

      review() {
        const t = now();
        const wakes: number[] = []; // each quiet deadline, a hidden entry's or a lead's: nothing else looks again then
        let leadsChanged = false;
        for (const [id, lead] of leads) {
          const look = sources.lookOf(id);
          let ended: boolean;
          if (look.route === 'runs') {
            const endedAt = sources.turnEndedAt(id);
            ended = endedAt !== null && Date.parse(endedAt) > lead.at;
          } else {
            const seen = working(look, t);
            ended = seen === false && lead.sawWorking;
            if (seen === true) lead.sawWorking = true;
            if (seen === true && look.route === 'transcript' && look.newestAt !== null) wakes.push(quietAfter(look.newestAt));
          }
          if (ended) {
            leads.delete(id);
            leadsChanged = true;
          }
        }
        const patch: Partial<HiddenStore> = leadsChanged ? { leading: new Set(leads.keys()) } : {};
        // Until a read has answered, the map holds only this run's acts: they are looked at alike, and what a look changes
        // is remembered with them, so the read's answer cannot bring back what this run saw return.
        const current = get().hidden;
        let next: Map<AppSessionId, HiddenEntry> | null = null;
        for (const [id, entry] of current) {
          const look = sources.lookOf(id);
          const answer = sources.gone(id) ? 'returns' : afterLook(entry, look, t);
          if (answer === entry) {
            if (look.route === 'transcript' && entry.armedAt === null && look.newestAt !== null) wakes.push(quietAfter(look.newestAt));
            continue;
          }
          next ??= new Map(current);
          if (answer === 'returns') next.delete(id);
          else next.set(id, answer);
          if (!loaded) early.set(id, answer === 'returns' ? null : answer);
        }
        wakeAt(wakes);
        if (next !== null) {
          patch.hidden = loaded ? bounded(next, client.localMachine) : next;
          if (loaded) schedule();
        }
        if (Object.keys(patch).length > 0) set(patch);
      },
    };
  });
  resets.set(store, () => {
    if (timer !== null) clearTimeout(timer);
    if (wake !== null) clearTimeout(wake);
    timer = wake = null;
    reading = null;
    loaded = false;
    early.clear();
    leads.clear();
    sources = NO_SOURCES;
    store.setState({ hidden: new Map(), leading: new Set(), acts: 0 });
  });
  return store;
}

export const useHidden = createHiddenStore(ipc);

/** Tests only: the store as it was before its first read, its connection and its timers gone. */
export function resetHidden(store: UseBoundStore<StoreApi<HiddenStore>> = useHidden): void {
  resets.get(store)?.();
}

const WORKING_PHASES: ReadonlySet<SessionDigest['phase']> = new Set(['starting', 'working', 'waiting']);

/** The look a session gets (§E, "Which look a session gets"). */
export function lookOf(state: Pick<SessionsState, 'records' | 'digests' | 'listed'>, id: AppSessionId, local: MachineRef): Look {
  if (!isAddress(id) || machineOf(id) !== local) {
    const listed = state.listed.get(id);
    return listed === undefined ? { route: 'nothing' } : { route: 'says', working: listed.state === 'busy' };
  }
  const record = state.records.get(id);
  const digest = state.digests.get(id);
  if (record === undefined || digest === undefined) return { route: 'nothing' };
  if (record.holder.kind === 'self') return { route: 'runs', working: WORKING_PHASES.has(digest.phase), turnStartedAt: digest.turnStartedAt };
  if (digest.phase === 'foreign') return { route: 'transcript', newestAt: digest.lastTurnEndedAt }; // for these records, its newest transcript record
  return { route: 'says', working: WORKING_PHASES.has(digest.phase) };
}

/** Follows the sessions store and the machines store; gathers each look and applies `afterLook`. Mounted once, beside the People toggles' first read. */
export function connectHidden(store: UseBoundStore<StoreApi<HiddenStore>> = useHidden): () => void {
  const local = () => ipc.localMachine;
  const detach = store.getState().attach({
    lookOf: (id) => lookOf(useSessions.getState(), id, local()),
    gone: (id) => {
      if (!isAddress(id) || machineOf(id) !== local() || !useMachines.getState().loaded.has(local())) return false; // another machine's: never for its absence
      const record = useSessions.getState().records.get(id);
      return record === undefined || record.archived;
    },
    turnEndedAt: (id) => useSessions.getState().digests.get(id)?.lastTurnEndedAt ?? null,
  });
  void store.getState().load();
  const offSessions = useSessions.subscribe((state, previous) => {
    if (state.digests !== previous.digests || state.records !== previous.records || state.listed !== previous.listed) store.getState().review();
  });
  const offMachines = useMachines.subscribe((state, previous) => {
    if (state.loaded !== previous.loaded) store.getState().review();
  });
  return () => {
    detach();
    offSessions();
    offMachines();
  };
}
