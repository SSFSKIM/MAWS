// X17 in the engine host (P2-A §5.5, M2's tests): the per-launch fold of journal rows, the live recorder (per-field
// merge, the previous launch's facts kept across a launch that observed nothing, subagent inits ignored, its base the
// recovered snapshot) and recovery by launch (each exported fixture's fields, a launch folded once never re-read, an
// older build's launch caught up, a reading budget that answers `complete: false` and continues at the next read).
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyObservedFacts, type ObservedFacts } from '@shared/engine/observed-facts';
import type { AppSessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { ObservedFactsFold, ObservedFactsService, type ObservedFactsServiceDeps } from './observed-facts';
import { MemoryObservedFactsStore } from './store/observed-facts-store';

const FIXTURES = resolve(__dirname, '../../spikes/protocol-probe/fixtures/pass3');
const ID = 'app-facts' as AppSessionId;
const BUILTINS = ['cc-plugin-agents-md', 'cc-plugin-telemetry', 'cc-plugin-plugin-authoring'];

let root: string;
let store: MemoryObservedFactsStore;
let opened: string[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'maws-facts-'));
  store = new MemoryObservedFactsStore();
  opened = [];
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

const dir = (id: AppSessionId = ID) => join(root, id);
const service = (over: Partial<ObservedFactsServiceDeps> = {}) =>
  new ObservedFactsService({
    store,
    journalRoot: root,
    log: () => {},
    lines: (file) => {
      opened.push(file);
      return createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    },
    ...over,
  });
// A fixture as the journal of one launch of ID.
async function journal(launchId: string, fixture: string): Promise<void> {
  await mkdir(dir(), { recursive: true });
  await copyFile(join(FIXTURES, `${fixture}.jsonl`), join(dir(), `${launchId}.jsonl`));
}
async function journalRows(launchId: string, rows: Omit<JournalRow, 'seq'>[]): Promise<void> {
  await mkdir(dir(), { recursive: true });
  await writeFile(join(dir(), `${launchId}.jsonl`), rows.map((r, i) => JSON.stringify({ seq: i + 1, ...r })).join('\n') + '\n');
}

const at = (s: number) => new Date(Date.UTC(2026, 9, 9, 10, 0, s)).toISOString();
const spawn = (s: number): Omit<JournalRow, 'seq'> => ({ direction: 'meta', at: at(s), frame: { event: 'spawn' } });
const init = (s: number, over: Record<string, unknown> = {}): Omit<JournalRow, 'seq'> => ({
  direction: 'in', at: at(s),
  frame: { type: 'system', subtype: 'init', model: 'claude-haiku-4-5', claude_code_version: '2.1.295', permissionMode: 'default', output_style: 'default', session_id: 'eng-1', plugins: [{ name: 'p1', path: '/p1', source: 'p1@m', version: '1' }], plugin_errors: [{ plugin: 'bad', type: 'load', message: 'no manifest' }], ...over },
});
const request = (s: number, id: string, subtype: string): Omit<JournalRow, 'seq'> => ({ direction: 'out', at: at(s), frame: { type: 'control_request', request_id: id, request: { subtype } } });
const answer = (s: number, id: string, response: unknown): Omit<JournalRow, 'seq'> => ({ direction: 'in', at: at(s), frame: { type: 'control_response', response: { subtype: 'success', request_id: id, response } } });

