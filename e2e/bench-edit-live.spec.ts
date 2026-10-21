// P4-A1's MAWS arm (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2 "The parity bench", §5 P4-A1, X34, X39):
// the parity bench's four edit tasks, each repetition a fresh session in the product app on the installed Claude Code
// (unmodified, D-1) through ClaudeUsage's relay, in the mode the owner's settings give (auto), with the model and effort
// the owner's settings give (no effort tuning, Decision Log 8) unless a measurement-only cell pins Desktop's actual
// setting. Desktop's arm is spikes/p4-parity-bench/desktop-driver.js; one parser times both from the engines' records
// (spikes/p4-parity-bench/parse.py) and one checker judges both edits (check.py). The decision rule and the run plan are
// in spikes/p4-parity-bench/findings.txt.
//
// Per repetition: a working copy of the pristine seed (`artifacts.duplicate`, then the task's title; an earlier copy of
// that title deleted first), its content exported before the turn; a new session (`session.create` in the bench's
// directory, `session.start` with the task's prompt, as the composer's first Send starts one) told the artifact by its
// `maws-artifact:` link, the native handle a MAWS user pastes; the turn waited on through the journal; the content
// exported after; the checker; the session stopped (the transcript complete); a manifest beside the before and after
// copies naming the transcript, the X8 journal, the relay logs, the load before and after and the checker's verdict; the
// parser's row; X34's reading of the journal (readToolCalls, the answered spans and the unanswered calls). A repetition that fails still writes its manifest, so the
// record shows what was excluded and why; a later attempt at the same repetition writes into its own …-a2, …-a3
// directory, so nothing recorded is overwritten.
//
// The scope (MAWS_BENCH_SCOPE):
//   owner   the arm of record: the app's launch names no CLAUDE_CONFIG_DIR, so every session reads the owner's user
//           scope (settings, plugins, hooks, output style) and the engine writes its own records under ~/.claude as any
//           MAWS session does (the session transcripts under projects/, the bench directory's entry in ~/.claude.json).
//           The harness itself writes nothing there. Run only in the record run's hold, with the owner's go.
//   mirror  (the default) a scratch config home holding the owner's settings.json cut to the model, effort, permissions,
//           auto-mode rules and non-secret env (no hooks, plugins, status line or output style), so nothing is written
//           under ~/.claude: the harness proved end to end on the owner's model and effort.
// The seeds: the deck from spikes/p4-parity-bench/seed/maws-deck through the window's deck seam; the document from
// seed/document.md, created once per profile by a Haiku session's one `artifact_create` and checked block by block
// against the seed. Both live in the bench profile (MAWS_BENCH_PROFILE), kept between invocations, so the record run's
// driver seeds once and runs one repetition per invocation.
//
// P4-A3 (docs/doperpowers/plans/2026-10-21-p4-a3-edit-protocol.md): MAWS_BENCH_VARIANT labels the build's lever, so a
// lever's arm is its own cell beside the base build's (parse.py's maws/<variant>, judged with --maws); the manifest
// records it with the running app's build stamp (main's own, `host.status`), a variant refused before it spends when that
// stamp is not its checkout's commit, and the repetition's directory carries it, so two arms share one run directory.
//
// Run on purpose only (it spends; no cap but the receipts are reported):
//   MAWS_LIVE=1 [MAWS_BENCH_TASKS=B1,B3,B5,B7] [MAWS_BENCH_REPS=1] [MAWS_BENCH_REP_FROM=1] [MAWS_BENCH_SCOPE=mirror|owner]
//   [MAWS_BENCH_PIN=<model>:<effort>] [MAWS_BENCH_OUT=<dir>] [MAWS_BENCH_PROFILE=<dir>] [MAWS_BENCH_VARIANT=<label>]
//   pnpm e2e:bench-edit-live
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandName } from '@shared/ipc/schema';
import type { JournalRow } from '@shared/wire/journal';
import { RELAY_URL } from '../src/engine-host/launch';
import { journalCost } from '../test/live/support/live';
import { readToolCalls } from '../test/live/support/tool-time';
import { relaySkipReason } from '../test/support/relay-health';
import { invoke, value } from './support/c7-replay';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { promptsEnded, sessionJournal, writtenPrompts } from './support/live-turns';
import { installedEngine } from './support/p1-live';

