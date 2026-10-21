import { describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid, ProjectId, SessionId } from '@shared/graph/ids';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { SetupIntent } from '@shared/sessions/intent';
import type { TrustState } from '@shared/sessions/trust';
import { record } from '../../../test/support/builders';
import { bootstrapSpec, C10_SETTING_DEFAULTS, intentLaunchSpec, readSettings, resumeLaunchSpec, toLaunchSpec, trustMapping, type C10Settings, seedPermissionMode } from './launch-mapping';
import { hooksOff, withOwnerChannel } from './launch-mapping'; // P2-C; P4-A2: hooksOff
import { CONTRACT_HEADER, MESSAGE_TOOL_ALIAS, messageToolHookGroup, NATIVE_TO_HUMAN_ENV, TO_HUMAN_CONTRACT, TO_HUMAN_CONTRACT_VERSION, TO_HUMAN_SUPPLEMENT } from '@shared/owner/contract'; // P2-C; P2-C2: the supplement; P4-R7y: the hook; P4-A2: the alias
import { buildLaunch } from '../../engine-host/launch'; // P4-R8: the launch line a spec becomes
import type { AppMcpServer } from '@shared/engine/app-mcp-servers'; // P4-R8
import { userScopeProfile, type LaunchProfile } from '@shared/engine/launch-profile'; // P4-A2

const APP = 'a0000000-0000-4000-8000-000000000001' as AppSessionId;
const BOOT = 'b0000000-0000-4000-8000-000000000002' as AppSessionId;
const PIN = 'c0000000-0000-4000-8000-000000000003' as SessionId;
const SOURCE_ENGINE = 'd0000000-0000-4000-8000-000000000004' as SessionId;
const REPO = '/private/tmp/maws-repo';
const HOME = '/Users/someone';

const base = {
  appSessionId: APP, cwd: REPO, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway' as const,
  trust: null, resume: null, sessionId: null, inheritGrantsFrom: null, replay: null,
};

const trustState = (over: Partial<TrustState> = {}): TrustState => ({
  directory: REPO, trustKey: REPO, keyKind: 'repo', configPath: `${HOME}/.claude.json`, trusted: false, source: null, isHome: false, found: [], ...over,
});

const intent = (over: Partial<SetupIntent> = {}): SetupIntent => ({
  appSessionId: APP, projectId: 'p1' as ProjectId, createdAt: '2026-09-29T10:00:00.000Z', updatedAt: '2026-09-29T10:00:00.000Z', kind: 'create', source: null,
  location: { kind: 'directory', path: REPO }, additionalDirectories: [], model: 'sonnet', effort: 'high', permissionMode: 'default', gateway: 'gateway',
  trust: 'unanswered', trustKey: null, message: null, draft: null,
  progress: { engineSessionId: PIN, worktree: null, trustRecorded: false, bootstrap: null, launch: null, send: null, lastFailure: null },
  ...over,
});

