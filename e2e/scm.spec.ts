// E6's source control end to end (E6 execution document, acceptance item 2; Plan of Work T6.2), run by `pnpm e2e:scm`
// (MAWS_SCM_E2E=1; the spec skips itself otherwise, so `pnpm e2e` is unchanged). Every case launches the product app in
// stub mode over a fresh scratch from `buildScmScratch()` (a repository under /tmp, local bare remotes, a fake `gh`
// first on the captured login-shell PATH through the launcher's `prepare` seam, trust written into the launch's own
// config home), selects *Charter + research*, opens Source control through "+" and drives it with a reader's clicks;
// what it asserts comes from the DOM and from the repository on disk. No engine runs; no remote command reaches a forge.
// When MAWS_E6_SHOTS names a directory, the themes case writes the evidence screenshots there in both themes.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { menu, otherThemeColours } from './support/code-product';
import { launchMaws, test, type MawsLaunch } from './support/launch';
import { CHARTER } from './support/panel-support';
import { APP_EDIT, APP_LINES,buildScmScratch, CHECKS_PASSED, PR_URL, prepareScm, UNTRACKED_TEXT, type ScmScratch } from './support/scm-scratch';
import { sidebarOf, sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_SCM_E2E !== '1', 'the source control e2e runs under pnpm e2e:scm (MAWS_SCM_E2E=1)');

const SHOTS = process.env.MAWS_E6_SHOTS;
const UNTRUSTED = 'MAWS runs git here only after you trust the folder in a session';

// ---- the product over a scratch ----------------------------------------------------------------------------------------------

interface Scm {
  maws: MawsLaunch;
  page: Page;
  panel: Locator;
  scratch: ScmScratch;
}

interface ScmOptions {
  trust?: boolean; // default true
  gh?: 'fake' | 'none'; // default fake
  ghState?: 'ready' | 'unauthenticated' | 'missing'; // what scm.status must answer first; default: ready for fake, missing for none
  setup?(scratch: ScmScratch): void; // before the launch
}

async function withScm(options: ScmOptions, body: (p: Scm) => Promise<void>): Promise<void> {
  const scratch = buildScmScratch();
  const gh = options.gh ?? 'fake';
  let maws: MawsLaunch | null = null;
  try {
    options.setup?.(scratch);
    maws = await launchMaws({ env: scratch.env, prepare: prepareScm(scratch, { trust: options.trust ?? true, gh }) });
    const { page } = maws;
    await expect(sidebarOf(page).locator('[data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
    await (await sidebarRow(page, CHARTER)).click();
    const panel = page.locator('[data-region="panel"]');
    await expect(summaryOf(panel).getByRole('heading', { level: 2 })).toContainText(CHARTER);
    const p = { maws, page, panel, scratch };
    await expectGh(p, options.ghState ?? (gh === 'fake' ? 'ready' : 'missing'));
    await body(p);
    expect(maws.consoleErrors(), 'the console stays free of errors').toEqual([]);
  } finally {
    await maws?.cleanup();
    scratch.cleanup();
  }
}

const invoke = (page: Page, name: 'scm.status' | 'scm.stage', input: Record<string, unknown>) =>
  page.evaluate(([name, input]) => window.maws.invoke(name as never, input as never), [name, input] as const) as Promise<{ ok: boolean; value?: unknown; error?: unknown }>;

// The gh MAWS resolved on the captured PATH: the scratch's fake (by path) before anything asks it about a PR, or none.
async function expectGh({ page, scratch }: Scm, state: 'ready' | 'unauthenticated' | 'missing'): Promise<void> {
  const result = await invoke(page, 'scm.status', { appSessionId: scratch.appSessionId });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const gh = (result.value as { gh: { state: string; path?: string } }).gh;
  expect(gh.state, JSON.stringify(gh)).toBe(state);
  if (state === 'missing') expect(gh.path).toBeUndefined();
  else expect(gh.path, 'the fake gh, never the owner’s').toBe(scratch.ghPath);
}

const summaryOf = (panel: Locator) => panel.getByRole('tabpanel', { name: 'Session overview' });
const pushRow = (p: Scm) => summaryOf(p.panel).getByRole('region', { name: 'Push state' });
const tool = (p: Scm) => p.panel.locator('[data-scm]');
const group = (p: Scm, name: 'staged' | 'unstaged' | 'untracked') => tool(p).locator(`[data-scm-group="${name}"]`);
const row = (p: Scm, name: 'staged' | 'unstaged' | 'untracked', path: string) => group(p, name).locator(`[data-scm-row][data-path="${path}"]`);
const count = (p: Scm, name: 'staged' | 'unstaged' | 'untracked') => group(p, name).locator('[data-scm-count]');
const sheet = (p: Scm, kind: 'discard' | 'push' | 'pr') => p.page.locator(`[data-scm-sheet="${kind}"]`);
const remoteAction = (p: Scm, name: 'push' | 'pr' | 'pr-link') => tool(p).locator(`[data-scm-remote-action="${name}"]`);
const button = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true });
const toolTab = (p: Scm) => p.panel.getByRole('tablist', { name: 'Panel tools' }).getByRole('tab', { name: 'Source control' });

