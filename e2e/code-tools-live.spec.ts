// C8c's live acceptance (C8c execution document, acceptance item 4), through Playwright against the product build, with
// the window hidden. Two cases. The first reads this checkout: Files, the viewer and Review over a scenario derived from
// C5's nine-sessions.json whose *Charter + research* record points at the checkout (C8a's live check's shape), checked
// against what git itself answers; the only write is an untracked probe file, removed after. The second runs a real
// model turn: a session created with the pinned binary through ClaudeUsage's relay in a scratch clone of this
// repository, found by C4's real index in a scratch CLAUDE_CONFIG_DIR, resumed by MAWS, and asked to make one edit;
// its receipt's "Review changes" opens Last turn and `Open file ↗` lands the viewer at the hunk's first changed line.
// The owner's ~/.claude and ~/.claude.json are never read for sessions nor written (checked after the turn, read-only).
// The second case removes its scratch clone and config dir after the run, keeping the turn's journal, unless
// MAWS_CODE_LIVE_KEEP=1 keeps them too. Run on purpose only:
//   pnpm build && MAWS_CODE_LIVE=1 pnpm exec playwright test e2e/code-tools-live.spec.ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { ENGINE_BIN, ENGINE_VERSION, GATEWAY_AUTH_TOKEN, RELAY_URL } from '../src/engine-host/launch';
import { launchDefaults } from '../src/shared/composer/launch-defaults';
import { scratchConfigHome } from '../test/live/support/live';
import { launchMaws, REPO_ROOT, test, type MawsLaunch } from './support/launch';
import { CHARTER } from './support/panel-support';