describe('launch mapping', () => {
  it('is an X6 LaunchSpec: one additionalDirectories entry per directory, resume, sessionId and inheritGrantsFrom as given', () => {
    const spec = toLaunchSpec({ ...base, additionalDirectories: ['/a', '/b', '/a'], resume: { sessionId: SOURCE_ENGINE, fork: true }, sessionId: PIN, inheritGrantsFrom: BOOT });
    expect(LaunchSpecSchema.parse(spec)).toEqual(spec);
    expect(spec).toMatchObject({ additionalDirectories: ['/a', '/b'], resume: { sessionId: SOURCE_ENGINE, fork: true }, sessionId: PIN, inheritGrantsFrom: BOOT });
    expect(spec).toMatchObject({ mcpConfig: null, extraSettings: null, maxBudgetUsd: null, subagentModel: null });
  });

  it('fills subagentModel from the settings seam (null until C11 lands settings v3)', () => {
    expect(readSettings()).toEqual(C10_SETTING_DEFAULTS);
    expect(C10_SETTING_DEFAULTS).toEqual({ gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask' }, engine: { subagentModel: null, mcpServers: [], launchProfile: userScopeProfile() }, permissions: { autoFallback: 'acceptEdits' } });
    const settings: C10Settings = { ...C10_SETTING_DEFAULTS, engine: { ...C10_SETTING_DEFAULTS.engine, subagentModel: 'sonnet' } };
    expect(toLaunchSpec(base, settings).subagentModel).toBe('sonnet');
  });

  // W3 (charter D-18 as amended 2026-10-01): an auto launch carries the fallback the host sets when the engine refuses it
  it('passes the auto fallback with an auto launch only, and seeds a mode from the user’s defaultMode, else auto', () => {
    const settings: C10Settings = { ...C10_SETTING_DEFAULTS, permissions: { autoFallback: 'plan' } };
    expect(toLaunchSpec({ ...base, permissionMode: 'auto' }, settings).permissionFallback).toBe('plan');
    expect(toLaunchSpec({ ...base, permissionMode: 'acceptEdits' }, settings).permissionFallback).toBeNull();
    expect(seedPermissionMode({ defaultMode: null })).toBe('auto');
    expect(seedPermissionMode({ defaultMode: 'acceptEdits' })).toBe('acceptEdits');
  });

  it('attests the trust key, not the session directory, only for an accepted decision given for that key', () => {
    const worktree = `${REPO}/.claude/worktrees/one`;
    const state = trustState({ directory: worktree });
    expect(trustMapping({ decision: 'accepted', decisionKey: REPO, trustRecorded: false }, state)).toEqual({ attestation: { accepted: true, directory: REPO }, bootstrap: true });
    expect(trustMapping({ decision: 'declined', decisionKey: REPO, trustRecorded: false }, state)).toEqual({ attestation: null, bootstrap: false });
    expect(trustMapping({ decision: 'unanswered', decisionKey: null, trustRecorded: false }, state)).toEqual({ attestation: null, bootstrap: false });
    // a decision for another key never attests this one
    expect(trustMapping({ decision: 'accepted', decisionKey: '/private/tmp/other', trustRecorded: false }, state)).toEqual({ attestation: null, bootstrap: false });
    // already trusted, or recorded by this attempt's bootstrap: attest on the real launch only (the engine answers already_trusted)
    expect(trustMapping({ decision: 'accepted', decisionKey: REPO, trustRecorded: false }, trustState({ trusted: true, source: 'trustKey' }))).toEqual({ attestation: { accepted: true, directory: REPO }, bootstrap: false });
    expect(trustMapping({ decision: 'accepted', decisionKey: REPO, trustRecorded: true }, state)).toEqual({ attestation: { accepted: true, directory: REPO }, bootstrap: false });
  });

  it('builds an intent’s launch: its chips, the pinned id, and a fork’s source and grants', () => {
    const attestation = { accepted: true as const, directory: REPO };
    const created = intentLaunchSpec(intent({ additionalDirectories: ['/extra'] }), { cwd: REPO, trust: attestation, replay: null });
    expect(created).toMatchObject({
      appSessionId: APP, cwd: REPO, additionalDirectories: ['/extra'], model: 'sonnet', effort: 'high', permissionMode: 'default', gateway: 'gateway',
      trust: attestation, resume: null, sessionId: PIN, inheritGrantsFrom: null, replay: null,
    });
    const SOURCE_APP = 'e0000000-0000-4000-8000-000000000005' as AppSessionId;
    const fork = intentLaunchSpec(intent({ kind: 'fork', source: { appSessionId: SOURCE_APP, engineSessionId: SOURCE_ENGINE, rewindTo: 'm1' as MessageUuid }, gateway: 'direct' }), { cwd: `${REPO}/.claude/worktrees/f`, trust: null, replay: 'spikes/protocol-probe/fixtures/pass3/fork-pinned-id-fork.jsonl' });
    expect(fork).toMatchObject({ cwd: `${REPO}/.claude/worktrees/f`, gateway: 'direct', resume: { sessionId: SOURCE_ENGINE, fork: true }, sessionId: PIN, inheritGrantsFrom: SOURCE_APP, trust: null, replay: 'spikes/protocol-probe/fixtures/pass3/fork-pinned-id-fork.jsonl' });
  });

  it('builds a resume from the record: its route unless options say otherwise, the overrides, and a non-fork resume of its engine id', () => {
    const r = record(APP, { engineSessionId: SOURCE_ENGINE, directory: REPO, additionalDirectories: ['/x'], model: { requested: 'claude/astra', resolved: null }, effort: 'high', permissionMode: { requested: 'plan', effective: 'plan', refusal: null } });
    const spec = resumeLaunchSpec(r, {}, { trust: null, replay: null });
    expect(spec).toMatchObject({ appSessionId: APP, cwd: REPO, additionalDirectories: ['/x'], model: 'claude/astra', effort: 'high', permissionMode: 'plan', gateway: 'gateway', resume: { sessionId: SOURCE_ENGINE, fork: false }, sessionId: null, inheritGrantsFrom: null });
    expect(resumeLaunchSpec(record(APP, { gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' } }), {}, { trust: null, replay: null }).gateway).toBe('direct');
    expect(resumeLaunchSpec(record(APP, { gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' } }), { gateway: 'gateway' }, { trust: null, replay: null }).gateway).toBe('gateway');
    // a discovered session's route is unknown: D-19's default, never read as a routing fact
    const discovered = record(APP, { gateway: { routed: null, baseUrl: null, autoModeServer: 'unknown' } });
    expect(resumeLaunchSpec(discovered, {}, { trust: null, replay: null }).gateway).toBe('gateway');
    expect(resumeLaunchSpec(discovered, {}, { trust: null, replay: null }, { ...C10_SETTING_DEFAULTS, gateway: { defaultRoute: 'direct', relayUnreachable: 'ask' } }).gateway).toBe('direct');
    // C11's route switch: model and effort overrides for this launch, null included
    expect(resumeLaunchSpec(r, { gateway: 'direct', model: 'sonnet', effort: null }, { trust: null, replay: null })).toMatchObject({ gateway: 'direct', model: 'sonnet', effort: null });
    // an effort the record holds that is not an X6 effort launches with none; a record without an engine id is a fresh pinned session
    expect(resumeLaunchSpec(record(APP, { effort: 'ultra', engineSessionId: null }), {}, { trust: null, replay: null })).toMatchObject({ effort: null, resume: null, sessionId: null });
    expect(resumeLaunchSpec(r, {}, { trust: null, replay: null }, { ...C10_SETTING_DEFAULTS, engine: { ...C10_SETTING_DEFAULTS.engine, subagentModel: 'haiku' } }).subagentModel).toBe('haiku');
  });

  it('runs the trust bootstrap under its own id: attested, resuming nothing, pinned by C3', () => {
    const spec = bootstrapSpec({ bootstrapId: BOOT, cwd: REPO, additionalDirectories: ['/extra'], gateway: 'gateway', trustKey: REPO, replay: null });
    expect(LaunchSpecSchema.parse(spec)).toEqual(spec);
    expect(spec).toMatchObject({ appSessionId: BOOT, cwd: REPO, additionalDirectories: ['/extra'], gateway: 'gateway', trust: { accepted: true, directory: REPO }, model: null, effort: null, permissionMode: null, resume: null, sessionId: null, inheritGrantsFrom: null });
    expect(spec.appSessionId).not.toBe(APP);
    expect(spec.extraSettings).toBeNull(); // E13: an initialize-only launch never reaches the browser
  });

  it('E13: hands the session\'s cua socket to the engine through extraSettings.env, and nothing when there is none', () => {
    const socket = '/u/browser/cua/app.sock';
    const created = intentLaunchSpec(intent({}), { cwd: REPO, trust: null, replay: null, browserBackend: socket });
    expect(LaunchSpecSchema.parse(created)).toEqual(created);
    expect(created.extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: socket } });
    expect(resumeLaunchSpec(record(APP), {}, { trust: null, replay: null, browserBackend: socket }).extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: socket } });
    expect(intentLaunchSpec(intent({}), { cwd: REPO, trust: null, replay: null, browserBackend: null }).extraSettings).toBeNull();
    expect(resumeLaunchSpec(record(APP), {}, { trust: null, replay: null }).extraSettings).toBeNull();
  });
});

// P4-R8: the app's MCP servers (settings v16, `engine.mcpServers`) reach the engine as one `--mcp-config` on every launch
// MAWS owns; the engine resolves a server of the same name in the user's or a project's own config (the entry wins).
describe('the app\'s MCP servers', () => {
  const SOURCE_APP = 'e0000000-0000-4000-8000-000000000005' as AppSessionId;
  const SERVERS: AppMcpServer[] = [
    { name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' },
    { name: 'local-docs', type: 'http', url: 'http://127.0.0.1:7777/mcp' },
  ];
  const CONFIG = { mcpServers: { notion: { type: 'http', url: 'https://mcp.notion.com/mcp' }, 'local-docs': { type: 'http', url: 'http://127.0.0.1:7777/mcp' } } };
  const withServers: C10Settings = { ...C10_SETTING_DEFAULTS, engine: { ...C10_SETTING_DEFAULTS.engine, mcpServers: SERVERS } };
  const source = { appSessionId: SOURCE_APP, engineSessionId: SOURCE_ENGINE, rewindTo: null };
  const ctx = { cwd: REPO, trust: null, replay: null };
  // the four launches a session can take: new, fork, side thread (a fork in place with its lineage) and resume
  const launches = (settings: C10Settings) => ({
    new: intentLaunchSpec(intent(), ctx, settings),
    fork: intentLaunchSpec(intent({ kind: 'fork', source }), ctx, settings),
    sideThread: intentLaunchSpec(intent({ kind: 'fork', source, lineage: { kind: 'side-thread', parentAppSessionId: SOURCE_APP, parentEngineSessionId: SOURCE_ENGINE, openedBy: 'btw' } }), ctx, settings),
    resume: resumeLaunchSpec(record(APP, { engineSessionId: SOURCE_ENGINE }), {}, { trust: null, replay: null }, settings),
  });
  const argsOf = (spec: ReturnType<typeof toLaunchSpec>) => buildLaunch(spec, {}, { relayUrl: 'http://127.0.0.1:8641', bin: '/bin/claude', engineVersion: '2.1.306', spawnerPid: 1 }).args;

  it('passes them to a new session, a fork, a side thread and a resume as one --mcp-config, never with --strict-mcp-config', () => {
    for (const [kind, spec] of Object.entries(launches(withServers))) {
      expect(LaunchSpecSchema.parse(spec), kind).toEqual(spec);
      expect(spec.mcpConfig, kind).toEqual(CONFIG);
      const args = argsOf(spec);
      expect(args.filter((arg) => arg === '--mcp-config'), kind).toHaveLength(1);
      expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!), kind).toEqual(CONFIG);
      expect(args, kind).not.toContain('--strict-mcp-config'); // the user's and the projects' servers load beside them
    }
    expect(argsOf(launches(withServers).sideThread)).toEqual(expect.arrayContaining(['--resume', SOURCE_ENGINE, '--fork-session']));
  });

  it('passes no --mcp-config when the list is empty, the default', () => {
    for (const [kind, spec] of Object.entries(launches(C10_SETTING_DEFAULTS))) {
      expect(spec.mcpConfig, kind).toBeNull();
      expect(argsOf(spec), kind).not.toContain('--mcp-config');
    }
  });

  it('leaves them out of the trust bootstrap, which serves no turn, and keeps them through the owner channel\'s decision', () => {
    const boot = bootstrapSpec({ bootstrapId: BOOT, cwd: REPO, additionalDirectories: [], gateway: 'gateway', trustKey: REPO, replay: null }, withServers);
    expect(boot.mcpConfig).toBeNull();
    expect(withOwnerChannel(launches(withServers).new, { laneOn: true, append: 'contract', snapshotOff: true }).mcpConfig).toEqual(CONFIG);
  });

  // beside P4-R7y: a lane-on launch carries both the app's servers and MAWS's SessionStart hook; the bootstrap neither
  it('gives a lane-on launch with app servers both --mcp-config and the SessionStart hook in --settings, and the bootstrap neither', () => {
    const settingsOf = (args: string[]) => JSON.parse(args[args.indexOf('--settings') + 1]!) as { hooks?: unknown };
    for (const [kind, spec] of Object.entries(launches(withServers))) {
      const args = argsOf(withOwnerChannel(spec, { laneOn: true, append: 'contract', snapshotOff: false }));
      expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!), kind).toEqual(CONFIG);
      expect(settingsOf(args).hooks, kind).toEqual({ SessionStart: [messageToolHookGroup()] });
    }
    const boot = argsOf(bootstrapSpec({ bootstrapId: BOOT, cwd: REPO, additionalDirectories: [], gateway: 'gateway', trustKey: REPO, replay: null }, withServers));
    expect(boot).not.toContain('--mcp-config');
    expect(settingsOf(boot).hooks).toBeUndefined();
  });
});

describe('home directory attests without a bootstrap', () => {
  it('maps an accepted decision for ~ to the home realpath on the real launch, and reports no bootstrap', () => {
    const home = trustState({ directory: HOME, trustKey: HOME, keyKind: 'directory', isHome: true });
    const mapping = trustMapping({ decision: 'accepted', decisionKey: HOME, trustRecorded: false }, home);
    expect(mapping).toEqual({ attestation: { accepted: true, directory: HOME }, bootstrap: false });
    expect(intentLaunchSpec(intent({ location: { kind: 'directory', path: HOME }, trust: 'accepted', trustKey: HOME }), { cwd: HOME, trust: mapping.attestation, replay: null }).trust).toEqual({ accepted: true, directory: HOME });
  });
});

// P2-C start (2026-10-09): the owner channel's decision applied to a spec (the P2-C document, Design §2, §3)
describe('withOwnerChannel', () => {
  const socket = '/u/browser/cua/a.sock';
  const spec = (extraSettings: Record<string, unknown> | null) => ({ ...toLaunchSpec({ ...base, browserBackend: null }), extraSettings });
  const HOOKS = { SessionStart: [messageToolHookGroup()] }; // P4-R7y

  it('advertises the contract version beside the browser socket while the lane is on, and sets the two keys as decided', () => {
    const decided = withOwnerChannel(spec({ env: { CUA_BROWSER_BACKENDS: socket }, enableWorkflows: true }), { laneOn: true, append: 'contract', snapshotOff: true });
    expect(decided.extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: socket, [NATIVE_TO_HUMAN_ENV]: String(TO_HUMAN_CONTRACT_VERSION) }, hooks: HOOKS, enableWorkflows: true });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_CONTRACT, systemPromptSnapshot: 'off' });
    expect(LaunchSpecSchema.parse(decided)).toEqual(decided);
  });

  it('sets the variable and the hook alone when the lane is on and a compatible style carries the instructions', () => {
    const decided = withOwnerChannel(spec(null), { laneOn: true, append: null, snapshotOff: false });
    expect(decided.extraSettings).toEqual({ env: { [NATIVE_TO_HUMAN_ENV]: String(TO_HUMAN_CONTRACT_VERSION) }, hooks: HOOKS });
    expect(decided).not.toHaveProperty('appendSystemPrompt');
    expect(decided).not.toHaveProperty('systemPromptSnapshot');
  });

  it('omits the variable when the lane is off, leaving the other settings as they were', () => {
    expect(withOwnerChannel(spec(null), { laneOn: false, append: null, snapshotOff: false }).extraSettings).toBeNull();
    expect(withOwnerChannel(spec({ env: { CUA_BROWSER_BACKENDS: socket } }), { laneOn: false, append: null, snapshotOff: true })).toMatchObject({ extraSettings: { env: { CUA_BROWSER_BACKENDS: socket } }, systemPromptSnapshot: 'off' });
    expect(withOwnerChannel(spec({ env: { [NATIVE_TO_HUMAN_ENV]: '1' } }), { laneOn: false, append: null, snapshotOff: false }).extraSettings).toBeNull(); // a retried spec
  });
  // P4-R7y: MAWS's SessionStart group after the caller's hooks, once; out again with the lane off
  it('adds MAWS’s SessionStart group after the caller’s hooks once, a retried spec included, and takes only it out with the lane off', () => {
    const own = { hooks: [{ type: 'command', command: 'echo own' }] };
    const caller = { SessionStart: [own], PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo post' }] }] };
    const on = withOwnerChannel(spec({ hooks: caller }), { laneOn: true, append: null, snapshotOff: false });
    expect(on.extraSettings?.hooks).toEqual({ ...caller, SessionStart: [own, messageToolHookGroup()] });
    expect(withOwnerChannel(on, { laneOn: true, append: null, snapshotOff: false }).extraSettings?.hooks).toEqual(on.extraSettings?.hooks); // a retried spec
    expect(withOwnerChannel(on, { laneOn: false, append: null, snapshotOff: false }).extraSettings).toEqual({ hooks: caller });
    expect(withOwnerChannel(withOwnerChannel(spec(null), { laneOn: true, append: null, snapshotOff: false }), { laneOn: false, append: null, snapshotOff: false }).extraSettings).toBeNull();
    expect(LaunchSpecSchema.parse(on)).toEqual(on);
  });
  // P2-C2 (Decision Log 31): a message-tool style gets the supplement, the advertisement unchanged
  it('appends the supplement in place of the contract beside a message-tool style, the variable still the contract version', () => {
    const decided = withOwnerChannel(spec(null), { laneOn: true, append: 'supplement', snapshotOff: true });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_SUPPLEMENT, systemPromptSnapshot: 'off', extraSettings: { env: { [NATIVE_TO_HUMAN_ENV]: String(TO_HUMAN_CONTRACT_VERSION) } } });
    expect(decided.appendSystemPrompt).not.toContain(CONTRACT_HEADER(TO_HUMAN_CONTRACT_VERSION));
    expect(LaunchSpecSchema.parse(decided)).toEqual(decided);
  });
});
// P2-C end

