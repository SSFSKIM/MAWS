// A scratch-home engine's environment (E11 W-E, Decision Log 22; the tracker's E4c row). A test run inside a Claude
// session carries that session's CLAUDE* variables (CLAUDE_CODE_PLUGIN_DIRS with the owner's plugins, the session and
// messaging ids, CLAUDE_MODEL, CLAUDE_EFFORT and more), and through a copied process environment or a login-shell
// capture they reached the engine under test, which then ran as the session's child with the owner's plugins loaded: a
// scratch CLAUDE_CONFIG_DIR alone does not isolate it. Every live harness and e2e launch starts from an environment with
// all of them dropped, and sets back only the ones it means (CLAUDE_CONFIG_DIR, and what MAWS's launch adds itself).

// The environment without any CLAUDE* variable (CLAUDE_* and CLAUDECODE), and without unset values.
export function withoutClaudeVariables(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined && !key.startsWith('CLAUDE')) out[key] = value;
  return out;
}

// The `system/init` plugins that are not the engine's own builtins (`<name>@builtin`), by source: what an owner's
// plugin reaching a scratch-home engine shows as. A recording's list should hold none.
export function ownerPlugins(plugins: readonly { source: string }[]): string[] {
  return plugins.map((plugin) => plugin.source).filter((source) => !source.endsWith('@builtin'));
}