async function openTool(p: Scm): Promise<void> {
  await p.panel.getByRole('button', { name: 'Add a tool' }).click();
  await p.page.getByRole('menuitem', { name: 'Source control' }).click();
  await expect(tool(p).locator('[data-scm-header]')).toContainText('⎇ main');
}

async function showSummary(p: Scm): Promise<void> {
  await p.panel.getByRole('button', { name: 'Session overview' }).click();
  await expect(pushRow(p)).toBeVisible();
}

async function showTool(p: Scm): Promise<void> {
  await toolTab(p).click();
  await expect(tool(p)).toBeVisible();
}

async function shot(target: Locator, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: join(SHOTS, name) });
}

const porcelain = (scratch: ScmScratch) => scratch.git('status', '--porcelain', '--untracked-files=normal');
// What git itself calls staged and unstaged: the paths `git diff --cached` and `git diff` name.
const gitNames = (scratch: ScmScratch, ...args: string[]) => scratch.git('diff', '--name-only', ...args).split('\n').filter(Boolean);

// The Push sheet, open with main's plan shown.
async function openPushSheet(p: Scm): Promise<Locator> {
  await expect(remoteAction(p, 'push')).toBeEnabled();
  await remoteAction(p, 'push').click();
  const push = sheet(p, 'push');
  await expect(push.locator('[data-scm-plan-command]')).toBeVisible();
  await expect(button(push, 'Push')).toBeEnabled();
  return push;
}

const output = (p: Scm) => tool(p).locator('[data-scm-output]');
const outputText = (p: Scm) => output(p).locator('[data-scm-output-text]');

// The Output disclosure after a run: open, ended with `Done`.
async function expectRunDone(p: Scm): Promise<void> {
  await expect(output(p).locator('[data-scm-output-state]')).toContainText('Done', { timeout: 30_000 });
  const toggle = output(p).getByRole('button', { expanded: false });
  if ((await toggle.count()) > 0) await toggle.first().click();
  await expect(output(p).locator('[data-scm-output-exit]')).toHaveText('Done');
}

// ---- the cases ---------------------------------------------------------------------------------------------------------------