test.skip(process.env.MAWS_LIVE !== '1', 'the parity bench runs only under MAWS_LIVE=1');
test.describe.configure({ mode: 'serial', timeout: 1_800_000 });

type Task = 'B1' | 'B3' | 'B5' | 'B7';
const BENCH = join(REPO_ROOT, 'spikes/p4-parity-bench');
const TASKS: Task[] = (process.env.MAWS_BENCH_TASKS ?? 'B1,B3,B5,B7').split(',').map((t) => t.trim() as Task);
for (const task of TASKS) if (!['B1', 'B3', 'B5', 'B7'].includes(task)) throw new Error(`MAWS_BENCH_TASKS names ${task}; the tasks are B1, B3, B5 and B7`);
const REPS = Number(process.env.MAWS_BENCH_REPS ?? '1');
const REP_FROM = Number(process.env.MAWS_BENCH_REP_FROM ?? '1');
const SCOPE = process.env.MAWS_BENCH_SCOPE ?? 'mirror';
if (SCOPE !== 'owner' && SCOPE !== 'mirror') throw new Error(`MAWS_BENCH_SCOPE is owner or mirror, not ${SCOPE}`);
const VARIANT = process.env.MAWS_BENCH_VARIANT || null;
if (VARIANT !== null && !/^[A-Za-z][\w.+-]*$/.test(VARIANT)) throw new Error(`MAWS_BENCH_VARIANT is a label (a letter, then letters, digits or . + - _), not ${VARIANT}`);
const CHECKOUT = (() => {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
})();
let APP_BUILD: { commit: string; builtAt: string; checkout: string | null } | null = null; // the running app's own stamp
const PIN = process.env.MAWS_BENCH_PIN ? (([model, effort]) => ({ model: model!, effort: effort! }))(process.env.MAWS_BENCH_PIN.split(':')) : null;
const OUT = resolve(process.env.MAWS_BENCH_OUT ?? `/tmp/maws-parity-bench/${new Date().toISOString().replace(/[:.]/g, '-')}`);
const PROFILE = resolve(process.env.MAWS_BENCH_PROFILE ?? join(OUT, 'maws-profile'));
const CWD = resolve(process.env.MAWS_BENCH_CWD ?? '/tmp/maws-parity-bench/maws-arm');
const TURN_MS = 600_000;
const CLAUDE_USAGE = join(homedir(), 'Library/Application Support/ClaudeUsage');

// The tasks, verbatim in both apps (tasks.json, which Desktop's driver reads too): `{ref}` is the artifact's native
// handle, here its maws-artifact link. A working copy carries the task's title, the pristine seed another.
const TASKS_FILE = JSON.parse(readFileSync(join(BENCH, 'tasks.json'), 'utf8')) as { titles: Record<'document' | 'presentation', string>; tasks: Record<Task, { kind: 'document' | 'presentation'; text: string }> };
const PROMPTS = TASKS_FILE.tasks;
const PRISTINE = { document: 'Bench seed (pristine): season plan', presentation: 'Bench seed (pristine): workshops deck' } as const;
const LANDING = ['mcp__maws__artifact_edit', 'mcp__maws__artifact_publish'];

interface Bench {
  maws: MawsLaunch;
  page: Page;
  configHome: string;
  engine: { bin: string; version: string };
  projectId: string;
  seeds: { document: string; presentation: string };
}
let bench: Bench | null = null;
const spent: { label: string; usd: number }[] = [];

