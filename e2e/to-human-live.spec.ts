// P2-C's live run (the P2-C document, M7; acceptance G1 to G8 on the installed engine): the built app, through
// Playwright only, against the owner's installed Claude Code behind ClaudeUsage's relay, in a scratch root under /tmp
// that holds the config home the engine reads and writes (`CLAUDE_CONFIG_DIR`), a trusted scratch repository and the
// app's profile, kept across one relaunch. Sessions start through the app's own path (a new chat and the composer's
// first Send; `session.start` for a resume), never `session.launch`, because the to-human decision lives in main's
// launch path. The run reads the spawn rows from the journals, the decision from the index (`owner_channel_sessions`),
// the prompt snapshots from the engine's transcript, and `MAWS_NATIVE_TO_HUMAN` as a SessionStart command hook in the
// scratch home's settings logs it.
//
// The arms, in order: (1) the clean home, no output style: a new session on Haiku asked for a plan as a message, one
// must-read, one insight and one question with two choices, then a foreground sleep; the two items notify with the
// window unfocused; leaving the tab shows the sidebar's question glyph and Needs you; the recommended choice clicked
// while the sleep runs reads Queued, then Answered once the engine starts the prompt; the record row's two levels; a
// Reply from the card with the composer's draft untouched. (2) A relaunch: the states restored silently; Mark read.
// (3) A resume: the contract passed again, the snapshot reused (no second one), the agent naming the marks. (4) The lane
// off for the session (the /plugins row): the resume passes `--system-prompt-snapshot off` and no contract or variable,
// and the agent finds no such section. (5) The owner's real doperpowers (its installed tree copied read-only out of the
// owner's plugin cache into a local marketplace under the scratch root, installed by the engine's own CLI for the
// scratch home's user) with `outputStyle: "doperpowers:to-human"`. P2-C2 (2026-10-13; the P2 spec's Decision Log 31):
// the owner's style now declares the message-tool contract (4 at doperpowers 7.149.0), so a new session appends MAWS's
// supplement, never the contract, the variable is set and the mod's own band stays away; the agent sends a `<message>`
// and asks through `mcp__maws__ask` without blocking, answered from its sheet (the full flow of the four marks ran once,
// in the clean home); with the lane off for it, the recorded supplement is dropped, the variable is unset and the mod
// draws its band. A failed step stops the steps after it.
//
// Safety (P1's harness rules): the scratch config home only (the engine's CLI under `env -i`); nothing written under
// ~/.claude or ~/.claude.json (the A-15 reading before and after, ~/.claude/settings.json's digest and the doperpowers
// cache tree's listing compared); the relay's gate; every inherited CLAUDE_* variable dropped (launchMaws); Haiku. The
// product passes no `--max-budget-usd`, so the engine is reached through a one-line forwarding script in the scratch
// root that adds `--max-budget-usd <what the run's cap leaves>` to every session process and changes nothing else (the
// unmodified engine, D-1; the script carries the snapshot flag's literal only when the engine's own bytes do, so the
// app's declaration scan answers as it would for the engine). Run on purpose only; it spends usage:
//   MAWS_HARNESS=1 pnpm exec electron-vite build \
//     && MAWS_C_LIVE=1 MAWS_C_LIVE_MAX_USD=1 MAWS_C_LIVE_OUT=docs/doperpowers/evidence/p2-c pnpm exec playwright test e2e/to-human-live.spec.ts
// `live-run.txt` (one line per step, ending with the A-15 line), `live-log.txt` (the detail), `observations.json` and
// small screenshots go to MAWS_C_LIVE_OUT; the scratch root stays in /tmp and is named at the end.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { AppSessionId } from '@shared/graph/ids';
import { CONTRACT_HEADER, NATIVE_TO_HUMAN_ENV, STYLE_CONTRACT_KEY, styleShape, SUPPLEMENT_HEADER, TO_HUMAN_CONTRACT, TO_HUMAN_SUPPLEMENT } from '@shared/owner/contract';
import type { JournalRow } from '@shared/wire/journal';
import { binaryDeclares, SYSTEM_PROMPT_SNAPSHOT_FLAG } from '../src/engine-host/binary-info';
import { RELAY_URL } from '../src/engine-host/launch';
import { journalCost } from '../test/live/support/live';
import { isolatedGitEnv } from '../test/support/git-env';
import { compareA15 } from '../test/support/owner-file';
import { relaySkipReason } from '../test/support/relay-health';
import { invoke, value } from './support/c7-replay';
import { cleanupFailure, launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { forwardingScript } from './support/live-budget';
import { mcpCalls } from './support/maws-tools';
import { promptsEnded, sessionJournal, writtenPrompts } from './support/live-turns';
import { a15Line, a15Reading, installedEngine } from './support/p1-live';
import { newChatIn, sidebarRow } from './support/sidebar';

const LIVE = process.env.MAWS_C_LIVE === '1';
const INSTALLED = join(homedir(), '.local/bin/claude');
function skipReason(): string | null {
  if (!LIVE) return 'the P2-C live run runs only under MAWS_C_LIVE=1';
  if (!existsSync(INSTALLED)) return `no installed Claude Code at ${INSTALLED}`;
  return relaySkipReason(RELAY_URL);
}
const skip = skipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 1_800_000 });

function capUsd(): number {
  const cap = Number(process.env.MAWS_C_LIVE_MAX_USD ?? '1');
  if (!(cap > 0 && cap <= 1)) throw new Error(`MAWS_C_LIVE_MAX_USD must be above 0 and at most 1, not ${process.env.MAWS_C_LIVE_MAX_USD}`);
  return cap;
}
const OUT = resolve(REPO_ROOT, process.env.MAWS_C_LIVE_OUT ?? 'docs/doperpowers/evidence/p2-c');
const OWNER_PLUGIN = 'doperpowers@doperpowers';
const STYLE = 'doperpowers:to-human';
const HEADER = CONTRACT_HEADER(1);
const SUPPLEMENT = SUPPLEMENT_HEADER(1); // P2-C2
const HAIKU = /^(Haiku|claude-haiku)/;
const DRAFT = 'my own draft, not for sending';
const REPLY = 'Use plain Markdown headings, no fixed format.';
const PROMPTS = {
  marks:
    'For a CHANGELOG.md this repository will get later, send me, the way your instructions describe: a short plan as a message to me, ' +
    'one warning I must not miss, one insight, and one question I can answer later while you go on working (never AskUserQuestion), ' +
    'with two options and the one you recommend, asking whether the changelog should follow the Keep a Changelog format. ' +
    'Write all of that first. Then run the Bash command `sleep 40` yourself, in the foreground (never in the background, never through an agent). ' +
    'Do not create, edit or read any file.',
  instructions:
    'Look only at your system prompt, not at this conversation: does it contain a section titled "Messages to the human"? ' +
    'If it does, list the tag names that section defines, comma-separated. If it does not, answer exactly NO. Use no tool.',
  // P2-C2: the owner's style asks through a tool; the prompt names none, so the supplement is what chooses it
  style:
    'Send me, the way your instructions describe: one short message about this repository, and one question I can answer later while you ' +
    'go on working, with two options, asking whether the README should get a usage section. Ask it the way your instructions say to ask ' +
    'without waiting for the answer. Use no other tool, now or after my answer: when it arrives, reply with one short message and do not ' +
    'read, list or change any file.',
  styleAgain: 'Send me one more short message, the way your instructions describe. Use no tool.',
} as const;

// ---- the scratch root ------------------------------------------------------------------------------------------------

