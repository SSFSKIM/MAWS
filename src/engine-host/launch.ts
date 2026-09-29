// X6 in code (charter §4.1, §13 X6, D-19; C3 execution document, Interfaces "X6 — launch spec and the launch
// function"): the pure function from a LaunchSpec and the captured login-shell environment to the exact process the
// charter describes: the pinned binary by absolute path, the fixed flag set in order, a constructed environment
// (allowlist, exclusions, the gateway variables) and the `--settings` JSON with the host's protected keys applied last.
// Nothing here spawns; `transport.ts` runs the plan.
import { randomBytes, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { SessionId } from '@shared/graph/ids';

export const ENGINE_BIN = '/Users/new/.local/share/claude/versions/2.1.283'; // pinned; the packaged app later moves this to a setting (C11), never to PATH
export const ENGINE_VERSION = '2.1.283';
// C11 start: the dev-only relay override (C11 execution document, M6; ruled 2026-09-29). The relay-down live cases point
// the host at a loopback forwarder they stop and start, so ClaudeUsage itself is never quit. Read once, when this module
// loads in the host, and only as `http://127.0.0.1:<port>`; any other value is ignored. Main deletes the variable before
// forking a packaged app's hosts (`main/hosts/supervisor.ts`), and terminals never carry `MAWS_*`.
export function relayUrlFrom(env: Record<string, string | undefined>): string {
  const override = env.MAWS_RELAY_URL;
  const port = override ? /^http:\/\/127\.0\.0\.1:([0-9]{1,5})$/.exec(override)?.[1] : undefined;
  return port !== undefined && Number(port) >= 1 && Number(port) <= 65_535 ? override! : 'http://127.0.0.1:8641';
}
// C11 end
export const RELAY_URL = relayUrlFrom(process.env); // ClaudeUsage's relay, http://127.0.0.1:8641, unless C11's dev override names a loopback port

// The host's one binary configuration (C11's ask, M5): the pinned path and version by default; C11's `engine.configure`
// moves the path to a setting, never to PATH. `buildLaunch`, `engine.binaryInfo` and `session.launch`'s binary refusals
// read it; a process already spawned keeps the path its plan carries.
export interface BinaryConfig { binaryPath: string | null; expectedVersion: string } // binaryPath null = ENGINE_BIN
let binaryConfig: BinaryConfig = { binaryPath: null, expectedVersion: ENGINE_VERSION };

export function setBinaryConfig(cfg: BinaryConfig): void {
  if (cfg.binaryPath !== null && !isAbsolute(cfg.binaryPath)) throw new Error(`the engine binary path must be absolute, never resolved through PATH: ${cfg.binaryPath}`);
  binaryConfig = { ...cfg };
}

export function getBinaryConfig(): BinaryConfig {
  return { ...binaryConfig };
}

export function engineBinaryPath(): string {
  return binaryConfig.binaryPath ?? ENGINE_BIN;
}
export const GATEWAY_AUTH_TOKEN = 'claudeusage-local-gateway'; // D-19: a non-secret marker; the relay substitutes the real token
export const CHARTER_PIN = '87f8c7881119ea670901205dae35917d3751459c'; // the parent pin this child was authored against

// §4.1 launch line, verbatim and in this order. `--strict-mcp-config` is never passed: the user's MCP servers must load
// as in the terminal.
export const ENGINE_FLAGS: readonly string[] = Object.freeze([
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--permission-prompt-tool', 'stdio',
  '--include-partial-messages',
  '--forward-subagent-text',
  '--replay-user-messages',
  '--include-hook-events',
  '--setting-sources', 'user,project,local',
]);

export interface LaunchPlan {
  bin: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  flagSettings: Record<string, unknown>;
  launchId: string;
  sessionId: SessionId;
  gateway: 'gateway' | 'direct'; // additive to the X6 shape: the spawn meta row and the status read it without re-deriving it from env
  engineVersion: string; // the version this plan was built for; the spawn meta row records it per session
}

// An `extraSettings` (or spec field) that would displace something X6 guarantees. `session.launch` answers
// `refused { reason: 'settings_conflict' }` without spawning (M5).
export class LaunchSpecConflict extends Error {
  constructor(readonly key: string, detail: string) {
    super(`launch spec conflict on ${key}: ${detail}`);
    this.name = 'LaunchSpecConflict';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Environment

const ALLOWED_KEYS = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TZ', 'LANG', 'SSH_AUTH_SOCK',
  'ENABLE_TOOL_SEARCH', 'MCP_TIMEOUT', 'MCP_CONNECT_TIMEOUT_MS', 'MAX_THINKING_TOKENS',
]);
const ALLOWED_PREFIXES = ['LC_', 'XDG_', 'HOMEBREW_', 'GIT_', 'CLAUDE_', 'ANTHROPIC_', 'DISABLE_', 'OTEL_'];

// Excluded whatever the capture holds: what a parent Claude session injects into its children (pass 2 had to scrub
// them for a clean child), the git worktree pins, and the host's own runtime noise.
const EXCLUDED_KEYS = new Set([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_PID',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_EFFORT', 'CLAUDECODE',
  'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS', 'CLAUDE_CODE_ENTRYPOINT',
  'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE',
]);
const EXCLUDED_PREFIXES = ['CMUX_', 'ELECTRON_'];

const GATEWAY_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ENABLE_TOOL_SEARCH'] as const;

function isAllowed(key: string): boolean {
  if (EXCLUDED_KEYS.has(key) || EXCLUDED_PREFIXES.some((p) => key.startsWith(p))) return false;
  return ALLOWED_KEYS.has(key) || ALLOWED_PREFIXES.some((p) => key.startsWith(p));
}

export function buildEnvironment(spec: LaunchSpec, captured: Record<string, string>, relayUrl: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(captured)) if (isAllowed(key)) env[key] = value;
  env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts'; // the probe's identity; every fixture was recorded under it
  env.CLAUDE_CODE_FORK_SUBAGENT = 'true';
  env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = '1';
  env.TERM = 'dumb';
  if (spec.subagentModel !== null) env.CLAUDE_CODE_SUBAGENT_MODEL = spec.subagentModel;
  if (spec.gateway === 'gateway') {
    env.ANTHROPIC_BASE_URL = relayUrl;
    env.ANTHROPIC_AUTH_TOKEN = GATEWAY_AUTH_TOKEN;
    env.ENABLE_TOOL_SEARCH = 'true';
  } else {
    for (const key of GATEWAY_KEYS) delete env[key]; // the `--settings` env override does the rest (pass 2 verified)
  }
  return env;
}

