// The engine's configuration directory (`CLAUDE_CONFIG_DIR`, else `~/.claude`), where the terminal keeps its history,
// paste cache, plugins and settings. Neutral ground (P5 O3-C, D3): the spine's prompt history and owner channel read it,
// and so does main's Settings reveal.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.CLAUDE_CONFIG_DIR || join(home, '.claude');
}

// The global config file the engine reads, its `Lo()` (SPEC §3 16.1): the legacy `<configHome>/.config.json` wins outright
// when it exists, where the config home is CLAUDE_CONFIG_DIR or `~/.claude`; otherwise
// `${CLAUDE_CONFIG_DIR || homedir}/.claude<suffix>.json`. The suffix is the OAuth environment's (`w3()`, cli.pretty.js
// 525522-525533): 2.1.283 compiles its environment switch to the constant "prod", so `-staging-oauth` and `-local-oauth`
// are unreachable and only CLAUDE_CODE_CUSTOM_OAUTH_URL selects one, `-custom-oauth`. One selection for every reader
// (P5 O7 M9: moved here from the trust reader, src/services/sessions/trust.ts, so the engine host's base-URL resolution,
// engine-host/models-cache.ts, reads the same file).
export function configFilePath(env: NodeJS.ProcessEnv, exists: (path: string) => boolean = existsSync): string {
  const legacy = legacyConfigPath(env);
  if (exists(legacy)) return legacy;
  const suffix = env.CLAUDE_CODE_CUSTOM_OAUTH_URL ? '-custom-oauth' : '';
  return join(env.CLAUDE_CONFIG_DIR || homeOf(env), `.claude${suffix}.json`);
}

export function legacyConfigPath(env: NodeJS.ProcessEnv): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homeOf(env), '.claude'), '.config.json');
}

const homeOf = (env: NodeJS.ProcessEnv): string => env.HOME || homedir();
