// X17 in the engine host (P2-A execution document §5.5): the facts the engine reported for a session — its version,
// the resolved model, the effort, the effective permission mode, the output style, the loaded plugins and the last
// context reading — each with the journal time and launch it came from, kept in a file beside the state file
// (store/observed-facts-store.ts) so a session with no process still shows them, labelled with when.
//
// One fold reads journal rows into facts, so the live recorder and the recovery read every fact the same way: the live
// recorder is fed each row as the session journals it (EngineSession.record), and recovery folds the rows of journal
// launches the file has not folded yet, newest first, under a reading budget. Facts merge per field by time
// (`mergeObservedFacts`), so the order of live writes and recovery never matters and a launch that observed nothing
// (a no-prompt start sees no system/init) keeps the previous launch's facts.
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { assertSafeAppSessionId } from '@shared/engine/app-session-id';
import { EffortSchema } from '@shared/engine/launch-spec';
import {
  contextUsageOf,
  emptyObservedFacts,
  mergeObservedFacts,
  OBSERVED_FACT_KEYS,
  type Fact,
  type ObservedFactKey,
  type ObservedFacts,
  type ObservedFactsAnswer,
  type ObservedPlugins,
} from '@shared/engine/observed-facts';
import type { AppSessionId } from '@shared/graph/ids';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { JournalReader, type LaunchFiles } from './journal';
import { contextSampleOf } from './normalizer';
import { initPluginsOf, isPermissionMode, isSubagentFrame, pluginsOf } from './session-status';
import type { ObservedFactsStore } from './store/observed-facts-store';

export const OBSERVED_FACTS_DEBOUNCE_MS = 500;
export const OBSERVED_FACTS_BUDGET_MS = 5_000; // recovery's reading budget, inside `engine.observedFacts`'s bounded deadline

type FactValues = { [K in ObservedFactKey]: ObservedFacts[K] };
type Frame = Record<string, unknown>;

// The answers whose request carries a fact; their `in` control response names no subtype, so it is matched by id.
const FACT_REQUESTS = new Set(['initialize', 'reload_plugins', 'get_context_usage', 'get_settings', 'set_permission_mode']);
const isRecord = (v: unknown): v is Frame => typeof v === 'object' && v !== null && !Array.isArray(v);
const noFacts = (): FactValues => ({ engineVersion: null, model: null, effort: null, mode: null, outputStyle: null, plugins: null, contextUsage: null });

// ---------------------------------------------------------------------------------------------------------------------
// The fold: one launch's journal rows → that launch's facts

export class ObservedFactsFold {
  readonly facts: FactValues = noFacts();
  engineSessionId: string | null = null;
  // the plugins fact came from a reload_plugins answer before any init in this launch: its errors and warnings are the
  // last init's, which an earlier launch saw (the caller fills them from what it already knows)
  reloadWithoutInit = false;
  private readonly requests = new Map<string, string>(); // request id → subtype, until answered
  private initIssues: Pick<ObservedPlugins, 'errors' | 'warnings'> | null = null; // this launch's last init's
  private initAt: string | null = null;

  constructor(readonly launchId: string) {}

  // One row; true when a fact was set.
  row(row: JournalRow): boolean {
    const frame = row.frame;
    if (!isRecord(frame)) return false;
    if (row.direction === 'out') {
      const request = frame.request;
      if (frame.type === 'control_request' && typeof frame.request_id === 'string' && isRecord(request) && typeof request.subtype === 'string' && FACT_REQUESTS.has(request.subtype)) this.requests.set(frame.request_id, request.subtype);
      return false;
    }
    if (row.direction !== 'in') return false;
    if (frame.type === 'system') return this.system(frame, row.at);
    if (frame.type === 'control_response' && isRecord(frame.response)) return this.answer(frame.response, row.at);
    return false;
  }

  private set<K extends ObservedFactKey>(key: K, value: NonNullable<FactValues[K]>['value'], at: string): true {
    (this.facts as Record<ObservedFactKey, Fact<unknown>>)[key] = { value, at, launchId: this.launchId };
    return true;
  }

  private mode(mode: unknown, at: string): boolean {
    return typeof mode === 'string' && isPermissionMode(mode) ? this.set('mode', mode, at) : false;
  }