// ---------------------------------------------------------------------------------------------------------------------
// Flag settings

// The host's keys, applied after `extraSettings` so nothing a caller passes can displace them. A caller value that
// differs from the host's is a conflict, never an override; an equal value is accepted. `env.ANTHROPIC_*` is protected
// under both gateway modes (a settings-level base URL would silently re-route a gateway launch too), so under
// `gateway` the host's value for those two is "absent" and any caller value conflicts.
function protectedSettings(spec: LaunchSpec): { top: Record<string, unknown>; env: Record<string, string | undefined> } {
  const top: Record<string, unknown> = { dialogExpiry: 'never' };
  if (spec.effort !== null) top.effortLevel = spec.effort;
  const env: Record<string, string | undefined> =
    spec.gateway === 'direct'
      ? { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' }
      : { ANTHROPIC_BASE_URL: undefined, ANTHROPIC_AUTH_TOKEN: undefined };
  return { top, env };
}

export function mergeFlagSettings(spec: LaunchSpec): Record<string, unknown> {
  const extra = spec.extraSettings ?? {};
  const merged: Record<string, unknown> = { ...extra };
  const { top, env } = protectedSettings(spec);

  for (const [key, value] of Object.entries(top)) {
    if (key in extra && extra[key] !== value) {
      throw new LaunchSpecConflict(key, `extraSettings sets ${JSON.stringify(extra[key])}, the host requires ${JSON.stringify(value)}`);
    }
    merged[key] = value;
  }

  const callerEnv = extra.env;
  if (callerEnv !== undefined && (typeof callerEnv !== 'object' || callerEnv === null || Array.isArray(callerEnv))) {
    throw new LaunchSpecConflict('env', 'extraSettings.env must be an object');
  }
  const mergedEnv: Record<string, unknown> = { ...((callerEnv as Record<string, unknown> | undefined) ?? {}) };
  for (const [key, value] of Object.entries(env)) {
    if (key in mergedEnv && mergedEnv[key] !== value) {
      throw new LaunchSpecConflict(
        `env.${key}`,
        value === undefined
          ? `extraSettings sets ${JSON.stringify(mergedEnv[key])}, the host routes a gateway launch through the environment`
          : `extraSettings sets ${JSON.stringify(mergedEnv[key])}, the host requires ${JSON.stringify(value)}`,
      );
    }
    if (value !== undefined) mergedEnv[key] = value;
  }
  if (Object.keys(mergedEnv).length > 0) merged.env = mergedEnv;
  return merged;
}

// ---------------------------------------------------------------------------------------------------------------------
// Launch ids and the plan

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

// Eight base32 characters, minted per spawn: request ids are `${launchId}-${n}` (M2), so a journal reader tells the
// host's ids from the engine's UUIDs at a glance and ids never collide across a resume within one session's journals.
export function mintLaunchId(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += BASE32[bytes[i]! & 31];
  return out;
}

// `engineVersion` defaults to the binary configuration's expected version.
export function buildLaunch(spec: LaunchSpec, captured: Record<string, string>, opts: { relayUrl: string; engineVersion?: string }): LaunchPlan {
  if (spec.resume !== null && !spec.resume.fork && spec.sessionId !== null) {
    throw new LaunchSpecConflict('sessionId', '--session-id never co-occurs with a non-fork --resume; a resumed launch takes the resumed id');
  }
  const flagSettings = mergeFlagSettings(spec);
  // A new session and a fork are pinned (the fork's id is known from spawn, C10's ask); a plain resume keeps its id.
  const pinned = spec.resume === null || spec.resume.fork;
  const sessionId = (pinned ? (spec.sessionId ?? randomUUID()) : spec.resume!.sessionId) as SessionId;

  const args = [...ENGINE_FLAGS];
  if (spec.model !== null) args.push('--model', spec.model);
  if (spec.permissionMode !== null) args.push('--permission-mode', spec.permissionMode);
  for (const dir of spec.additionalDirectories) args.push('--add-dir', dir);
  if (spec.resume !== null) {
    args.push('--resume', spec.resume.sessionId);
    if (spec.resume.fork) args.push('--fork-session'); // SPEC 35.16.5: --session-id is accepted beside --resume only with it
  }
  if (pinned) args.push('--session-id', sessionId);
  if (spec.mcpConfig !== null) args.push('--mcp-config', JSON.stringify(spec.mcpConfig));
  if (spec.maxBudgetUsd !== null) args.push('--max-budget-usd', String(spec.maxBudgetUsd));
  args.push('--settings', JSON.stringify(flagSettings));

  return {
    bin: engineBinaryPath(),
    args,
    env: buildEnvironment(spec, captured, opts.relayUrl),
    cwd: spec.cwd,
    flagSettings,
    launchId: mintLaunchId(),
    sessionId,
    gateway: spec.gateway,
    engineVersion: opts.engineVersion ?? binaryConfig.expectedVersion,
  };
}

// The journal's `spawn` meta row (X8): written before `spawn()` returns so a launch that dies instantly still leaves a
// journal. Env values are never journaled; the row lists key names.
export function spawnMeta(plan: LaunchPlan, opts: { appVersion: string }): {
  event: 'spawn';
  bin: string;
  args: string[];
  envKeys: string[];
  cwd: string;
  gateway: 'gateway' | 'direct';
  engineVersion: string;
  appVersion: string;
  charterPin: string;
  launchId: string;
  sessionId: string;
} {
  return {
    event: 'spawn',
    bin: plan.bin,
    args: plan.args,
    envKeys: Object.keys(plan.env).sort(),
    cwd: plan.cwd,
    gateway: plan.gateway,
    engineVersion: plan.engineVersion,
    appVersion: opts.appVersion,
    charterPin: CHARTER_PIN,
    launchId: plan.launchId,
    sessionId: plan.sessionId,
  };
}