describe('recovery from the exported fixtures yields the fields the journal holds and nulls for the rest', () => {
  it('e8-plugins-reload: the last init (after the reloads) and its model, version, mode and style; no context, no effort', async () => {
    await journal('LE8', 'e8-plugins-reload');
    const facts = (await service().read(ID))!;
    expect(facts.complete).toBe(true);
    expect(facts.plugins?.value.plugins.map((p) => p.name)).toEqual(BUILTINS);
    expect(facts.plugins?.at).toBe('2026-10-06T02:52:10.949Z'); // seq 76, the init after the reload at seq 64
    expect(facts.model).toEqual({ value: 'claude-haiku-4-5-20251001', at: '2026-10-06T02:52:10.949Z', launchId: 'LE8' });
    expect(facts.engineVersion?.value).toBe('2.1.290');
    expect(facts.mode?.value).toBe('default');
    expect(facts.outputStyle?.value).toBe('default');
    expect(facts.engineSessionId).toBe('697523b2-fa91-45d7-88ae-9e1f7dc112be');
    expect(facts.contextUsage).toBeNull();
    expect(facts.effort).toBeNull();
    expect(facts.launches).toEqual(['LE8']);
    expect(facts.source).toBe('journal');
    const { complete: _complete, ...file } = facts;
    expect(await store.load(ID)).toEqual(file); // what was answered is what was written, less the wire's `complete`
  });

  it('context-sample: the last get_context_usage answer, mapped as the digest maps it', async () => {
    await journal('LCX', 'context-sample');
    const facts = (await service().read(ID))!;
    expect(facts.contextUsage?.at).toBe('2026-09-29T19:00:55.087Z'); // seq 148
    expect(facts.contextUsage?.value).toMatchObject({ maxTokens: 200_000, autoCompactThreshold: 167_000 });
    expect(facts.contextUsage?.value.totalTokens).toBeGreaterThan(0);
    expect(facts.engineVersion?.value).toBe('2.1.283');
    expect(facts.plugins?.value.plugins.map((p) => p.name)).toEqual(['agents-md', 'telemetry', 'plugin-authoring']);
  });

  it('p2-no-prompt-resume-1 (U1): no init, so no model and no version; the mode and style from initialize, the plugins from reload_plugins, the context before any turn', async () => {
    await journal('LU1', 'p2-no-prompt-resume-1');
    const facts = (await service().read(ID))!;
    expect(facts.model).toBeNull();
    expect(facts.engineVersion).toBeNull();
    expect(facts.mode).toEqual({ value: 'default', at: '2026-10-09T07:01:51.876Z', launchId: 'LU1' }); // seq 9, initialize's answer
    expect(facts.outputStyle?.value).toBe('default');
    expect(facts.plugins).toEqual({ value: { plugins: BUILTINS.map((name) => ({ name, path: 'builtin', source: `${name}@builtin`, version: null })), errors: [], warnings: [] }, at: '2026-10-09T07:02:37.012Z', launchId: 'LU1' });
    // the answer's 19,058 corrected as the normaliser corrects its sample (debt wave 4's contextTotal): one mapping
    expect(facts.contextUsage).toEqual({ value: { percent: 2, totalTokens: 18_194, maxTokens: 1_000_000, autoCompactThreshold: 967_000 }, at: '2026-10-09T07:02:37.048Z', launchId: 'LU1' });
  });

  it('p1-side-thread-live-resume: the resumed launch’s init', async () => {
    await journal('LST', 'p1-side-thread-live-resume');
    const facts = (await service().read(ID))!;
    expect(facts.engineVersion?.value).toBe('2.1.291');
    expect(facts.plugins?.value.plugins).toHaveLength(3);
    expect(facts.contextUsage).toBeNull();
  });

  it('several launches merge per field: the newest launch’s facts win, an older launch fills what the newer did not see', async () => {
    await journal('LST', 'p1-side-thread-live-resume'); // 2026-10-06, an init
    await journal('LU1', 'p2-no-prompt-resume-1'); // 2026-10-09, no init
    const facts = (await service().read(ID))!;
    expect(facts.engineVersion).toMatchObject({ value: '2.1.291', launchId: 'LST' });
    expect(facts.plugins?.launchId).toBe('LU1');
    expect(facts.launches.sort()).toEqual(['LST', 'LU1']);
  });
});

