// C8a's end-to-end support (C8a execution document, M4): the scratch git repository the summary's cases read through
// C4's real git service, the scenario file derived from C5's nine-sessions.json, and the theme scan in C5's smoke's
// manner (its helpers live inside `e2e/shell.spec.ts`, which is C5's; the two below are the same probe, restated).
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { REPO_ROOT } from './launch';

// ---- the scratch repository --------------------------------------------------------------------------------------------

export interface ScratchRepository {
  dir: string; // the working tree (a real path: C4 reports roots resolved, and the git store matches them)
  dirtyFile: string; // the tracked file with one uncommitted line
  append(line: string): void; // one more line in the dirty file
  git(...args: string[]): string;
  cleanup(): void;
}

// Isolated from the machine's git configuration, so hooks, signing or a default branch name cannot change the facts.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'MAWS e2e',
  GIT_AUTHOR_EMAIL: 'e2e@maws.invalid',
  GIT_COMMITTER_NAME: 'MAWS e2e',
  GIT_COMMITTER_EMAIL: 'e2e@maws.invalid',
};

// `main` with three commits, the second pushed to a local bare `origin` and tracked (`git branch -u origin/main`), the
// third not pushed; then one tracked file edited by one appended line and one untracked file. So the summary reads
// `⎇ main`, `+1 −0 across 2 files · 1 untracked` and `1 ahead of origin/main`, and no "Open on GitHub" (a local remote).
export function scratchRepository(): ScratchRepository {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-panel-repo-')));
  const dir = join(root, 'repo');
  const origin = join(root, 'origin.git');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
  git(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
  mkdirSync(dir);
  git(dir, 'init', '--quiet', '-b', 'main');
  const commit = (file: string, text: string, message: string) => {
    writeFileSync(join(dir, file), text);
    git(dir, 'add', file);
    git(dir, 'commit', '--quiet', '-m', message);
  };
  commit('notes.txt', 'one\n', 'one');
  commit('plan.txt', 'two\n', 'two');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '--quiet', 'origin', 'main');
  git(dir, 'branch', '--quiet', '-u', 'origin/main');
  commit('later.txt', 'three\n', 'three');
  const dirtyFile = join(dir, 'notes.txt');
  appendFileSync(dirtyFile, 'edited\n');
  writeFileSync(join(dir, 'untracked.txt'), 'new\n');
  return {
    dir,
    dirtyFile,
    append: (line) => appendFileSync(dirtyFile, `${line}\n`),
    git: (...args) => git(dir, ...args),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ---- the scenario (acceptance item 2's product-host cases) ---------------------------------------------------------------

export const CHARTER = 'Charter + research'; // the record pointed at the scratch repository
export const SIDEBAR_DRAG = 'Fix sidebar drag'; // left at its probe directory, which does not exist here

// C5's nine-sessions.json copied as `panel-scenario.json` into `into`, the *Charter + research* record's directory
// rewritten to `directory`; C5's file is not edited. Returns the copy's path.
export function panelScenario(into: string, directory: string): string {
  const scenario = JSON.parse(readFileSync(join(REPO_ROOT, 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as { sessions: { title: { text: string }; directory: string }[] };
  const record = scenario.sessions.find((session) => session.title.text === CHARTER);
  if (!record) throw new Error(`nine-sessions.json has no ${CHARTER}`);
  record.directory = directory;
  const path = join(into, 'panel-scenario.json');
  writeFileSync(path, JSON.stringify(scenario, null, 2));
  return path;
}

// ---- themes (C5's smoke: e2e/shell.spec.ts, *themes*) ----------------------------------------------------------------------

const COLOUR_TOKENS = [
  '--bg', '--bg-raised', '--bg-overlay', '--bg-hover', '--bg-active', '--border', '--border-strong', '--fg', '--fg-muted', '--fg-faint',
  '--accent', '--accent-soft', '--success', '--warning', '--danger', '--info', '--diff-add-bg', '--diff-del-bg',
] as const;
type Palette = Record<(typeof COLOUR_TOKENS)[number], string>;

// Every colour token resolved to its computed colour under each theme, by probing inside a `[data-theme]` element.
export async function themeTokens(page: Page): Promise<{ light: Palette; dark: Palette }> {
  return page.evaluate((names) => {
    const resolve = (theme: string) => {
      const host = document.createElement('div');
      host.setAttribute('data-theme', theme);
      const probe = document.createElement('span');
      host.append(probe);
      document.body.append(host);
      const out: Record<string, string> = {};
      for (const name of names) {
        probe.style.color = `var(${name})`;
        out[name] = getComputedStyle(probe).color;
      }
      host.remove();
      return out;
    };
    return { light: resolve('light'), dark: resolve('dark') } as { light: Palette; dark: Palette };
  }, COLOUR_TOKENS);
}

// Elements (portals included: the "+" menu) whose background, text or border colour is a colour only the other theme's
// tokens produce. Returns the first few offenders, described.
export async function otherThemeColours(page: Page): Promise<string[]> {
  const themed = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const tokens = await themeTokens(page);
  const [own, other] = themed === 'dark' ? [tokens.dark, tokens.light] : [tokens.light, tokens.dark];
  const forbidden = [...new Set(Object.values(other))].filter((colour) => !Object.values(own).includes(colour));
  return page.evaluate((forbidden) => {
    const props = ['background-color', 'color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const style = getComputedStyle(el);
      for (const prop of props) {
        const value = style.getPropertyValue(prop);
        if (forbidden.includes(value)) {
          offenders.push(`${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}.${el.className} ${prop} ${value}`);
          break;
        }
      }
      if (offenders.length >= 8) break;
    }
    return offenders;
  }, forbidden);
}
