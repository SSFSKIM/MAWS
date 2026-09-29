// A temporary git repository shaped like a project the trust card asks about (C10 execution document, Repository map):
// commits, a `.claude/settings.json` carrying an allow rule, a hook, a marketplace and a plugin, a `.mcp.json` server,
// and linked worktrees on demand. Built on C4's GitFixture (isolated git configuration, fixed identity, temp root
// only), so nothing here touches this checkout, the owner's repositories or `~/.claude`.
import { GitFixture } from './git-fixture';

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

  dispose(): void {
    this.fixture.dispose();
  }
}