const root = skip === null ? realpathSync(mkdtempSync('/tmp/maws-p2c-live-')) : '/tmp/maws-p2c-live-skipped'; // made only for a run
const config = join(root, 'claude-config');
const userData = join(root, 'user-data');
const repo = join(root, 'p2c-repo');
const REPO_NAME = 'p2c-repo';
const market = join(root, 'doperpowers-market');
const engineScript = join(root, 'engine', 'claude');
const budgetFile = join(root, 'budget-usd');
const probeLog = join(root, 'probe.log');
const notifyHook = join(root, 'notify-hook.cjs');
const db = join(userData, 'index.sqlite');

const line = (text: string) => {
  appendFileSync(join(OUT, 'live-run.txt'), `${text}\n`);
  log(`>> ${text}`);
};
const log = (text = '') => appendFileSync(join(OUT, 'live-log.txt'), `${text}\n`);
function observe(key: string, data: unknown): void {
  const file = join(OUT, 'observations.json');
  const prior = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(file, `${JSON.stringify({ ...prior, [key]: data }, null, 2)}\n`);
}
const sha256 = (path: string): string => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'absent');
// A tree's listing (relative path, size, mtime), digested: a read-only copy leaves it as it was.
function treeDigest(dir: string): { files: number; digest: string } {
  const entries: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.name === '.in_use') continue; // the cache's own bookkeeping of the owner's running sessions
      if (entry.isDirectory()) walk(path);
      else {
        const s = statSync(path);
        entries.push(`${relative(dir, path)}\0${s.size}\0${s.mtimeMs}`);
      }
    }
  };
  walk(dir);
  entries.sort();
  return { files: entries.length, digest: createHash('sha256').update(entries.join('\n')).digest('hex') };
}

// The owner's installed doperpowers, read only: the facts the compatible-style arm stands on.
function ownerPlugin(): { version: string; scope: string; installPath: string; lastUpdated: string; contractKey: string | null; shape: string; reads: string[] } {
  const installed = JSON.parse(readFileSync(join(homedir(), '.claude/plugins/installed_plugins.json'), 'utf8')) as { plugins: Record<string, { scope: string; installPath: string; version: string; lastUpdated: string }[]> };
  const entry = installed.plugins[OWNER_PLUGIN]?.find((e) => e.scope === 'user');
  if (!entry) throw new Error(`no user-scope ${OWNER_PLUGIN} in the owner's installed_plugins.json`);
  const style = readFileSync(join(entry.installPath, 'output-styles/to-human.md'), 'utf8');
  const front = /^---\n([\s\S]*?)\n---/.exec(style)?.[1] ?? '';
  const contractKey = new RegExp(`^${STYLE_CONTRACT_KEY}:\\s*(\\S+)\\s*$`, 'm').exec(front)?.[1] ?? null;
  const reads = ['hooks/mods/to-human.tsx', 'hooks/to-human-stream.sh'].filter((file) => readFileSync(join(entry.installPath, file), 'utf8').includes(NATIVE_TO_HUMAN_ENV));
  const shape = styleShape(contractKey !== null && /^\d+$/.test(contractKey) ? Number(contractKey) : null); // P2-C2: the shape rule
  return { version: entry.version, scope: entry.scope, installPath: entry.installPath, lastUpdated: entry.lastUpdated, contractKey, shape, reads };
}

async function prepare(real: string, cap: number): Promise<{ declares: boolean }> {
  for (const dir of [config, userData, repo, join(root, 'engine'), join(root, 'kairos')]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# P2-C live run\n');
  const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=Live', '-c', 'user.email=live@localhost', '-c', 'commit.gpgsign=false', ...args], { env: isolatedGitEnv(), cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'seed');
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2));
  // The probe: a SessionStart command hook that logs what the engine's environment holds (U2's command-hook reading),
  // printing nothing, so nothing enters the conversation.
  const probe = join(root, 'probe.sh');
  writeFileSync(probe, `#!/bin/sh\nmeta=$(/usr/bin/python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("session_id",""), d.get("source",""))' 2>/dev/null)\nprintf '%s %s ${NATIVE_TO_HUMAN_ENV}=%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$meta" "\${${NATIVE_TO_HUMAN_ENV}:-<unset>}" >> '${probeLog}'\nexit 0\n`, { mode: 0o755 });
  writeSettings({});
  writeFileSync(notifyHook, NOTIFY_HOOK);
  // The engine as the app finds it: every argument forwarded to the installed binary; a session process (stream-json
  // input) also gets the run's remaining budget (the script's source is e2e/support/live-budget.ts's, quoting the paths).
  const declares = await binaryDeclares(real, SYSTEM_PROMPT_SNAPSHOT_FLAG);
  writeFileSync(engineScript, forwardingScript({ label: 'P2-C live run', real, budgetFile, declares, cap }), { mode: 0o755 });
  return { declares };
}

// The scratch home's user settings: Haiku, the sleep the first prompt asks for, the probe, kairos's flags kept in the
// scratch root (the doperpowers arm), plus what the arm adds.
function writeSettings(extra: Record<string, unknown>): void {
  const file = join(config, 'settings.json');
  const prior = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  const settings = {
    ...prior,
    model: 'haiku',
    permissions: { defaultMode: 'default', allow: ['Bash(sleep:*)'] },
    env: { KAIROS_DIR: join(root, 'kairos') },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `'${join(root, 'probe.sh')}'` }] }] },
    ...extra,
  };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

