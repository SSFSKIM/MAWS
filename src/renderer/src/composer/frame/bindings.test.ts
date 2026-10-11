import { describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../../test/support/builders';
import type { SetupIntentHook, SetupProject } from '../setup-intent';
import { MESSAGE_HELD, STARTING } from '../submit/submit-state';
import { gitAnswerOf } from '../../sessions/branch-label';
import { intentBindings, liveBindings, LOCATION_FIXED, workspaceDirectoriesOf, type LiveReads } from './bindings';

const APP = 'app-1';

function bridge(answers: Record<string, unknown> = {}) {
  const invoke = vi.fn(async (name: string) => answers[name] ?? { ok: true, value: undefined });
  return { client: { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as MawsBridge, invoke };
}

function hook(over: Partial<SetupIntentHook['intent']> = {}, project?: SetupProject): SetupIntentHook & { patch: ReturnType<typeof vi.fn> } {
  return {
    intent: { location: { kind: 'directory', path: '/repo' }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null, ...over },
    options: {
      models: [{ value: 'sonnet', displayName: 'Sonnet' }, { value: 'haiku', displayName: 'Haiku', supportsAutoMode: false }],
      autoModeNote: null,
    },
    patch: vi.fn(async () => ({ ok: true as const })),
    start: vi.fn(async () => ({ ok: true as const })),
    ...(project && { project }),
  };
}

const answered = () => vi.fn(async () => ({ ok: true as const }));
function project(over: Partial<SetupProject> = {}): SetupProject {
  return { projectId: null, label: null, path: null, branch: null, worktree: null, choose: answered(), newProject: answered(), setWorktree: answered(), ...over };
}

describe('the frame binds its chips to the setup intent or to the live session', () => {
  it('writes every chip of an unstarted session through the hook’s patch', async () => {
    const h = hook({ model: 'haiku' });
    const b = intentBindings(h, { starting: false });
    expect([b.model.disabled, b.mode.disabled, b.directories.disabled]).toEqual([null, null, null]);
    await b.model.set({ model: 'sonnet', effort: 'high' });
    await b.mode.set('plan');
    await b.directories.set(['/extra']);
    expect(h.patch.mock.calls.map(([p]) => p)).toEqual([{ model: 'sonnet', effort: 'high' }, { permissionMode: 'plan' }, { additionalDirectories: ['/extra'] }]);
    expect(b.mode.autoUnavailable).toBe('This model does not support auto mode'); // haiku holds no auto
    expect(b.location.path).toBe('/repo'); // a hook without project facts (the harness's stub) keeps the toolbar's chip
    expect(b.project).toBeNull();
  });

  it('New chat: the project row carries the hook’s project facts and writes through them', async () => {
    const facts = project({ projectId: 'p-1' as SetupProject['projectId'], label: 'repo', path: '/repo', branch: 'main', worktree: false });
    const b = intentBindings(hook({}, facts), { starting: false });
    expect(b.project).toMatchObject({ projectId: 'p-1', label: 'repo', path: '/repo', branch: 'main', worktree: false, disabled: null });
    await b.project!.choose(null);
    await b.project!.setWorktree(true);
    await b.project!.newProject();
    expect(facts.choose).toHaveBeenCalledWith(null);
    expect(facts.setWorktree).toHaveBeenCalledWith(true);
    expect(facts.newProject).toHaveBeenCalledTimes(1);
    const none = intentBindings(hook({ location: null }, project()), { starting: false });
    expect(none.location.path).toBe('');
    expect(none.project).toMatchObject({ label: null, worktree: null });
  });

  it('disables every chip with one reason while starting, or while C10 holds the first message', async () => {
    const starting = intentBindings(hook({}, project()), { starting: true });
    expect([starting.project!.disabled, starting.model.disabled, starting.mode.disabled, starting.directories.disabled, starting.location.note]).toEqual([STARTING, STARTING, STARTING, STARTING, STARTING]);
    const facts = project();
    const held = intentBindings(hook({ message: { content: 'hi', display: 'hi' } }, facts), { starting: false });
    expect([held.project!.disabled, held.model.disabled, held.mode.disabled, held.directories.disabled]).toEqual([MESSAGE_HELD, MESSAGE_HELD, MESSAGE_HELD, MESSAGE_HELD]);
    expect(await held.model.set({ model: 'sonnet', effort: null })).toEqual({ ok: false, error: MESSAGE_HELD });
    expect(await held.project!.choose(null)).toEqual({ ok: false, error: MESSAGE_HELD });
    expect(facts.choose).not.toHaveBeenCalled();
  });

  it('applies a live session’s model, effort and directories through C3, and keeps location and branch read-only', async () => {
    const rulesAnswer = { ok: true, value: { state: { rules: [], workspaceDirectories: ['/a', '/held'], originalCwd: '/work/app-1', managedOnly: false } } };
    const { client, invoke } = bridge({ 'session.setModel': { ok: true, value: { ok: true, error: null, code: null } }, 'session.listPermissionRules': rulesAnswer });
    const s = { ...status(APP), cwd: '/work/app-1', model: { requested: 'sonnet', resolved: 'claude-sonnet' }, effort: 'medium' as const };
    const refresh = vi.fn();
    const b = liveBindings(s, record(APP), { models: null, directories: ['/a'], git: { repository: true, branch: 'main' }, refresh }, client);
    expect(b.location).toEqual({ path: '/work/app-1', branch: 'main', note: LOCATION_FIXED });
    expect(b.project).toBeNull(); // no project row once started
    expect(b.model.value).toEqual({ model: 'sonnet', effort: 'medium' }); // the model asked for (S-chip), the same one the engine runs
    await b.model.set({ model: 'haiku', effort: 'medium' });
    await b.model.set({ model: 'claude-sonnet', effort: 'high' });
    await b.directories.set(['/a', '/b']);
    expect(invoke.mock.calls).toEqual([
      ['session.setModel', { appSessionId: APP, model: 'haiku' }],
      ['session.setEffort', { appSessionId: APP, effort: 'high' }],
      ['session.listPermissionRules', { appSessionId: APP }], // read at the change: the engine's list, not the chip's
      ['session.applyFlagSettings', { appSessionId: APP, settings: { permissions: { additionalDirectories: ['/a', '/held', '/b'] } } }],
    ]);
    expect(refresh).toHaveBeenCalledTimes(1); // the chip re-reads the rules afterwards
    expect(b.mode.value).toBe('auto');
  });

  // W9 (H2): the record's branch only until git has answered; git's answer after, the record never again
  it('names the branch by git once it has answered: its branch, "detached", or none for a folder that is no repository', () => {
    const s = { ...status(APP), cwd: '/tmp/not-a-repo' };
    const branchOf = (r: Parameters<typeof liveBindings>[1], git: LiveReads['git']) => liveBindings(s, r, { git }).location.branch;
    const onMain = { ...record(APP), branch: 'main' };
    const stale = { ...record(APP), branch: 'HEAD' }; // what the engine wrote in a non-repository, before migration 3
    // not yet answered: a branch the record names, never HEAD, never a placeholder
    expect([branchOf(onMain, null), branchOf(stale, null), branchOf(record(APP), null)]).toEqual(['main', null, null]);
    // answered: a checkout's branch, a detached checkout, a folder outside any repository (the record is not consulted)
    expect(branchOf(onMain, { repository: true, branch: 'topic' })).toBe('topic');
    expect(branchOf(onMain, { repository: true, branch: null })).toBe('detached');
    expect(branchOf(onMain, { repository: false })).toBeNull();
    // the watch's states as answers: a refusal for a non-repository is one; any other failure is not
    expect(gitAnswerOf({ status: null, error: 'not a git repository' })).toEqual({ repository: false });
    expect(gitAnswerOf({ status: null, error: 'spawn git ENOENT' })).toBeNull();
    expect(gitAnswerOf({ status: { branch: null }, error: null })).toEqual({ repository: true, branch: null });
    expect(gitAnswerOf(null)).toBeNull();
  });

  it('does not switch to the running model when it is re-picked by its option value', async () => {
    const { client, invoke } = bridge({ 'session.setModel': { ok: true, value: { ok: true, error: null, code: null } } });
    const s = { ...status(APP), model: { requested: 'sonnet', resolved: 'claude-sonnet-5' }, effort: 'medium' as const };
    const models = [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet', description: '' }];
    const b = liveBindings(s, record(APP), { models }, client);
    expect(await b.model.set({ model: 'sonnet', effort: 'medium' })).toEqual({ ok: true });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses a model the engine refused', async () => {
    const { client } = bridge({ 'session.setModel': { ok: true, value: { ok: false, error: 'unknown model', code: 'invalid' } } });
    const b = liveBindings(status(APP), record(APP), {}, client);
    expect(await b.model.set({ model: 'nope', effort: null })).toEqual({ ok: false, error: 'unknown model' });
  });

  // P2-A (2026-10-09; the execution document §5.6): with no ready process the chips follow the session's availability
  describe('a record with no ready process', () => {
    const ACQUIRED = { ok: true, value: { status: 'ready', appSessionId: APP, launched: true, joined: false } };
    const terminal = record(APP, { holder: { kind: 'terminal', pid: 4711 } });
    it.each([
      ['resumable', record(APP), null],
      ['failed', record(APP), null],
      ['needs_trust', record(APP), null],
      ['missing_directory', record(APP), null],
      ['starting', record(APP), null],
      ['foreign_held', terminal, 'Held by terminal · 4711'],
      ['archived', record(APP, { archived: true }), 'Archived · unarchive it to continue'],
    ] as const)('%s: every chip is %s', (availability, r, words) => {
      for (const s of [status(APP, { process: 'exited' }), null]) {
        const b = liveBindings(s, r, {}, bridge().client, availability);
        expect([b.model.disabled, b.mode.disabled, b.directories.disabled]).toEqual([words, words, words]);
      }
    });

    it('a model, mode or directory choice starts the session (chip), then applies as a live one does', async () => {
      const rulesAnswer = { ok: true, value: { state: { rules: [], workspaceDirectories: ['/a'], originalCwd: '/work/app-1', managedOnly: false } } };
      const { client, invoke } = bridge({ 'session.acquire': ACQUIRED, 'session.setModel': { ok: true, value: { ok: true, error: null, code: null } }, 'session.setPermissionMode': { ok: true, value: { refusal: null, error: null } }, 'session.listPermissionRules': rulesAnswer });
      const b = liveBindings(status(APP, { process: 'exited' }), record(APP), {}, client, 'resumable');
      expect(await b.model.set({ model: 'haiku', effort: null })).toEqual({ ok: true });
      expect(await b.mode.set('plan')).toEqual({ ok: true });
      expect(await b.directories.set(['/b'])).toEqual({ ok: true });
      expect(invoke.mock.calls.map((call) => [call[0], ((call as unknown[])[1] as { reason?: string }).reason ?? null])).toEqual([
        ['session.acquire', 'chip'],
        ['session.setModel', null],
        ['session.acquire', 'chip'],
        ['session.setPermissionMode', null],
        ['session.acquire', 'chip'],
        ['session.listPermissionRules', null],
        ['session.applyFlagSettings', null],
      ]);
    });

    it('an attempt that does not end ready applies nothing and says why; a holder or an archive asks nothing', async () => {
      const { client, invoke } = bridge({ 'session.acquire': { ok: true, value: { status: 'missing_directory', appSessionId: APP, directory: '/gone' } } });
      const b = liveBindings(null, record(APP), {}, client, 'resumable');
      expect(await b.model.set({ model: 'haiku', effort: null })).toEqual({ ok: false, error: 'Directory not found: /gone' });
      expect(await b.mode.set('plan')).toEqual({ ok: false, error: 'Directory not found: /gone' });
      expect(await b.directories.set(['/b'])).toEqual({ ok: false, error: 'Directory not found: /gone' });
      expect(invoke.mock.calls.map(([name]) => name)).toEqual(['session.acquire', 'session.acquire', 'session.acquire']);
      invoke.mockClear();
      const held = liveBindings(null, terminal, {}, client, 'foreign_held');
      expect(await held.model.set({ model: 'haiku', effort: null })).toEqual({ ok: false, error: 'Held by terminal · 4711' });
      expect(await held.directories.set(['/b'])).toEqual({ ok: false, error: 'Held by terminal · 4711' });
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  it('reads the workspace directories the engine lists as paths', () => {
    expect(workspaceDirectoriesOf(['/a', { path: '/b' }, 7, { nope: true }])).toEqual(['/a', '/b']);
  });
});

// W3 (charter §5.4 as amended 2026-10-01): the chip reads `<alias> <effort>`, never "Default"
describe('the model chip names the model and the effort the engine uses', () => {
  const catalogue = [
    { value: 'default', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Default (recommended)' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)' },
    { value: 'fable', resolvedModel: 'claude-fable-5-1[1m]', displayName: 'Fable 5.1' },
    { value: 'claude/sol', resolvedModel: 'claude/sol', displayName: 'sol', description: 'From gateway' },
  ];

  it('an unstarted tab: the intent first, then the user’s settings, then what `default` runs', () => {
    const h = hook();
    h.options.models = catalogue;
    expect(intentBindings(h, { starting: false }).model.label).toBe('opus');
    expect(intentBindings(h, { starting: false }, { model: null, effortLevel: 'xhigh', defaultMode: null }).model.label).toBe('opus xhigh');
    expect(intentBindings(h, { starting: false }, { model: 'fable', effortLevel: 'xhigh', defaultMode: 'auto' }).model.label).toBe('fable xhigh');
    const chosen = hook({ model: 'claude/sol', effort: 'high' });
    chosen.options.models = catalogue;
    expect(intentBindings(chosen, { starting: false }, { model: 'fable', effortLevel: 'xhigh', defaultMode: null }).model.label).toBe('sol high');
  });

  it('an unstarted mode is the intent’s, else the user’s defaultMode, else auto; auto is off for a row that does not say it holds auto', () => {
    expect(intentBindings(hook(), { starting: false }).mode.value).toBe('auto');
    expect(intentBindings(hook(), { starting: false }, { model: null, effortLevel: null, defaultMode: 'plan' }).mode.value).toBe('plan');
    expect(intentBindings(hook({ permissionMode: 'default' }), { starting: false }, { model: null, effortLevel: null, defaultMode: 'plan' }).mode.value).toBe('default');
    const haiku = hook({ model: 'haiku' });
    haiku.options.models = [{ value: 'haiku', displayName: 'Haiku' }]; // reads.jsonl seq 3: the key is absent
    expect(intentBindings(haiku, { starting: false }).mode.autoUnavailable).toBe('This model does not support auto mode');
  });

  it('a live session: the resolved model by its named row, with the effort get_settings applied, else the requested one', () => {
    const s = { ...status(APP), model: { requested: null, resolved: 'claude-opus-5-5[1m]' }, effort: null };
    expect(liveBindings(s, record(APP), { modelNames: catalogue, effort: 'high' }).model.label).toBe('opus high');
    expect(liveBindings(s, record(APP), { modelNames: catalogue }).model.label).toBe('opus');
    expect(liveBindings({ ...s, effort: 'max' }, record(APP), { modelNames: catalogue }).model.label).toBe('opus max');
    expect(liveBindings({ ...s, model: { requested: 'claude/sol', resolved: 'claude/sol' } }, record(APP), { modelNames: catalogue, effort: 'xhigh' }).model.label).toBe('sol xhigh');
    expect(liveBindings({ ...s, model: { requested: 'haiku', resolved: 'claude-haiku-4-5-20251001' } }, record(APP), { modelNames: catalogue, effort: null }).model.label).toBe('haiku');
  });

  // The sitting's A1.6 (P2-F wave S, S-chip): on a live session the closed chip kept the init frame's model after a
  // set_model until the next turn's init frame, while the picker already checked the new one. One rule: the chip names
  // the model asked for, marked as requested, until the engine reports running it.
  it('a live session names the model asked for, marked as requested, until an init frame reports it', () => {
    const s = { ...status(APP), model: { requested: 'opus', resolved: 'claude-opus-5-5[1m]' }, effort: null };
    const asked = { ...s, model: { requested: 'fable', resolved: 'claude-opus-5-5[1m]' } }; // set_model accepted, no turn since
    expect(liveBindings(asked, record(APP), { modelNames: catalogue, effort: 'medium' }).model).toMatchObject({ label: 'fable medium', requested: true });
    expect(liveBindings(asked, record(APP), { modelNames: catalogue, effort: 'medium' }).model.value.model).toBe('fable');
    // the next init frame runs it: no longer marked
    expect(liveBindings({ ...s, model: { requested: 'fable', resolved: 'claude-fable-5-1[1m]' } }, record(APP), { modelNames: catalogue, effort: 'medium' }).model).toMatchObject({ label: 'fable medium', requested: false });
    // an alias and the id it resolves to, `default` and what it runs, a family id with no row: the same model, unmarked
    expect(liveBindings(s, record(APP), { modelNames: catalogue }).model.requested).toBe(false);
    expect(liveBindings({ ...s, model: { requested: 'default', resolved: 'claude-opus-5-5[1m]' } }, record(APP), { modelNames: catalogue }).model.requested).toBe(false);
    expect(liveBindings({ ...s, model: { requested: 'haiku', resolved: 'claude-haiku-4-5-20251001' } }, record(APP), { modelNames: catalogue }).model.requested).toBe(false);
    // nothing reported yet (a launch before its first turn): the model asked for, unmarked, as the selector reads it
    expect(liveBindings({ ...s, model: { requested: 'fable', resolved: null } }, record(APP), { modelNames: catalogue }).model).toMatchObject({ label: 'fable', requested: false });
    // a record with no process reads the same way: what it asked for, marked while its last run reported another
    expect(liveBindings(null, record(APP, { model: { requested: 'fable', resolved: 'claude-opus-5-5[1m]' } }), { modelNames: catalogue }).model).toMatchObject({ label: 'fable', requested: true });
  });

  it('re-picking the running model while another is asked for switches back to it', async () => {
    const { client, invoke } = bridge({ 'session.setModel': { ok: true, value: { ok: true, error: null, code: null } } });
    const s = { ...status(APP), model: { requested: 'fable', resolved: 'claude-opus-5-5[1m]' }, effort: null };
    const b = liveBindings(s, record(APP), { models: catalogue.map((m) => ({ description: '', ...m })) }, client);
    expect(await b.model.set({ model: 'opus', effort: null })).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('session.setModel', { appSessionId: APP, model: 'opus' });
  });
});
