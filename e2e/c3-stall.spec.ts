// C3 corrective (ledger docs/doperpowers/ledgers/2026-09-30-c3-handshake-stall.md, hypothesis 4): the resume stall at
// `initialize`, reproduced through the product. One MAWS-made deep session (C10's sentinel recipe in a worktree, as the
// C12 pre-run's §10.2 made it) is resumed from its row in a fresh app launch, over and over; each launch waits for
// `ready`, optionally runs one turn, and closes the app, which is how the pre-run's stalled resumes were preceded. A
// launch that is not ready within MAWS_C3_STALL_WAIT_MS has its engine's ps, lsof, `sample` and environment captured
// under the scratch root before the app closes. Run on purpose only (it spends a little usage per turn):
//   export C3=/private/tmp/maws-c3-stall/h4 && mkdir -p $C3/config $C3/userData && printf '{}\n' > $C3/config/settings.json
//   pnpm build && MAWS_C3_STALL=1 CLAUDE_CONFIG_DIR=$C3/config MAWS_USER_DATA=$C3/userData pnpm e2e e2e/c3-stall.spec.ts
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import { invoke, value } from './support/c7-replay';
import { journalSpend, ownerFileCheck, scratchRepo, stateOf } from './support/c12-prerun';
import { launchMaws, REPO_ROOT, type MawsLaunch } from './support/launch';
import { openProject, sidebarRow } from './support/sidebar';

const ON = process.env.MAWS_C3_STALL === '1';
test.skip(!ON, 'the C3 stall reproduction goes only under MAWS_C3_STALL=1');
test.describe.configure({ timeout: 7_200_000 });

const N = Number(process.env.MAWS_C3_STALL_N ?? '20');
const WAIT_MS = Number(process.env.MAWS_C3_STALL_WAIT_MS ?? '45000');
const TURN = process.env.MAWS_C3_STALL_TURN !== '0';
const MAX_USD = Number(process.env.MAWS_C3_STALL_MAX_USD ?? '3');

// Both homes are required and must be siblings under one scratch root whose path is plain (no spaces or shell
// metacharacters: the sentinel hook's command embeds it), checked before anything launches: an empty MAWS_USER_DATA
// would open the owner's own MAWS profile.
const SCRATCH_ROOT = /^\/private\/tmp\/maws-c3-stall(\/[A-Za-z0-9._-]+)*$/;
function scratchHomes(): { config: string; userData: string; root: string } {
  const rawConfig = process.env.CLAUDE_CONFIG_DIR ?? '';
  const rawUserData = process.env.MAWS_USER_DATA ?? '';
  if (rawConfig === '' || rawUserData === '') throw new Error('export CLAUDE_CONFIG_DIR and MAWS_USER_DATA under one /private/tmp/maws-c3-stall root first');
  const config = realpathSync(rawConfig);
  const userData = realpathSync(rawUserData);
  const root = dirname(config);
  if (!SCRATCH_ROOT.test(root) || dirname(userData) !== root) throw new Error(`the scratch must be one plain /private/tmp/maws-c3-stall root holding both homes: CLAUDE_CONFIG_DIR=${config}, MAWS_USER_DATA=${userData}`);
  return { config, userData, root };
}
const { config, userData, root } = ON ? scratchHomes() : { config: '', userData: '', root: '' };
const out = (name: string) => join(root, name);
const log = (row: Record<string, unknown>) => {
  appendFileSync(out('h4-run.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`);
  console.log(`[c3-stall] ${JSON.stringify(row).slice(0, 500)}`);
};
const sh = (cmd: string, args: string[], timeout = 20_000): string => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    return `ERR ${error instanceof Error ? error.message : String(error)}`;
  }
};

const main = (page: Page) => page.locator('[data-region="main"]');
const sidebar = (page: Page) => page.locator('[data-region="sidebar"]');
async function statusOrNull(page: Page, id: string): Promise<EngineSessionStatus | null> {
  const r = await invoke(page, 'session.status', { appSessionId: id as AppSessionId });
  return r.ok ? r.value : null;
}

