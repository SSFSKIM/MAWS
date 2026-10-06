// E6's scratch repository, fake `gh` and launch seam for `e2e/scm.spec.ts` (E6 execution document, Plan of Work T6.1 and
// Interfaces *Harness and e2e*). Everything lives under one `mkdtemp` directory in /tmp (a realpath, `/private/tmp/…`,
// which is also the repository's trust key): the repository `repo` on `main`, tracked to a local bare `origin.git` and
// one commit ahead of it, with one unstaged, one staged and two untracked entries; a second bare `push.git` for the
// several-destinations case; a `pre-commit` hook that leaves a marker; and `bin/gh`, a shell script answering the gh
// calls MAWS makes from files under `gh/`. No remote command can reach a real forge: the remotes are local paths and the
// only `gh` on the captured PATH is this one (the spec asserts `scm.status`'s `gh.path` before any PR case).
//
// `prepareScm` is the launcher's `prepare`: the scratch shell home's `.zshrc`, the last file an interactive login zsh
// reads (after `/etc/zprofile`'s path_helper), puts `bin/` first on the captured PATH, or for `gh: 'none'` replaces the
// PATH with one that holds no gh; and with `trust` the launch's config home trusts the repository as the engine would.
import { isolatedGitEnv } from '../../test/support/git-env';
import { execFileSync } from 'node:child_process';
import { accessSync, appendFileSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { CHARTER, panelScenario } from './panel-support';

// src/app.ts as committed, and the line the scratch's working tree inserts (the Unstaged entry).
export const APP_LINES = ['export function app(): number {', '  const answer = 42;', '  return answer;', '}'];
export const APP_EDIT = '// edited in the working tree';
export const UNTRACKED_TEXT = ['an untracked file', 'with two lines'];
export const PR_URL = 'https://github.com/o/r/pull/7';

// The fake gh's answers (gh 2.97.0's documented fields, as M2's fixtures).
const REPO_JSON = { nameWithOwner: 'o/r', url: 'https://github.com/o/r' };
const VIEW_JSON = {
  number: 7, url: PR_URL, title: 'Panel PR', state: 'OPEN', isDraft: false, reviewDecision: '', baseRefName: 'main', headRefName: 'main', mergeStateStatus: 'BLOCKED',
};
const check = (name: string, bucket: 'pass' | 'pending', state: string) => ({ name, bucket, state, link: `https://github.com/o/r/actions/runs/1/job/${name}`, workflow: 'CI' });
const CHECKS_MIXED = [check('typecheck', 'pass', 'SUCCESS'), check('lint', 'pass', 'SUCCESS'), check('test', 'pending', 'IN_PROGRESS')];
export const CHECKS_PASSED = [check('typecheck', 'pass', 'SUCCESS'), check('lint', 'pass', 'SUCCESS'), check('test', 'pass', 'SUCCESS')];

export interface ScmScratch {
  root: string; // the mkdtemp directory under /tmp (a realpath)
  dir: string; // the repository: the session's checkout and its trust key
  origin: string; // the bare `origin`
  pushRepo: string; // a second bare repository, added as a push destination by a case
  appSessionId: string; // the *Charter + research* record's id
  ghPath: string; // `<root>/bin/gh`, the fake
  marker: string; // what the pre-commit hook writes
  env: Record<string, string>; // the product launch's environment
  path(relative: string): string; // a path in the repository
  git(...args: string[]): string; // git in the repository, under an isolated environment
  head(bare: string): string | null; // `refs/heads/main` of a bare repository, null when it has none
  gh(name: string, content: string | null): void; // writes (or, with null, removes) one of the fake's files under gh/
  createLog(): string[]; // the arguments of every `gh pr create`, one per line
  writeHook(script: string): void; // replaces the pre-commit hook's body (after its shebang)
  slowGit(): void; // `bin/git`: says it waits, sleeps 3 s, then execs the real git (the reload case only)
  cleanup(): void;
}

// The first executable `git` on this runner's PATH (absolute entries only), which the slow wrapper execs.
function realGit(): string {
  for (const entry of (process.env.PATH ?? '').split(':')) {
    if (!isAbsolute(entry)) continue;
    const candidate = join(entry, 'git');
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return '/usr/bin/git';
}

const sh = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

// The fake gh: dispatches on its first two arguments, every call appended to gh/calls.log.
function ghScript(ghDir: string): string {
  const g = sh(ghDir);
  return `#!/bin/sh
G=${g}
printf '%s\\n' "$*" >> "$G/calls.log"
if [ "$1" = "--version" ]; then echo "gh version 2.97.0 (fake)"; exit 0; fi
case "$1 $2" in
  "auth status")
    code=0; [ -f "$G/auth.exit" ] && code=$(cat "$G/auth.exit")
    [ "$code" = 0 ] || echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2
    exit "$code" ;;
  "repo view") cat "$G/repo.json"; exit 0 ;;
  "pr view")
    if [ -f "$G/view.none" ]; then echo 'no pull requests found for branch "main"' >&2; exit 1; fi
    cat "$G/view.json"; exit 0 ;;
  "pr checks")
    cat "$G/checks.json"; code=8; [ -f "$G/checks.exit" ] && code=$(cat "$G/checks.exit")
    exit "$code" ;;
  "pr create")
    for arg in "$@"; do printf '%s\\n' "$arg"; done >> "$G/create.log"
    echo ${sh(PR_URL)}; exit 0 ;;
  "pr diff") cat "$G/diff.patch"; exit 0 ;;
esac
echo "fake gh: unexpected $*" >&2
exit 1
`;
}

export function buildScmScratch(): ScmScratch {
  const root = realpathSync(mkdtempSync('/tmp/maws-scm-'));
  try {
    return buildIn(root);
  } catch (error) {
    rmSync(root, { recursive: true, force: true }); // a step failed mid-build: no case will clean this root
    throw error;
  }
}

function buildIn(root: string): ScmScratch {
  const dir = join(root, 'repo');
  const origin = join(root, 'origin.git');
  const pushRepo = join(root, 'push.git');
  const bin = join(root, 'bin');
  const ghDir = join(root, 'gh');
  const marker = join(root, 'hook-ran');
  const hook = join(dir, '.git/hooks/pre-commit');
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: isolatedGitEnv(), encoding: 'utf8' }).trim();
  const write = (relative: string, content: string) => {
    const path = join(dir, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };
  const lines = (list: readonly string[]) => `${list.join('\n')}\n`;
  const writeHook = (script: string) => {
    writeFileSync(hook, `#!/bin/sh\n${script}\n`);
    chmodSync(hook, 0o755);
  };

  run(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
  run(root, 'init', '--quiet', '--bare', '-b', 'main', pushRepo);
  mkdirSync(dir);
  run(dir, 'init', '--quiet', '-b', 'main');
  // The repository's own settings, so the owner's global ones (a hooks path, signing, an identity) cannot change what a
  // panel commit does here: MAWS's mutating runner reads the owner's HOME, as a terminal would.
  run(dir, 'config', 'user.name', 'MAWS Fixture');
  run(dir, 'config', 'user.email', 'fixture@maws.invalid');
  run(dir, 'config', 'core.hooksPath', join(dir, '.git/hooks'));
  run(dir, 'config', 'commit.gpgsign', 'false');
  write('src/app.ts', lines(APP_LINES));
  write('README.md', '# Scratch\n');
  run(dir, 'add', '-A');
  run(dir, 'commit', '--quiet', '-m', 'scratch');
  run(dir, 'remote', 'add', 'origin', origin);
  run(dir, 'push', '--quiet', 'origin', 'main');
  run(dir, 'branch', '--quiet', '-u', 'origin/main');
  run(dir, 'remote', 'set-head', 'origin', 'main'); // as a clone has it: the default base is `main`
  write('README.md', '# Scratch\n\nOne commit ahead.\n');
  run(dir, 'commit', '--quiet', '-am', 'ahead');

  write('src/app.ts', lines([APP_EDIT, ...APP_LINES])); // Unstaged
  write('src/staged.ts', 'export const staged = true;\n');
  run(dir, 'add', 'src/staged.ts'); // Staged
  write('untracked.txt', lines(UNTRACKED_TEXT)); // Untracked
  write('udir/x.txt', 'inside an untracked directory\n'); // Untracked, as `udir/`
  writeHook(`touch ${sh(marker)}\nexit 0`);

  mkdirSync(bin);
  mkdirSync(join(root, 'bin-empty'));
  mkdirSync(ghDir);
  const ghPath = join(bin, 'gh');
  writeFileSync(ghPath, ghScript(ghDir));
  chmodSync(ghPath, 0o755);
  const gh = (name: string, content: string | null) => {
    if (content === null) rmSync(join(ghDir, name), { force: true });
    else writeFileSync(join(ghDir, name), content);
  };
  gh('repo.json', JSON.stringify(REPO_JSON));
  gh('view.json', JSON.stringify(VIEW_JSON));
  gh('view.none', ''); // no PR until a case says there is one
  gh('checks.json', JSON.stringify(CHECKS_MIXED));

  const scenario = panelScenario(root, dir);
  const record = (JSON.parse(readFileSync(scenario, 'utf8')) as { sessions: { appId: string; title: { text: string } }[] }).sessions.find((s) => s.title.text === CHARTER)!;
  return {
    root,
    dir,
    origin,
    pushRepo,
    appSessionId: record.appId,
    ghPath,
    marker,
    // MAWS_GIT and MAWS_GH emptied, so nothing inherited overrides the programs the captured PATH resolves.
    env: { MAWS_SESSION_SOURCE: `stub:${scenario}`, MAWS_HARNESS: '0', MAWS_SCENARIO_CLOCK: 'manual', MAWS_GIT: '', MAWS_GH: '' },
    path: (relative) => join(dir, relative),
    git: (...args) => run(dir, ...args),
    head: (bare) => {
      try {
        return execFileSync('git', ['--git-dir', bare, 'rev-parse', '--verify', '--quiet', 'refs/heads/main'], { env: isolatedGitEnv(), encoding: 'utf8' }).trim();
      } catch {
        return null;
      }
    },
    gh,
    createLog: () => (existsSync(join(ghDir, 'create.log')) ? readFileSync(join(ghDir, 'create.log'), 'utf8').split('\n').filter((line) => line !== '') : []),
    writeHook,
    slowGit: () => {
      const wrapper = join(bin, 'git');
      writeFileSync(wrapper, `#!/bin/sh\necho "slow git: waiting 3 s" >&2\nsleep 3\nexec ${sh(realGit())} "$@"\n`);
      chmodSync(wrapper, 0o755);
    },
    cleanup: () => {
      // The app's will-quit dispose stops its remote runs; this stops only a leftover process whose argv names the
      // scratch (the slow-git wrapper, a receive-pack into a bare remote) before the files go.
      try {
        execFileSync('pkill', ['-f', root]);
      } catch {
        // none left (pkill exits 1)
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// The launcher's `prepare` for a scratch: the captured PATH begins with the fake gh's directory (`fake`) or holds no gh
// at all (`none`), and `trust` records the repository as trusted in the launch's config home, keyed by its realpath
// (the trust key of a main checkout is its root), exactly as the engine records it.
export function prepareScm(scratch: ScmScratch, { trust, gh }: { trust: boolean; gh: 'fake' | 'none' }) {
  return ({ shellHome, claudeConfigDir }: { shellHome: string; claudeConfigDir: string }): void => {
    const path = gh === 'fake' ? `export PATH=${sh(join(scratch.root, 'bin'))}:"$PATH"\n` : `export PATH=${sh(join(scratch.root, 'bin-empty'))}:/usr/bin:/bin:/usr/sbin:/sbin\n`;
    for (const file of ['.zshrc', '.bash_profile']) appendFileSync(join(shellHome, file), path);
    if (trust) writeFileSync(join(claudeConfigDir, '.claude.json'), JSON.stringify({ projects: { [scratch.dir]: { hasTrustDialogAccepted: true } } }, null, 2));
  };
}