// The engine's CLI against the scratch home only.
function cli(args: string[]): string {
  return execFileSync('/usr/bin/env', ['-i', `HOME=${root}`, `CLAUDE_CONFIG_DIR=${config}`, 'PATH=/usr/bin:/bin', 'DISABLE_AUTOUPDATER=1', 'TERM=dumb', engineScript, 'plugin', ...args], { cwd: root, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

// ---- journals, the index, the transcript, the probe ------------------------------------------------------------------

const journal = (id: string): JournalRow[] => sessionJournal(userData, id);
function spent(): number {
  const dir = join(userData, 'engine-host', 'journal');
  if (!existsSync(dir)) return 0;
  let usd = 0;
  for (const id of readdirSync(dir)) {
    for (const file of readdirSync(join(dir, id)).filter((f) => f.endsWith('.jsonl'))) usd += journalCost(readFileSync(join(dir, id, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow)).costUsd;
  }
  return usd;
}
// Before every launch: the session process may spend what the run's cap leaves.
function budget(cap: number): number {
  const left = cap - spent();
  if (left < 0.05) throw new Error(`not run (budget): US$${left.toFixed(4)} left of US$${cap}`);
  writeFileSync(budgetFile, left.toFixed(4));
  return left;
}

interface Spawn { at: string; launchId: string; args: string[]; append: string | null; snapshotOff: boolean; env: Record<string, string>; resume: string | null; outputStyle: unknown }
function spawns(id: string): Spawn[] {
  return journal(id)
    .filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'spawn')
    .map((r) => {
      const { args, launchId } = r.frame as { args: string[]; launchId: string };
      const after = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1]! : null);
      const settings = JSON.parse(after('--settings') ?? '{}') as { env?: Record<string, string>; outputStyle?: unknown };
      return { at: r.at, launchId, args, append: after('--append-system-prompt'), snapshotOff: after('--system-prompt-snapshot') === 'off', env: settings.env ?? {}, resume: after('--resume'), outputStyle: settings.outputStyle };
    });
}
const spawnWords = (s: Spawn) =>
  `${s.append === null ? 'no --append-system-prompt' : `--append-system-prompt (${s.append === TO_HUMAN_CONTRACT ? 'contract 1, byte for byte' : s.append === TO_HUMAN_SUPPLEMENT ? 'supplement 1, byte for byte' : s.append.startsWith(HEADER) ? 'contract 1 header' : 'OTHER TEXT'})`}; ${s.snapshotOff ? '--system-prompt-snapshot off' : 'no --system-prompt-snapshot'}; --settings env ${NATIVE_TO_HUMAN_ENV}=${s.env[NATIVE_TO_HUMAN_ENV] ?? '<unset>'}`;

interface OwnerRow { launch_id: string | null; desired: string | null; recorded: string | null; appended: number; snapshot_off: number; off_unavailable: number; applied: string | null; style: string | null; observed_style: string | null; style_mismatch: number; override: string; enabled_at: string | null }
function ownerRow(id: string): OwnerRow | null {
  if (!/^[0-9a-f-]+$/.test(id)) throw new Error(`not a session id: ${id}`);
  const out = execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', db, `select launch_id, desired, recorded, appended, snapshot_off, off_unavailable, applied, style, observed_style, style_mismatch, override, enabled_at from owner_channel_sessions where app_session_id = '${id}'`], { encoding: 'utf8' }).trim();
  return out === '' ? null : ((JSON.parse(out) as OwnerRow[])[0] ?? null);
}
// The decision of the session's latest launch, once main has written it.
async function decision(id: string, launchId: string): Promise<OwnerRow> {
  let row: OwnerRow | null = null;
  await expect.poll(() => (row = ownerRow(id))?.launch_id ?? null, { timeout: 30_000, message: `owner_channel_sessions for launch ${launchId}` }).toBe(launchId);
  return row!;
}
const decisionWords = (r: OwnerRow) => `desired ${r.desired}, recorded ${r.recorded}, applied ${r.applied}`;
async function observedStyle(id: string): Promise<OwnerRow> {
  let row: OwnerRow | null = null;
  await expect.poll(() => (row = ownerRow(id))?.observed_style ?? null, { timeout: 60_000, message: 'the first session.init’s output style' }).not.toBeNull();
  return row!;
}

// The probe's line for an engine session written at or after a launch.
async function probed(engineSessionId: string, since: string): Promise<string> {
  let found = '';
  await expect
    .poll(
      () => {
        const lines = existsSync(probeLog) ? readFileSync(probeLog, 'utf8').split('\n').filter(Boolean) : [];
        found = lines.filter((l) => l.includes(engineSessionId) && l.slice(0, 20) >= since.slice(0, 19)).at(-1) ?? '';
        return found;
      },
      { timeout: 60_000, message: `the SessionStart probe for ${engineSessionId}` },
    )
    .not.toBe('');
  return /MAWS_NATIVE_TO_HUMAN=(\S+)/.exec(found)?.[1] ?? '?';
}

type Frame = { type?: string; subtype?: string; uuid?: string; command_uuid?: string; state?: string; parent_tool_use_id?: string | null; message?: { content?: unknown } };
const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => (b as { type?: string; text?: string }).type === 'text' ? (b as { text: string }).text : '').join('') : '';
// The main lane's assistant text after the last prompt MAWS wrote.
function lastReply(id: string): string {
  const rows = journal(id);
  const lastUser = rows.map((r) => r.direction === 'out' && (r.frame as Frame).type === 'user').lastIndexOf(true);
  return rows
    .slice(lastUser + 1)
    .filter((r) => r.direction === 'in' && (r.frame as Frame).type === 'assistant' && ((r.frame as Frame).parent_tool_use_id ?? null) === null)
    .map((r) => textOf((r.frame as Frame).message?.content))
    .join('\n')
    .trim();
}
function answerWrites(id: string): { uuid: string; text: string; at: string }[] {
  return journal(id)
    .filter((r) => r.direction === 'out' && (r.frame as Frame).type === 'user' && textOf((r.frame as Frame).message?.content).startsWith('Answering "'))
    .map((r) => ({ uuid: (r.frame as Frame).uuid!, text: textOf((r.frame as Frame).message?.content), at: r.at }));
}
const lifecycle = (id: string, uuid: string, state: string) =>
  journal(id).find((r) => r.direction === 'in' && (r.frame as Frame).type === 'command_lifecycle' && (r.frame as Frame).command_uuid === uuid && (r.frame as Frame).state === state)?.at ?? null;

// The engine's transcript: its prompt snapshots (how many of each one's segments are the contract, and P2-C2, the
// supplement) and compact boundaries.
function snapshots(engineSessionId: string): { snapshots: number[]; supplements: number[]; boundaries: number } {
  const dir = join(config, 'projects', realpathSync(repo).replace(/[^a-zA-Z0-9]/g, '-'));
  const file = join(dir, `${engineSessionId}.jsonl`);
  const out = { snapshots: [] as number[], supplements: [] as number[], boundaries: 0 };
  if (!existsSync(file)) return out;
  for (const l of readFileSync(file, 'utf8').split('\n')) {
    if (!l.includes('prompt_snapshot') && !l.includes('compact_boundary')) continue;
    const record = JSON.parse(l) as { type?: string; subtype?: string; attachment?: { type?: string; systemPrompt?: unknown[] } };
    const count = (header: string) => (record.attachment?.systemPrompt ?? []).filter((s) => typeof s === 'string' && (s === header || s.startsWith(`${header}\n`))).length;
    if (record.type === 'attachment' && record.attachment?.type === 'prompt_snapshot') {
      out.snapshots.push(count(HEADER));
      out.supplements.push(count(SUPPLEMENT));
    }
    if (record.type === 'system' && record.subtype === 'compact_boundary') out.boundaries += 1;
  }
  return out;
}
const snapshotWords = (s: ReturnType<typeof snapshots>) => `${s.snapshots.length} prompt snapshot(s) [${s.snapshots.map((c) => (c === 0 ? 'none' : `contract:1${c > 1 ? ` x${c}` : ''}`)).join(', ')}], ${s.boundaries} compact boundaries`;

// ---- the page ----------------------------------------------------------------------------------------------------------