describe('recovery runs once per launch', () => {
  it('a launch folded once is never re-read: the second read opens no journal file', async () => {
    await journal('LE8', 'e8-plugins-reload');
    const first = await service().read(ID);
    expect(opened).toHaveLength(1);
    const second = await service().read(ID);
    expect(opened).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('no file and no journal (a terminal-only session) answers null and writes nothing', async () => {
    expect(await service().read(ID)).toBeNull();
    expect(store.files.size).toBe(0);
  });

  it('a journal whose launches hold no facts is written once, empty, so it is not read again', async () => {
    await journalRows('L0', [spawn(0), { direction: 'meta', at: at(1), frame: { event: 'exit' } }]);
    const facts = (await service().read(ID))!;
    expect(facts).toMatchObject({ launches: ['L0'], model: null, plugins: null, complete: true });
    await service().read(ID);
    expect(opened).toHaveLength(1);
  });

  it('a launch an older build journalled after the file’s last write is folded at the next read, and its newer facts win per field', async () => {
    await journalRows('L1', [spawn(0), init(1)]);
    await service().read(ID);
    await journalRows('L2', [spawn(10), init(11, { model: 'claude-sonnet-5', plugins: [] })]);
    const facts = (await service().read(ID))!;
    expect(facts.model).toEqual({ value: 'claude-sonnet-5', at: at(11), launchId: 'L2' });
    expect(facts.plugins?.value.plugins).toEqual([]); // a confirmed empty list is a fact
    expect(facts.launches.sort()).toEqual(['L1', 'L2']);
    expect(opened.map((f) => f.endsWith('L2.jsonl'))).toEqual([false, true]);
  });

  it('a recovery cut by its budget answers what it folded with complete: false, and the next read continues', async () => {
    await journalRows('L1', [spawn(0), init(1, { model: 'm-old' })]);
    await journalRows('L2', [spawn(10), init(11, { model: 'm-new', output_style: 'Explanatory' }), { direction: 'in', at: at(12), frame: { type: 'system', subtype: 'status', permissionMode: 'plan' } }]);
    let ticks = 0;
    const cut = service({ budgetMs: 4, clock: () => ticks++ }); // the newest launch fits, the older one does not
    const partial = (await cut.read(ID))!;
    expect(partial.complete).toBe(false);
    expect(partial.model?.value).toBe('m-new');
    expect(partial.launches).toEqual(['L2']);
    const rest = (await service().read(ID))!;
    expect(rest.complete).toBe(true);
    expect(rest.launches.sort()).toEqual(['L1', 'L2']);
    expect(rest.model?.value).toBe('m-new'); // the older launch's fact is older
    expect(rest.mode?.value).toBe('plan');
  });

  it('stops reading older launches once every field is known from newer ones, and lists them as folded', async () => {
    const full = (s: number, launch: string) => [
      spawn(s), init(s + 1, { model: `m-${launch}` }),
      request(s + 2, `${launch}-1`, 'get_settings'), answer(s + 3, `${launch}-1`, { effective: {}, sources: [], applied: { effort: 'high' } }),
      request(s + 4, `${launch}-2`, 'get_context_usage'),
      answer(s + 5, `${launch}-2`, { categories: [], totalTokens: 10, maxTokens: 100, percentage: 10, autoCompactThreshold: 80, isAutoCompactEnabled: true, model: 'm', gridRows: [], memoryFiles: [], mcpTools: [] }),
    ];
    await journalRows('L1', full(0, 'L1'));
    await journalRows('L2', full(20, 'L2'));
    const facts = (await service().read(ID))!;
    expect(facts.effort?.value).toBe('high');
    expect(facts.contextUsage?.launchId).toBe('L2');
    expect(facts.launches.sort()).toEqual(['L1', 'L2']);
    expect(opened.filter((f) => f.endsWith('L1.jsonl'))).toEqual([]);
  });

  it('reads a journal whose last line was cut by a crash', async () => {
    await journalRows('L1', [spawn(0), init(1)]);
    await appendFile(join(dir(), 'L1.jsonl'), '{"seq":3,"direction":"in","at":"2026-10-09T10:00:02.000Z","frame":{"type":"sys');
    expect((await service().read(ID))?.model?.value).toBe('claude-haiku-4-5');
  });

  it('reads a launch’s rotations after its base file', async () => {
    await journalRows('L1', [spawn(0), init(1)]);
    await mkdir(dir(), { recursive: true });
    await writeFile(join(dir(), 'L1.1.jsonl'), JSON.stringify({ seq: 3, direction: 'in', at: at(5), frame: { type: 'system', subtype: 'status', permissionMode: 'acceptEdits' } }) + '\n');
    expect((await service().read(ID))?.mode).toEqual({ value: 'acceptEdits', at: at(5), launchId: 'L1' });
  });
});

describe('the fold', () => {
  it('ignores a subagent’s init: its model, plugins and mode are not the session’s', () => {
    const fold = new ObservedFactsFold('L1');
    fold.row({ seq: 1, ...init(1) });
    fold.row({ seq: 2, ...init(2, { parent_tool_use_id: 'toolu_1', model: 'claude-sub', plugins: [], permissionMode: 'plan' }) });
    expect(fold.facts.model?.value).toBe('claude-haiku-4-5');
    expect(fold.facts.plugins?.value.plugins).toHaveLength(1);
    expect(fold.facts.mode?.value).toBe('default');
  });

  it('matches an answer to its request by id (the answer names no subtype), and ignores error answers', () => {
    const fold = new ObservedFactsFold('L1');
    fold.row({ seq: 1, ...request(1, 'r1', 'set_permission_mode') });
    fold.row({ seq: 2, ...answer(2, 'r1', { mode: 'acceptEdits' }) });
    fold.row({ seq: 3, ...request(3, 'r2', 'reload_plugins') });
    fold.row({ seq: 4, direction: 'in', at: at(4), frame: { type: 'control_response', response: { subtype: 'error', request_id: 'r2', error: 'nope' } } });
    fold.row({ seq: 5, ...answer(5, 'r9', { plugins: [] }) }); // no request of ours
    expect(fold.facts.mode?.value).toBe('acceptEdits');
    expect(fold.facts.plugins).toBeNull();
  });

  it('a reload keeps this launch’s init errors and warnings; with no init in the launch it says so, for the caller to inherit', () => {
    const fold = new ObservedFactsFold('L1');
    fold.row({ seq: 1, ...request(1, 'r1', 'reload_plugins') });
    fold.row({ seq: 2, ...answer(2, 'r1', { commands: [], agents: [], plugins: [{ name: 'p2', path: '/p2', source: null }], error_count: 0 }) });
    expect(fold.reloadWithoutInit).toBe(true);
    fold.row({ seq: 3, ...init(3) });
    fold.row({ seq: 4, ...request(4, 'r2', 'reload_plugins') });
    fold.row({ seq: 5, ...answer(5, 'r2', { commands: [], agents: [], plugins: [{ name: 'p3', path: '/p3' }], error_count: 1 }) });
    expect(fold.reloadWithoutInit).toBe(false);
    expect(fold.facts.plugins?.value).toEqual({ plugins: [{ name: 'p3', path: '/p3', source: null, version: null }], errors: [{ plugin: 'bad', type: 'load', message: 'no manifest', path: null }], warnings: [] });
  });
});

describe('the live recorder', () => {
  const facts = (over: Partial<ObservedFacts>): ObservedFacts => ({ ...emptyObservedFacts(ID, at(0), 'live'), ...over });

  it('writes this launch’s facts trailing-debounced, merged per field into the file, and lists the launch at the exit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const host = service({ debounceMs: 500 });
    const recorder = host.recorder({ appSessionId: ID, launchId: 'L1', engineSessionId: () => 'eng-1' });
    recorder.row({ seq: 1, ...init(1) });
    recorder.row({ seq: 2, direction: 'in', at: at(2), frame: { type: 'system', subtype: 'status', permissionMode: 'plan' } });
    await vi.advanceTimersByTimeAsync(499);
    expect(store.files.size).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(store.files.get(ID)?.mode?.value).toBe('plan'));
    expect(store.files.get(ID)).toMatchObject({ source: 'live', engineSessionId: 'eng-1', launches: [] });
    await recorder.flush(true);
    expect(store.files.get(ID)?.launches).toEqual(['L1']);
  });

  it('keeps the previous launch’s plugins across a launch with no init (a no-prompt start), and adds what it saw', async () => {
    await store.merge(ID, facts({ launches: ['L1'], plugins: { value: { plugins: [{ name: 'p1', path: '/p1', source: null, version: null }], errors: [], warnings: [] }, at: at(1), launchId: 'L1' } }));
    const recorder = service().recorder({ appSessionId: ID, launchId: 'L2', engineSessionId: () => null });
    recorder.row({ seq: 1, ...request(10, 'i1', 'initialize') });
    recorder.row({ seq: 2, ...answer(11, 'i1', { current_permission_mode: 'acceptEdits', output_style: 'default', commands: [] }) });
    await recorder.flush(true);
    const file = store.files.get(ID)!;
    expect(file.plugins?.launchId).toBe('L1');
    expect(file.mode).toEqual({ value: 'acceptEdits', at: at(11), launchId: 'L2' });
    expect(file.launches.sort()).toEqual(['L1', 'L2']);
    expect((await recorder.answer()).plugins?.launchId).toBe('L1');
  });

  it('a session started before its first read keeps its journal’s facts: the recorder’s base is the recovered snapshot', async () => {
    await journalRows('L1', [spawn(0), init(1)]); // a launch an earlier build ran
    const host = service();
    await journalRows('L2', [spawn(10)]); // the live launch's own journal, being written
    const recorder = host.recorder({ appSessionId: ID, launchId: 'L2', engineSessionId: () => null });
    const live = await recorder.answer();
    expect(live.model?.launchId).toBe('L1');
    expect(live.complete).toBe(true);
    expect(store.files.get(ID)?.launches).toEqual(['L1']); // the live launch is not folded from its journal
    expect(opened.some((f) => f.endsWith('L2.jsonl'))).toBe(false);
    await recorder.flush(true);
    expect(store.files.get(ID)?.model?.launchId).toBe('L1');
  });

  it('a reload with no init in this launch keeps the previous launch’s plugin errors and warnings', async () => {
    const errors = [{ plugin: 'bad', type: 'load', message: 'no manifest', path: null }];
    await store.merge(ID, facts({ launches: ['L1'], plugins: { value: { plugins: [], errors, warnings: [] }, at: at(1), launchId: 'L1' } }));
    const recorder = service().recorder({ appSessionId: ID, launchId: 'L2', engineSessionId: () => null });
    recorder.row({ seq: 1, ...request(10, 'r1', 'reload_plugins') });
    recorder.row({ seq: 2, ...answer(11, 'r1', { commands: [], agents: [], plugins: [{ name: 'p2', path: '/p2' }], error_count: 1 }) });
    const live = await recorder.answer();
    expect(live.plugins?.value).toEqual({ plugins: [{ name: 'p2', path: '/p2', source: null, version: null }], errors, warnings: [] });
    await recorder.flush(true);
    expect(store.files.get(ID)?.plugins?.value.errors).toEqual(errors);
  });

  it('a row it cannot read never throws into the session', () => {
    const recorder = service().recorder({ appSessionId: ID, launchId: 'L1', engineSessionId: () => null });
    expect(() => recorder.row({ seq: 1, direction: 'in', at: at(1), frame: null })).not.toThrow();
  });
});

describe('the file on disk', () => {
  it('survives the service being rebuilt (a host restart) and is read without the journal', async () => {
    const { FileObservedFactsStore } = await import('./store/observed-facts-store');
    const fileStore = new FileObservedFactsStore(root);
    await journalRows('L1', [spawn(0), init(1)]);
    await service({ store: fileStore }).read(ID);
    await rm(dir(), { recursive: true, force: true }); // the journal gone (archive keeps the facts file)
    const again = await service({ store: new FileObservedFactsStore(root) }).read(ID);
    expect(again?.model?.value).toBe('claude-haiku-4-5');
    expect(JSON.parse(await readFile(join(root, 'engine-host', 'state', `${ID}.observed.json`), 'utf8'))).not.toHaveProperty('complete');
  });
});
