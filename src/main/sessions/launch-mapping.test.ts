import { describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid, ProjectId, SessionId } from '@shared/graph/ids';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { SetupIntent } from '@shared/sessions/intent';
import type { TrustState } from '@shared/sessions/trust';
import { record } from '../../../test/support/builders';
import { bootstrapSpec, C10_SETTING_DEFAULTS, intentLaunchSpec, readSettings, resumeLaunchSpec, toLaunchSpec, trustMapping, type C10Settings, seedPermissionMode } from './launch-mapping';

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
    expect(C10_SETTING_DEFAULTS).toEqual({ gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask' }, engine: { subagentModel: null }, permissions: { autoFallback: 'acceptEdits' } });
    const settings: C10Settings = { ...C10_SETTING_DEFAULTS, engine: { subagentModel: 'sonnet' } };
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
    expect(resumeLaunchSpec(r, {}, { trust: null, replay: null }, { ...C10_SETTING_DEFAULTS, engine: { subagentModel: 'haiku' } }).subagentModel).toBe('haiku');
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

describe('home directory attests without a bootstrap', () => {
  it('maps an accepted decision for ~ to the home realpath on the real launch, and reports no bootstrap', () => {
    const home = trustState({ directory: HOME, trustKey: HOME, keyKind: 'directory', isHome: true });
    const mapping = trustMapping({ decision: 'accepted', decisionKey: HOME, trustRecorded: false }, home);
    expect(mapping).toEqual({ attestation: { accepted: true, directory: HOME }, bootstrap: false });
    expect(intentLaunchSpec(intent({ location: { kind: 'directory', path: HOME }, trust: 'accepted', trustKey: HOME }), { cwd: HOME, trust: mapping.attestation, replay: null }).trust).toEqual({ accepted: true, directory: HOME });
  });
});