const launch = () => launchMaws({ userData, requireFirst: notifyHook, env: { MAWS_E2E_ENGINE_BIN: engineScript, MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: config } });
const pane = (page: Page) => page.locator('[data-region="main"] [data-pane="0"]');
const composer = (page: Page) => pane(page).getByRole('textbox', { name: 'Message' });
const status = async (page: Page, id: string) => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId }));
// How many prompts MAWS has written to the session's engine: a gesture's count, taken before it.
const written = (id: string) => writtenPrompts(journal(id)).length;
// The submitted turn's end: every prompt written after `before` ended at the engine (support/live-turns.ts), then the
// session with no open turn and no pending request.
async function settle(page: Page, id: string, before: number, timeout = 300_000): Promise<void> {
  await expect.poll(() => promptsEnded(writtenPrompts(journal(id)), before), { timeout, intervals: [500] }).toBe(true);
  await expect.poll(async () => {
    const s = await status(page, id);
    return s.turn === null && s.pendingRequests === 0;
  }, { timeout, intervals: [500] }).toBe(true);
}
async function closeWidgets(page: Page): Promise<void> {
  if (await page.getByRole('dialog', { name: 'Model and effort' }).isVisible()) await page.keyboard.press('Escape');
  for (const w of await page.locator('[data-widget]').all()) await w.getByRole('button', { name: /^Close / }).first().click().catch(() => undefined);
}
async function send(page: Page, text: string): Promise<void> {
  await closeWidgets(page);
  await composer(page).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
}
async function openWidget(page: Page, name: string): Promise<Locator> {
  await closeWidgets(page);
  await composer(page).click();
  await page.keyboard.type(`/${name}`);
  await expect(page.getByRole('listbox', { name: 'Commands' }).locator('[role="option"][aria-selected="true"]')).toContainText(`/${name}`);
  await page.keyboard.press('Enter');
  const w = page.locator(`[data-widget="${name}"]`);
  await expect(w).toBeVisible();
  return w;
}
// A new chat in the scratch repository on Haiku; its first Send is the launch.
async function newSession(page: Page): Promise<string> {
  await newChatIn(page, REPO_NAME);
  await expect(page.getByRole('heading', { name: `New chat in ${REPO_NAME}` })).toBeVisible();
  const id = value(await invoke(page, 'session.intent.list', undefined)).intents.at(-1)!.appSessionId;
  const model = await openWidget(page, 'model');
  await model.getByRole('menuitemradio', { name: HAIKU }).click();
  await expect.poll(async () => value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => i.appSessionId === id)?.model ?? '').toMatch(/haiku/);
  await closeWidgets(page);
  return id;
}
async function stop(page: Page, id: string): Promise<void> {
  value(await invoke(page, 'session.stop', { appSessionId: id as AppSessionId, reason: 'stop' }));
  await expect.poll(async () => (await status(page, id)).process, { timeout: 60_000 }).toBe('exited');
}
async function resume(page: Page, id: string): Promise<void> {
  value(await invoke(page, 'session.start', { appSessionId: id as AppSessionId, message: null, options: { model: 'haiku' } }));
  // the host knows no session it has not loaded since the app started, so its status answers an error until the launch
  await expect.poll(async () => (await status(page, id).catch(() => null))?.process ?? null, { timeout: 120_000 }).toBe('ready');
}
async function open(page: Page, id: string): Promise<void> {
  await (await sidebarRow(page, { appSessionId: id })).click();
  await page.mouse.move(700, 450);
  await expect(pane(page).locator(`[data-composer="${id}"]`)).toBeVisible();
}
// The mods row in /plugins for the session in front.
async function modsRow(page: Page): Promise<Locator> {
  const w = await openWidget(page, 'plugins');
  const row = w.locator('[data-mod-row="maws.to-human"]');
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}
async function setOverride(page: Page, to: 'On' | 'Off'): Promise<Locator> {
  const row = await modsRow(page);
  // a controlled radio: the row reads the override back from main after the write
  const radio = row.getByRole('radiogroup', { name: 'To-human in this session' }).getByRole('radio', { name: to, exact: true });
  await radio.click({ force: true });
  await expect(radio).toBeChecked({ timeout: 10_000 });
  return row;
}
// Loaded in main before its entry at every launch (launchMaws's requireFirst), so it sees what main does before any
// page listens (the owner service and the notifier start with the app): every notification main attempts, the OS one
// refused (as an unsigned build's is) so the notifier's own fallback runs and nothing reaches the desktop's notification
// centre, and every fallback's dock bounce, which each notification ends in.
const NOTIFY_HOOK = `const { app, Notification } = require('electron');
const attempts = (globalThis.__p2cNotifyAttempts = []);
Notification.prototype.show = function () {
  attempts.push({ via: 'os', title: this.title, at: new Date().toISOString() });
  this.emit('failed', {}, 'refused by the P2-C live run');
};
if (app.dock) {
  const bounce = app.dock.bounce.bind(app.dock);
  app.dock.bounce = (type) => {
    attempts.push({ via: 'bounce', at: new Date().toISOString() });
    return bounce(type);
  };
}
`;
// What the hook recorded since this launch's main process began.
const mainNotifications = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { __p2cNotifyAttempts?: { via: string; title?: string; at: string }[] }).__p2cNotifyAttempts ?? null);
// Every attention.notified the page hears, from its load, with the window unfocused.
async function instrument(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().forEach((w) => w.blur());
  });
  await page.evaluate(() => {
    const w = window as unknown as { __p2cNotified?: unknown[] };
    if (w.__p2cNotified) return;
    const notes: unknown[] = [];
    w.__p2cNotified = notes;
    window.maws.on('attention.notified', (payload) => notes.push(payload));
  });
}
const notified = async (page: Page, id: string) =>
  (await page.evaluate(() => (window as unknown as { __p2cNotified: { appSessionId: string; attentionId: string; delivery: string; at: string }[] }).__p2cNotified)).filter((n) => n.appSessionId === id);
const items = async (page: Page, id: string) => value(await invoke(page, 'attention.list', undefined)).filter((i) => i.appSessionId === id && (i.kind === 'async_input' || i.kind === 'essential_unread') && i.state === 'pending');
const focusedWindow = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null);

// ---- the run -------------------------------------------------------------------------------------------------------------

