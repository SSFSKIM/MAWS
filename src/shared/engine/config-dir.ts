// The engine's configuration directory (`CLAUDE_CONFIG_DIR`, else `~/.claude`), where the terminal keeps its history,
// paste cache, plugins and settings. Neutral ground (P5 O3-C, D3): the spine's prompt history and owner channel read it,
// and so does main's Settings reveal.
import { join } from 'node:path';

export function claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.CLAUDE_CONFIG_DIR || join(home, '.claude');
}
