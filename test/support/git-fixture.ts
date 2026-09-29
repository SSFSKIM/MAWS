// Temporary git repositories for the read-only git service's tests (C4 execution document, M6). Everything here runs
// `git` against a fresh directory under the system temp root and nothing else: never this checkout, never the owner's
// repositories, never `~/.claude`. The fixture's own git calls write (init, commit, worktree add, push to a local bare
// remote); the service under test only reads. Global and system configuration are ignored and identity is fixed, so a
// run does not depend on the machine's git setup, and no GIT_* variable of the calling process leaks in.
import { execFile } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const GIT = '/usr/bin/git';

function isolatedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'MAWS Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@maws.invalid',
    GIT_COMMITTER_NAME: 'MAWS Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@maws.invalid',
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(GIT, ['-C', cwd, ...args], { env: isolatedEnv(), encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args.join(' ')} failed in ${cwd}: ${stderr || error.message}`));
      else resolve(stdout);
    });
  });
}

export class GitFixture {
  private readonly temps: string[] = [];

  private constructor(readonly root: string) {
    this.temps.push(root);
  }

  // A repository on `main` with one commit (`README.md`, one line).
  static async create(): Promise<GitFixture> {
    const fixture = new GitFixture(realpathSync(mkdtempSync(join(tmpdir(), 'maws-git-'))));
    await fixture.git('init', '-q', '-b', 'main');
    await fixture.write('README.md', 'hello\n');
    await fixture.git('add', 'README.md');
    await fixture.git('commit', '-q', '-m', 'initial');
    return fixture;
  }

  git(...args: string[]): Promise<string> {
    return runGit(this.root, args);
  }

  path(rel: string): string {
    return join(this.root, rel);
  }

  async write(rel: string, content: string): Promise<string> {
    const path = this.path(rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return path;
  }

  // Sets the file's mtime (and atime) to a whole second, a value `utimes` can restore exactly.
  async setMtime(rel: string, epochSeconds: number): Promise<void> {
    await utimes(this.path(rel), epochSeconds, epochSeconds);
  }

  // Writes the file's current bytes back and restores its mtime: a save that changes nothing git or a stat can see.
  // Exact only for an mtime `utimes` can represent (see setMtime); a sub-millisecond one moves by the rounding.
  async rewriteIdentical(rel: string): Promise<void> {
    const path = this.path(rel);
    const [content, before] = await Promise.all([readFile(path), stat(path)]);
    await writeFile(path, content);
    await utimes(path, before.atimeMs / 1000, before.mtimeMs / 1000);
  }

  // `git worktree add .claude/worktrees/wt -b wt` inside this temporary repository; answers the worktree's path.
  async addWorktree(name = 'wt'): Promise<string> {
    await this.git('worktree', 'add', '-q', `.claude/worktrees/${name}`, '-b', name);
    return this.path(`.claude/worktrees/${name}`);
  }

  // A local bare repository (a sibling temp directory, no network) added as `origin`, pushed to, and set as `main`'s
  // upstream with `git branch -u origin/main`; answers the remote's URL as configured.
  async addBareRemote(): Promise<string> {
    const bare = realpathSync(mkdtempSync(join(tmpdir(), 'maws-git-remote-')));
    this.temps.push(bare);
    await runGit(bare, ['init', '-q', '--bare', '-b', 'main']);
    await this.git('remote', 'add', 'origin', bare);
    await this.git('push', '-q', 'origin', 'main');
    await this.git('branch', '-q', '-u', 'origin/main');
    return bare;
  }

  dispose(): void {
    for (const dir of this.temps) rmSync(dir, { recursive: true, force: true });
  }
}
