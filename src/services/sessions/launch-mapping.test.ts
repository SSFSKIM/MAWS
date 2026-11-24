import { describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid, ProjectId, SessionId } from '@shared/graph/ids';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { SetupIntent } from '@shared/sessions/intent';
import type { TrustState } from '@shared/sessions/trust';
import { record } from '../../../test/support/builders';
import { bootstrapSpec, C10_SETTING_DEFAULTS, intentLaunchSpec, readSettings, resumeLaunchSpec, toLaunchSpec, trustMapping, type C10Settings, seedPermissionMode } from './launch-mapping';
import { withOwnerChannel } from './launch-mapping'; // P2-C
import { CONTRACT_HEADER, NATIVE_TO_HUMAN_ENV, TO_HUMAN_MIRROR_VERSION, TO_HUMAN_SUPPLEMENT } from '@shared/owner/contract'; // P2-C; P2-C2: the supplement; U2b: the mirror's number by name
import { FOLD_SUMMARIES_ENV } from '@shared/owner/folds'; // U2b: the summaries' value
import { buildLaunch } from '../../engine-host/launch'; // P4-R8: the launch line a spec becomes
import type { AppMcpServer } from '@shared/engine/app-mcp-servers'; // P4-R8
import { userScopeProfile, type LaunchProfile } from '@shared/engine/launch-profile'; // P4-A2
import { FULL_MAWS_TOOL_SET, type MawsToolSet } from '@shared/maws/tool-set'; // board ticket 421

