// C8a's live check (C8a execution document, acceptance item 3), through Playwright against the product build: the summary
// over this repository's checkout, read through C4's real git service, against what git itself answers. Nothing here
// edits this checkout: the edits, the commit and the GitHub-form remote are made in a scratch clone of it. The sessions
// come from a scenario derived from C5's nine-sessions.json (records pointed at the checkout, the clone and a directory
// that is not a repository), not from the real index, which reads the owner's ~/.claude. Run on purpose only:
//   pnpm build && MAWS_PANEL_LIVE=1 pnpm exec playwright test e2e/panel-live.spec.ts
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Locator } from '@playwright/test';
import { launchMaws, REPO_ROOT, test } from './support/launch';
import { sidebarOf, sidebarRow } from './support/sidebar';

test.skip(process.env.MAWS_PANEL_LIVE !== '1', 'the live check runs only under MAWS_PANEL_LIVE=1');

const ASSUMED_REPOSITORY = 'SSFSKIM/MAWS'; // used only when this checkout has no GitHub remote of its own
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
const tryGit = (cwd: string, ...args: string[]) => {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
};

// The change line git's own answers imply, in the summary's copy: `git diff HEAD --numstat` summed (binary rows counted
// apart), the files `git status --porcelain` lists, its untracked ones.
function expectedChangeLine(dir: string): string {
  const porcelain = git(dir, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);
  if (porcelain.length === 0) return 'Clean';
  let insertions = 0;
  let deletions = 0;
  let binary = 0;
  for (const line of git(dir, 'diff', 'HEAD', '--numstat').split('\n').filter(Boolean)) {
    const [add, del] = line.split('\t');
    if (add === '-') binary += 1;
    else [insertions, deletions] = [insertions + Number(add), deletions + Number(del)];
  }
  const untracked = porcelain.filter((line) => line.startsWith('??')).length;
  const files = porcelain.length;
  return `+${insertions} −${deletions} across ${files} ${files === 1 ? 'file' : 'files'}${untracked ? ` · ${untracked} untracked` : ''}${binary ? ` · ${binary} binary` : ''}`;
}

function expectedPush(dir: string): string {
  const upstream = tryGit(dir, 'rev-parse', '--abbrev-ref', '@{u}');
  if (!upstream) return 'Not pushed';
  const ahead = Number(git(dir, 'rev-list', '--count', '@{u}..HEAD'));
  const behind = Number(git(dir, 'rev-list', '--count', 'HEAD..@{u}'));
  return `${ahead > 0 ? `${ahead} ahead of ${upstream}` : `Up to date with ${upstream}`}${behind > 0 ? ` · ${behind} behind` : ''}`;
}

// `<owner>/<repo>` of a GitHub remote in any of its forms (git@github.com:o/r.git, ssh://git@github.com/o/r.git,
// https://github.com/o/r(.git)), else null.
function githubRepository(remote: string | null): string | null {
  const match = remote && /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote);
  return match ? `${match[1]}/${match[2]}` : null;
}