test.describe('source control over a scratch repository', () => {
  test('lists the groups, draws diffs, stages, unstages, discards, deletes and commits with the hooks', async () => {
    test.setTimeout(120_000);
    await withScm({}, async (p) => {
      const { scratch } = p;
      await openTool(p);
      await expect(count(p, 'staged')).toHaveText('1');
      await expect(count(p, 'unstaged')).toHaveText('1');
      await expect(count(p, 'untracked')).toHaveText('2');
      await expect(row(p, 'staged', 'src/staged.ts')).toBeVisible();
      await expect(row(p, 'untracked', 'udir/')).toBeVisible();

      // src/app.ts's hunks in the diff body
      await row(p, 'unstaged', 'src/app.ts').locator('[data-scm-select]').click();
      await expect(tool(p).locator('[data-scm-file-header]')).toHaveText('src/app.ts · Modified');
      await expect(tool(p).locator('[data-scm-diff] [data-review-block]').first()).toBeVisible();
      await expect(tool(p).locator('[data-scm-diff] [data-review-block]').first()).toContainText(APP_EDIT);

      // untracked.txt as an all-added diff
      await row(p, 'untracked', 'untracked.txt').locator('[data-scm-select]').click();
      await expect(tool(p).locator('[data-scm-file-header]')).toHaveText('untracked.txt · Untracked');
      const block = tool(p).locator('[data-scm-diff] [data-review-block]').first();
      await expect(block).toContainText(UNTRACKED_TEXT[0]!);
      await expect(block).toContainText(UNTRACKED_TEXT[1]!);
      const operators = await block.locator('.diff-line-content-operator').allTextContents();
      expect(operators.length, 'the added lines draw their operator').toBeGreaterThanOrEqual(UNTRACKED_TEXT.length);
      expect(operators.every((operator) => operator.trim() === '+'), `every line added: ${JSON.stringify(operators)}`).toBe(true);

      // Stage, then Unstage. E11 (tracker row E6 "two short windows"): the stage's git.changed comes from main's
      // refresh of the watcher, within one status read of the stage's own answer, not from the watcher's 250 ms
      // trailing debounce after the index write (the buttons stage below; this one is timed through the bridge)
      const timed = await p.page.evaluate(async ([appSessionId, repoRoot]) => {
        let changedAt: number | null = null;
        const off = window.maws.on('git.changed', (event) => {
          if ((event as { repoRoot: string }).repoRoot === repoRoot && changedAt === null) changedAt = performance.now();
        });
        const answer = await window.maws.invoke('scm.stage', { appSessionId, paths: ['src/app.ts'] } as never);
        const answeredAt = performance.now();
        for (let waited = 0; changedAt === null && waited < 5_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
        off();
        return { ok: answer.ok, gap: changedAt === null ? null : changedAt - answeredAt };
      }, [scratch.appSessionId, scratch.dir] as const);
      expect(timed.ok).toBe(true);
      expect(timed.gap, 'git.changed arrived').not.toBeNull();
      expect(timed.gap!, `git.changed ${Math.round(timed.gap!)} ms after the stage answered`).toBeLessThan(150); // W-B review M4: well clear of a debounce-driven one (250 ms less the IPC)
      await expect(row(p, 'staged', 'src/app.ts')).toBeVisible();
      await expect(row(p, 'unstaged', 'src/app.ts')).toHaveCount(0);
      expect(gitNames(scratch, '--cached'), 'git agrees').toEqual(['src/app.ts', 'src/staged.ts']);
      expect(gitNames(scratch)).toEqual([]);
      await button(row(p, 'staged', 'src/app.ts'), 'Unstage src/app.ts').click();
      await expect(row(p, 'unstaged', 'src/app.ts')).toBeVisible();
      await expect(row(p, 'staged', 'src/app.ts')).toHaveCount(0);
      expect(gitNames(scratch, '--cached'), 'git agrees').toEqual(['src/staged.ts']);
      expect(gitNames(scratch)).toEqual(['src/app.ts']);

      // Discard asks first, naming the file, and needs the acknowledgement
      await button(row(p, 'unstaged', 'src/app.ts'), 'Discard changes to src/app.ts').click();
      const discard = sheet(p, 'discard');
      await expect(discard.getByRole('heading', { name: 'Discard changes' })).toBeVisible();
      await expect(discard.locator('[data-scm-sheet-path]')).toHaveText(['src/app.ts']);
      await expect(button(discard, 'Discard')).toBeDisabled();
      await discard.getByRole('checkbox', { name: 'Discard 1 change; this cannot be undone' }).check();
      await expect(button(discard, 'Discard')).toBeEnabled();
      await button(discard, 'Discard').click();
      await expect(discard).toHaveCount(0);
      await expect(row(p, 'unstaged', 'src/app.ts')).toHaveCount(0);
      expect(readFileSync(scratch.path('src/app.ts'), 'utf8'), 'the file is back to its staged content').toBe(`${APP_LINES.join('\n')}\n`);

      // Delete removes an untracked file
      await button(row(p, 'untracked', 'untracked.txt'), 'Delete untracked.txt').click();
      const deletion = sheet(p, 'discard');
      await expect(deletion.getByRole('heading', { name: 'Delete untracked files' })).toBeVisible();
      await expect(deletion.locator('[data-scm-sheet-path]')).toHaveText(['untracked.txt']);
      await expect(button(deletion, 'Delete')).toBeDisabled();
      await deletion.getByRole('checkbox', { name: 'Delete 1 file; this cannot be undone' }).check();
      await button(deletion, 'Delete').click();
      await expect(deletion).toHaveCount(0);
      await expect(row(p, 'untracked', 'untracked.txt')).toHaveCount(0);
      expect(existsSync(scratch.path('untracked.txt'))).toBe(false);

      // A commit runs the repository's pre-commit hook
      const message = tool(p).getByRole('textbox', { name: 'Commit message' });
      await message.fill('From the panel');
      await button(tool(p), 'Commit').click();
      await expect(tool(p).locator('[data-scm-last-commit]')).toHaveText(/^[0-9a-f]{7} · From the panel$/);
      expect(scratch.git('log', '-1', '--format=%s')).toBe('From the panel');
      expect(existsSync(scratch.marker), 'the hook ran').toBe(true);
      await expect(count(p, 'staged')).toHaveText('0');
      await showSummary(p);
      await expect(pushRow(p)).toContainText('2 ahead of origin/main');
      await showTool(p);

      // Skip hooks leaves no marker
      rmSync(scratch.marker);
      await button(row(p, 'untracked', 'udir/'), 'Stage udir/').click();
      await expect(row(p, 'staged', 'udir/x.txt')).toBeVisible();
      await message.fill('Without the hooks');
      await tool(p).getByRole('checkbox', { name: /Skip hooks/ }).check();
      await button(tool(p), 'Commit').click();
      await expect(tool(p).locator('[data-scm-last-commit]')).toHaveText(/ · Without the hooks$/);
      expect(scratch.git('log', '-1', '--format=%s')).toBe('Without the hooks');
      expect(existsSync(scratch.marker), 'the hook did not run').toBe(false);

      // A failing hook: its words in the notice's output, HEAD unchanged
      scratch.writeHook('echo nope\nexit 1');
      writeFileSync(scratch.path('later.txt'), 'later\n');
      await button(row(p, 'untracked', 'later.txt'), 'Stage later.txt').click();
      await expect(row(p, 'staged', 'later.txt')).toBeVisible();
      const head = scratch.git('rev-parse', 'HEAD');
      await expect(tool(p).getByRole('checkbox', { name: /Skip hooks/ }), 'Skip hooks is per commit').not.toBeChecked();
      await message.fill('Refused by the hook');
      await button(tool(p), 'Commit').click();
      const notice = tool(p).locator('[data-scm-notice="git_failed"]');
      await expect(notice).toBeVisible();
      await notice.locator('summary').click();
      await expect(notice.locator('pre')).toContainText('nope');
      expect(scratch.git('rev-parse', 'HEAD'), 'HEAD unchanged').toBe(head);
      await expect(row(p, 'staged', 'later.txt'), 'still staged').toBeVisible();
    });
  });

  test('pushes only through the confirm sheet, to every destination, and refuses a moved head', async () => {
    test.setTimeout(120_000);
    await withScm({}, async (p) => {
      const { scratch } = p;
      await openTool(p);
      const before = scratch.head(scratch.origin);

      // The sheet names the destination and the exact command; Cancel runs nothing
      let push = await openPushSheet(p);
      await expect(push.locator('[data-scm-plan-row="remote"]')).toContainText('origin');
      await expect(push.locator('[data-scm-destination]')).toHaveText([scratch.origin]);
      await expect(push.locator('[data-scm-plan-command]')).toHaveText(/\/git push --progress origin refs\/heads\/main:refs\/heads\/main$/); // the program's path is this machine's
      await button(push, 'Cancel').click();
      await expect(push).toHaveCount(0);
      await expect(output(p), 'nothing ran').toHaveCount(0);
      expect(scratch.head(scratch.origin), 'the origin is unchanged').toBe(before);

      // Push streams into the Output and lands
      push = await openPushSheet(p);
      await button(push, 'Push').click();
      await expect(push).toHaveCount(0);
      await expectRunDone(p);
      await expect(outputText(p)).toContainText('main -> main');
      expect(scratch.head(scratch.origin)).toBe(scratch.git('rev-parse', 'HEAD'));
      await showSummary(p);
      await expect(pushRow(p)).toContainText('Up to date with origin/main');
      await showTool(p);

      // Two push destinations: the sheet lists both and the push lands in both. The origin's own URL is added as a push
      // URL first: once a remote has any `pushurl`, git pushes to those alone.
      scratch.git('remote', 'set-url', '--push', '--add', 'origin', scratch.origin);
      scratch.git('remote', 'set-url', '--push', '--add', 'origin', scratch.pushRepo);
      scratch.git('commit', '--quiet', '--allow-empty', '--no-verify', '-m', 'second');
      push = await openPushSheet(p);
      await expect(push.locator('[data-scm-destination]')).toHaveText([scratch.origin, scratch.pushRepo]);
      await button(push, 'Push').click();
      await expect(push).toHaveCount(0);
      await expectRunDone(p);
      const second = scratch.git('rev-parse', 'HEAD');
      expect(scratch.head(scratch.origin)).toBe(second);
      expect(scratch.head(scratch.pushRepo), 'the push landed in push.git too').toBe(second);

      // A commit made while the sheet is open: the run is refused, re-planned, and nothing is pushed
      scratch.git('commit', '--quiet', '--allow-empty', '--no-verify', '-m', 'third');
      push = await openPushSheet(p);
      scratch.git('commit', '--quiet', '--allow-empty', '--no-verify', '-m', 'fourth');
      await button(push, 'Push').click();
      await expect(push.locator('[data-scm-sheet-note="changed"]')).toContainText('head changed since the sheet opened');
      await expect(push.locator('[data-scm-plan-command]'), 're-planned').toBeVisible();
      await expect(button(push, 'Push')).toBeEnabled();
      expect(scratch.head(scratch.origin), 'nothing was pushed').toBe(second);
      expect(scratch.head(scratch.pushRepo)).toBe(second);
      await button(push, 'Cancel').click();
      await expect(push).toHaveCount(0);
    });
  });

  test('opens a PR through gh with the confirmed repository and shows its state and checks', async () => {
    test.setTimeout(120_000);
    await withScm({ setup: (scratch) => scratch.git('push', '--quiet', 'origin', 'main') }, async (p) => {
      const { scratch } = p;
      await expect(pushRow(p)).toContainText('Up to date with origin/main');
      await expect(pushRow(p)).toContainText('No PR for main');
      await openTool(p);

      await expect(remoteAction(p, 'pr')).toBeEnabled();
      await remoteAction(p, 'pr').click();
      const pr = sheet(p, 'pr');
      await pr.getByRole('textbox', { name: 'Title' }).fill('Panel PR');
      await pr.getByRole('textbox', { name: 'Base' }).fill('main');
      await expect(pr.locator('[data-scm-plan-row="repository"]')).toContainText('o/r');
      await expect(pr.locator('[data-scm-plan-row="head"]')).toContainText('main');
      await expect(pr.locator('[data-scm-plan-command]')).toHaveText(`${scratch.ghPath} pr create --repo o/r --head main --base main '--title=Panel PR' --body=`);
      await expect(button(pr, 'Create pull request')).toBeEnabled();
      scratch.gh('view.none', null); // from now on gh has the PR
      await button(pr, 'Create pull request').click();
      await expect(pr).toHaveCount(0);

      await expectRunDone(p);
      await expect(outputText(p)).toContainText(PR_URL);
      await expect(button(output(p), 'Open PR #7 ↗')).toBeVisible();
      expect(scratch.createLog()).toEqual(['pr', 'create', '--repo', 'o/r', '--head', 'main', '--base', 'main', '--title=Panel PR', '--body=']);
      await expect(remoteAction(p, 'pr-link')).toHaveText('PR #7 ↗');

      await showSummary(p);
      const line = pushRow(p).getByTestId('pr-line');
      await expect(line).toHaveText('PR #7 Open · 2 passed, 1 pending');
      scratch.gh('checks.json', JSON.stringify(CHECKS_PASSED));
      scratch.gh('checks.exit', '0');
      await pushRow(p).getByRole('button', { name: 'Refresh PR state' }).click();
      await expect(line).toHaveText('PR #7 Open · 3 passed');
    });
  });

  test('a reload during a slow push shows the run from the latest-run snapshot', async () => {
    test.setTimeout(120_000);
    await withScm({ setup: (scratch) => scratch.slowGit() }, async (p) => {
      const { scratch } = p;
      await openTool(p);
      const push = await openPushSheet(p);
      await expect(push.locator('[data-scm-plan-command]'), 'the wrapper is the git the push runs').toContainText(`${scratch.root}/bin/git push --progress origin`);
      await button(push, 'Push').click();
      await expect(outputText(p)).toContainText('slow git: waiting 3 s');
      await expect(output(p).locator('[data-scm-output-state]')).toContainText('Running');

      await p.page.reload();
      await expect(sidebarOf(p.page).locator('[data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
      await expect(toolTab(p)).toBeVisible({ timeout: 10_000 });
      if ((await toolTab(p).getAttribute('aria-selected')) !== 'true') await toolTab(p).click();
      await expect(tool(p)).toBeVisible();
      // The first line went to the page before the reload: only the snapshot can show it now.
      await expectRunDone(p);
      await expect(outputText(p)).toContainText('slow git: waiting 3 s');
      await expect(outputText(p)).toContainText('main -> main');
      expect(scratch.head(scratch.origin)).toBe(scratch.git('rev-parse', 'HEAD'));
    });
  });

  test('without gh the row offers the install', async () => {
    await withScm({ gh: 'none' }, async (p) => {
      await expect(pushRow(p).getByTestId('pr-line')).toHaveText('GitHub CLI not installed · Install');
      await expect(button(pushRow(p), 'Install')).toBeVisible();
    });
  });

  test('with gh signed out the row offers the sign-in', async () => {
    await withScm({ ghState: 'unauthenticated', setup: (scratch) => scratch.gh('auth.exit', '1') }, async (p) => {
      await expect(pushRow(p).getByTestId('pr-line')).toHaveText('GitHub CLI not signed in · Sign in');
      await expect(button(pushRow(p), 'Sign in')).toBeVisible();
    });
  });

  test('an untrusted checkout is listed with every action disabled, and main refuses a stage', async () => {
    await withScm({ trust: false }, async (p) => {
      const { scratch } = p;
      await expect(pushRow(p)).toContainText('Trust this folder to see PR state');
      await openTool(p);
      await expect(tool(p).locator('[data-scm-untrusted]')).toHaveText(UNTRUSTED);
      await expect(count(p, 'untracked')).toHaveText('2');
      const actions = tool(p).locator('[data-scm-action]');
      expect(await actions.count()).toBeGreaterThan(0);
      for (const action of await actions.all()) await expect(action).toBeDisabled();
      await expect(remoteAction(p, 'push')).toBeDisabled();
      await expect(remoteAction(p, 'pr')).toBeDisabled();
      await tool(p).getByRole('textbox', { name: 'Commit message' }).fill('Not here');
      await expect(button(tool(p), 'Commit')).toBeDisabled();

      const before = porcelain(scratch);
      const result = await invoke(p.page, 'scm.stage', { appSessionId: scratch.appSessionId, paths: ['src/app.ts'] });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.value).toMatchObject({ refused: 'untrusted' });
      expect(porcelain(scratch), 'nothing staged').toBe(before);
    });
  });

  test('the tool and its sheets use tokens only in both themes', async () => {
    test.setTimeout(150_000);
    const themes = ['light', 'dark'] as const;
    const setTheme = async (p: Scm, theme: (typeof themes)[number]) => {
      await menu(p.maws, `theme.${theme}`);
      await expect(p.page.locator('html')).toHaveAttribute('data-theme', theme);
    };
    const scan = async (p: Scm, what: string) => expect(await otherThemeColours(p.page), what).toEqual([]);
    await withScm({}, async (p) => {
      await openTool(p);
      await row(p, 'unstaged', 'src/app.ts').locator('[data-scm-select]').click();
      await expect(tool(p).locator('[data-scm-diff] [data-review-block]').first()).toBeVisible();
      for (const theme of themes) {
        await setTheme(p, theme);
        await scan(p, `${theme}: the tool with src/app.ts's hunks`);
        await shot(p.panel, `scm-panel-${theme}.png`);

        await button(row(p, 'unstaged', 'src/app.ts'), 'Discard changes to src/app.ts').click();
        await expect(sheet(p, 'discard').locator('[data-scm-sheet-path]')).toHaveText(['src/app.ts']);
        await scan(p, `${theme}: the Discard sheet`);
        await shot(sheet(p, 'discard'), `discard-sheet-${theme}.png`);
        await button(sheet(p, 'discard'), 'Cancel').click();
        await expect(sheet(p, 'discard')).toHaveCount(0);

        const push = await openPushSheet(p);
        await scan(p, `${theme}: the Push sheet`);
        await shot(push, `push-confirm-${theme}.png`);
        await button(push, 'Cancel').click();
        await expect(push).toHaveCount(0);
      }

      // Pushed and even, the PR sheet opens; with a PR on gh, the summary's row shows it.
      const push = await openPushSheet(p);
      await button(push, 'Push').click();
      await expectRunDone(p);
      for (const theme of themes) {
        await setTheme(p, theme);
        await scan(p, `${theme}: the tool with the Output`);
        await expect(remoteAction(p, 'pr')).toBeEnabled();
        await remoteAction(p, 'pr').click();
        await expect(sheet(p, 'pr').locator('[data-scm-plan-command]')).toBeVisible();
        await scan(p, `${theme}: the PR sheet`);
        await button(sheet(p, 'pr'), 'Cancel').click();
        await expect(sheet(p, 'pr')).toHaveCount(0);
      }
      p.scratch.gh('view.none', null);
      await showSummary(p);
      await pushRow(p).getByRole('button', { name: 'Refresh PR state' }).click();
      await expect(pushRow(p).getByTestId('pr-line')).toHaveText('PR #7 Open · 2 passed, 1 pending');
      await p.page.mouse.move(0, 0); // the row as it rests, Refresh neither hovered nor focused
      await p.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      for (const theme of themes) {
        await setTheme(p, theme);
        await scan(p, `${theme}: the summary with the PR line`);
        await shot(pushRow(p), `pr-state-row-${theme}.png`);
      }
    });
  });
});