const ok = async <N extends CommandName>(page: Page, name: N, input: CommandInput<N>) => value(await invoke(page, name, input));
const note = (line: string) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'bench-run.txt'), `${line}\n`, { flag: 'a' });
  console.log(line);
};
const python = (args: string[]) => execFileSync('/usr/bin/python3', ['-I', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
// check.py's verdict, read from its stdout whatever its exit code (it exits 1 on a failed check, a real result); only a
// missing or unparsable verdict is the harness's failure.
function checker(args: string[]): { pass: boolean; detail: string } {
  const run = spawnSync('/usr/bin/python3', ['-I', join(BENCH, 'check.py'), ...args], { encoding: 'utf8' });
  const verdict = (() => {
    try {
      return JSON.parse(run.stdout) as { pass?: unknown; detail?: unknown };
    } catch {
      return null;
    }
  })();
  if (verdict !== null && typeof verdict.pass === 'boolean' && typeof verdict.detail === 'string') return { pass: verdict.pass, detail: verdict.detail };
  throw new Error(`check.py ${args[0]} gave no verdict (exit ${run.status ?? run.signal}): ${(run.stderr || run.error?.message || '').slice(-300)}`);
}
const load = () => loadavg().map((x) => Math.round(x * 100) / 100);

// The owner's settings cut to what decides the model, effort, permissions and route; no hooks, plugins, status line,
// output style or secret-looking env value is copied (the gateway route sets its own token).
const MIRRORED = ['model', 'effortLevel', 'modelSettings', 'permissions', 'autoMode', 'skipAutoPermissionPrompt', 'autoCompactWindow', 'alwaysThinkingEnabled'];
function mirrorConfigHome(): string {
  const home = join(OUT, 'mirror-config');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const owner = JSON.parse(readFileSync(join(homedir(), '.claude/settings.json'), 'utf8')) as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  for (const key of MIRRORED) if (owner[key] !== undefined) settings[key] = owner[key];
  const env = (owner.env ?? {}) as Record<string, string>;
  // A secret's name ends in TOKEN, KEY, SECRET or PASSWORD (CLAUDE_CODE_MAX_CONTEXT_TOKENS is a setting, kept).
  settings.env = Object.fromEntries(Object.entries(env).filter(([key]) => !/(^|_)(TOKEN|KEY|SECRET|PASSWORD)$/i.test(key) && !/PLUGIN_DIRS/i.test(key)));
  writeFileSync(join(home, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  const trusted = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true };
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [CWD]: trusted, [realpathSync(CWD)]: trusted } }, null, 2)}\n`, { mode: 0o600 });
  return home;
}

// The transcript the engine wrote for `sessionId` under the config home.
function transcriptOf(configHome: string, sessionId: string): string | null {
  const projects = join(configHome, 'projects');
  if (!existsSync(projects)) return null;
  for (const dir of readdirSync(projects)) {
    const file = join(projects, dir, `${sessionId}.jsonl`);
    if (existsSync(file)) return file;
  }
  return null;
}

// The relay's logs written since `since` (ms), the parser's join for first byte and route.
const relayLogs = (since: number) =>
  existsSync(CLAUDE_USAGE) ? readdirSync(CLAUDE_USAGE).filter((f) => /^gateway-requests.*\.jsonl$/.test(f)).map((f) => join(CLAUDE_USAGE, f)).filter((f) => statSync(f).mtimeMs >= since - 60_000) : [];

async function exportContent(page: Page, kind: 'document' | 'presentation', artifactId: string, to: string): Promise<string> {
  if (kind === 'document') {
    const { path } = await ok(page, 'artifacts.export', { artifactId, format: 'md', ownFile: true });
    const file = `${to}.md`;
    cpSync(path, file);
    return file;
  }
  const files = await page.evaluate((id) => (window as unknown as { __maws_presentations: { files(id: string): Promise<Record<string, string>> } }).__maws_presentations.files(id), artifactId);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(to, path)), { recursive: true });
    writeFileSync(join(to, path), text);
  }
  return to;
}

// A session's status, or null while the host does not know it yet (a start's launch has not reached the host).
async function statusOf(page: Page, id: string) {
  const result = await invoke(page, 'session.status', { appSessionId: id as AppSessionId });
  return result.ok ? result.value : null;
}

async function waitTurn(page: Page, id: string, label: string): Promise<void> {
  const deadline = Date.now() + TURN_MS;
  let pendingSince: number | null = null;
  for (;;) {
    if (promptsEnded(writtenPrompts(sessionJournal(PROFILE, id)), 0)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    const status = await statusOf(page, id);
    if (status === null) {
      await page.waitForTimeout(500);
      continue;
    }
    if (status.process === 'exited') throw new Error(`the engine exited during ${label}`);
    // A permission the session waits on is a human stop: the timing would include it, so the repetition fails.
    pendingSince = status.pendingRequests > 0 ? (pendingSince ?? Date.now()) : null;
    if (pendingSince !== null && Date.now() - pendingSince > 15_000) throw new Error(`${label} stopped for a human: ${status.pendingRequests} pending request(s)`);
    await page.waitForTimeout(500);
  }
}

// A fresh session in the bench's directory with the arm's model and effort; its id goes to the caller before anything
// can throw past it, so the caller's stop always reaches a session that started.
async function createSession(page: Page, options: { model?: string; effort?: string } = {}): Promise<string> {
  const { appSessionId } = await ok(page, 'session.create', { projectId: bench!.projectId as never, location: { kind: 'directory', path: CWD } });
  if (options.model || options.effort) await ok(page, 'session.intent.patch', { appSessionId, patch: { ...(options.model && { model: options.model }), ...(options.effort && { effort: options.effort as never }) } });
  return appSessionId;
}

// The session started with its first message as the composer's Send starts one, then its launch awaited.
async function startSession(page: Page, id: string, message: string): Promise<void> {
  const appSessionId = id as AppSessionId;
  let outcome = await ok(page, 'session.start', { appSessionId, message: { content: message, display: message }, options: {} });
  if (outcome.status === 'needs_trust') outcome = await ok(page, 'session.start', { appSessionId, message: null, options: { trust: 'accepted' } });
  expect(outcome.status, `the session started (${JSON.stringify(outcome)})`).toBe('starting');
  await expect.poll(async () => (await statusOf(page, id))?.process ?? 'unknown to the host', { timeout: 120_000, message: 'the session launched' }).not.toBe('unknown to the host');
}

// A repetition's records are never overwritten: a later attempt at it goes to …-a2, …-a3, created fresh.
function attemptDir(task: Task, rep: number): { dir: string; attempt: number } {
  for (let attempt = 1; ; attempt++) {
    const arm = VARIANT === null ? 'maws' : `maws-${VARIANT}`;
    const dir = join(OUT, attempt === 1 ? `${arm}-${task}-r${rep}` : `${arm}-${task}-r${rep}-a${attempt}`);
    if (existsSync(join(dir, 'manifest.json'))) continue;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    return { dir, attempt };
  }
}

async function stopSession(page: Page, id: string): Promise<void> {
  await ok(page, 'session.stop', { appSessionId: id as AppSessionId, reason: 'stop' });
  await expect.poll(async () => (await statusOf(page, id))?.process, { timeout: 60_000 }).toBe('exited');
}

const journalPathOf = async (page: Page, id: string) => (await statusOf(page, id))?.journalPath ?? null;
const rowsOf = (path: string): JournalRow[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as JournalRow);
const engineSessionOf = (rows: JournalRow[]) => (rows.find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'spawn')?.frame as { sessionId?: string } | undefined)?.sessionId ?? null;

// The pristine seeds, made once per profile and recorded beside it.
async function seeds(page: Page): Promise<{ document: string; presentation: string }> {
  const record = join(PROFILE, 'bench-seeds.json');
  const live = new Map((await ok(page, 'artifacts.list', {})).artifacts.map((a) => [a.id, a]));
  const kept = existsSync(record) ? (JSON.parse(readFileSync(record, 'utf8')) as { document?: string; presentation?: string }) : {};
  const out = { document: kept.document && live.has(kept.document) ? kept.document : '', presentation: kept.presentation && live.has(kept.presentation) ? kept.presentation : '' };
  if (!out.presentation) {
    const { artifact } = await ok(page, 'artifacts.create', { kind: 'presentation', title: PRISTINE.presentation });
    const dir = join(BENCH, 'seed/maws-deck');
    const files: Record<string, string> = { 'project/deck.json': readFileSync(join(dir, 'project/deck.json'), 'utf8').trim() };
    for (const f of readdirSync(join(dir, 'project/slides'))) files[`project/slides/${f}`] = readFileSync(join(dir, 'project/slides', f), 'utf8').trim();
    await page.evaluate(([id, f]) => (window as unknown as { __maws_presentations: { seed(id: string, files: Record<string, string>): Promise<unknown> } }).__maws_presentations.seed(id, f), [artifact.id, files] as const);
    out.presentation = artifact.id;
    note(`seed: the deck ${artifact.id} from seed/maws-deck (${Object.keys(files).length} files) through the deck seam`);
  }
  if (!out.document) {
    const markdown = readFileSync(join(BENCH, 'seed/document.md'), 'utf8');
    const prompt =
      `Call mcp__maws__artifact_create exactly once with kind "document", title "${PRISTINE.document}" and content set to the markdown between the two marker lines below, copied character for character (the marker lines themselves excluded). Make no other MAWS call and reply DONE.\n` +
      `----- BEGIN -----\n${markdown}----- END -----`;
    const id = await createSession(page, { model: 'haiku' });
    await startSession(page, id, prompt);
    await waitTurn(page, id, 'the document seed');
    const journalPath = await journalPathOf(page, id);
    await stopSession(page, id);
    spent.push({ label: 'seed (Haiku)', usd: journalPath ? journalCost(rowsOf(journalPath)).costUsd : 0 });
    const made = (await ok(page, 'artifacts.list', { filter: { appSessionId: id as AppSessionId, kind: 'document' } })).artifacts.find((a) => a.title === PRISTINE.document);
    expect(made, 'the seed session made the pristine document').toBeDefined();
    const exported = await exportContent(page, 'document', made!.id, join(OUT, 'seed-document'));
    const same = checker(['same', join(BENCH, 'seed/document.md'), exported]);
    note(`seed: the document ${made!.id} by a Haiku session's artifact_create; against seed/document.md: ${same.detail}`);
    expect(same.pass, `the seeded document matches seed/document.md: ${same.detail}`).toBe(true);
    out.document = made!.id;
  }
  writeFileSync(record, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const relay = relaySkipReason(RELAY_URL);
  if (relay !== null) throw new Error(`blocked: relay (${relay})`);
  const engine = installedEngine();
  mkdirSync(CWD, { recursive: true });
  mkdirSync(PROFILE, { recursive: true });
  const configHome = SCOPE === 'owner' ? join(homedir(), '.claude') : mirrorConfigHome();
  note(`==== P4-A1 MAWS arm, ${new Date().toISOString()} on ${hostname()}: scope ${SCOPE} (${SCOPE === 'owner' ? "the owner's ~/.claude, no CLAUDE_CONFIG_DIR" : configHome}), engine ${engine.bin.replace(homedir(), '~')} ${engine.version}, relay ${RELAY_URL}, cwd ${CWD}, profile ${PROFILE}, pin ${PIN ? `${PIN.model}:${PIN.effort} (measurement-only)` : "none (the owner's settings)"}, variant ${VARIANT ?? 'none'} in a checkout at ${CHECKOUT ?? 'an unknown commit'}, tasks ${TASKS.join(',')} x ${REPS} from repetition ${REP_FROM}`);
  const maws = await launchMaws({
    userData: PROFILE,
    ownerConfigHome: SCOPE === 'owner',
    env: { MAWS_E2E_ENGINE_BIN: engine.bin, MAWS_HARNESS: '0', ...(SCOPE === 'mirror' ? { CLAUDE_CONFIG_DIR: configHome } : {}) },
  });
  const { page } = maws;
  // P4-A3: the app measured is this checkout's build, or nothing runs: a variant's cell holds only its own build
  const { mainBuild } = await ok(page, 'host.status', undefined);
  APP_BUILD = { commit: mainBuild.commit, builtAt: mainBuild.builtAt, checkout: CHECKOUT };
  note(`the app: built at ${mainBuild.commit} (${mainBuild.builtAt}), the checkout at ${CHECKOUT ?? 'an unknown commit'}`);
  if (VARIANT !== null && (CHECKOUT === null || !CHECKOUT.startsWith(mainBuild.commit))) throw new Error(`blocked: the app was built at ${mainBuild.commit} and the checkout is at ${CHECKOUT ?? 'an unknown commit'}; build it again (scripts/e2e-build.sh plain) before a variant's repetitions`);
  await expect.poll(async () => (await ok(page, 'engine.hostState', undefined)).state, { timeout: 120_000, message: 'the engine host is ready' }).toBe('ready');
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __maws_presentations?: unknown }).__maws_presentations), { message: 'the deck seam is installed' }).toBe('object');
  const real = realpathSync(CWD);
  const project = (await ok(page, 'session.projects.list', undefined)).projects.find((p) => p.directory === real) ?? (await ok(page, 'session.projects.add', { directory: real }));
  bench = { maws, page, configHome, engine, projectId: project.id, seeds: { document: '', presentation: '' } };
  bench.seeds = await seeds(page);
});

