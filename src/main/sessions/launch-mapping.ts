// Intent or record → LaunchSpec (C10 execution document, Interfaces "Trust" (attestation mapping, trust bootstrap) and
// "Session service" (Resume)): the exact X6 spec a session, its resume or its trust bootstrap launches with. C10 never
// spawns the engine; everything here ends in C3's `session.launch`.
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { PermissionMode } from '@shared/graph/enums';
import type { SessionRecord } from '@shared/graph/session';
import { EffortSchema, type Effort, type LaunchSpec } from '@shared/engine/launch-spec';
import type { SetupIntent, TrustDecision } from '@shared/sessions/intent';
import type { TrustState } from '@shared/sessions/trust';
import { NATIVE_TO_HUMAN_ENV, TO_HUMAN_CONTRACT, TO_HUMAN_CONTRACT_VERSION } from '@shared/owner/contract'; // P2-C (2026-10-09)

export type Attestation = { accepted: true; directory: string };
type Gateway = LaunchSpec['gateway'];

// ---- the settings seam (Consumed asks of C11) ---------------------------------------------------------------------
// Settings v3 is C11's; until it lands C10 reads these defaults here, so nothing changes when C11 lands but the source.
export interface C10Settings {
  gateway: { defaultRoute: Gateway; relayUnreachable: 'ask' | 'direct' | 'wait' };
  engine: { subagentModel: string | null };
  permissions: { autoFallback: PermissionMode }; // W3: settings v6, the mode a refused auto falls back to
}
export const C10_SETTING_DEFAULTS: C10Settings = Object.freeze({
  gateway: Object.freeze({ defaultRoute: 'gateway', relayUnreachable: 'ask' }),
  engine: Object.freeze({ subagentModel: null }),
  permissions: Object.freeze({ autoFallback: 'acceptEdits' }),
}) as C10Settings;

// W3 (charter D-18 and §5.1 as amended 2026-10-01): a session's permission mode when nothing chose one, the user's own
// `permissions.defaultMode`, else auto, MAWS's default.
export const seedPermissionMode = (defaults: { defaultMode: PermissionMode | null }): PermissionMode => defaults.defaultMode ?? 'auto';

export function readSettings(): C10Settings {
  return C10_SETTING_DEFAULTS;
}

// ---- the base mapping ---------------------------------------------------------------------------------------------
export interface LaunchInput {
  appSessionId: AppSessionId;
  cwd: string;
  additionalDirectories: readonly string[];
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode | null;
  gateway: Gateway;
  trust: Attestation | null;
  resume: { sessionId: SessionId; fork: boolean } | null;
  sessionId: SessionId | null;
  inheritGrantsFrom: AppSessionId | null;
  replay: string | null;
  // E13 (the in-app browser spec of 2026-10-08, "Socket and lifecycle"): the session's cua socket, which the engine, its
  // subagents and the cua_repl shims they start inherit as CUA_BROWSER_BACKENDS; null when there is none
  browserBackend?: string | null;
}

export function toLaunchSpec(input: LaunchInput, settings: C10Settings = readSettings()): LaunchSpec {
  return {
    appSessionId: input.appSessionId,
    cwd: input.cwd,
    additionalDirectories: [...new Set(input.additionalDirectories)], // `--add-dir` once per directory
    model: input.model,
    effort: input.effort,
    permissionMode: input.permissionMode,
    permissionFallback: input.permissionMode === 'auto' ? settings.permissions.autoFallback : null, // W3
    gateway: input.gateway,
    subagentModel: settings.engine.subagentModel,
    resume: input.resume,
    sessionId: input.sessionId,
    trust: input.trust,
    mcpConfig: null,
    // the engine's environment is an allowlist (engine-host/launch.ts): `--settings` env is the one way to add a variable
    extraSettings: input.browserBackend ? { env: { CUA_BROWSER_BACKENDS: input.browserBackend } } : null,
    maxBudgetUsd: null,
    replay: input.replay,
    inheritGrantsFrom: input.inheritGrantsFrom,
  };
}

// P2-C start (2026-10-09): the owner channel's launch decision applied to a spec (the P2-C document, Design §2, §3;
// src/main/owner/launch.ts decides). While the lane is on, MAWS_NATIVE_TO_HUMAN (the contract version) joins the
// settings env beside CUA_BROWSER_BACKENDS: the engine applies settings env to its process at startup, so a plugin's
// hooks read it, and a toggle takes effect at the next launch. The contract is appended and "off" passed as decided.
export interface OwnerChannelFlags {
  laneOn: boolean;
  append: boolean; // --append-system-prompt <the contract>
  snapshotOff: boolean; // --system-prompt-snapshot off
}

export function withOwnerChannel(spec: LaunchSpec, flags: OwnerChannelFlags): LaunchSpec {
  const { appendSystemPrompt: _append, systemPromptSnapshot: _snapshot, extraSettings, ...rest } = spec;
  void _append;
  void _snapshot;
  const { env: callerEnv, ...settings } = extraSettings ?? {};
  const env: Record<string, unknown> = { ...(callerEnv as Record<string, unknown> | undefined) };
  delete env[NATIVE_TO_HUMAN_ENV];
  if (flags.laneOn) env[NATIVE_TO_HUMAN_ENV] = String(TO_HUMAN_CONTRACT_VERSION);
  const merged = Object.keys(env).length > 0 ? { ...settings, env } : settings;
  return {
    ...rest,
    extraSettings: Object.keys(merged).length > 0 ? merged : null,
    ...(flags.append ? { appendSystemPrompt: TO_HUMAN_CONTRACT } : {}),
    ...(flags.snapshotOff ? { systemPromptSnapshot: 'off' as const } : {}),
  };
}
// P2-C end