function skipReason(): string | null {
  if (process.env.MAWS_CODE_LIVE !== '1') return 'the C8c live acceptance runs only under MAWS_CODE_LIVE=1';
  if (!existsSync(ENGINE_BIN)) return `engine binary missing at ${ENGINE_BIN}`;
  const version = execFileSync(ENGINE_BIN, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim();
  if (!version.startsWith(ENGINE_VERSION)) return `engine reports ${version}, expected ${ENGINE_VERSION}`;
  const code = execFileSync('/usr/bin/curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${RELAY_URL}/api/hello`], { encoding: 'utf8' }).trim();
  return code === '200' ? null : `relay at ${RELAY_URL} answered ${code}: start ClaudeUsage`;
}
const skip = skipReason();
test.skip(skip !== null, skip ?? '');
test.describe.configure({ timeout: 300_000 });

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
const REFUSAL = "path outside the session's directories";
const WORKTREE_SESSION = 'Fix sidebar drag'; // the scenario record pointed at the main checkout with this worktree

async function hideWindow(maws: MawsLaunch): Promise<void> {
  await maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
}

async function addTool(page: Page, name: 'Files' | 'Review'): Promise<void> {
  await page.locator('[data-region="panel"]').getByRole('button', { name: 'Add a tool' }).click();
  await page.getByRole('menuitem', { name }).click();
}

// The owner's home after a live turn, read only: nothing in ~/.claude/history.jsonl or ~/.claude.json names the turn's
// session or its scratch (by the scratch's own name, whichever spelling of /tmp), and ~/.claude/projects has no
// transcript folder for it. Not a before/after stat: the owner's own Claude Code sessions write both files at any
// moment, so their mtimes and sizes move whatever this run does.
function expectOwnerHomeUntouched(sessionId: string, scratch: string): void {
  const home = join(homedir(), '.claude');
  const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  for (const path of [join(home, 'history.jsonl'), join(homedir(), '.claude.json')]) {
    const text = read(path);
    expect(text.includes(sessionId) || text.includes(basename(scratch)), `${path} names this run`).toBe(false);
  }
  const projects = join(home, 'projects');
  const folders = existsSync(projects) ? readdirSync(projects).filter((name) => name.includes(basename(scratch))) : [];
  expect(folders, `${projects} has a folder for this run`).toEqual([]);
}

// The flashed line of the code view: its text, and whether it sits in the middle third or the view rests at an end.
const flashed = (page: Page) =>
  page.evaluate(() => {
    const line = document.querySelector<HTMLElement>('[data-file-viewer] .cm-flash-line');
    const scroller = document.querySelector<HTMLElement>('[data-file-viewer] .cm-scroller');
    if (!line || !scroller) return null;
    const l = line.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const at = (l.top + l.height / 2 - s.top) / s.height;
    const end = scroller.scrollTop <= 1 || scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
    return { text: line.textContent ?? '', at, centred: (at >= 1 / 3 && at <= 2 / 3) || (end && at > 0 && at < 1) };
  });

test('live: Files, the viewer and Review over this checkout', async () => {
  const observed: Record<string, unknown> = {};
  const scratch = realpathSync(mkdtempSync('/tmp/maws-c8c-live-'));
  type StubRecord = { appId: string; title: { text: string }; directory: string; worktree: { path: string; branch: string | null } | null };
  const scenario = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as { sessions: StubRecord[] };
  const charter = scenario.sessions.find((s) => s.title.text === CHARTER)!;
  charter.directory = REPO_ROOT;
  // A session that runs in this worktree of the main checkout (item 4's second root), read-only on the main checkout.
  const worktree = realpathSync.native(REPO_ROOT);
  const mainCheckout = realpathSync.native(dirname(git(REPO_ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir')));
  const inWorktree = scenario.sessions.find((s) => s.title.text === WORKTREE_SESSION)!;
  inWorktree.directory = mainCheckout;
  inWorktree.worktree = { path: worktree, branch: git(REPO_ROOT, 'branch', '--show-current') || null };
  writeFileSync(join(scratch, 'scenario.json'), JSON.stringify(scenario));
  const root = realpathSync(REPO_ROOT);
  const probe = join(root, 'c8c-live-probe.txt'); // untracked, so Review has something to list; removed below
  writeFileSync(probe, 'one\ntwo\n');
  const maws = await launchMaws({ env: { MAWS_SESSION_SOURCE: `stub:${join(scratch, 'scenario.json')}`, MAWS_SCENARIO_CLOCK: 'manual', MAWS_HARNESS: '0' } });
  try {
    await hideWindow(maws);
    const { page } = maws;
    const panel = page.locator('[data-region="panel"]');
    await page.locator('[data-region="sidebar"]').getByRole('treeitem', { name: CHARTER }).click();

    await test.step('Files: one root for the repository', async () => {
      await addTool(page, 'Files');
      const roots = panel.locator('[data-tool="files"] [role="treeitem"][data-kind="root"]');
      await expect(roots).toHaveCount(1);
      await expect(roots).toHaveAttribute('data-path', root);
      observed.roots = await roots.evaluateAll((rows) => rows.map((r) => `${r.getAttribute('data-path')} · ${r.textContent}`));
      await roots.click();
      await panel.locator(`[data-path="${root}/docs"]`).click();
    });

    await test.step('docs/charter.md renders, with its Source', async () => {
      await panel.locator(`[data-path="${root}/docs/charter.md"]`).click();
      const viewer = page.locator(`[data-file-viewer][data-path="${root}/docs/charter.md"]`);
      await expect(viewer.locator('[data-markdown-view] h1').first()).toBeVisible({ timeout: 10_000 });
      observed.charterHeading = await viewer.locator('[data-markdown-view] h1').first().textContent();
      await viewer.getByRole('button', { name: 'Source' }).click();
      await expect(viewer.locator('[data-code-view] .cm-line').first()).toContainText('#');
      await viewer.getByRole('button', { name: 'Rendered' }).click();
      await expect(viewer.locator('[data-markdown-view] h1').first()).toBeVisible();
    });

    await test.step('src/main/ipc/router.ts is highlighted', async () => {
      for (const dir of ['src', 'src/main', 'src/main/ipc']) await panel.locator(`[data-path="${root}/${dir}"]`).click();
      await panel.locator(`[data-path="${root}/src/main/ipc/router.ts"]`).click();
      const viewer = page.locator(`[data-file-viewer][data-path="${root}/src/main/ipc/router.ts"]`);
      await expect(viewer.locator('[data-code-view]')).toHaveAttribute('data-language', 'TypeScript');
      await expect
        .poll(() =>
          viewer.evaluate((el) => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--code-keyword)';
            el.append(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            return Array.from(el.querySelectorAll<HTMLElement>('.cm-content span')).some((s) => s.textContent === 'import' && getComputedStyle(s).color === want);
          }),
        )
        .toBe(true);
    });

    await test.step('Review Uncommitted matches git diff HEAD --numstat plus the untracked files', async () => {
      const numstat = git(root, 'diff', 'HEAD', '--numstat').split('\n').filter(Boolean).map((l) => l.split('\t'));
      const added = numstat.reduce((sum, [a]) => sum + (a === '-' ? 0 : Number(a)), 0);
      const removed = numstat.reduce((sum, [, r]) => sum + (r === '-' ? 0 : Number(r)), 0);
      const untracked = git(root, 'status', '--porcelain', '--untracked-files=all').split('\n').filter((l) => l.startsWith('??')).length;
      const files = numstat.length + untracked;
      const expected = `${files} ${files === 1 ? 'file' : 'files'} changed · +${added} −${removed} · Uncommitted`;
      await addTool(page, 'Review');
      await expect(panel.locator('[data-review-header]')).toHaveText(expected, { timeout: 15_000 });
      await expect(panel.locator('[role="option"] button[data-path="c8c-live-probe.txt"]')).toHaveAttribute('data-kind', 'untracked');
      observed.review = { header: expected, numstat: numstat.length, untracked };
    });

    await test.step('G3: This branch is the three-dot diff against the main worktree’s branch (C10’s git.worktree.branch)', async () => {
      const current = git(root, 'branch', '--show-current');
      const base = git(mainCheckout, 'symbolic-ref', '--short', 'HEAD');
      const chip = panel.locator('[data-chip="branch"]');
      if (current === base) {
        await expect(chip).toHaveAttribute('title', `Session runs on ${current}, the main worktree's branch`);
        await expect(chip).toBeDisabled();
        observed.thisBranch = { current, base, disabled: await chip.getAttribute('title') };
        return;
      }
      await expect(chip).toBeEnabled({ timeout: 10_000 });
      await chip.click();
      await expect(panel.locator('[data-review-footer]')).toHaveText(`${current} · Since ${base}`);
      const numstat = git(root, 'diff', `${base}...HEAD`, '--numstat').split('\n').filter(Boolean).map((l) => l.split('\t'));
      const added = numstat.reduce((sum, [a]) => sum + (a === '-' ? 0 : Number(a)), 0);
      const removed = numstat.reduce((sum, [, r]) => sum + (r === '-' ? 0 : Number(r)), 0);
      if (numstat.length === 0) await expect(panel.locator('[data-review-empty]')).toHaveText(`Nothing on ${current} beyond ${base}`, { timeout: 15_000 });
      else await expect(panel.locator('[data-review-header]')).toHaveText(`${numstat.length} ${numstat.length === 1 ? 'file' : 'files'} changed · +${added} −${removed} · This branch`, { timeout: 15_000 });
      observed.thisBranch = { current, base, files: numstat.length, added, removed };
      await panel.locator('[data-chip="uncommitted"]').click(); // back, for the steps below
    });

    await test.step('the viewer follows an edit made outside MAWS', async () => {
      await panel.locator('[role="option"] button[data-path="c8c-live-probe.txt"]').click();
      await panel.locator('[data-open-file]').click();
      const viewer = page.locator(`[data-file-viewer][data-path="${probe}"]`);
      await expect(viewer.locator('.cm-content')).toContainText('two');
      const written = Date.now();
      writeFileSync(probe, 'one\ntwo\nthree, written outside MAWS\n');
      await expect(viewer.locator('.cm-content')).toContainText('three, written outside MAWS', { timeout: 5_000 });
      observed.followMs = Date.now() - written;
      // And the boundary: a path outside the session's directories is refused.
      const refused = await page.evaluate(async (appSessionId) => window.maws.invoke('files.read', { appSessionId, path: '/etc/hosts' } as never), charter.appId);
      expect(refused).toEqual({ ok: false, error: { code: 'internal', message: REFUSAL } });
    });

    await test.step('Files: a session in a worktree has two roots, its directory and the worktree, in record order', async () => {
      if (mainCheckout === worktree) throw new Error(`this run is not in a linked worktree: ${worktree}`);
      await page.locator('[data-region="sidebar"]').getByRole('treeitem', { name: WORKTREE_SESSION }).click();
      await addTool(page, 'Files');
      const roots = panel.locator('[data-tool="files"] [role="treeitem"][data-kind="root"]');
      await expect(roots).toHaveCount(2);
      const shown = await roots.evaluateAll((rows) => rows.map((r) => ({ path: r.getAttribute('data-path'), role: r.querySelector('span.text-fg-faint')?.textContent ?? null })));
      expect(shown).toEqual([
        { path: mainCheckout, role: 'directory' },
        { path: worktree, role: 'worktree' },
      ]);
      observed.worktreeRoots = shown;
    });
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
    console.log(`[c8c-live] checkout ${JSON.stringify(observed)}`);
    await maws.cleanup();
    rmSync(probe, { force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('live: a turn that edits a file opens Review on Last turn and the viewer at the hunk', async () => {
  const observed: Record<string, unknown> = {};
  const scratch = realpathSync(mkdtempSync('/tmp/maws-c8c-live-'));
  const config = join(scratch, 'claude-config');
  execFileSync('/bin/mv', [scratchConfigHome(), config]);
  const clone = join(scratch, 'maws');
  git(scratch, 'clone', '--quiet', REPO_ROOT, clone);
  const engineEnv: Record<string, string> = { TERM: 'xterm-256color', LANG: process.env.LANG ?? 'en_US.UTF-8' };
  for (const key of ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR']) if (process.env[key]) engineEnv[key] = process.env[key]!;
  Object.assign(engineEnv, { CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: RELAY_URL, ANTHROPIC_AUTH_TOKEN: GATEWAY_AUTH_TOKEN });
  const created = JSON.parse(
    execFileSync(ENGINE_BIN, ['-p', 'Reply with exactly: C8C LIVE READY', '--model', 'sonnet', '--max-budget-usd', '0.5', '--output-format', 'json'], {
      cwd: clone,
      env: engineEnv,
      encoding: 'utf8',
      timeout: 180_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  ) as { session_id: string; total_cost_usd: number; result: string };
  observed.created = { sessionId: created.session_id, costUsd: created.total_cost_usd, result: created.result };

  const target = 'CLAUDE.md';
  const before = readFileSync(join(clone, target), 'utf8').split('\n');
  const lineNo = before.findIndex((l) => l.startsWith('- Light theme is the default')) + 1;
  expect(lineNo, 'the line the turn edits').toBeGreaterThan(0);
  const edited = `${before[lineNo - 1]} (C8c live)`;

  const maws = await launchMaws({ env: { CLAUDE_CONFIG_DIR: config, MAWS_HARNESS: '0' } });
  try {
    await hideWindow(maws);
    const { page } = maws;
    const invoke = (name: string, input: unknown) => page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const);
    let record: { appId: string; title: { text: string }; directory: string } | undefined;
    await expect
      .poll(
        async () => {
          const listed = (await invoke('session.list', {})) as { ok: boolean; value?: { sessions: { appId: string; engineSessionId: string | null; title: { text: string }; directory: string }[] } };
          record = listed.value?.sessions.find((s) => s.engineSessionId === created.session_id);
          return record !== undefined;
        },
        { timeout: 30_000, message: 'C4’s index lists the session' },
      )
      .toBe(true);
    observed.record = { appId: record!.appId, directory: record!.directory };

    // Spread from C7's one list of X6 fields, so a field the contract makes mandatory fails typecheck here, not at launch.
    const spec: LaunchSpec = {
      ...launchDefaults(record!.appId as AppSessionId, record!.directory),
      model: 'sonnet', permissionMode: 'acceptEdits', subagentModel: 'sonnet', resume: { sessionId: created.session_id as SessionId, fork: false }, maxBudgetUsd: 0.5,
    };
    const launched = (await invoke('session.launch', { spec })) as { ok: boolean };
    expect(launched, JSON.stringify(launched)).toMatchObject({ ok: true });
    const status = async () => ((await invoke('session.status', { appSessionId: record!.appId })) as { value?: { process?: string; engineState?: string } }).value;
    await expect.poll(async () => (await status())?.process, { timeout: 60_000 }).toBe('ready');

    // Open the session, so the transcript (C6's slot, with C8c's registered callbacks) shows the turn's receipt.
    await page.locator('[data-region="sidebar"]').getByRole('treeitem', { name: new RegExp(record!.title.text.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
    const prompt = `Use the Edit tool exactly once on ${target} to change the line "${before[lineNo - 1]}" into "${edited}". Change nothing else and do not run any other tool than Read and Edit. Then reply DONE.`;
    const sent = await invoke('session.send', { appSessionId: record!.appId, content: prompt });
    observed.sent = sent;
    await expect.poll(() => readFileSync(join(clone, target), 'utf8').includes(edited), { timeout: 180_000, message: 'the turn edits the file' }).toBe(true);
    const receipt = page.locator('.transcript-receipt');
    await expect(receipt).toBeVisible({ timeout: 120_000 });
    observed.receipt = await receipt.textContent();

    await receipt.locator('.transcript-receipt-review').click();
    const panel = page.locator('[data-region="panel"]');
    await expect(panel.locator('[data-chip="turn"]')).toHaveAttribute('aria-pressed', 'true');
    const file = panel.locator(`[role="option"] button[data-path="${join(record!.directory, target)}"]`);
    await expect(file).toBeVisible();
    observed.review = { header: await panel.locator('[data-review-header]').textContent(), file: await file.textContent() };

    await panel.locator('[data-open-file]').click();
    await expect.poll(async () => (await flashed(page))?.text, { timeout: 5_000 }).toBe(edited);
    const landed = (await flashed(page))!;
    expect(landed.centred).toBe(true);
    observed.landed = { line: lineNo, ...landed };

    const viewer = page.locator('[data-file-viewer]');
    const written = Date.now();
    writeFileSync(join(clone, target), `${readFileSync(join(clone, target), 'utf8')}\nA line written outside MAWS.\n`);
    await expect(viewer.locator('.cm-content')).toContainText('A line written outside MAWS.', { timeout: 5_000 });
    observed.followMs = Date.now() - written;
    const journalPath = ((await invoke('session.status', { appSessionId: record!.appId })) as { value?: { journalPath?: string } }).value?.journalPath;
    await invoke('session.stop', { appSessionId: record!.appId, reason: 'stop' });
    if (journalPath && existsSync(journalPath)) {
      // The turn's cost: the engine's cumulative figure on its last main-lane result.
      const journal = join(scratch, 'turn.jsonl');
      writeFileSync(journal, readFileSync(journalPath));
      const costs = readFileSync(journal, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { direction: string; frame: { type?: string; total_cost_usd?: number; parent_tool_use_id?: string | null } })
        .filter((row) => row.direction === 'in' && row.frame.type === 'result' && !row.frame.parent_tool_use_id)
        .map((row) => row.frame.total_cost_usd ?? 0);
      observed.turn = { journal, costUsd: Math.max(0, ...costs) };
    }
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
    console.log(`[c8c-live] turn ${JSON.stringify(observed)}`);
    await maws.cleanup();
    if (process.env.MAWS_CODE_LIVE_KEEP === '1') {
      console.log(`[c8c-live] scratch kept (MAWS_CODE_LIVE_KEEP=1): ${scratch}`);
    } else {
      rmSync(clone, { recursive: true, force: true });
      rmSync(config, { recursive: true, force: true });
      console.log(`[c8c-live] scratch clone and config removed; the turn's journal is kept: ${join(scratch, 'turn.jsonl')}`);
    }
    // Read only, and in the finally so a failing model run is checked too.
    expectOwnerHomeUntouched(created.session_id, scratch);
  }
});
