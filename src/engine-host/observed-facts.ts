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
  lines?: (file: string) => AsyncIterable<string>; // reads a journal file's lines (tests count the files opened)
}

// A file's lines; the stream is closed however the reading ends (a budget cut stops mid-file).
async function* readLines(file: string): AsyncIterable<string> {
  const input = createReadStream(file, { encoding: 'utf8' });
  try {
    yield* createInterface({ input, crlfDelay: Infinity });
  } finally {
    input.destroy();
  }
}

export class ObservedFactsService {
  constructor(private readonly deps: ObservedFactsServiceDeps) {}

  // The file, after folding every journal launch it has not folded (except `skip`, the live launch whose recorder
  // writes its own facts), newest first, under the reading budget. Writes once when it folded anything (an empty fold
  // included, so it is not read again) and answers the merge; launches the budget did not reach stay unlisted and the
  // answer says `complete: false`. No file and no journal (a terminal-only session): null, nothing written.
  async read(appSessionId: AppSessionId, skip: ReadonlySet<string> = new Set()): Promise<ObservedFactsAnswer | null> {
    assertSafeAppSessionId(appSessionId);
    const stored = await this.deps.store.load(appSessionId);
    const journal = JournalReader.launches(join(this.deps.journalRoot, appSessionId));
    const listed = new Set(stored?.launches ?? []);
    const pending = journal.filter((launch) => !listed.has(launch.launchId) && !skip.has(launch.launchId)).reverse(); // newest first
    if (pending.length === 0) return stored && { ...stored, complete: true };

    const clock = this.deps.clock ?? Date.now;
    const deadline = clock() + (this.deps.budgetMs ?? OBSERVED_FACTS_BUDGET_MS);
    const expired = () => clock() > deadline;
    const writtenAt = new Date().toISOString();
    let recovered = emptyObservedFacts(appSessionId, writtenAt, 'journal');
    const folded: string[] = [];
    let complete = true;
    for (const [index, launch] of pending.entries()) {
      // every field known from launches newer than the rest: the older ones cannot win a field, so they count as folded
      if (folded.length > 0 && OBSERVED_FACT_KEYS.every((key) => recovered[key] !== null)) {
        folded.push(...pending.slice(index).map((l) => l.launchId));
        break;
      }
      const fold = await this.foldLaunch(launch, expired);
      if (fold === null) {
        complete = false;
        break;
      }
      recovered = mergeObservedFacts(fold.toFacts(appSessionId, writtenAt, 'journal', stored), recovered);
      folded.push(launch.launchId);
    }
    if (folded.length === 0) return stored && { ...stored, complete };
    recovered = { ...recovered, launches: folded, writtenAt, source: 'journal' };
    const keepLaunches = new Set([...journal.map((l) => l.launchId), ...skip]);
    const merged = await this.deps.store.merge(appSessionId, recovered, { keepLaunches });
    return { ...merged, complete };
  }

  // One launch's files in order, tolerant of a line a crash cut; null when the budget ran out inside it.
  private async foldLaunch(launch: LaunchFiles, expired: () => boolean): Promise<ObservedFactsFold | null> {
    const fold = new ObservedFactsFold(launch.launchId);
    const lines = this.deps.lines ?? readLines;
    for (const file of launch.files) {
      for await (const line of lines(file)) {
        if (expired()) return null;
        if (line.length === 0) continue;
        let row: JournalRow;
        try {
          row = parseJournalRow(JSON.parse(line));
        } catch {
          continue; // a torn last line, or a row an older build wrote differently: nothing a fact depends on
        }
        fold.row(row);
      }
    }
    return fold;
  }

  // The recorder for one launch; its base (what earlier launches observed) is loaded at once, recovering from the
  // journal when needed, with this launch skipped.
  recorder(opts: { appSessionId: AppSessionId; launchId: string; engineSessionId: () => string | null }): ObservedFactsRecorder {
    return new ObservedFactsRecorder({
      ...opts,
      store: this.deps.store,
      loadBase: () => this.read(opts.appSessionId, new Set([opts.launchId])),
      debounceMs: this.deps.debounceMs ?? OBSERVED_FACTS_DEBOUNCE_MS,
      log: this.deps.log,
    });
  }

  forget(appSessionId: AppSessionId): Promise<void> {
    return this.deps.store.forget(appSessionId);
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
    if (this.base !== null && !this.base.complete) await (this.baseLoaded = this.loadBase());
    const now = new Date().toISOString();
    const live = this.live(now);
    const facts = this.base ? mergeObservedFacts(this.base, live) : live;
    return { ...facts, complete: this.base?.complete ?? true };
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
      await this.opts.store.merge(this.opts.appSessionId, this.live(new Date().toISOString()));
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
    } catch (error) {
      this.opts.log(`observed facts: the earlier launches could not be read: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
