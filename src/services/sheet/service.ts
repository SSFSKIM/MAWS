// The question sheet's service on the spine (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §C, §E;
// S1 to S7): one per machine, started beside lane A's driver. It follows every record under the sminos home, whichever
// kind of session wrote it, announces each change small (`sheet.changed`, a summary), reads a model on demand, appends a
// window's inbox lines through the writer's door, and serves a record's bodies and takes its uploads.
//
// It is also what C4's page server calls, in process (`SpineRoot.sheet`), so every rule holds at this boundary and not
// only at the wire's: a session is taken only in the engine's id form (`isSheetSession`) before any path is made from
// it; every file is confined to the record (./files.ts); the door is located, and anything executed, only when there is
// a record to answer (`read` of a record with something open on it, or `put` to a session with a `state.json`); and an
// upload's bytes are checked here.
import { join } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { ServiceHandler } from '@shared/spine/bus';
import type { EventPayload } from '@shared/ipc/schema';
import { SheetBodyRequestSchema, isSheetSession, type SheetBody, type SheetBodyRequest, type SheetImageType, type SheetLine, type SheetModel, type SheetPutResult, type SheetSummary } from '@shared/sheet/model';
import { lineError, summaryOf } from '@shared/sheet/read';
import { SEND_MAX_LINES } from '@shared/sheet/words';
import { watchTree, type WatchTreeHandle } from '@shared/fs/watch-tree';
import { stat } from 'node:fs/promises';
import { DOOR_NOT_STARTED, putLines } from './door';
import { GONE, imageTypeOfName, isRecord, readBody, writeUpload } from './files';
import { locateSminos, type LocateDeps, type Located, type ProofCache } from './locate';
import { UNREADABLE, listRecords, readRecord, recordIo, sheetRoot, type RecordIo } from './reader';
import { SHEET_TIMING, type SheetTiming } from './timing';

export type { DoorState } from '@shared/ipc/schema/sheet';

type Env = Record<string, string | undefined>;
type Facts = Pick<SheetSummary, 'appSessionId' | 'title' | 'live'>;

export interface SheetServiceDeps {
  home: Promise<string>; // sminosHome(deps.env, shellEnv), as lane A's driver gets it
  shell: Promise<Record<string, string>>; // the login shell's environment
  env: Env;
  configHome: Promise<string>; // the engine's config home, read under the login shell's environment
  sessionOf(engineSessionId: string): { appSessionId: AppSessionId; title: string | null; live: boolean } | null; // from the index
  onSessionsChanged(listener: () => void): () => void; // the index's sessions moved: one was added, changed its holder or title, or was removed
  emit(name: 'sheet.changed', payload: EventPayload<'sheet.changed'>): void;
  timing?: Partial<SheetTiming>; // over SHEET_TIMING
  io?: RecordIo; // the tests' seam: every touch of a record's state and inbox (./reader.ts)
  locate?: Pick<LocateDeps, 'underTest' | 'systemRoot'>; // the tests' seam: the locator's own
}

export type SheetListener = (summary: SheetSummary | null, session: string, was: SheetSummary | null) => void;

export interface SheetService {
  list(): Promise<SheetSummary[]>;
  read(session: string): Promise<SheetModel | null>;
  put(session: string, lines: SheetLine[]): Promise<SheetPutResult>;
  body(session: string, of: SheetBodyRequest): Promise<SheetBody>;
  upload(session: string, image: { mediaType: SheetImageType; data: string }): Promise<{ ok: true; path: string } | { ok: false; why: string }>;
  onChange(listener: SheetListener): () => void; // what §H's items are made from
  door(): DoorState; // what is known now; it starts nothing
  stop(): void;
}

// One record as the service last verified it: its model (null when unreadable), its summary, what an announcement is
// decided by (`mark`), and the files' stamp the poll compares (null: read again at the next tick).
interface Entry {
  model: SheetModel | null;
  summary: SheetSummary;
  mark: string;
  stamp: string | null;
}

const NO_FACTS: Facts = { appSessionId: null, title: null, live: null };
const sameFacts = (a: Facts, b: Facts): boolean => a.appSessionId === b.appSessionId && a.title === b.title && a.live === b.live;
const refused = (message: string): SheetPutResult => ({ ok: false, why: 'refused', message });
const NO_SHEET: SheetPutResult = { ok: false, why: 'no-sheet', message: 'This session has no question sheet on this Mac.' };
const OUT_OF_TIME: SheetPutResult = { ok: false, why: 'failed', message: 'The sminos command did not answer in time; send again.' };
const sameDoor = (a: DoorState, b: DoorState): boolean => JSON.stringify(a) === JSON.stringify(b); // each built here, keys in one order
// Something a person could act on: an open question, or a dismissal they could take back.
const answerable = (model: SheetModel): boolean => model.open.length > 0 || model.hidden.length > 0;