const APP = 'a0000000-0000-4000-8000-000000000001' as AppSessionId;
const BOOT = 'b0000000-0000-4000-8000-000000000002' as AppSessionId;
const PIN = 'c0000000-0000-4000-8000-000000000003' as SessionId;
const SOURCE_ENGINE = 'd0000000-0000-4000-8000-000000000004' as SessionId;
const REPO = '/private/tmp/maws-repo';
const HOME = '/Users/someone';
// UX wave U12a: a record with no title, whose resume sets no cursor label (the label's own cases are below)
const UNTITLED = { title: { text: '', source: 'none' as const } };

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
    expect(C10_SETTING_DEFAULTS).toEqual({ gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask' }, engine: { subagentModel: null, mcpServers: [], launchProfile: userScopeProfile() }, permissions: { autoFallback: 'acceptEdits' }, mawsTools: FULL_MAWS_TOOL_SET });
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

  // P5 O7 M9: `route` read before the legacy fields: the caller's, then the record's, then the machine's default
  it('resumes on the record’s route before its `routed`, an older caller’s gateway option over both, and the machine default for a record never verified', () => {
    const machine = record(APP, { gateway: { routed: true, baseUrl: 'http://127.0.0.1:8641', autoModeServer: 'unknown', route: 'machine', observed: { kind: 'claudeusage', baseUrl: 'http://127.0.0.1:8641' } } });
    expect(resumeLaunchSpec(machine, {}, { trust: null, replay: null })).toMatchObject({ route: 'machine', gateway: 'gateway' });
    expect(resumeLaunchSpec(machine, { gateway: 'direct' }, { trust: null, replay: null })).toMatchObject({ route: 'direct', gateway: 'direct' });
    expect(resumeLaunchSpec(record(APP, { gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' } }), { route: 'machine' }, { trust: null, replay: null })).toMatchObject({ route: 'machine', gateway: 'direct' });
    const discovered = record(APP, { gateway: { routed: null, baseUrl: null, autoModeServer: 'unknown' } });
    const machineDefault: C10Settings = { ...C10_SETTING_DEFAULTS, gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', route: 'machine' } };
    expect(resumeLaunchSpec(discovered, {}, { trust: null, replay: null }, machineDefault)).toMatchObject({ route: 'machine', gateway: 'gateway' });
    expect(intentLaunchSpec({ ...intent(), route: 'machine', gateway: 'direct' }, { cwd: REPO, trust: null, replay: null })).toMatchObject({ route: 'machine', gateway: 'direct' });
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
    expect(resumeLaunchSpec(record(APP, UNTITLED), {}, { trust: null, replay: null, browserBackend: socket }).extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: socket } });
    expect(intentLaunchSpec(intent({}), { cwd: REPO, trust: null, replay: null, browserBackend: null }).extraSettings).toBeNull();
    expect(resumeLaunchSpec(record(APP, UNTITLED), {}, { trust: null, replay: null }).extraSettings).toBeNull();
  });

  // Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, Interfaces §E, D3, D8): the spec carries the set
  // the attempt serves, given by the caller, and nothing at the full set, so a default launch's spec is what it was
  it('board ticket 421: a new session’s, a fork’s and a resume’s spec carry the set the attempt serves, none at the full set; the bootstrap none', () => {
    const partial: MawsToolSet = { artifacts: false, documents: false, dashboards: false, auxiliary: true, question: 'engine' };
    const created = intentLaunchSpec(intent(), { cwd: REPO, trust: null, replay: null, mawsTools: partial });
    expect(LaunchSpecSchema.parse(created)).toEqual(created);
    expect(created.mawsTools).toEqual(partial);
    // the intent's own key is not read: the caller's served set is the one answer
    expect(intentLaunchSpec(intent({ mawsTools: partial }), { cwd: REPO, trust: null, replay: null, mawsTools: FULL_MAWS_TOOL_SET })).not.toHaveProperty('mawsTools');
    expect(intentLaunchSpec(intent(), { cwd: REPO, trust: null, replay: null })).not.toHaveProperty('mawsTools');
    const fork = intent({ kind: 'fork', source: { appSessionId: BOOT, engineSessionId: SOURCE_ENGINE, rewindTo: null } });
    expect(intentLaunchSpec(fork, { cwd: REPO, trust: null, replay: null, mawsTools: partial }).mawsTools).toEqual(partial);
    const kept = record(APP, { ...UNTITLED, engineSessionId: SOURCE_ENGINE, mawsTools: partial });
    expect(resumeLaunchSpec(kept, {}, { trust: null, replay: null, mawsTools: partial }).mawsTools).toEqual(partial);
    expect(resumeLaunchSpec(record(APP, UNTITLED), {}, { trust: null, replay: null, mawsTools: FULL_MAWS_TOOL_SET })).not.toHaveProperty('mawsTools');
    expect(bootstrapSpec({ bootstrapId: BOOT, cwd: REPO, additionalDirectories: [], gateway: 'gateway', trustKey: REPO, replay: null })).not.toHaveProperty('mawsTools');
    // the owner channel's merge keeps it
    const decided = withOwnerChannel(created, { advertisement: 8, append: null, snapshotOff: false, summariesOff: false });
    expect(decided.mawsTools).toEqual(partial);
  });

  // P5 O12 M11 (Interfaces §H): a launch names the spawner of its own session, the intent's at the start and the record's
  // at a resume, less the sealed action, which goes to the proof file it names; a session without one, a fork (its
  // intent carries none) and the trust bootstrap name none
  it('P5 O12 M11: names the session’s own spawner at its start and its resume, with the proof file, and nobody for the rest', () => {
    const launchedBy = { member: 'mem-a', device: 'dev-1', opId: 'op-0123456789abcdef', action: { action: 'session.spawn', brief: 'x'.repeat(64) } };
    const proofFile = `/u/sessions/launched-by/${APP}.json`;
    const named = { appSessionId: APP, member: 'mem-a', device: 'dev-1', opId: 'op-0123456789abcdef', proofFile };
    const started = intentLaunchSpec(intent({ launchedBy }), { cwd: REPO, trust: null, replay: null, proofFile });
    expect(LaunchSpecSchema.parse(started)).toEqual(started);
    expect(started.launchedBy).toEqual(named);
    const resumed = resumeLaunchSpec(record(APP, { launchedBy }), {}, { trust: null, replay: null, proofFile });
    expect(LaunchSpecSchema.parse(resumed)).toEqual(resumed);
    expect(resumed.launchedBy).toEqual(named);
    expect(intentLaunchSpec(intent(), { cwd: REPO, trust: null, replay: null, proofFile })).not.toHaveProperty('launchedBy');
    expect(resumeLaunchSpec(record(APP), {}, { trust: null, replay: null, proofFile })).not.toHaveProperty('launchedBy');
    const fork = intent({ kind: 'fork', source: { appSessionId: APP, engineSessionId: SOURCE_ENGINE, rewindTo: null }, appSessionId: BOOT });
    expect(intentLaunchSpec(fork, { cwd: REPO, trust: null, replay: null, proofFile })).not.toHaveProperty('launchedBy');
    expect(bootstrapSpec({ bootstrapId: BOOT, cwd: REPO, additionalDirectories: [], gateway: 'gateway', trustKey: REPO, replay: null })).not.toHaveProperty('launchedBy');
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
    expect(withOwnerChannel(launches(withServers).new, { advertisement: TO_HUMAN_MIRROR_VERSION, append: 'supplement', snapshotOff: true, summariesOff: false }).mcpConfig).toEqual(CONFIG);
  });

  // a lane-on launch carries the app's servers and the advertisement (P4-R7z: no hook of MAWS's); the bootstrap neither
  it('gives a lane-on launch with app servers both --mcp-config and the advertisement in --settings, and the bootstrap neither', () => {
    const settingsOf = (args: string[]) => JSON.parse(args[args.indexOf('--settings') + 1]!) as { hooks?: unknown; env?: Record<string, string> };
    for (const [kind, spec] of Object.entries(launches(withServers))) {
      const args = argsOf(withOwnerChannel(spec, { advertisement: TO_HUMAN_MIRROR_VERSION, append: 'supplement', snapshotOff: false, summariesOff: false }));
      expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!), kind).toEqual(CONFIG);
      expect(settingsOf(args).env?.[NATIVE_TO_HUMAN_ENV], kind).toBe(String(TO_HUMAN_MIRROR_VERSION));
      expect(settingsOf(args).hooks, kind).toBeUndefined();
    }
    const boot = argsOf(bootstrapSpec({ bootstrapId: BOOT, cwd: REPO, additionalDirectories: [], gateway: 'gateway', trustKey: REPO, replay: null }, withServers));
    expect(boot).not.toContain('--mcp-config');
    expect(settingsOf(boot).env).toBeUndefined();
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
  const ADVERTISED = String(TO_HUMAN_MIRROR_VERSION);

  // P2-C2 (Decision Log 31): the plugin's style gets the supplement; P4-R7z: MAWS appends no contract, and no hook goes in
  it('advertises 8 beside the browser socket while the lane is on, appends the supplement and passes "off" as decided', () => {
    const decided = withOwnerChannel(spec({ env: { CUA_BROWSER_BACKENDS: socket }, enableWorkflows: true }), { advertisement: TO_HUMAN_MIRROR_VERSION, append: 'supplement', snapshotOff: true, summariesOff: false });
    expect(ADVERTISED).toBe('8');
    expect(decided.extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: socket, [NATIVE_TO_HUMAN_ENV]: ADVERTISED }, enableWorkflows: true });
    expect(decided).toMatchObject({ appendSystemPrompt: TO_HUMAN_SUPPLEMENT, systemPromptSnapshot: 'off' });
    expect(decided.appendSystemPrompt).not.toContain(CONTRACT_HEADER(0).slice(0, -3));
    expect(LaunchSpecSchema.parse(decided)).toEqual(decided);
  });

  it('omits the variable when the lane is off, leaving the other settings as they were', () => {
    expect(withOwnerChannel(spec(null), { advertisement: null, append: null, snapshotOff: false, summariesOff: false }).extraSettings).toBeNull();
    expect(withOwnerChannel(spec({ env: { CUA_BROWSER_BACKENDS: socket } }), { advertisement: null, append: null, snapshotOff: true, summariesOff: false })).toMatchObject({ extraSettings: { env: { CUA_BROWSER_BACKENDS: socket } }, systemPromptSnapshot: 'off' });
    expect(withOwnerChannel(spec({ env: { [NATIVE_TO_HUMAN_ENV]: '7' } }), { advertisement: null, append: null, snapshotOff: false, summariesOff: false }).extraSettings).toBeNull(); // a retried spec
    expect(withOwnerChannel(spec({ env: { [NATIVE_TO_HUMAN_ENV]: '7' } }), { advertisement: TO_HUMAN_MIRROR_VERSION, append: 'supplement', snapshotOff: false, summariesOff: false }).extraSettings).toEqual({ env: { [NATIVE_TO_HUMAN_ENV]: ADVERTISED } });
  });

  // The UX wave, U2b (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, Interfaces §A and §M): the
  // settings env carries the advertisement the decision made, 9, 8 or none, and TO_HUMAN_FOLD_SUMMARIES=off for every
  // launch decided while the summaries' switch is off, whatever the lane; a caller's value of either name is replaced
  it('writes the decided advertisement, 9, 8 or none, in place of a caller’s', () => {
    for (const advertisement of [9, 8, null] as const) {
      const decided = withOwnerChannel(spec({ env: { CUA_BROWSER_BACKENDS: socket, [NATIVE_TO_HUMAN_ENV]: '7' } }), { advertisement, append: null, snapshotOff: false, summariesOff: false });
      expect(decided.extraSettings, String(advertisement)).toEqual({ env: { CUA_BROWSER_BACKENDS: socket, ...(advertisement === null ? {} : { [NATIVE_TO_HUMAN_ENV]: String(advertisement) }) } });
    }
  });

  it('writes TO_HUMAN_FOLD_SUMMARIES=off beside each advertisement while the switch is off, and removes a caller’s value while it is on', () => {
    expect(FOLD_SUMMARIES_ENV).toBe('TO_HUMAN_FOLD_SUMMARIES');
    for (const advertisement of [9, 8, null] as const) {
      const off = withOwnerChannel(spec({ env: { CUA_BROWSER_BACKENDS: socket } }), { advertisement, append: null, snapshotOff: false, summariesOff: true });
      expect(off.extraSettings, `off, ${advertisement}`).toEqual({ env: { CUA_BROWSER_BACKENDS: socket, ...(advertisement === null ? {} : { [NATIVE_TO_HUMAN_ENV]: String(advertisement) }), [FOLD_SUMMARIES_ENV]: 'off' } });
      expect(LaunchSpecSchema.parse(off)).toEqual(off);
      const on = withOwnerChannel(spec({ env: { [FOLD_SUMMARIES_ENV]: 'off' } }), { advertisement, append: null, snapshotOff: false, summariesOff: false });
      expect(on.extraSettings, `on, ${advertisement}`).toEqual(advertisement === null ? null : { env: { [NATIVE_TO_HUMAN_ENV]: String(advertisement) } });
    }
    expect(withOwnerChannel(spec(null), { advertisement: null, append: null, snapshotOff: false, summariesOff: true }).extraSettings).toEqual({ env: { [FOLD_SUMMARIES_ENV]: 'off' } });
  });

  // P4-R7z: P4-R7y's SessionStart group and P4-A2's appended alias are gone; the caller's hooks pass as they are
  it('leaves the caller’s hooks as they are, with the lane on or off, and adds none of its own', () => {
    const caller = { SessionStart: [{ hooks: [{ type: 'command', command: 'echo own' }] }], PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo post' }] }] };
    for (const laneOn of [true, false]) {
      const decided = withOwnerChannel(spec({ hooks: caller, disableAllHooks: true }), { advertisement: laneOn ? TO_HUMAN_MIRROR_VERSION : null, append: laneOn ? 'supplement' : null, snapshotOff: false, summariesOff: false });
      expect(decided.extraSettings).toEqual({ hooks: caller, disableAllHooks: true, ...(laneOn ? { env: { [NATIVE_TO_HUMAN_ENV]: ADVERTISED } } : {}) });
      expect(decided.appendSystemPrompt ?? null).toBe(laneOn ? TO_HUMAN_SUPPLEMENT : null);
      expect(LaunchSpecSchema.parse(decided)).toEqual(decided);
    }
  });
});
// P2-C end

// UX wave U12a start (l9-browser-delivery-07; the execution document's Interfaces §F): a resume of a record with a title
// gives the computer-use plugin's on-screen cursor that title as CUA_CURSOR_LABEL, in the settings environment beside
// the browser socket; the plugin cuts it to 24 characters and picks the colour itself
describe('the cursor label', () => {
  const titled = (text: string, source: 'user' | 'generated' | 'tool' | 'none' = 'user') => record(APP, { title: { text, source } });
  const resumed = (r: ReturnType<typeof record>, browserBackend: string | null = null) => resumeLaunchSpec(r, {}, { trust: null, replay: null, browserBackend });

  it('is the record’s title at a resume, beside the browser socket and without one', () => {
    expect(resumed(titled('Fix the login form'), '/u/cua.sock').extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: '/u/cua.sock', CUA_CURSOR_LABEL: 'Fix the login form' } });
    expect(resumed(titled('Fix the login form')).extraSettings).toEqual({ env: { CUA_CURSOR_LABEL: 'Fix the login form' } });
    expect(resumed(titled('Generated title', 'generated')).extraSettings).toEqual({ env: { CUA_CURSOR_LABEL: 'Generated title' } });
    const spec = resumed(titled('Fix the login form'), '/u/cua.sock');
    expect(LaunchSpecSchema.parse(spec)).toEqual(spec);
  });

  it('is nothing for a record whose title source is none, or whose title is empty once cleaned', () => {
    expect(resumed(titled('Leftover text', 'none')).extraSettings).toBeNull();
    expect(resumed(titled(' \u0007\n\t ')).extraSettings).toBeNull();
    expect(resumed(titled('', 'user'), '/u/cua.sock').extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: '/u/cua.sock' } });
  });

  it('removes control characters, trims, and cuts the title at 64 characters', () => {
    expect(resumed(titled('  Fix\u0000 the\u001b[31m form\u007f\u0085 \n')).extraSettings).toEqual({ env: { CUA_CURSOR_LABEL: 'Fix the[31m form' } });
    const long = `${'a'.repeat(60)}bcdefgh`;
    expect(resumed(titled(long)).extraSettings).toEqual({ env: { CUA_CURSOR_LABEL: `${'a'.repeat(60)}bcde` } });
    const astral = '🙂'.repeat(70); // cut by characters, never inside one
    expect((resumed(titled(astral)).extraSettings as { env: { CUA_CURSOR_LABEL: string } }).env.CUA_CURSOR_LABEL).toBe('🙂'.repeat(64));
  });

  it('is set by no intent’s launch and not by the trust bootstrap', () => {
    expect(intentLaunchSpec(intent({}), { cwd: REPO, trust: null, replay: null, browserBackend: '/u/cua.sock' }).extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: '/u/cua.sock' } });
    expect(intentLaunchSpec(intent({ kind: 'fork', source: { appSessionId: BOOT, engineSessionId: SOURCE_ENGINE, rewindTo: null } }), { cwd: REPO, trust: null, replay: null }).extraSettings).toBeNull();
    expect(bootstrapSpec({ bootstrapId: BOOT, cwd: REPO, additionalDirectories: [], gateway: 'gateway', trustKey: REPO, replay: null }).extraSettings).toBeNull();
  });

  it('is kept through the owner channel’s merge of the environment, lane on and off', () => {
    const spec = resumed(titled('Fix the login form'), '/u/cua.sock');
    expect(withOwnerChannel(spec, { advertisement: TO_HUMAN_MIRROR_VERSION, append: 'supplement', snapshotOff: false, summariesOff: false }).extraSettings).toEqual({
      env: { CUA_BROWSER_BACKENDS: '/u/cua.sock', CUA_CURSOR_LABEL: 'Fix the login form', [NATIVE_TO_HUMAN_ENV]: String(TO_HUMAN_MIRROR_VERSION) },
    });
    expect(withOwnerChannel(spec, { advertisement: null, append: null, snapshotOff: false, summariesOff: false }).extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: '/u/cua.sock', CUA_CURSOR_LABEL: 'Fix the login form' } });
  });
});
// UX wave U12a end

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
    resume: resumeLaunchSpec(record(APP, { engineSessionId: SOURCE_ENGINE, effort: 'high', ...UNTITLED }), {}, { trust: null, replay: null, browserBackend }, settings), // U12a: untitled, so no cursor label
    bootstrap: bootstrapSpec(BOOTSTRAP, settings),
  });
  const argsOf = (spec: ReturnType<typeof toLaunchSpec>) => buildLaunch(spec, {}, { relayUrl: 'http://127.0.0.1:8641', bin: '/bin/claude', engineVersion: '2.1.306', spawnerPid: 1 }).args;
  const flagOf = (args: string[]) => args[args.indexOf('--settings') + 1]!;
  const OFF = { 'cua@cua': false, 'ptc@ptc-tool': false };
  const PROFILE: LaunchProfile = { plugins: { off: ['ptc@ptc-tool', 'cua@cua', 'ptc@ptc-tool'] }, hooks: 'none' };

  it('is the user scope by default, and the user scope gives today’s launch byte for byte', () => {
    expect(C10_SETTING_DEFAULTS.engine.launchProfile).toEqual(userScopeProfile());
    const today = launches(C10_SETTING_DEFAULTS);
    const explicit = launches(withProfile({ plugins: { off: [] }, hooks: 'user' }));
    for (const kind of Object.keys(today) as (keyof typeof today)[]) {
      expect(explicit[kind], kind).toEqual(today[kind]);
      expect(today[kind].extraSettings, kind).toBeNull();
      // the host's keys alone, as before the profile existed
      expect(flagOf(argsOf(today[kind])), kind).toBe(kind === 'bootstrap' ? '{"dialogExpiry":"never"}' : '{"dialogExpiry":"never","effortLevel":"high"}');
    }
    expect(launches(C10_SETTING_DEFAULTS, '/u/cua.sock').new.extraSettings).toEqual({ env: { CUA_BROWSER_BACKENDS: '/u/cua.sock' } });
    expect(withOwnerChannel(today.new, { advertisement: TO_HUMAN_MIRROR_VERSION, append: 'supplement', snapshotOff: false, summariesOff: false })).toMatchObject({
      appendSystemPrompt: TO_HUMAN_SUPPLEMENT,
      extraSettings: { env: { [NATIVE_TO_HUMAN_ENV]: String(TO_HUMAN_MIRROR_VERSION) } },
    });
  });

  it('turns each plugin in `off` off at flag level, sorted and once, leaving every other plugin to the user’s settings', () => {
    for (const [kind, spec] of Object.entries(launches(withProfile({ plugins: { off: ['ptc@ptc-tool', 'cua@cua', 'ptc@ptc-tool'] }, hooks: 'user' })))) {
      expect(spec.extraSettings, kind).toEqual({ enabledPlugins: OFF });
      expect(flagOf(argsOf(spec)), kind).toContain('"enabledPlugins":{"cua@cua":false,"ptc@ptc-tool":false}');
    }
  });

  // Version 19 (the owner's ruling of 2026-10-28): the profile names no output style, so no launch sets one and the
  // user's own style applies, whatever else the profile turns off
  it('turns every hook off with disableAllHooks, and never sets an output style', () => {
    for (const [kind, spec] of Object.entries(launches(withProfile({ plugins: { off: [] }, hooks: 'none' })))) expect(spec.extraSettings, kind).toEqual({ disableAllHooks: true });
    for (const [kind, spec] of Object.entries(launches(withProfile(PROFILE), '/u/cua.sock'))) {
      expect(spec.extraSettings ?? {}, kind).not.toHaveProperty('outputStyle');
      expect(JSON.parse(flagOf(argsOf(spec))) as Record<string, unknown>, kind).not.toHaveProperty('outputStyle');
    }
  });

  it('keeps `user` among the setting sources, the effort, the browser socket and the app’s MCP servers, and adds no effort of its own', () => {
    const servers: C10Settings = { ...C10_SETTING_DEFAULTS, engine: { ...C10_SETTING_DEFAULTS.engine, launchProfile: PROFILE, mcpServers: [{ name: 'notion', type: 'http', url: 'https://mcp.notion.com/mcp' }] } };
    for (const [kind, spec] of Object.entries(launches(servers, '/u/cua.sock'))) {
      expect(LaunchSpecSchema.parse(spec), kind).toEqual(spec);
      const args = argsOf(spec);
      expect(args[args.indexOf('--setting-sources') + 1], kind).toBe('user,project,local');
      const flag = JSON.parse(flagOf(args)) as Record<string, unknown>;
      expect(flag, kind).toMatchObject({ enabledPlugins: OFF, disableAllHooks: true, ...(kind === 'bootstrap' ? {} : { env: { CUA_BROWSER_BACKENDS: '/u/cua.sock' } }) }); // the bootstrap has no socket
      expect(flag.effortLevel ?? null, kind).toBe(spec.effort); // the spec's effort as before; the profile names none
      // turning plugins off leaves the app's servers alone (the bootstrap takes none, as before)
      if (kind !== 'bootstrap') expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!), kind).toEqual({ mcpServers: { notion: { type: 'http', url: 'https://mcp.notion.com/mcp' } } });
    }
  });

  // P4-R7z: under hooks none (`disableAllHooks`, which silences the flag JSON's own command hooks too) MAWS has no
  // start-time context to give any more: P4 Decision Log 50's alias is gone with its SessionStart group
  it('under hooks none appends the supplement alone, the profile’s keys kept, and nothing with the lane off', () => {
    const off = launches(withProfile(PROFILE)).new;
    const on = withOwnerChannel(off, { advertisement: TO_HUMAN_MIRROR_VERSION, append: 'supplement', snapshotOff: true, summariesOff: false });
    expect(on.extraSettings).toEqual({ enabledPlugins: OFF, disableAllHooks: true, env: { [NATIVE_TO_HUMAN_ENV]: String(TO_HUMAN_MIRROR_VERSION) } });
    expect(on).toMatchObject({ appendSystemPrompt: TO_HUMAN_SUPPLEMENT, systemPromptSnapshot: 'off' });
    expect(LaunchSpecSchema.parse(on)).toEqual(on);
    const laneOff = withOwnerChannel(off, { advertisement: null, append: null, snapshotOff: false, summariesOff: false });
    expect(laneOff).not.toHaveProperty('appendSystemPrompt');
    expect(laneOff.extraSettings).toEqual({ enabledPlugins: OFF, disableAllHooks: true });
  });
});
// P4-A2 end