// P4-A2 start (2026-10-21; P4 §4.2 "The per-session launch profile", X6's amendment; the owner's ruling: one profile in
// Settings › Engine, settings version 17): the profile reaches the engine as flag-level `--settings` keys alone
describe('the launch profile', () => {
  const SOURCE_APP = 'e0000000-0000-4000-8000-000000000005' as AppSessionId;
  const source = { appSessionId: SOURCE_APP, engineSessionId: SOURCE_ENGINE, rewindTo: null };
  const ctx = { cwd: REPO, trust: null, replay: null };
  const withProfile = (launchProfile: LaunchProfile): C10Settings => ({ ...C10_SETTING_DEFAULTS, engine: { ...C10_SETTING_DEFAULTS.engine, launchProfile } });
  const BOOTSTRAP = { bootstrapId: BOOT, cwd: REPO, additionalDirectories: [], gateway: 'gateway' as const, trustKey: REPO, replay: null };
  // every launch MAWS owns: new, fork, side thread, resume and the trust bootstrap
  const launches = (settings: C10Settings, browserBackend: string | null = null) => ({
    new: intentLaunchSpec(intent(), { ...ctx, browserBackend }, settings),
    fork: intentLaunchSpec(intent({ kind: 'fork', source }), { ...ctx, browserBackend }, settings),
    sideThread: intentLaunchSpec(intent({ kind: 'fork', source, lineage: { kind: 'side-thread', parentAppSessionId: SOURCE_APP, parentEngineSessionId: SOURCE_ENGINE, openedBy: 'btw' } }), { ...ctx, browserBackend }, settings),
    resume: resumeLaunchSpec(record(APP, { engineSessionId: SOURCE_ENGINE, effort: 'high' }), {}, { trust: null, replay: null, browserBackend }, settings),
    bootstrap: bootstrapSpec(BOOTSTRAP, settings),
  });
  const argsOf = (spec: ReturnType<typeof toLaunchSpec>) => buildLaunch(spec, {}, { relayUrl: 'http://127.0.0.1:8641', bin: '/bin/claude', engineVersion: '2.1.306', spawnerPid: 1 }).args;
  const flagOf = (args: string[]) => args[args.indexOf('--settings') + 1]!;
  const OFF = { 'cua@cua': false, 'ptc@ptc-tool': false };
  const PROFILE: LaunchProfile = { plugins: { off: ['ptc@ptc-tool', 'cua@cua', 'ptc@ptc-tool'] }, outputStyle: 'maws', hooks: 'none' };

  it('is the user scope by default, and the user scope gives today’s launch byte for byte', () => {
    expect(C10_SETTING_DEFAULTS.engine.launchProfile).toEqual(userScopeProfile());
    const today = launches(C10_SETTING_DEFAULTS);
    const explicit = launches(withProfile({ plugins: { off: [] }, outputStyle: 'user', hooks: 'user' }));
    for (const kind of Object.keys(today) as (keyof typeof today)[]) {
      expect(explicit[kind], kind).toEqual(today[kind]);
      expect(today[kind].extraSettings, kind).toBeNull();
      // the host's keys alone, as before the profile existed
      expect(flagOf(argsOf(today[kind])), kind).toBe(kind === 'bootstrap' ? '{"dialogExpiry":"never"}' : '{"dialogExpiry":"never","effortLevel":"high"}');
    }
    expect(launches(C10_SETTING_DEFAULTS, '/u/cua.sock').new.extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: '/u/cua.sock' } });
    expect(withOwnerChannel(today.new, { laneOn: true, append: 'contract', snapshotOff: false })).toMatchObject({
      appendSystemPrompt: TO_HUMAN_CONTRACT,
      extraSettings: { env: { [NATIVE_TO_HUMAN_ENV]: String(TO_HUMAN_CONTRACT_VERSION) }, hooks: { SessionStart: [messageToolHookGroup()] } },
    });
  });

  it('turns each plugin in `off` off at flag level, sorted and once, leaving every other plugin to the user’s settings', () => {
    for (const [kind, spec] of Object.entries(launches(withProfile({ plugins: { off: ['ptc@ptc-tool', 'cua@cua', 'ptc@ptc-tool'] }, outputStyle: 'user', hooks: 'user' })))) {
      expect(spec.extraSettings, kind).toEqual({ enabledPlugins: OFF });
      expect(flagOf(argsOf(spec)), kind).toContain('"enabledPlugins":{"cua@cua":false,"ptc@ptc-tool":false}');
    }
  });

  it('selects the engine’s built-in default style for MAWS’s own, and turns every hook off with disableAllHooks', () => {
    for (const [kind, spec] of Object.entries(launches(withProfile({ plugins: { off: [] }, outputStyle: 'maws', hooks: 'user' })))) expect(spec.extraSettings, kind).toEqual({ outputStyle: 'default' });
    for (const [kind, spec] of Object.entries(launches(withProfile({ plugins: { off: [] }, outputStyle: 'user', hooks: 'none' })))) expect(spec.extraSettings, kind).toEqual({ disableAllHooks: true });
  });

  it('keeps `user` among the setting sources, the effort, the browser socket and the app’s MCP servers, and adds no effort of its own', () => {
    const servers: C10Settings = { ...C10_SETTING_DEFAULTS, engine: { ...C10_SETTING_DEFAULTS.engine, launchProfile: PROFILE, mcpServers: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' }] } };
    for (const [kind, spec] of Object.entries(launches(servers, '/u/cua.sock'))) {
      expect(LaunchSpecSchema.parse(spec), kind).toEqual(spec);
      const args = argsOf(spec);
      expect(args[args.indexOf('--setting-sources') + 1], kind).toBe('user,project,local');
      const flag = JSON.parse(flagOf(args)) as Record<string, unknown>;
      expect(flag, kind).toMatchObject({ enabledPlugins: OFF, outputStyle: 'default', disableAllHooks: true, ...(kind === 'bootstrap' ? {} : { env: { CUA_BROWSER_BACKENDS: '/u/cua.sock' } }) }); // the bootstrap has no socket
      expect(flag.effortLevel ?? null, kind).toBe(spec.effort); // the spec's effort as before; the profile names none
      // turning plugins off leaves the app's servers alone (the bootstrap takes none, as before)
      if (kind !== 'bootstrap') expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!), kind).toEqual({ mcpServers: { notion: { type: 'http', url: 'https://mcp.notion.com/mcp' } } });
    }
  });

  // P4 Decision Log 50 (P4-R7y): `disableAllHooks` silences the flag JSON's own command hooks too (the engine keeps only
  // policy hooks; spikes/protocol-probe/findings-p4-a2p-profile.txt), so MAWS's start-time context goes through the
  // appended prompt instead of its SessionStart group
  it('under hooks none gives MAWS’s start-time context through the appended prompt, after the contract or the supplement, and no SessionStart group', () => {
    const off = launches(withProfile(PROFILE)).new;
    const lane = String(TO_HUMAN_CONTRACT_VERSION);
    const contract = withOwnerChannel(off, { laneOn: true, append: 'contract', snapshotOff: false });
    expect(contract.extraSettings).toEqual({ enabledPlugins: OFF, outputStyle: 'default', disableAllHooks: true, env: { [NATIVE_TO_HUMAN_ENV]: lane } });
    expect(contract.appendSystemPrompt).toBe(`${TO_HUMAN_CONTRACT}\n\n${MESSAGE_TOOL_ALIAS}`);
    expect(withOwnerChannel(off, { laneOn: true, append: 'supplement', snapshotOff: true })).toMatchObject({ appendSystemPrompt: `${TO_HUMAN_SUPPLEMENT}\n\n${MESSAGE_TOOL_ALIAS}`, systemPromptSnapshot: 'off' });
    const alone = withOwnerChannel(off, { laneOn: true, append: null, snapshotOff: false });
    expect(alone.appendSystemPrompt).toBe(MESSAGE_TOOL_ALIAS);
    expect(alone.extraSettings).not.toHaveProperty('hooks');
    expect(LaunchSpecSchema.parse(contract)).toEqual(contract);
    // with the lane off the plugin's tool is real: no alias, nothing appended
    const laneOff = withOwnerChannel(off, { laneOn: false, append: null, snapshotOff: false });
    expect(laneOff).not.toHaveProperty('appendSystemPrompt');
    expect(laneOff.extraSettings).toEqual({ enabledPlugins: OFF, outputStyle: 'default', disableAllHooks: true });
    // a retried spec carries the alias once
    expect(withOwnerChannel(contract, { laneOn: true, append: 'contract', snapshotOff: false }).appendSystemPrompt).toBe(contract.appendSystemPrompt);
    expect(hooksOff(off)).toBe(true);
    expect(hooksOff(launches(C10_SETTING_DEFAULTS).new)).toBe(false);
  });
});
// P4-A2 end