test('live: the summary over this repository matches git', async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maws-panel-live-')));
  const branch = git(REPO_ROOT, 'rev-parse', '--abbrev-ref', 'HEAD');
  // The clone's remote: this checkout's own GitHub repository when it has one, else an assumed one (annotated).
  const origin = tryGit(REPO_ROOT, 'remote', 'get-url', 'origin');
  const derived = githubRepository(origin);
  const repository = derived ?? ASSUMED_REPOSITORY;
  test.info().annotations.push({
    type: 'GitHub repository',
    description: derived ? `${repository}, from this checkout's origin (${origin})` : `${repository}, assumed: this checkout has ${origin ? `a non-GitHub origin (${origin})` : 'no origin remote'}`,
  });
  const clone = join(scratch, 'clone');
  git(scratch, 'clone', '--quiet', '--branch', branch, REPO_ROOT, clone);
  git(clone, 'remote', 'set-url', 'origin', `https://github.com/${repository}.git`);
  const plain = join(scratch, 'not-a-repository');
  mkdirSync(plain);

  const scenario = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as { sessions: { title: { text: string }; directory: string }[] };
  const point = (title: string, directory: string) => (scenario.sessions.find((s) => s.title.text === title)!.directory = directory);
  point('Charter + research', REPO_ROOT);
  point('Fix sidebar drag', clone);
  point('Sidebar interaction pass', plain);
  writeFileSync(join(scratch, 'panel-live.json'), JSON.stringify(scenario));

  const maws = await launchMaws({ env: { MAWS_SESSION_SOURCE: `stub:${join(scratch, 'panel-live.json')}`, MAWS_SCENARIO_CLOCK: 'manual', MAWS_HARNESS: '0' } });
  const observed: Record<string, unknown> = {};
  try {
    const { page, app } = maws;
    const panel = page.locator('[data-region="panel"]');
    const summary = panel.getByRole('tabpanel', { name: 'Session overview' });
    const section = (name: string): Locator => summary.getByRole('region', { name });
    const changeLine = summary.getByTestId('change-line');
    // W11: a session's row shows in its expanded project, expanded first, once the stub's records are in.
    const open = async (title: string) => {
      await expect(sidebarOf(page).locator('[data-kind="project"]').first()).toBeVisible({ timeout: 10_000 });
      await (await sidebarRow(page, title)).click();
      await expect(summary.getByRole('heading', { level: 2 })).toContainText(title);
    };

    await test.step('this checkout: branch, change line and push state as git reports them', async () => {
      await open('Charter + research');
      const line = expectedChangeLine(REPO_ROOT);
      const push = expectedPush(REPO_ROOT);
      await expect(section('Environment')).toContainText(`⎇ ${branch}`);
      await expect(changeLine).toHaveText(line);
      await expect(section('Push state')).toContainText(push);
      Object.assign(observed, { checkout: { branch, line, push, revList: tryGit(REPO_ROOT, 'rev-list', '--count', '@{u}..HEAD') ?? 'no upstream' } });
    });

    await test.step('a scratch clone with a GitHub remote: push state, Open on GitHub, one commit ahead, two edits', async () => {
      await app.evaluate(({ shell }) => {
        const opened: string[] = [];
        (globalThis as { __opened?: string[] }).__opened = opened;
        shell.openExternal = async (url: string) => void opened.push(url);
      });
      await open('Fix sidebar drag');
      await expect(section('Push state')).toContainText(expectedPush(clone)); // up to date with origin/<branch>
      await section('Push state').getByRole('button', { name: 'Open on GitHub' }).click();
      await expect.poll(() => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened)).toEqual([`https://github.com/${repository}/tree/${branch}`]);
      observed.openOnGitHub = (await app.evaluate(() => (globalThis as { __opened?: string[] }).__opened))?.[0];

      writeFileSync(join(clone, 'panel-live-note.txt'), 'scratch\n');
      git(clone, 'add', 'panel-live-note.txt');
      git(clone, '-c', 'user.name=MAWS e2e', '-c', 'user.email=e2e@maws.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'scratch');
      await expect(section('Push state')).toContainText(expectedPush(clone));
      observed.cloneAhead = { push: expectedPush(clone), revList: git(clone, 'rev-list', '--count', '@{u}..HEAD') };
      await expect(changeLine).toHaveText('Clean');

      const edits: { line: string; ms: number }[] = [];
      for (const text of ['first live edit', 'second live edit']) {
        const written = Date.now();
        appendFileSync(join(clone, 'CLAUDE.md'), `\n${text}\n`);
        const line = expectedChangeLine(clone);
        await expect(changeLine).toHaveText(line, { timeout: 2_000 });
        edits.push({ line, ms: Date.now() - written });
      }
      observed.edits = edits;
    });

    await test.step('a directory that is not a repository', async () => {
      await open('Sidebar interaction pass');
      await expect(section('Environment')).toContainText('Not a git repository');
    });
    expect(maws.consoleErrors()).toEqual([]);
  } finally {
    test.info().annotations.push({ type: 'observed', description: JSON.stringify(observed) });
    await maws.cleanup();
    rmSync(scratch, { recursive: true, force: true });
  }
});