  private system(frame: Frame, at: string): boolean {
    if (frame.subtype === 'status') return this.mode(frame.permissionMode, at);
    if (frame.subtype !== 'init' || isSubagentFrame(frame)) return false;
    if (typeof frame.session_id === 'string') this.engineSessionId = frame.session_id;
    if (typeof frame.claude_code_version === 'string') this.set('engineVersion', frame.claude_code_version, at);
    if (typeof frame.model === 'string') this.set('model', frame.model, at);
    if (typeof frame.output_style === 'string') this.set('outputStyle', frame.output_style, at);
    this.mode(frame.permissionMode, at);
    const { plugins, pluginErrors, pluginWarnings } = initPluginsOf(frame);
    this.initIssues = { errors: pluginErrors, warnings: pluginWarnings };
    this.initAt = at;
    this.reloadWithoutInit = false;
    return this.set('plugins', { plugins, errors: pluginErrors, warnings: pluginWarnings }, at);
  }

  private answer(envelope: Frame, at: string): boolean {
    const id = envelope.request_id;
    const subtype = typeof id === 'string' ? this.requests.get(id) : undefined;
    if (subtype === undefined) return false;
    this.requests.delete(id as string);
    const response = envelope.response;
    if (envelope.subtype !== 'success' || !isRecord(response)) return false;
    switch (subtype) {
      case 'initialize': {
        const style = typeof response.output_style === 'string' && this.set('outputStyle', response.output_style, at);
        return this.mode(response.current_permission_mode, at) || style;
      }
      case 'set_permission_mode':
        return this.mode(response.mode, at);
      case 'get_settings': {
        const effort = EffortSchema.safeParse(isRecord(response.applied) ? response.applied.effort : undefined);
        return effort.success ? this.set('effort', effort.data, at) : false;
      }
      case 'get_context_usage': {
        const sample = contextSampleOf(response);
        return sample ? this.set('contextUsage', contextUsageOf(sample), at) : false;
      }
      case 'reload_plugins': {
        if (!Array.isArray(response.plugins)) return false;
        this.reloadWithoutInit = this.initIssues === null;
        return this.set('plugins', { plugins: pluginsOf(response.plugins), ...(this.initIssues ?? { errors: [], warnings: [] }) }, at);
      }
    }
    return false;
  }

  // This launch's last init's plugin errors and warnings, with its time (an earlier launch's reload inherits them).
  get lastInit(): (Pick<ObservedPlugins, 'errors' | 'warnings'> & { at: string }) | null {
    return this.initIssues && this.initAt !== null ? { ...this.initIssues, at: this.initAt } : null;
  }