test.afterAll(async () => {
  note(`spend: ${spent.map((s) => `${s.label} US$${s.usd.toFixed(4)}`).join('; ') || 'none'}; total US$${spent.reduce((sum, s) => sum + s.usd, 0).toFixed(4)}`);
  await bench?.maws.cleanup();
});

for (let rep = REP_FROM; rep < REP_FROM + REPS; rep++) {
  for (const task of TASKS) {
    test(`${task} repetition ${rep}`, async () => {
      const { page } = bench!;
      const { kind, text } = PROMPTS[task];
      const { dir, attempt } = attemptDir(task, rep);
      const title = TASKS_FILE.titles[kind];
      for (const old of (await ok(page, 'artifacts.list', { filter: { kind } })).artifacts.filter((a) => a.title === title)) await ok(page, 'artifacts.delete', { artifactId: old.id });
      const { artifact: work } = await ok(page, 'artifacts.duplicate', { artifactId: bench!.seeds[kind] });
      await ok(page, 'artifacts.update', { artifactId: work.id, title });
      const before = await exportContent(page, kind, work.id, join(dir, 'before'));
      const prompt = text.replace('{ref}', `[${title}](maws-artifact:${work.id})`);

      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const loadBefore = load();
      let id = '';
      let failure: unknown = null;
      let check: { pass: boolean; detail: string };
      let journalPath: string | null = null;
      try {
        id = await createSession(page, PIN ?? {});
        await startSession(page, id, prompt);
        journalPath = await journalPathOf(page, id);
        await waitTurn(page, id, `${task} repetition ${rep}`);
        const after = await exportContent(page, kind, work.id, join(dir, 'after'));
        check = checker([task, before, after]);
      } catch (error) {
        failure = error;
        check = { pass: false, detail: `the run failed: ${error instanceof Error ? error.message : String(error)}` };
      } finally {
        if (id) await stopSession(page, id).catch((error) => (failure ??= error));
      }
      const loadAfter = load();
      const rows = journalPath && existsSync(journalPath) ? rowsOf(journalPath) : [];
      const sessionId = engineSessionOf(rows);
      const transcript = sessionId ? transcriptOf(bench!.configHome, sessionId) : null;
      // P4-A2 (X34, at the landing): the reader answers the spans and the unanswered calls apart; the record keeps every
      // call in journal order, an unanswered one (the engine withdrew it; MAWS answers nothing) with no time
      const calls = journalPath && existsSync(journalPath) ? readToolCalls(journalPath) : { spans: [], unanswered: [] };
      const spans = [...calls.spans.map(({ name, ms, toolUseId, requestSeq }) => ({ name, ms: ms as number | null, toolUseId, requestSeq })), ...calls.unanswered.map(({ name, toolUseId, requestSeq }) => ({ name, ms: null, toolUseId, requestSeq }))].sort((a, b) => a.requestSeq - b.requestSeq);
      const cost = journalCost(rows).costUsd;
      spent.push({ label: `${task} r${rep}`, usd: cost });
      const manifest = {
        arm: 'maws', task, rep, attempt, surface: 'maws', kind, host: hostname(), scope: SCOPE, startedAt, prompt, promptMatch: text.slice(text.indexOf('{ref}') + '{ref}'.length), artifactId: work.id,
        transcript, journal: journalPath, relay: relayLogs(startedMs), landing: LANDING, sessionId, appSessionId: id,
        load: { before: loadBefore, after: loadAfter }, check, pin: PIN, measurementOnly: PIN !== null, variant: VARIANT, build: APP_BUILD,
        engine: { bin: bench!.engine.bin, version: bench!.engine.version }, costUsd: cost,
        mawsToolSpans: spans.map(({ name, ms, toolUseId }) => ({ name, ms, toolUseId })),
      };
      const manifestPath = join(dir, 'manifest.json');
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      type Measured = { sendToEditLanded: number | null; sendToFirstToken: number; sendToTurnEnd: number; requests: number; outputTokens: number; efforts: string[]; models: string[]; cache: { state: string } };
      let m: Measured | null = null;
      if (transcript) {
        const parsed = python([join(BENCH, 'parse.py'), 'edit', manifestPath]);
        writeFileSync(join(dir, 'measured.json'), parsed);
        m = (JSON.parse(parsed) as { measured: Measured | null }).measured;
      }
      const artifactSpans = spans.filter((s) => s.name.startsWith('artifact_'));
      note(
        `${VARIANT ? `${VARIANT} ` : ''}${task} r${rep}${attempt > 1 ? ` attempt ${attempt}` : ''}: ${check.pass ? 'PASS' : 'FAIL'} (${check.detail}); landed ${m?.sendToEditLanded ?? '-'} s, first token ${m?.sendToFirstToken ?? '-'} s, turn end ${m?.sendToTurnEnd ?? '-'} s, ` +
          `${m?.requests ?? '-'} requests, ${m?.outputTokens ?? '-'} output tokens, ${JSON.stringify(m?.models ?? [])} ${JSON.stringify(m?.efforts ?? [])}, cache ${m?.cache?.state ?? '-'}; ` +
          `MAWS tool time ${artifactSpans.map((s) => `${s.name} ${s.ms ?? 'unanswered'} ms`).join(', ') || 'none'}; load ${loadBefore[0]} -> ${loadAfter[0]}; US$${cost.toFixed(4)}; ${manifestPath}`,
      );
      if (failure !== null) throw failure;
      expect(transcript, 'the engine wrote the session transcript').not.toBeNull();
      expect(m?.sendToEditLanded, 'an edit call landed').toBeGreaterThan(0);
      expect(check.pass, check.detail).toBe(true);
    });
  }
}