// A session's row (W5: on its project's page, which this opens), once the index lists the record: a fresh launch reads
// the store a moment after the window shows.
async function rowOf(page: Page, id: string): Promise<Locator> {
  await expect.poll(async () => value(await invoke(page, 'session.list', { includeArchived: true })).sessions.some((r) => r.appId === id), { timeout: 30_000 }).toBe(true);
  return sidebarRow(page, { appSessionId: id });
}

async function open(label: string): Promise<MawsLaunch> {
  const maws = await launchMaws({ userData, env: { MAWS_HARNESS: '0', CLAUDE_CONFIG_DIR: config } });
  const child = maws.app.process();
  const appLog = out(`app-${label}.log`);
  child.stdout?.on('data', (c: Buffer) => appendFileSync(appLog, c));
  child.stderr?.on('data', (c: Buffer) => appendFileSync(appLog, c));
  await expect(main(maws.page)).toBeVisible({ timeout: 60_000 });
  await maws.page.evaluate(() => {
    const w = window as unknown as { __setup: unknown[] };
    w.__setup = [];
    window.maws.on('session.setup', (e) => w.__setup.push({ ...e, t: Date.now() }));
    // exits and process errors as main's LaunchWatch sees them, live (seq set) or from the transcript (seq null)
    window.maws.on('session.eventBatch', (b) => {
      for (const e of b.events) if (e.kind === 'process.exited' || (e.kind === 'error.raised' && e.scope === 'process')) w.__setup.push({ exitEvent: e.kind, id: e.id, seq: e.seq, t: Date.now() });
    });
  });
  value(await invoke(maws.page, 'settings.set', { engine: { subagentModel: 'haiku' } }));
  return maws;
}

const setupEvents = (page: Page) => page.evaluate(() => (window as unknown as { __setup: unknown[] }).__setup);
// Every pinned-engine process on the machine under this scratch home (an orphan of a previous app would show here).
const engines = () => sh('/bin/ps', ['-axo', 'pid=,ppid=,etime=,stat=,command=']).split('\n').filter((l) => l.includes('versions/2.1.283') && !l.includes(' sample ')).map((l) => l.trim().slice(0, 160));

async function send(page: Page, id: string, text: string): Promise<void> {
  const before = (await statusOrNull(page, id))?.lastEventSeq ?? 0;
  await (await rowOf(page, id)).click();
  await expect(main(page).locator(`[data-composer="${id}"]`)).toBeVisible({ timeout: 20_000 });
  await main(page).getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
  await expect.poll(async () => ((await statusOrNull(page, id))?.lastEventSeq ?? 0) > before, { timeout: 30_000 }).toBe(true); // the turn is under way
}

async function idle(page: Page, id: string, timeout = 240_000): Promise<void> {
  await expect
    .poll(async () => {
      const s = await statusOrNull(page, id);
      return s !== null && s.process === 'ready' && s.turn === null && !s.busy && s.pendingRequests === 0;
    }, { timeout, intervals: [500] })
    .toBe(true);
}