  // This launch's facts as a file's content; a reload with no init here takes its errors and warnings from `prior`.
  toFacts(appSessionId: AppSessionId, writtenAt: string, source: ObservedFacts['source'], prior: ObservedFacts | null): ObservedFacts {
    const facts: ObservedFacts = { ...emptyObservedFacts(appSessionId, writtenAt, source), ...structuredClone(this.facts), engineSessionId: this.engineSessionId };
    const inherited = prior?.plugins?.value;
    if (this.reloadWithoutInit && facts.plugins && inherited) facts.plugins = { ...facts.plugins, value: { ...facts.plugins.value, errors: inherited.errors, warnings: inherited.warnings } };
    return facts;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The service: recovery by launch, and one recorder per live launch

export interface ObservedFactsServiceDeps {
  store: ObservedFactsStore;
  journalRoot: string; // <userData>/engine-host/journal
  log: (message: string) => void;
  budgetMs?: number;
  clock?: () => number; // recovery's budget clock (tests)
  debounceMs?: number;
  lines?: (file: string, start: number) => AsyncIterable<string>; // a journal file's lines from a byte offset (tests count the opens)
}

// A file's lines from byte `start`. readline's iterator does not forward its input's errors (a journal removed or made
// unreadable after it was listed), so the stream's error ends the lines and is thrown; both are closed however the
// reading ends (a budget cut stops mid-file).
export async function* readJournalLines(file: string, start = 0): AsyncIterable<string> {
  const input = createReadStream(file, { encoding: 'utf8', start });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let failure: Error | null = null;
  input.once('error', (error) => {
    failure = error;
    lines.close();
  });
  try {
    for await (const line of lines) yield line;
    if (failure) throw failure;
  } finally {
    lines.close();
    input.destroy();
  }
}

// Where recovery stopped inside a launch its budget cut: the fold so far (its facts and the requests still awaiting
// their answers) and the next byte to read. Host memory only; a host restart reads the launch from its start again.
interface Cursor {
  fold: ObservedFactsFold;
  file: number; // index into the launch's files
  offset: number; // the next byte in that file
}

type Issues = Pick<ObservedPlugins, 'errors' | 'warnings'> & { at: string };
const allKnown = (facts: ObservedFacts) => OBSERVED_FACT_KEYS.every((key) => facts[key] !== null);
const anyKnown = (facts: ObservedFacts) => OBSERVED_FACT_KEYS.some((key) => facts[key] !== null);
const latestBefore = (issues: Issues[], at: string): Issues | null =>
  issues.filter((i) => Date.parse(i.at) < Date.parse(at)).reduce<Issues | null>((best, i) => (best === null || Date.parse(i.at) > Date.parse(best.at) ? i : best), null);

export class ObservedFactsService {
  private readonly cursors = new Map<AppSessionId, Map<string, Cursor>>();
  // launches whose plugins fact is a reload_plugins answer with no init before it in the launch: its errors and warnings
  // are an earlier launch's last init's, filled in once recovery has folded that init
  private readonly awaitingIssues = new Map<AppSessionId, Set<string>>();
  // session.forget's coordination: a recovery commits only under the generation it began in, and none begins while
  // an erase runs; the erase first waits for the recoveries in flight
  private readonly generations = new Map<AppSessionId, number>();
  private readonly forgetting = new Set<AppSessionId>();
  private readonly running = new Map<AppSessionId, Set<Promise<unknown>>>();

  constructor(private readonly deps: ObservedFactsServiceDeps) {}

  // The file, after folding the journal launches it has not folded (except `skip`, the live launch whose recorder
  // writes its own facts), newest first, under the reading budget. A launch the budget cuts is resumed where it stopped
  // at the next read, so recovery always advances; until every launch is folded the answer says `complete: false`. It
  // writes when it folded or learnt anything, and prunes the launch list to the journal's launches and `skip`. No file
  // and no journal (a terminal-only session): null, nothing written. Rejects when a journal cannot be read.
  read(appSessionId: AppSessionId, skip: ReadonlySet<string> = new Set()): Promise<ObservedFactsAnswer | null> {
    assertSafeAppSessionId(appSessionId);
    if (this.forgetting.has(appSessionId)) return Promise.resolve(null);
    const run = this.recover(appSessionId, skip, this.generations.get(appSessionId) ?? 0);
    const running = this.running.get(appSessionId) ?? new Set();
    this.running.set(appSessionId, running);
    running.add(run);
    const done = () => {
      running.delete(run);
      if (running.size === 0 && this.running.get(appSessionId) === running) this.running.delete(appSessionId);
    };
    run.then(done, done);
    return run;
  }

  // The journal's launch ids now, and `also` (a live launch): what the facts file keeps listing.
  currentLaunches(appSessionId: AppSessionId, also: Iterable<string> = []): Set<string> {
    return new Set([...JournalReader.launches(join(this.deps.journalRoot, appSessionId)).map((l) => l.launchId), ...also]);
  }

  private async recover(appSessionId: AppSessionId, skip: ReadonlySet<string>, generation: number): Promise<ObservedFactsAnswer | null> {
    const stored = await this.deps.store.load(appSessionId);
    const journal = JournalReader.launches(join(this.deps.journalRoot, appSessionId));
    const journalIds = new Set(journal.map((l) => l.launchId));
    const cursors = this.cursors.get(appSessionId);
    for (const launchId of [...(cursors?.keys() ?? [])]) if (!journalIds.has(launchId)) cursors!.delete(launchId);
    const keepLaunches = new Set([...journalIds, ...skip]);
    const listed = new Set(stored?.launches ?? []);
    const pending = journal.filter((launch) => !listed.has(launch.launchId) && !skip.has(launch.launchId)).reverse(); // newest first
    const writtenAt = new Date().toISOString();
    if (pending.length === 0) {
      if (!stored) return null;
      if (stored.launches.every((launchId) => keepLaunches.has(launchId))) return { ...stored, complete: true };
      const pruned = await this.commit(appSessionId, generation, emptyObservedFacts(appSessionId, stored.writtenAt, stored.source), keepLaunches);
      return pruned && { ...pruned, complete: true };
    }

    const clock = this.deps.clock ?? Date.now;
    const deadline = clock() + (this.deps.budgetMs ?? OBSERVED_FACTS_BUDGET_MS);
    const expired = () => clock() > deadline;
    const awaiting = this.awaitingIssues.get(appSessionId) ?? new Set<string>();
    this.awaitingIssues.set(appSessionId, awaiting);
    const inits: Issues[] = [];
    let recovered = emptyObservedFacts(appSessionId, writtenAt, 'journal');
    const folded: string[] = [];
    let complete = true;
    // the plugins fact waits for an earlier init's errors and warnings that this pass has not folded yet
    const pluginsUnsettled = () => recovered.plugins !== null && awaiting.has(recovered.plugins.launchId) && latestBefore(inits, recovered.plugins.at) === null;
    for (const [index, launch] of pending.entries()) {
      // every field known from launches newer than the rest: the older ones cannot win a field, so they count as folded
      if (folded.length > 0 && allKnown(recovered) && !pluginsUnsettled()) {
        folded.push(...pending.slice(index).map((l) => l.launchId));
        break;
      }
      if (index > 0 && expired()) {
        complete = false;
        break;
      }
      const { fold, done } = await this.foldLaunch(appSessionId, launch, expired);
      if (fold.reloadWithoutInit) awaiting.add(launch.launchId);
      else awaiting.delete(launch.launchId);
      if (fold.lastInit) inits.push(fold.lastInit);
      recovered = mergeObservedFacts(fold.toFacts(appSessionId, writtenAt, 'journal', null), recovered);
      if (!done) {
        complete = false;
        break;
      }
      folded.push(launch.launchId);
    }
    // A reload with no init before it in its launch: the errors and warnings of the latest init before it, from this
    // pass's folds or from the file, set on whichever plugins fact is now current (the loaded list itself is kept)
    let learnt = anyKnown(recovered);
    const current = recovered.plugins && (!stored?.plugins || Date.parse(recovered.plugins.at) >= Date.parse(stored.plugins.at)) ? recovered.plugins : (stored?.plugins ?? null);
    if (current && awaiting.has(current.launchId)) {
      const older = stored?.plugins && stored.plugins !== current && !awaiting.has(stored.plugins.launchId) ? [{ ...stored.plugins.value, at: stored.plugins.at }] : [];
      const source = latestBefore([...inits, ...older], current.at);
      if (source) {
        recovered = { ...recovered, plugins: { ...current, value: { ...current.value, errors: source.errors, warnings: source.warnings } } };
        awaiting.delete(current.launchId);
        learnt = true;
      }
    }
    if (folded.length === 0 && !learnt) return { ...(stored ?? emptyObservedFacts(appSessionId, writtenAt, 'journal')), complete };
    const merged = await this.commit(appSessionId, generation, { ...recovered, launches: folded, writtenAt, source: 'journal' }, keepLaunches);
    return merged && { ...merged, complete };
  }

  // The write, unless session.forget began since the recovery did (an obsolete recovery never recreates the file). The
  // check and the store's enqueueing happen in one tick, so a forget after it erases what this wrote.
  private commit(appSessionId: AppSessionId, generation: number, facts: ObservedFacts, keepLaunches: ReadonlySet<string>): Promise<ObservedFacts | null> {
    if (this.forgetting.has(appSessionId) || (this.generations.get(appSessionId) ?? 0) !== generation) return Promise.resolve(null);
    return this.deps.store.merge(appSessionId, facts, { keepLaunches });
  }

  // One launch's files from where an earlier cut left them, tolerant of a line a crash cut; `done: false` when the
  // budget ran out inside it (at least one line is read each time, so a read always advances).
  private async foldLaunch(appSessionId: AppSessionId, launch: LaunchFiles, expired: () => boolean): Promise<{ fold: ObservedFactsFold; done: boolean }> {
    const cursors = this.cursors.get(appSessionId) ?? new Map<string, Cursor>();
    this.cursors.set(appSessionId, cursors);
    const cursor = cursors.get(launch.launchId) ?? { fold: new ObservedFactsFold(launch.launchId), file: 0, offset: 0 };
    cursors.delete(launch.launchId);
    const lines = this.deps.lines ?? readJournalLines;
    for (; cursor.file < launch.files.length; cursor.file += 1, cursor.offset = 0) {
      for await (const line of lines(launch.files[cursor.file]!, cursor.offset)) {
        cursor.offset += Buffer.byteLength(line, 'utf8') + 1;
        if (line.length > 0) {
          let row: JournalRow | null = null;
          try {
            row = parseJournalRow(JSON.parse(line));
          } catch {
            // a torn last line, or a row an older build wrote differently: nothing a fact depends on
          }
          if (row) cursor.fold.row(row);
        }
        if (expired()) {
          cursors.set(launch.launchId, cursor);
          return { fold: cursor.fold, done: false };
        }
      }
    }
    return { fold: cursor.fold, done: true };
  }

  // The recorder for one launch; its base (what earlier launches observed) is loaded at once, recovering from the
  // journal when needed, with this launch skipped.
  recorder(opts: { appSessionId: AppSessionId; launchId: string; engineSessionId: () => string | null }): ObservedFactsRecorder {
    return new ObservedFactsRecorder({
      ...opts,
      store: this.deps.store,
      loadBase: () => this.read(opts.appSessionId, new Set([opts.launchId])),
      keepLaunches: () => this.currentLaunches(opts.appSessionId, [opts.launchId]),
      debounceMs: this.deps.debounceMs ?? OBSERVED_FACTS_DEBOUNCE_MS,
      log: this.deps.log,
    });
  }

  // The erase behind delete conversation: no recovery begins while it runs, the ones in flight are waited for and can
  // no longer commit (the generation moved), then `erase` (the state file and the journal) runs before the facts file
  // goes, so nothing is left to recover it from.
  async forget(appSessionId: AppSessionId, erase: () => Promise<void> = async () => {}): Promise<void> {
    assertSafeAppSessionId(appSessionId);
    this.forgetting.add(appSessionId);
    this.generations.set(appSessionId, (this.generations.get(appSessionId) ?? 0) + 1);
    try {
      await Promise.allSettled([...(this.running.get(appSessionId) ?? [])]);
      await erase();
      await this.deps.store.forget(appSessionId);
      this.cursors.delete(appSessionId);
      this.awaitingIssues.delete(appSessionId);
    } finally {
      this.forgetting.delete(appSessionId);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The live recorder

interface RecorderOptions {
  appSessionId: AppSessionId;
  launchId: string;
  engineSessionId: () => string | null;
  store: ObservedFactsStore;
  loadBase: () => Promise<ObservedFactsAnswer | null>;
  keepLaunches: () => ReadonlySet<string>; // what the exit write keeps listing: the journal's launches and this one
  debounceMs: number;
  log: (message: string) => void;
}

// One per EngineSession: fed every row the session journals, it writes the facts this launch observed, trailing-
// debounced and once more at the exit (which also lists the launch as folded, so recovery never re-reads it; a launch
// a crash cut before that is folded from its journal at the next read). Every write waits for the base, so a session
// MAWS ran before this build keeps its journal's facts even when it starts before any read.
export class ObservedFactsRecorder {
  private readonly fold: ObservedFactsFold;
  private base: ObservedFactsAnswer | null = null;
  private baseLoaded: Promise<void>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private ended = false; // the exit's write was issued: the launch is listed as folded from then on
  private baseFailed = false; // the earlier launches could not be read: the answer is not complete

  constructor(private readonly opts: RecorderOptions) {
    this.fold = new ObservedFactsFold(opts.launchId);
    this.baseLoaded = this.loadBase();
  }

  row(row: JournalRow): void {
    try {
      if (!this.fold.row(row)) return;
    } catch (error) {
      this.opts.log(`observed facts: row ${row.seq} not read: ${messageOf(error)}`);
      return;
    }
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush(false);
    }, this.opts.debounceMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  // What `engine.observedFacts` answers while the session has a row: the base merged with this launch's facts. A base
  // the budget cut short is read again first, so recovery continues.
  async answer(): Promise<ObservedFactsAnswer> {
    await this.baseLoaded;
    if ((this.base !== null && !this.base.complete) || this.baseFailed) await (this.baseLoaded = this.loadBase());
    const now = new Date().toISOString();
    const live = this.live(now);
    const facts = this.base ? mergeObservedFacts(this.base, live) : live;
    return { ...facts, complete: this.base ? this.base.complete : !this.baseFailed };
  }

  // Writes what this launch observed since the last write; `final` (the exit) writes even when nothing changed and
  // lists the launch. Never rejects.
  async flush(final: boolean): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty && !final) return;
    this.dirty = false;
    if (final) this.ended = true;
    await this.baseLoaded;
    try {
      await this.opts.store.merge(this.opts.appSessionId, this.live(new Date().toISOString()), final ? { keepLaunches: this.opts.keepLaunches() } : undefined);
    } catch (error) {
      this.opts.log(`observed facts not saved: ${messageOf(error)}`);
    }
  }

  private live(writtenAt: string): ObservedFacts {
    const facts = this.fold.toFacts(this.opts.appSessionId, writtenAt, 'live', this.base);
    return { ...facts, engineSessionId: this.fold.engineSessionId ?? this.opts.engineSessionId(), launches: this.ended ? [this.opts.launchId] : [] };
  }

  private async loadBase(): Promise<void> {
    try {
      this.base = await this.opts.loadBase();
      this.baseFailed = false;
    } catch (error) {
      this.baseFailed = true;
      this.opts.log(`observed facts: the earlier launches could not be read: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
