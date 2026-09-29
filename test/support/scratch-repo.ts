// A temporary git repository shaped like a project the trust card asks about (C10 execution document, Repository map):
// commits, a `.claude/settings.json` carrying an allow rule, a hook, a marketplace and a plugin, a `.mcp.json` server,
// and linked worktrees on demand. Built on C4's GitFixture (isolated git configuration, fixed identity, temp root
// only), so nothing here touches this checkout, the owner's repositories or `~/.claude`.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitFixture, runGit } from './git-fixture';

export const SCRATCH_RULE = 'Bash(echo SCRATCH_SENTINEL:*)';

export const SCRATCH_SETTINGS = {
  permissions: { allow: [SCRATCH_RULE] },
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'true' }] }] },
  enableAllProjectMcpServers: true,
  extraKnownMarketplaces: { 'scratch-market': { source: { source: 'directory', path: '/tmp/scratch-market' } } },
  enabledPlugins: { 'scratch-plugin@scratch-market': true },
};
export const SCRATCH_MCP = { mcpServers: { 'scratch-sentinel': { command: 'node', args: ['server.mjs'] } } };

export class ScratchRepo {
  private readonly temps: string[] = []; // scratch directories beside the repository (C10 M2)

  private constructor(readonly fixture: GitFixture) {}

  get root(): string {
    return this.fixture.root;
  }

  // The repository with the settings and `.mcp.json` committed, so every worktree carries them.
  static async create(opts: { sentinels?: boolean } = {}): Promise<ScratchRepo> {
    const repo = new ScratchRepo(await GitFixture.create());
    if (opts.sentinels !== false) {
      await repo.fixture.write('.claude/settings.json', `${JSON.stringify(SCRATCH_SETTINGS, null, 2)}\n`);
      await repo.fixture.write('.mcp.json', `${JSON.stringify(SCRATCH_MCP, null, 2)}\n`);
      await repo.fixture.git('add', '.claude/settings.json', '.mcp.json');
      await repo.fixture.git('commit', '-q', '-m', 'sentinels');
    }
    return repo;
  }

  path(rel: string): string {
    return this.fixture.path(rel);
  }

  git(...args: string[]): Promise<string> {
    return this.fixture.git(...args);
  }

  // A managed worktree `<root>/.claude/worktrees/<name>` on branch `worktree-<name>`, the engine's convention.
  async addManagedWorktree(name: string): Promise<string> {
    await this.fixture.git('worktree', 'add', '-q', '--no-track', '-b', `worktree-${name}`, `.claude/worktrees/${name}`, 'HEAD');
    return this.fixture.path(`.claude/worktrees/${name}`);
  }

  // The environment for a git runner under test: the caller's PATH and an empty HOME.
  serviceEnv(): NodeJS.ProcessEnv {
    return this.fixture.serviceEnv();
  }

  // C10 M2: worktrees a person makes by hand, and the moves the cleanup ladder must notice. Every path is inside a
  // temporary directory this repository disposes of.

  // A temporary directory beside the repository (disposed with it), for worktrees outside `.claude/worktrees/`.
  scratchDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'maws-scratch-wt-')));
    this.temps.push(dir);
    return dir;
  }

  // A hand-made worktree at any path on a new branch of any name (a slash included), as `git worktree add` makes it.
  async addWorktreeAt(path: string, branch: string): Promise<string> {
    await this.fixture.git('worktree', 'add', '-q', '-b', branch, path, 'HEAD');
    return path;
  }

  // A worktree on a detached HEAD.
  async addDetachedWorktree(path: string): Promise<string> {
    await this.fixture.git('worktree', 'add', '-q', '--detach', path, 'HEAD');
    return path;
  }

  // One commit of `file` in the worktree (or the main checkout) at `directory`; answers the new HEAD.
  async commitIn(directory: string, file: string, content = `${file}\n`): Promise<string> {
    await writeFile(join(directory, file), content);
    await runGit(directory, ['add', file]);
    await runGit(directory, ['commit', '-q', '-m', `add ${file}`]);
    return (await runGit(directory, ['rev-parse', 'HEAD'])).trim();
  }

  async head(ref = 'HEAD'): Promise<string> {
    return (await this.fixture.git('rev-parse', ref)).trim();
  }

  // The paths `git worktree list` shows, as git prints them.
  async worktreePaths(): Promise<string[]> {
    const out = await this.fixture.git('worktree', 'list', '--porcelain');
    return out.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
  }

  async hasBranch(branch: string): Promise<boolean> {
    return (await this.fixture.git('branch', '--list', branch)).trim() !== '';
  }

  dispose(): void {
    this.fixture.dispose();
    for (const dir of this.temps) rmSync(dir, { recursive: true, force: true });
  }
}

// A repository with no commit (`git init` only), for the worktree service's `repository has no commits` refusal.
export function emptyRepository(): { root: string; ready: Promise<void>; dispose(): void } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-empty-repo-')));
  return { root, ready: runGit(root, ['init', '-q', '-b', 'main']).then(() => undefined), dispose: () => rmSync(root, { recursive: true, force: true }) };
}