// The deep session of the C12 pre-run's §10.2, made once through "+" with a new worktree (auto mode, Haiku).
function sentinelRepo(): string {
  const market = out('marketplace');
  if (!existsSync(market)) {
    mkdirSync(join(market, '.claude-plugin'), { recursive: true });
    writeFileSync(join(market, '.claude-plugin/marketplace.json'), JSON.stringify({ name: 'c12-market', owner: { name: 'C12' }, plugins: [{ name: 'c12-plugin', source: './c12-plugin', description: 'C12 sentinel plugin' }] }));
    mkdirSync(join(market, 'c12-plugin/.claude-plugin'), { recursive: true });
    writeFileSync(join(market, 'c12-plugin/.claude-plugin/plugin.json'), JSON.stringify({ name: 'c12-plugin', version: '0.0.1' }));
    mkdirSync(join(market, 'c12-plugin/commands'), { recursive: true });
    writeFileSync(join(market, 'c12-plugin/commands/c12-plugin-ping.md'), '---\ndescription: C12 plugin sentinel\n---\nReply with the word PLUGIN.\n');
    mkdirSync(out('hooks'), { recursive: true });
  }
  const settings = {
    permissions: { allow: ['Bash(echo C12_SENTINEL:*)'] },
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch ${out('hooks')}/started-$PPID` }] }] },
    enableAllProjectMcpServers: true,
    enableWorkflows: true,
    extraKnownMarketplaces: { 'c12-market': { source: { source: 'directory', path: market } } },
    enabledPlugins: { 'c12-plugin@c12-market': true },
  };
  return scratchRepo(root, 'deep', {
    'README.md': '# Deep (C3 stall scratch)\n',
    'one.txt': 'ONE\n',
    '.claude/settings.json': `${JSON.stringify(settings, null, 2)}\n`,
    '.claude/settings.local.json': '{"skipWorkflowUsageWarning":true}\n',
    '.mcp.json': `${JSON.stringify({ mcpServers: { 'c12-sentinel': { command: process.execPath, args: [join(REPO_ROOT, 'spikes/protocol-probe/scenarios/pass2/elicit-mcp-server.mjs')] } } }, null, 2)}\n`,
  });
}

async function makeDeep(page: Page): Promise<string> {
  const repo = sentinelRepo();
  const known = value(await invoke(page, 'session.projects.list', undefined)).projects.some((p) => p.directory === repo);
  if (!known) value(await invoke(page, 'session.projects.add', { directory: repo }));
  const before = new Set(value(await invoke(page, 'session.intent.list', undefined)).intents.map((i) => i.appSessionId));
  await openProject(page, 'deep'); // W5: the "+" beside the name on the project's page
  await sidebar(page).locator('[data-level-pane="2"]').getByRole('button', { name: 'New session in deep', exact: true }).click();
  let id: AppSessionId | undefined;
  await expect.poll(async () => (id = value(await invoke(page, 'session.intent.list', undefined)).intents.find((i) => !before.has(i.appSessionId))?.appSessionId)).toBeDefined();
  value(await invoke(page, 'session.intent.patch', { appSessionId: id!, patch: { model: 'haiku', permissionMode: 'auto' } }));
  const name = `deep-${Date.now().toString(36).slice(-4)}`;
  // New chat (2026-10-01): the Worktree checkbox names its worktree itself, so this named one is set on the intent
  value(await invoke(page, 'session.intent.patch', { appSessionId: id!, patch: { location: { kind: 'newWorktree', repoRoot: repo, name, branch: { kind: 'new', name: `worktree-${name}`, base: 'HEAD' } } } }));
  await main(page).getByRole('textbox', { name: 'Message' }).click();
  await page.keyboard.insertText('Reply with exactly: DEEP READY');
  await page.keyboard.press('Enter');
  const card = page.getByRole('group', { name: 'Trust this folder?' });
  await expect.poll(async () => (await card.isVisible()) || (await statusOrNull(page, id!)) !== null, { timeout: 60_000 }).toBe(true);
  if (await card.isVisible()) await card.getByRole('button', { name: 'Trust and start' }).click();
  await expect.poll(async () => (await statusOrNull(page, id!))?.process ?? null, { timeout: 180_000 }).toBe('ready');
  await idle(page, id!);
  return id!;
}

// The engine's view during a stall: its state, open files, where its threads sit, its children, and its environment.
function capture(dir: string, pid: number): void {
  mkdirSync(dir, { recursive: true });
  const ppid = sh('/bin/ps', ['-o', 'ppid=', '-p', String(pid)]).trim();
  writeFileSync(join(dir, 'ps.txt'), `${sh('/bin/ps', ['-o', 'pid,ppid,stat,wchan,etime,rss,command', '-p', `${pid},${ppid}`])}\n${sh('/usr/bin/pgrep', ['-lP', String(pid)])}`);
  writeFileSync(join(dir, 'lsof-engine.txt'), sh('/usr/sbin/lsof', ['-p', String(pid)]));
  if (/^\d+$/.test(ppid)) writeFileSync(join(dir, 'lsof-host.txt'), sh('/usr/sbin/lsof', ['-p', ppid]));
  writeFileSync(join(dir, 'env.txt'), sh('/bin/ps', ['-wwE', '-o', 'command=', '-p', String(pid)]), { mode: 0o600 });
  writeFileSync(join(dir, 'sample.txt'), sh('/usr/bin/sample', [String(pid), '3'], 40_000));
}

test('the deep session resumed from its row in a fresh app launch, repeatedly', async () => {
  expect(ownerFileCheck(root), 'no scratch path in the owner’s ~/.claude.json before').toEqual([]);
  const state = stateOf(root);
  let id = state.get('deep.appId');
  if (!id) {
    const maws = await open('made');
    try {
      id = await makeDeep(maws.page);
      state.set('deep.appId', id);
      const s = (await statusOrNull(maws.page, id))!;
      log({ event: 'made', appSessionId: id, pid: s.pid, cwd: s.cwd, journal: s.journalPath });
      writeFileSync(out('env-ready.txt'), sh('/bin/ps', ['-wwE', '-o', 'command=', '-p', String(s.pid)]), { mode: 0o600 });
    } finally {
      await maws.cleanup();
    }
  }
  let stalls = 0;
  for (let i = 0; i < N; i++) {
    const usd = journalSpend(userData).usd;
    if (usd >= MAX_USD) {
      log({ event: 'budget', usd });
      break;
    }
    const maws = await open(`i${i}`);
    const { page } = maws;
    try {
      const row = await rowOf(page, id);
      await expect(row).toBeVisible({ timeout: 30_000 });
      const enginesBefore = engines();
      const t0 = Date.now();
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Resume', exact: true }).click();
      let status: EngineSessionStatus | null = null;
      let captured = false;
      for (;;) {
        status = await statusOrNull(page, id);
        if (status?.process === 'ready' || status?.process === 'exited') break;
        if (!captured && status?.pid && Date.now() - t0 > 10_000) {
          capture(out(`stalls/i${i}-early-${status.pid}`), status.pid); // at 10 s, well past the half second it takes
          captured = true;
        }
        if (Date.now() - t0 > WAIT_MS) break;
        await page.waitForTimeout(100);
      }
      const readyMs = Date.now() - t0;
      const ok = status?.process === 'ready';
      if (!ok) stalls += 1;
      if (!ok && status?.pid && status.process !== 'exited') capture(out(`stalls/i${i}-late-${status.pid}`), status.pid);
      if (status?.process === 'exited') await page.waitForTimeout(1_500); // the setup's failure event follows the exit
      const journal = status ? readFileSync(status.journalPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { direction: string; frame: Record<string, unknown> }) : [];
      log({ event: 'resume', i, ok, readyMs, process: status?.process ?? null, pid: status?.pid ?? null, launchId: status?.launchId ?? null, rows: journal.map((r) => `${r.direction}:${String(r.frame.event ?? r.frame.type ?? '')}${r.frame.subtype ? `/${String(r.frame.subtype)}` : ''}`).slice(0, 12), stderr: journal.filter((r) => r.direction === 'stderr').map((r) => r.frame.text).slice(0, 5), enginesBefore, setup: await setupEvents(page) });
      if (ok && TURN) {
        await send(page, id, 'Reply with exactly: OK');
        await idle(page, id);
      }
    } finally {
      await maws.cleanup();
      log({ event: 'closed', i, enginesAfter: engines() });
    }
  }
  log({ event: 'done', stalls, n: N, usd: journalSpend(userData).usd });
  expect(ownerFileCheck(root), 'no scratch path in the owner’s ~/.claude.json after').toEqual([]);
});