export function createSheetService(deps: SheetServiceDeps): SheetService {
  const timing: SheetTiming = { ...SHEET_TIMING, ...deps.timing };
  const io = deps.io ?? recordIo;
  const entries = new Map<string, Entry>();
  const listeners = new Set<SheetListener>();
  const reading = new Map<string, { again: boolean; done: Promise<void> }>();
  const debounces = new Map<string, NodeJS.Timeout>();
  const proofs: ProofCache = new Set();
  let home: string | null = null;
  let stopped = false;
  let watcher: WatchTreeHandle | null = null;
  let poll: NodeJS.Timeout | null = null;
  let rootPoll: NodeJS.Timeout | null = null; // while the root does not exist (or its watch failed)
  let scanning = false;
  let doorState: DoorState = { known: false };
  let locating: Promise<Located> | null = null;

  const factsOf = (session: string): Facts => deps.sessionOf(session) ?? NO_FACTS;

  const announce = (session: string, summary: SheetSummary | null, was: SheetSummary | null) => {
    if (stopped) return;
    deps.emit('sheet.changed', { session, summary });
    for (const listener of [...listeners]) listener(summary, session, was);
  };

  // The record's files as the poll compares them: `state.json` and the inbox, each by size and modification time.
  const stampOf = async (session: string): Promise<string> => {
    const record = join(sheetRoot(home!), session);
    const one = async (name: string) => {
      const st = await stat(join(record, name), { bigint: true }).catch(() => null);
      return st === null ? '-' : `${st.size}:${st.mtimeNs}`;
    };
    return `${await one('state.json')}|${await one('inbox.jsonl')}`;
  };
  const inboxLength = (stamp: string): string => stamp.split('|')[1]!.split(':')[0]!;

  // One read of a record, and its announcement when it appeared, went, or its seq, its inbox's length, its count of
  // queued lines or its join to the index moved. A read that cannot pair changes nothing and is made again at the next
  // tick.
  async function readOnce(session: string): Promise<void> {
    const stamp = await stampOf(session);
    const result = await readRecord(home!, session, io).catch(() => ({ unreadable: UNREADABLE.record }));
    if (stopped) return;
    const was = entries.get(session) ?? null;
    if (result === null) {
      if (was === null) return;
      entries.delete(session);
      return announce(session, null, was.summary);
    }
    if ('busy' in result) {
      if (was !== null) was.stamp = null;
      return;
    }
    const facts = factsOf(session);
    const entry: Entry =
      'model' in result
        ? { model: result.model, summary: summaryOf(result.model, facts), mark: `${result.model.seq}:${inboxLength(stamp)}:${result.model.sent.filter((sent) => sent.state === 'queued').length}`, stamp }
        : { model: null, summary: { session, ...facts, seq: 0, open: 0, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: true }, mark: `unreadable:${result.unreadable}`, stamp };
    entries.set(session, entry);
    if (was === null || was.mark !== entry.mark || !sameFacts(was.summary, entry.summary)) announce(session, entry.summary, was?.summary ?? null);
  }

  // Reads a record, one read of it at a time: asked again while one is under way, it reads once more after.
  function refresh(session: string): Promise<void> {
    const current = reading.get(session);
    if (current !== undefined) {
      current.again = true;
      return current.done;
    }
    const state = { again: false, done: Promise.resolve() };
    state.done = (async () => {
      try {
        do {
          state.again = false;
          await readOnce(session);
        } while (state.again && !stopped);
      } finally {
        reading.delete(session);
      }
    })();
    reading.set(session, state);
    return state.done;
  }

  // Every record listed, each read when its files moved since its last verified read; each one gone, dropped.
  async function scan(): Promise<void> {
    if (scanning || stopped || home === null) return;
    scanning = true;
    try {
      const listed = await listRecords(home).catch(() => [] as string[]);
      const reads: Promise<void>[] = [];
      for (const session of listed) {
        const entry = entries.get(session);
        if (entry === undefined || entry.stamp === null || entry.stamp !== (await stampOf(session))) reads.push(refresh(session));
      }
      for (const session of entries.keys()) if (!listed.includes(session)) reads.push(refresh(session));
      await Promise.all(reads);
    } finally {
      scanning = false;
    }
  }

  // A change under a record's directory reads that record after `debounceMs`; a change the platform names no file of,
  // a scan. Within a record only its own directory is watched: its state and inbox are there.
  function arm(): void {
    if (watcher !== null || stopped || home === null) return;
    const root = sheetRoot(home);
    try {
      watcher = watchTree(root, { prune: (dir) => dir.includes('/') || !isSheetSession(dir) }, (_event, filename) => {
        if (filename === null) return void scan();
        const session = filename.split('/')[0]!;
        if (!isSheetSession(session)) return;
        clearTimeout(debounces.get(session));
        const timer = setTimeout(() => {
          debounces.delete(session);
          void refresh(session);
        }, timing.debounceMs);
        timer.unref();
        debounces.set(session, timer);
      });
      watcher.on('error', () => {
        watcher?.close();
        watcher = null;
        lookForRoot();
      });
    } catch {
      watcher = null; // no root yet
      lookForRoot();
    }
  }

  // While the root is not watched, it is looked for every `rootPollMs`, so the first record under a home that had no
  // sheet/ shows within a second and not at the next poll; once it is watched, it is scanned at once.
  function lookForRoot(): void {
    if (rootPoll !== null || stopped) return;
    rootPoll = setInterval(() => {
      if (stopped || home === null) return;
      arm();
      if (watcher === null) return;
      clearInterval(rootPoll!);
      rootPoll = null;
      void scan();
    }, timing.rootPollMs);
    rootPoll.unref();
  }

  const ready: Promise<void> = deps.home.then(
    async (resolved) => {
      if (stopped) return;
      home = resolved;
      arm();
      await scan();
      if (stopped) return;
      poll = setInterval(() => {
        arm();
        void scan();
      }, timing.pollMs);
      poll.unref();
    },
    () => {}, // no sminos home here (a test runner's refusal): nothing to follow, nothing listed
  );

  // The index's join moved: each summary projected again from the model held, no file read.
  let projecting = false;
  const offSessions = deps.onSessionsChanged(() => {
    if (projecting) return;
    projecting = true;
    queueMicrotask(() => {
      projecting = false;
      for (const [session, entry] of entries) {
        const facts = factsOf(session);
        if (sameFacts(entry.summary, facts)) continue;
        const was = entry.summary;
        entry.summary = { ...entry.summary, ...facts };
        announce(session, entry.summary, was);
      }
    });
  });

  // A move of the door's state reaches the windows as an announcement of every record held, its summary as it was: a
  // window re-reads what it watches and takes the door from that read, and the next list carries it. Only the windows
  // hear it; nothing of a record changed, so the service's own listeners (§H) do not.
  const announceDoor = () => {
    if (stopped) return;
    for (const [session, entry] of entries) deps.emit('sheet.changed', { session, summary: entry.summary });
  };

  // The door's state, located again only while it is not known to be available, or at a put; one location at a time,
  // its probe bounded by `probeMs` (less when a put has less left).
  function locate(probeMs = timing.probeMs): Promise<Located> {
    locating ??= (async () => {
      const located = await locateSminos({ env: deps.env, shell: await deps.shell, configHome: await deps.configHome, home: home!, proofs, probeMs, ...deps.locate });
      const was = doorState;
      doorState = located.ok ? { known: true, available: true } : { known: true, available: false, reason: located.detail };
      if (!sameDoor(was, doorState)) announceDoor();
      return located;
    })().finally(() => {
      locating = null;
    });
    return locating;
  }

  // A location within what is left of a put's budget: null when the budget ran out first (a location already under way,
  // a read's, is not waited on past it).
  async function locateWithin(deadline: number): Promise<Located | null> {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    let timer: NodeJS.Timeout | undefined;
    const outOfTime = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), left);
    });
    try {
      return await Promise.race([locate(Math.min(timing.probeMs, left)), outOfTime]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function modelOf(session: string): Promise<SheetModel | null> {
    if (!entries.has(session)) await refresh(session);
    return entries.get(session)?.model ?? null;
  }

  return {
    async list() {
      await ready;
      return [...entries.values()].map((entry) => entry.summary).sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : 0));
    },

    async read(session) {
      if (!isSheetSession(session)) return null;
      await ready;
      if (home === null) return null;
      await refresh(session);
      const model = entries.get(session)?.model ?? null;
      // Located behind the answer: the read answers within the host's deadline whatever the probe does, the door's
      // state as it stands until the probe ends.
      if (model !== null && answerable(model) && !(doorState.known && doorState.available)) void locate().catch(() => {});
      return model;
    },

    async put(session, lines) {
      if (!isSheetSession(session)) return refused('A sheet’s session is named by its engine session id.');
      if (lines.length === 0) return refused('A put carries at least one inbox line.');
      if (lines.length > SEND_MAX_LINES) return refused(`A put carries at most ${SEND_MAX_LINES} inbox lines.`);
      for (const [i, line] of lines.entries()) {
        const why = lineError(line);
        if (why !== null) return refused(`Line ${i + 1} is not an inbox line: ${why}.`);
      }
      // One budget for the probe and the door, inside the wire's: the door gets what the location left of it.
      const deadline = Date.now() + timing.putMs;
      await ready;
      if (home === null) return { ok: false, why: 'unavailable', message: 'This Mac has no sminos home to answer in.' };
      // Nothing is located or run for a session with no record (X2). A removal racing this check is the door's to
      // settle: it answers 3, read as no-sheet.
      if (!(await isRecord(join(sheetRoot(home), session)))) return NO_SHEET;
      const send = async (): Promise<SheetPutResult> => {
        const located = await locateWithin(deadline);
        if (located === null) return OUT_OF_TIME;
        if (!located.ok) return { ok: false, why: 'unavailable', message: located.detail };
        const left = deadline - Date.now();
        return left <= 0 ? OUT_OF_TIME : putLines(located.cli, session, lines, left);
      };
      let result = await send();
      if (!result.ok && result.message === DOOR_NOT_STARTED) {
        // A plugin update removed the old version's directory: the command is found and proven again, and the lines,
        // which nothing appended, sent once more.
        proofs.clear();
        result = await send();
      }
      void refresh(session);
      return result;
    },

    async body(session, of) {
      if (!isSheetSession(session) || !SheetBodyRequestSchema.safeParse(of).success) return GONE;
      await ready;
      if (home === null) return GONE;
      const record = join(sheetRoot(home), session);
      if ('upload' in of) {
        if (!(await isRecord(record))) return GONE; // an upload is served only from a record, as it is taken only into one
        const name = of.upload.slice('uploads/'.length);
        return readBody(record, 'uploads', name, imageTypeOfName(name) ?? '');
      }
      const model = await modelOf(session);
      if (model === null) return GONE;
      if ('ref' in of) {
        const reference = model.open.flatMap((question) => question.references).find((candidate) => candidate.sha256 === of.ref);
        if (reference === undefined) return GONE;
        return readBody(record, 'refs', reference.sha256, reference.kind === 'text' ? 'text' : (reference.mediaType ?? ''));
      }
      const file = `texts/${of.text}.txt`;
      if (!model.pending.some((outcome) => (outcome as { textFile?: unknown }).textFile === file)) return GONE;
      return readBody(record, 'texts', `${of.text}.txt`, 'text');
    },

    async upload(session, image) {
      if (!isSheetSession(session)) return { ok: false, why: 'A sheet’s session is named by its engine session id.' };
      await ready;
      if (home === null) return { ok: false, why: 'This Mac has no sminos home to answer in.' };
      return writeUpload(join(sheetRoot(home), session), image.mediaType, image.data);
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    door: () => doorState,

    stop() {
      stopped = true;
      offSessions();
      watcher?.close();
      watcher = null;
      if (poll !== null) clearInterval(poll);
      if (rootPoll !== null) clearInterval(rootPoll);
      for (const timer of debounces.values()) clearTimeout(timer);
      debounces.clear();
      listeners.clear();
    },
  };
}

type SheetCommand = 'sheet.list' | 'sheet.read' | 'sheet.put' | 'sheet.body' | 'sheet.upload';
type Register = <N extends SheetCommand>(name: N, handler: ServiceHandler<N>) => void;

/** The wire's handlers (§D): `sheet.put` stamps `by: 'maws'` on every line; the service refuses what it must. */
export function registerSheet(service: SheetService, register: Register): void {
  register('sheet.list', async () => ({ sessions: await service.list(), door: service.door() }));
  register('sheet.read', async ({ session }) => {
    const model = await service.read(session);
    return { model, door: service.door() };
  });
  register('sheet.put', ({ session, lines }) => service.put(session, lines.map((line) => ({ ...line, by: 'maws' as const }))));
  register('sheet.body', ({ session, of }) => service.body(session, of));
  register('sheet.upload', ({ session, mediaType, data }) => service.upload(session, { mediaType, data }));
}