// ---- attestation --------------------------------------------------------------------------------------------------
// Only an `accepted` decision given for this trust key attests, and the directory attested is the trust key (the
// engine persists trust only when `directory` matches the cwd's key, SPEC §45 18.2; a worktree's key is its repository
// root). A bootstrap launch is needed first when the key is not trusted yet, is not the home directory (whose trust the
// engine keeps per session only: the real launch attests it, every launch), and this attempt has not recorded it.
export function trustMapping(
  decision: { decision: TrustDecision; decisionKey: string | null; trustRecorded: boolean },
  state: Pick<TrustState, 'trustKey' | 'trusted' | 'isHome'>,
): { attestation: Attestation | null; bootstrap: boolean } {
  if (decision.decision !== 'accepted' || decision.decisionKey !== state.trustKey) return { attestation: null, bootstrap: false };
  return { attestation: { accepted: true, directory: state.trustKey }, bootstrap: !state.isHome && !state.trusted && !decision.trustRecorded };
}

// ---- the three launches -------------------------------------------------------------------------------------------
// An intent's real launch: its chips, the id pinned at its first attempt, and for a fork the source it resumes with
// `--fork-session` (pinned too: C3's buildLaunch emits `--session-id` beside a fork's resume) and the grants it inherits.
export function intentLaunchSpec(intent: SetupIntent, ctx: { cwd: string; trust: Attestation | null; replay: string | null; browserBackend?: string | null }, settings: C10Settings = readSettings()): LaunchSpec {
  const fork = intent.kind === 'fork' ? intent.source : null;
  return toLaunchSpec(
    {
      appSessionId: intent.appSessionId,
      cwd: ctx.cwd,
      additionalDirectories: intent.additionalDirectories,
      model: intent.model,
      effort: intent.effort,
      permissionMode: intent.permissionMode,
      gateway: intent.gateway,
      trust: ctx.trust,
      resume: fork ? { sessionId: fork.engineSessionId, fork: true } : null,
      sessionId: intent.progress.engineSessionId,
      inheritGrantsFrom: fork?.appSessionId ?? null,
      replay: ctx.replay,
      browserBackend: ctx.browserBackend ?? null,
    },
    settings,
  );
}

export type ResumeOptions = Partial<{ gateway: Gateway; model: string | null; effort: Effort | null }>;

// A record's resume: a non-fork `--resume` of the engine id the record is bound to now (after a `/clear`, the new
// transcript), else a fresh session C3 pins; `--add-dir` is not persisted by the engine, so the record's directories
// are re-passed. The route is the record's last one unless the caller says otherwise, and a record whose route was
// never verified (every discovered session) takes D-19's default rather than reading null as a routing fact. `model`
// and `effort` are C11's route-switch overrides for this launch; C3 re-applies the session's own grants by app id.
export function resumeLaunchSpec(record: SessionRecord, options: ResumeOptions, ctx: { trust: Attestation | null; replay: string | null; browserBackend?: string | null }, settings: C10Settings = readSettings()): LaunchSpec {
  const routed = record.gateway.routed;
  const recordEffort = EffortSchema.safeParse(record.effort);
  return toLaunchSpec(
    {
      appSessionId: record.appId,
      cwd: record.directory,
      additionalDirectories: record.additionalDirectories,
      model: 'model' in options ? (options.model ?? null) : record.model.requested,
      effort: 'effort' in options ? (options.effort ?? null) : recordEffort.success ? recordEffort.data : null,
      permissionMode: record.permissionMode.requested,
      gateway: options.gateway ?? (routed === true ? 'gateway' : routed === false ? 'direct' : settings.gateway.defaultRoute),
      trust: ctx.trust,
      resume: record.engineSessionId ? { sessionId: record.engineSessionId, fork: false } : null,
      sessionId: null,
      inheritGrantsFrom: null,
      replay: ctx.replay,
      browserBackend: ctx.browserBackend ?? null,
    },
    settings,
  );
}

// The trust bootstrap (Trust, "Trust bootstrap"): an initialize-only launch that records trust for the key, under a
// bootstrap id minted for it alone, never the conversation's, so no index record ever hears of it. C3 mints its pin.
export function bootstrapSpec(
  input: { bootstrapId: AppSessionId; cwd: string; additionalDirectories: readonly string[]; gateway: Gateway; trustKey: string; replay: string | null },
  settings: C10Settings = readSettings(),
): LaunchSpec {
  return toLaunchSpec(
    {
      appSessionId: input.bootstrapId,
      cwd: input.cwd,
      additionalDirectories: input.additionalDirectories,
      model: null,
      effort: null,
      permissionMode: null,
      gateway: input.gateway,
      trust: { accepted: true, directory: input.trustKey },
      resume: null,
      sessionId: null,
      inheritGrantsFrom: null,
      replay: input.replay,
    },
    settings,
  );
}
