// A temporary config home with the engine's global config in it (C10 execution document, Repository map): what the
// trust reader reads, written by tests only. Never the owner's `~/.claude.json`: every directory here is a fresh temp.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type TrustEntries = Record<string, { hasTrustDialogAccepted?: boolean }>;

export class TrustStoreFixture {
  readonly configHome = realpathSync(mkdtempSync(join(tmpdir(), 'maws-trust-config-')));

  // The environment that points the engine's resolution at this home (CLAUDE_CONFIG_DIR), on top of `base`.
  env(base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { ...base, CLAUDE_CONFIG_DIR: this.configHome };
  }

  get configPath(): string {
    return join(this.configHome, '.claude.json');
  }

  // `<configHome>/.claude.json` with `projects` and whatever else the engine keeps there.
  write(projects: TrustEntries, extra: Record<string, unknown> = { numStartups: 3 }): string {
    writeFileSync(this.configPath, `${JSON.stringify({ ...extra, projects }, null, 2)}\n`);
    return this.configPath;
  }

  writeRaw(text: string): string {
    writeFileSync(this.configPath, text);
    return this.configPath;
  }

  dispose(): void {
    rmSync(this.configHome, { recursive: true, force: true });
  }
}