test('P2-C live: to-human end to end on the installed engine, in a scratch home', async () => {
  const cap = capUsd();
  mkdirSync(OUT, { recursive: true });
  for (const file of ['live-run.txt', 'live-log.txt', 'observations.json']) writeFileSync(join(OUT, file), file.endsWith('.json') ? '{}\n' : '');
  const engine = installedEngine();
  const { declares } = await prepare(engine.bin, cap);
  const plugin = ownerPlugin();
  const owner = { a15: a15Reading(), settings: sha256(join(homedir(), '.claude/settings.json')), cache: treeDigest(plugin.installPath) };
  line(`setup: engine ${engine.version} (${engine.bin.replace(homedir(), '~')}, declares ${SYSTEM_PROMPT_SNAPSHOT_FLAG}: ${declares ? 'yes' : 'no'}) through ${engineScript} (adds --max-budget-usd, cap US$${cap}); relay ${RELAY_URL}; scratch ${root}`);
  line(`plugin precondition: doperpowers ${plugin.version} at ${plugin.scope} scope (installPath ${plugin.installPath.replace(homedir(), '~')}, lastUpdated ${plugin.lastUpdated}); output-styles/to-human.md declares ${STYLE_CONTRACT_KEY}: ${plugin.contractKey ?? 'NOTHING'}; ${plugin.reads.join(' and ')} read ${NATIVE_TO_HUMAN_ENV}`);
  line(a15Line('before the run', owner.a15, owner.a15, [root]));
  log(`owner files before: ~/.claude/settings.json sha256 ${owner.settings}; the doperpowers cache tree ${owner.cache.files} files, listing sha256 ${owner.cache.digest}`);
  observe('before', { engine, declares, plugin, owner });
  expect(plugin.shape, 'the owner’s style declares a message-tool contract (P2-C2)').toBe('message-tool');
  expect(plugin.reads, 'the owner’s mod and stream hook read the variable').toHaveLength(2);

  const failures: string[] = [];
  let n = 0;
  let maws: MawsLaunch | null = null;
  let page!: Page;
  const shot = (name: string) => page?.screenshot({ path: join(OUT, `live-${name}.jpg`), type: 'jpeg', quality: 50, scale: 'css' }).catch(() => undefined);
  const consoleErrors: string[] = []; // both launches'
  // Every step builds on the ones before it (one session through its states, then the arms), so after a failure the
  // rest are not run.
  const step = (name: string, title: string, body: () => Promise<void>) =>
    test.step(title, async () => {
      n += 1;
      log('');
      log(`=== ${String(n).padStart(2, '0')}-${name} · ${title}`);
      if (failures.length > 0) {
        line(`${name}: not run (an earlier step failed)`);
        return;
      }
      try {
        await body();
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n').slice(0, 6).join(' | ') : String(error);
        failures.push(`${name}: ${message}`);
        line(`${name}: FAILED: ${message}`);
        await shot(`${name}-failed`);
      }
    });

  let s1 = '';
  let s1Engine = '';
  let s2 = '';
  let s2Engine = '';
  let restoredBefore: string[] = [];
  try {
    maws = await launch();
    page = maws.page;
    await expect(page.locator('[data-region="main"]')).toBeVisible();
    await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
    await instrument(maws.app, page);
    value(await invoke(page, 'settings.set', { notifications: { enabled: true } }));
    const projects = value(await invoke(page, 'session.projects.list', undefined)).projects;
    if (!projects.some((p) => p.directory === repo)) value(await invoke(page, 'session.projects.add', { directory: repo }));

    await step('g1-new', 'G1: a new session in the clean home carries the contract, the variable, and records maws-contract', async () => {
      s1 = await newSession(page);
      const left = budget(cap);
      await send(page, PROMPTS.marks);
      await maws!.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.blur()));
      await expect.poll(() => spawns(s1).length, { timeout: 60_000 }).toBe(1);
      const spawn = spawns(s1)[0]!;
      const row = await decision(s1, spawn.launchId);
      await expect.poll(async () => (s1Engine = (await status(page, s1)).engineSessionId ?? ''), { timeout: 60_000 }).not.toBe('');
      const probe = await probed(s1Engine, spawn.at);
      const s = await status(page, s1);
      log(`session ${s1} (engine ${s1Engine}): model ${s.model.resolved}, gateway ${s.gateway.verified}, budget US$${left.toFixed(4)}; spawn ${spawnWords(spawn)}; ${decisionWords(row)}; appended ${row.appended}, snapshot_off ${row.snapshot_off}, style ${row.style}, enabled_at ${row.enabled_at}; probe ${NATIVE_TO_HUMAN_ENV}=${probe}`);
      observe('g1New', { s1, s1Engine, spawn: { ...spawn, append: spawn.append?.slice(0, 80) }, row, probe, model: s.model, gateway: s.gateway });
      expect(spawn.append, 'the contract, byte for byte').toBe(TO_HUMAN_CONTRACT);
      expect(spawn.snapshotOff).toBe(false);
      expect(spawn.env[NATIVE_TO_HUMAN_ENV]).toBe('1');
      expect(probe).toBe('1');
      expect([row.desired, row.recorded, row.applied]).toEqual(['maws-contract', 'unrecorded', 'maws-contract']);
      expect(s.gateway.verified).toBe('routed');
      line(`G1 new: spawn has --append-system-prompt (contract 1 header; the contract byte for byte); no --system-prompt-snapshot; ${NATIVE_TO_HUMAN_ENV}=1 in --settings env and logged by the SessionStart probe; ${decisionWords(row)}`);
    });

    await step('g6-notify', 'G6: with the window unfocused, one notification per item: the question and the must-read', async () => {
      const question = pane(page).locator('[data-owner-card="need-input"]');
      await expect(question).toBeVisible({ timeout: 240_000 });
      await expect.poll(async () => (await items(page, s1)).length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
      const focused = await focusedWindow(maws!.app);
      await expect.poll(async () => (await notified(page, s1)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
      await page.waitForTimeout(2_000);
      const notes = await notified(page, s1);
      const list = await items(page, s1);
      const kinds = notes.map((note) => list.find((i) => i.id === note.attentionId)?.kind ?? '?');
      log(`window focused at the items: ${focused === null ? 'none' : `window ${focused}`}; items ${JSON.stringify(list.map((i) => [i.kind, i.summary]))}; attention.notified ${JSON.stringify(notes.map((x, k) => [kinds[k], x.delivery]))}`);
      observe('g6Notify', { focused, items: list.map((i) => ({ kind: i.kind, summary: i.summary, anchor: i.anchor })), notified: notes });
      await shot('01-marks');
      expect(kinds.sort()).toEqual(['async_input', 'essential_unread']);
      line(`G6 notify: attention.notified x${notes.length} (${[...new Set(notes.map((x) => x.delivery))].join('|')}) for ${kinds.join(' and ')}, the window unfocused; none for to-human or insight`);
    });

    await step('g6-leave', 'G6: leaving the tab, the sidebar row shows the question glyph and Needs you lists the items', async () => {
      const turnBefore = (await status(page, s1)).turn;
      await newChatIn(page, REPO_NAME); // another tab in front
      await expect(page.getByRole('heading', { name: `New chat in ${REPO_NAME}` })).toBeVisible();
      await expect((await sidebarRow(page, { appSessionId: s1 })).getByRole('img', { name: 'Question waiting' })).toBeVisible();
      await page.mouse.move(700, 450);
      const needs = page.getByRole('list', { name: 'Needs you' }).locator(`[data-needs-you="${s1}"]`);
      await expect(needs).toBeVisible();
      const row = (await needs.innerText()).replaceAll('\n', ' · ');
      const summaries = (await items(page, s1)).map((i) => i.summary);
      log(`turn running when leaving: ${turnBefore !== null}; Needs you row: ${row}; items: ${JSON.stringify(summaries)}`);
      await shot('02-leave-tab');
      expect(summaries.some((x) => x.startsWith('Question — '))).toBe(true);
      expect(summaries.some((x) => x.startsWith('Must read — '))).toBe(true);
      line(`G6 leave tab: sidebar '?' (Question waiting) and Needs you "${row.slice(0, 120)}"; items ${summaries.map((x) => `"${x.slice(0, 70)}"`).join(', ')}`);
    });

    await step('g4-choice', 'G4: the recommended choice clicked while the agent runs reads Queued, then Answered when the engine starts it', async () => {
      await page.getByRole('list', { name: 'Needs you' }).locator(`[data-needs-you="${s1}"]`).click();
      await page.mouse.move(700, 450);
      await expect(pane(page).locator(`[data-composer="${s1}"]`)).toBeVisible();
      await expect(pane(page).getByRole('group', { name: 'Session view' }).getByRole('button', { name: 'Report' })).toHaveAttribute('aria-pressed', 'true');
      await composer(page).click();
      await page.keyboard.insertText(DRAFT);
      const question = pane(page).locator('[data-owner-card="need-input"]').first();
      const choice = question.getByRole('group', { name: 'Choices' }).locator('button[data-recommended]');
      const choiceText = (await choice.locator('.owner-question-choice-text').innerText()).trim();
      const running = (await status(page, s1)).turn !== null;
      await choice.click();
      const clickedAt = new Date().toISOString();
      await expect(question).toContainText('Queued — sends when the agent reaches a pause', { timeout: 20_000 });
      await expect(question.getByRole('button', { name: 'Cancel' })).toBeVisible();
      const queuedSeenAt = new Date().toISOString();
      const writtenWhileQueued = answerWrites(s1).length;
      await shot('03-queued');
      await expect(question.locator('[data-answered]')).toHaveText(`Answered: ${choiceText}`, { timeout: 240_000 });
      const answeredSeenAt = new Date().toISOString();
      const write = answerWrites(s1)[0];
      if (!write) throw new Error('no Answering prompt in the journal');
      const started = lifecycle(s1, write.uuid, 'started');
      log(`turn running at the click: ${running}; clicked ${clickedAt}; Queued seen ${queuedSeenAt} (answer prompts written by then: ${writtenWhileQueued}); written ${write.at} as ${write.uuid}; the engine's started ${started}; Answered seen ${answeredSeenAt}; prompt ${JSON.stringify(write.text.slice(0, 160))}`);
      observe('g4Choice', { running, clickedAt, queuedSeenAt, writtenWhileQueued, write, started, answeredSeenAt, choiceText });
      await shot('04-answered');
      expect(running, 'the click landed while the turn ran').toBe(true);
      expect(started, 'the engine started the answer').not.toBeNull();
      expect(answeredSeenAt >= started!).toBe(true);
      await expect(composer(page)).toHaveText(DRAFT);
      line(`G4 choice mid-turn: Queued → Answered (command_lifecycle started ${write.uuid} at ${started}; written at ${write.at}, Answered seen at ${answeredSeenAt}); composer draft unchanged`);
    });

    await step('g3-report', 'G3: the marked turn reads as cards over one Working record; opened, the divider; expanded, the tool rows; folded again', async () => {
      await settle(page, s1, 0); // every prompt of the session: the marks prompt and the answer, both written by now (g4-choice)
      const p = pane(page);
      const counts = {
        message: await p.locator('[data-owner-card="to-human"]').count(),
        mustRead: await p.locator('[data-owner-card="essential"]').count(),
        insight: await p.locator('aside[aria-label="Insight"]').count(),
        question: await p.locator('[data-owner-card="need-input"]').count(),
        records: await p.locator('.owner-record').count(),
      };
      const placement = await p.locator('.owner-insights').first().getAttribute('data-placement').catch(() => null);
      // the sleep's tool row (a cell, or a group holding it), never the prompt that names the command
      const toolRow = p.locator('.transcript-row[data-kind="cell"], .transcript-row[data-kind="group"]').filter({ hasText: 'sleep 40' });
      const record = p.locator('.owner-record button').first();
      const closed = (await record.innerText()).replaceAll('\n', ' ');
      await expect(toolRow, 'level 0: the tool row folded into the record').toHaveCount(0);
      await record.click();
      await expect(record).toContainText('Fold to report');
      const divider = p.getByRole('button', { name: /^Worked for/ }).first();
      await expect(divider).toBeVisible();
      const dividerText = (await divider.innerText()).replaceAll('\n', ' ');
      await expect(toolRow, 'level 1: the divider still closed').toHaveCount(0);
      await divider.click();
      await expect(toolRow.first(), 'level 2: the tool row shown').toBeVisible();
      const toolText = (await toolRow.first().innerText()).replaceAll('\n', ' ');
      await shot('05-record-open');
      await record.click();
      await expect(record).toContainText('Working record');
      await expect(toolRow, 'folded: the tool row gone again').toHaveCount(0);
      log(`cards ${JSON.stringify(counts)}; insight placement ${placement}; record closed "${closed}"; divider "${dividerText}"; the tool row: absent at levels 0 and 1, "${toolText.slice(0, 120)}" at level 2, absent after the fold`);
      observe('g3Report', { counts, placement, closed, dividerText, toolText });
      expect(counts.message).toBeGreaterThanOrEqual(1);
      expect(counts.mustRead).toBeGreaterThanOrEqual(1);
      expect(counts.insight).toBeGreaterThanOrEqual(1);
      expect(counts.question).toBeGreaterThanOrEqual(1);
      line(`G3 report: ${counts.message} message, ${counts.mustRead} must-read, ${counts.insight} insight (${placement}), ${counts.question} question card(s) over "${closed}"; the sleep's tool row absent; opened: "${dividerText}", the row still absent; expanded: the row "${toolText.slice(0, 40)}"; "Fold to report": absent again`);
    });

    await step('g4-reply', 'G4: Reply sends free text from the card; the composer’s draft is untouched and focused', async () => {
      const question = pane(page).locator('[data-owner-card="need-input"]').first();
      const prompts = written(s1);
      await question.getByRole('button', { name: 'Reply' }).click();
      await question.getByRole('textbox', { name: 'Your answer' }).fill(REPLY);
      await page.keyboard.press('Enter');
      await expect(question.locator('[data-answered]')).toHaveText(`Answered: ${REPLY}`, { timeout: 180_000 });
      await expect(composer(page)).toHaveText(DRAFT);
      await expect(composer(page)).toBeFocused();
      const write = answerWrites(s1).at(-1)!;
      await settle(page, s1, prompts);
      log(`reply written ${write.at} as ${write.uuid}, started ${lifecycle(s1, write.uuid, 'started')}; prompt ${JSON.stringify(write.text)}`);
      await shot('06-reply');
      line(`G4 Reply: Answered: ${REPLY} (started ${write.uuid}); composer draft unchanged and focused`);
      await composer(page).click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
    });

    await step('restart', 'restart: the states and items restored silently; the must-read unread until Mark read', async () => {
      restoredBefore = (await items(page, s1)).map((i) => i.id).sort();
      await stop(page, s1);
      consoleErrors.push(...maws!.consoleErrors());
      await maws!.cleanup(); // the profile is the run's: kept
      maws = await launch();
      page = maws.page;
      await expect(page.locator('[data-region="main"]')).toBeVisible();
      await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
      await instrument(maws.app, page);
      await open(page, s1);
      const question = pane(page).locator('[data-owner-card="need-input"]').first();
      await expect(question.locator('[data-answered]')).toHaveText(`Answered: ${REPLY}`, { timeout: 30_000 });
      const unread = pane(page).locator('[data-owner-card="essential"][data-state="unread"]');
      await expect(unread.first()).toBeVisible();
      await page.waitForTimeout(3_000);
      const after = (await items(page, s1)).map((i) => i.id).sort();
      const notes = await notified(page, s1);
      const attempts = await mainNotifications(maws.app);
      await shot('07-restart');
      log(`items before ${JSON.stringify(restoredBefore)}; after ${JSON.stringify(after)}; attention.notified since the page loaded: ${notes.length}; notifications main attempted since it started: ${JSON.stringify(attempts)}; unread must-reads ${await unread.count()}`);
      expect(after).toEqual(restoredBefore);
      expect(attempts, 'the hook loaded first in main').not.toBeNull();
      expect(attempts, 'main attempted no notification from its start').toEqual([]);
      expect(notes).toEqual([]);
      const before = await unread.count();
      while ((await unread.count()) > 0) await unread.first().getByRole('button', { name: 'Mark read' }).click();
      await expect(pane(page).locator('[data-owner-card="essential"][data-state="read"]').first()).toContainText('Read');
      await expect.poll(async () => (await items(page, s1)).filter((i) => i.kind === 'essential_unread').length).toBe(0);
      line(`restart: ${after.length} item(s) restored, ${notes.length} notified (main attempted ${attempts!.length} from its start); the question reads "Answered: ${REPLY}"; ${before} must-read(s) unread until Mark read, then Read`);
    });

    await step('resume', 'resume: the contract passed again and the recorded snapshot reused; the agent names the marks', async () => {
      const left = budget(cap);
      const before = snapshots(s1Engine);
      await resume(page, s1);
      await expect.poll(() => spawns(s1).length, { timeout: 30_000 }).toBe(2);
      const spawn = spawns(s1)[1]!;
      const row = await decision(s1, spawn.launchId);
      const prompts = written(s1);
      await send(page, PROMPTS.instructions);
      await settle(page, s1, prompts);
      const probe = await probed(s1Engine, spawn.at);
      const reply = lastReply(s1);
      const snap = snapshots(s1Engine);
      const named = ['to-human', 'essential', 'need-input', 'insight'].filter((tag) => reply.includes(tag));
      log(`budget US$${left.toFixed(4)}; spawn ${spawnWords(spawn)}; resume ${spawn.resume}; ${decisionWords(row)}; probe ${probe}; before the resume ${snapshotWords(before)}, after its turn ${snapshotWords(snap)}; reply ${JSON.stringify(reply.slice(0, 400))}`);
      observe('resume', { spawn: { ...spawn, append: spawn.append?.slice(0, 80) }, row, probe, before, snap, reply });
      expect(spawn.resume).toBe(s1Engine);
      expect(spawn.append).toBe(TO_HUMAN_CONTRACT);
      expect(spawn.snapshotOff).toBe(false);
      expect([row.desired, row.recorded, row.applied]).toEqual(['maws-contract', 'contract:1', 'maws-contract']);
      // the first launch may record more than one snapshot (2.1.296 wrote a fuller record mid-turn, its systemPrompt the
      // same); the resume reuses them and records none, and no snapshot carries the contract twice
      expect(snap).toEqual(before);
      expect(snap.snapshots.length).toBeGreaterThan(0);
      expect(snap.snapshots.every((c) => c === 1)).toBe(true);
      expect(named).toEqual(['to-human', 'essential', 'need-input', 'insight']);
      line(`resume: spawn has --append-system-prompt, no --system-prompt-snapshot; ${decisionWords(row)}; no second append in the snapshot (the resume recorded none: ${snapshotWords(snap)} before and after); agent names ${named.join(', ')}`);
    });

    await step('off', 'off arm: the session’s override Off; the resume passes --system-prompt-snapshot off, no contract and no variable; the agent finds none', async () => {
      const row = await setOverride(page, 'Off');
      await expect(row.locator('[data-mod-pending]')).toHaveText('Applies the next time this session starts');
      const pendingWords = await row.locator('[data-mod-pending]').innerText();
      await shot('08-off-pending');
      await closeWidgets(page);
      await stop(page, s1);
      const left = budget(cap);
      await resume(page, s1);
      await expect.poll(() => spawns(s1).length, { timeout: 30_000 }).toBe(3);
      const spawn = spawns(s1)[2]!;
      const decided = await decision(s1, spawn.launchId);
      const after = await modsRow(page);
      await expect(after.locator('[data-mod-source]')).toHaveText('Off: the agent is not asked to mark anything');
      await expect(after.locator('[data-mod-pending]')).toHaveCount(0);
      const sourceWords = await after.locator('[data-mod-source]').innerText();
      await closeWidgets(page);
      const prompts = written(s1);
      await send(page, PROMPTS.instructions);
      await settle(page, s1, prompts);
      const probe = await probed(s1Engine, spawn.at);
      const reply = lastReply(s1);
      log(`row: "${pendingWords}", then "${sourceWords}"; budget US$${left.toFixed(4)}; spawn ${spawnWords(spawn)}; ${decisionWords(decided)}, snapshot_off ${decided.snapshot_off}, override ${decided.override}; probe ${probe}; reply ${JSON.stringify(reply.slice(0, 400))}`);
      observe('off', { spawn: { ...spawn, append: spawn.append?.slice(0, 80) }, decided, probe, reply, pendingWords, sourceWords });
      await shot('09-off');
      expect(spawn.snapshotOff).toBe(true);
      expect(spawn.append).toBeNull();
      expect(spawn.env[NATIVE_TO_HUMAN_ENV]).toBeUndefined();
      expect(probe).toBe('<unset>');
      expect([decided.desired, decided.recorded, decided.applied]).toEqual(['off', 'contract:1', 'off']);
      // the answer is its first word; the model may go on to disown what it said under the contract (one run did,
      // naming the tags it no longer has)
      expect(reply).toMatch(/^\W*NO\b/);
      line(`off arm: the mods row "${pendingWords}", then "${sourceWords}"; spawn --system-prompt-snapshot off, no append, ${NATIVE_TO_HUMAN_ENV}=<unset> (--settings env and the probe); ${decisionWords(decided)}; agent: ${JSON.stringify(reply.slice(0, 60))}`);
      await stop(page, s1);
    });

    await step('style', 'style arm: the owner’s doperpowers installed in the scratch home with its to-human style selected; the supplement appended, never the contract; the variable set; a message card; the mod’s band stays away', async () => {
      cpSync(plugin.installPath, market, { recursive: true, filter: (src) => !src.split('/').includes('.in_use') });
      const added = cli(['marketplace', 'add', market]);
      const installed = cli(['install', OWNER_PLUGIN, '--scope', 'user']);
      log(`setup · marketplace add: ${added.trim().split('\n').at(-1)} · install: ${installed.trim().split('\n').at(-1)}`);
      const scratchInstalled = JSON.parse(readFileSync(join(config, 'plugins/installed_plugins.json'), 'utf8')) as { plugins: Record<string, { scope: string; version: string; installPath: string }[]> };
      const entry = scratchInstalled.plugins[OWNER_PLUGIN]?.[0];
      // P2-C2: the agent's ask is MAWS's tool, allowed here as the sleep is, so no permission card stands in the turn's way
      writeSettings({ outputStyle: STYLE, permissions: { defaultMode: 'default', allow: ['Bash(sleep:*)', 'mcp__maws__ask'] } });
      const enabled = (JSON.parse(readFileSync(join(config, 'settings.json'), 'utf8')) as { enabledPlugins?: Record<string, boolean> }).enabledPlugins ?? {};
      log(`the scratch home: ${OWNER_PLUGIN} ${entry?.version} at ${entry?.scope} scope (${entry?.installPath}); enabledPlugins ${JSON.stringify(enabled)}; outputStyle ${STYLE}`);
      expect(entry?.version).toBe(plugin.version);
      expect(enabled[OWNER_PLUGIN]).toBe(true);
      s2 = await newSession(page);
      const left = budget(cap);
      const prompts = written(s2);
      await send(page, PROMPTS.style);
      await expect.poll(() => spawns(s2).length, { timeout: 60_000 }).toBe(1);
      const spawn = spawns(s2)[0]!;
      const row = await decision(s2, spawn.launchId);
      await expect.poll(async () => (s2Engine = (await status(page, s2)).engineSessionId ?? ''), { timeout: 60_000 }).not.toBe('');
      const probe = await probed(s2Engine, spawn.at);
      await settle(page, s2, prompts);
      const observed = await observedStyle(s2);
      const s = await status(page, s2);
      const cards = await pane(page).locator('[data-owner-card="to-human"]').count(); // a <message> reads as the message card
      const snap = snapshots(s2Engine);
      const asks = mcpCalls(journal(s2)).filter((call) => call.name === 'ask');
      const band = pane(page).locator('[data-plugin-band]');
      const bandText = (await band.count()) > 0 ? (await band.first().innerText()).replaceAll('\n', ' ') : '(no band)';
      const reply = lastReply(s2);
      log(`session ${s2} (engine ${s2Engine}): budget US$${left.toFixed(4)}; plugins ${JSON.stringify(s.plugins.map((p) => p.source ?? p.name))}; spawn ${spawnWords(spawn)}; ${decisionWords(row)}, style ${row.style}, observed ${observed.observed_style}, mismatch ${observed.style_mismatch}; probe ${probe}; snapshots: contract ${JSON.stringify(snap.snapshots)}, supplement ${JSON.stringify(snap.supplements)}; message cards ${cards}; asks ${JSON.stringify(asks.map((a) => a.args))}; the band: ${bandText}; reply ${JSON.stringify(reply.slice(0, 300))}`);
      observe('style', { s2, s2Engine, spawn: { ...spawn, args: undefined, append: spawn.append?.slice(0, 80) }, row, observed, probe, snap, cards, asks, bandText, reply, plugins: s.plugins });
      await shot('10-style');
      expect(spawn.args.filter((arg) => arg === '--append-system-prompt'), 'one --append-system-prompt').toHaveLength(1);
      expect(spawn.append, 'the supplement, byte for byte').toBe(TO_HUMAN_SUPPLEMENT);
      expect(spawn.args.some((arg) => arg.includes(HEADER)), 'contract 1 nowhere in the arguments').toBe(false);
      expect(spawn.snapshotOff).toBe(false);
      expect(spawn.env[NATIVE_TO_HUMAN_ENV]).toBe('1');
      expect(probe).toBe('1');
      expect([row.desired, row.recorded, row.applied, row.style]).toEqual(['external-style-plus-supplement', 'unrecorded', 'external-style-plus-supplement', STYLE]);
      expect(observed.style_mismatch).toBe(0);
      expect(snap.snapshots.length).toBeGreaterThan(0);
      expect({ contract: snap.snapshots, supplement: snap.supplements }, 'each snapshot carries the supplement once and no contract').toEqual({ contract: snap.snapshots.map(() => 0), supplement: snap.snapshots.map(() => 1) });
      expect(cards).toBeGreaterThanOrEqual(1);
      expect(asks.map((a) => a.args.blocking), 'one ask through mcp__maws__ask, not blocking').toEqual([false]);
      expect(bandText).not.toContain('to-human view');
      line(`style arm: doperpowers ${entry?.version} installed for the scratch home's user from a local marketplace, outputStyle ${STYLE} (declares ${plugin.contractKey}: ${plugin.shape}); --append-system-prompt once, the supplement byte for byte, contract 1 nowhere; ${decisionWords(row)} (engine reports ${observed.observed_style}); ${snap.supplements.length} snapshot(s), each with the supplement once; ${NATIVE_TO_HUMAN_ENV}=1 logged; ${cards} message card(s); one mcp__maws__ask, blocking false; the mod's band absent (deferred)`);
    });

    // P2-C2: the owner's style asks through a tool, so the question is MAWS's ask, answered from its sheet while the
    // doperpowers mod is active; its answer reaches the agent as the user message naming the ask. (The four marks' cards,
    // Reply, attention and restart ran in the clean home.)
    await step('style-answer', 'style arm: the agent’s non-blocking mcp__maws__ask answered from its sheet with the doperpowers mod active; the agent replies', async () => {
      const capsule = pane(page).locator('section.transcript-ask').first();
      await expect(capsule).toHaveAttribute('data-ask-state', 'asked', { timeout: 30_000 });
      const askId = await capsule.getAttribute('data-ask-id');
      const sheet = page.locator(`[data-ask-sheet][data-ask-id="${askId}"]`);
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      const sections = sheet.locator('section[data-question-id]');
      const radios = sections.first().getByRole('radio');
      let answer: string;
      if ((await radios.count()) > 0) {
        answer = (await radios.first().getAttribute('aria-label')) ?? '?';
        await radios.first().click();
      } else {
        answer = REPLY;
        await sections.first().getByRole('textbox').fill(answer);
      }
      await shot('11-style-ask');
      const prompts = written(s2);
      await sheet.getByRole('button', { name: /^Submit/ }).click();
      await expect(capsule).toHaveAttribute('data-ask-state', 'answered', { timeout: 60_000 });
      await settle(page, s2, prompts);
      const delivered = journal(s2).filter((r) => r.direction === 'out' && (r.frame as Frame).type === 'user' && textOf((r.frame as Frame).message?.content).includes(askId ?? '\0'));
      const reply = lastReply(s2);
      log(`ask ${askId}: ${await sections.count()} question(s); answered "${answer}"; the answer written ${delivered.length} time(s): ${JSON.stringify(delivered.map((r) => textOf((r.frame as Frame).message?.content).slice(0, 200)))}; reply ${JSON.stringify(reply.slice(0, 300))}`);
      observe('styleAnswer', { askId, answer, delivered: delivered.map((r) => ({ at: r.at, text: textOf((r.frame as Frame).message?.content) })), reply });
      await shot('12-style-answer');
      expect(delivered, 'the answer reached the engine as a user message naming the ask').toHaveLength(1);
      expect(reply.length).toBeGreaterThan(0);
      line(`style answer: with the mod active, the mcp__maws__ask sheet answered "${answer}"; the capsule Answered; the answer written once to the engine naming ${askId}; the agent replied`);
    });

    await step('style-off', 'style arm, lane off: the variable unset; the mod draws its own to-human band', async () => {
      await setOverride(page, 'Off');
      await closeWidgets(page);
      await stop(page, s2);
      const left = budget(cap);
      await resume(page, s2);
      await expect.poll(() => spawns(s2).length, { timeout: 30_000 }).toBe(2);
      const spawn = spawns(s2)[1]!;
      const row = await decision(s2, spawn.launchId);
      const prompts = written(s2);
      await send(page, PROMPTS.styleAgain);
      await settle(page, s2, prompts);
      const probe = await probed(s2Engine, spawn.at);
      const band = pane(page).locator('[data-plugin-band]').filter({ hasText: 'to-human view' });
      await expect(band).toBeVisible({ timeout: 30_000 });
      const bandText = (await band.innerText()).replaceAll('\n', ' ');
      log(`budget US$${left.toFixed(4)}; spawn ${spawnWords(spawn)}; ${decisionWords(row)}; probe ${probe}; the band: ${bandText}`);
      observe('styleOff', { spawn, row, probe, bandText });
      await shot('13-style-off');
      expect(spawn.append).toBeNull();
      expect(spawn.env[NATIVE_TO_HUMAN_ENV]).toBeUndefined();
      expect(probe).toBe('<unset>');
      expect(row.applied).toBe('off');
      expect(row.recorded, 'the supplement the session recorded (P2-C2)').toBe('supplement:1');
      expect(spawn.snapshotOff, 'the recorded supplement dropped at once where the binary declares the flag').toBe(declares);
      line(`style arm, lane off: ${spawnWords(spawn)}; ${decisionWords(row)}; ${NATIVE_TO_HUMAN_ENV}=<unset> logged; the mod draws its band "${bandText.slice(0, 60)}"`);
      await stop(page, s2);
    });

  } finally {
    if (maws) consoleErrors.push(...maws.consoleErrors());
    log('');
    log(`console errors (both launches): ${JSON.stringify(consoleErrors)}`);
    // A close that fails (launchMaws kills the app, then throws) is kept for the result after the bookkeeping below.
    const teardown = await cleanupFailure(maws);
    log(`teardown: ${teardown ?? 'MAWS closed cleanly'}`);
    const after = { a15: a15Reading(), settings: sha256(join(homedir(), '.claude/settings.json')), cache: treeDigest(plugin.installPath) };
    log(`owner files after: ~/.claude/settings.json sha256 ${after.settings} (${after.settings === owner.settings ? 'identical' : 'CHANGED'}); the doperpowers cache tree ${after.cache.files} files, listing sha256 ${after.cache.digest} (${after.cache.digest === owner.cache.digest ? 'identical' : 'CHANGED'})`);
    const total = spent();
    line(`spend: US$${total.toFixed(4)} across the run's journals (cap US$${cap}); ~/.claude/settings.json ${after.settings === owner.settings ? 'unchanged' : 'CHANGED'}; the doperpowers cache tree ${after.cache.digest === owner.cache.digest ? 'unchanged' : 'CHANGED'}`);
    line(a15Line('after the run', owner.a15, after.a15, [root]));
    observe('after', { a15: after.a15, settings: after.settings, cache: after.cache, failures, consoleErrors, spentUsd: total, teardown });
    expect.soft(teardown, 'MAWS closed cleanly at the end of the run').toBeNull(); // soft: fails the run without hiding an error the run threw
    console.log(`P2-C live: scratch root ${root}`);
    expect(after.settings, '~/.claude/settings.json unchanged').toBe(owner.settings);
    expect(after.cache.digest, 'the owner’s doperpowers cache tree unchanged').toBe(owner.cache.digest);
    // A-15 by the shared attribution (test/support/owner-file.ts): a key under the run's scratch appearing or vanishing
    // is a breach; another owner session's /tmp project meanwhile is recorded in the line above, not failed.
    expect(compareA15(owner.a15.keys, after.a15.keys, [root]).breach, 'A-15: no key under the run’s scratch appeared or vanished in the owner file').toEqual([]);
    expect(total, `the run's spend within its cap of US$${cap}`).toBeLessThanOrEqual(cap);
  }
  expect(failures, failures.join('\n')).toEqual([]);
  expect(consoleErrors, 'no console error in either launch').toEqual([]);
});
