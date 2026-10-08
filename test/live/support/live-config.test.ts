// Offline config isolation boundaries: only fake owner homes and a stopped spawn boundary, never a live engine.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureShellEnvironment } from '@shared/host/shell-env';
import { HostHookRegistry } from '../../../src/engine-host/host-hooks';
import { spawnEngine } from '../../../src/engine-host/transport';
import { assertConfigHomeSafe, liveSpec, persistingControlOf, withRawProcess } from './live';
import { startDirectSession } from './live-host';

vi.mock('../../support/engine-pin', () => ({ ENGINE_BIN: '/unused/offline-engine', ENGINE_VERSION: '2.1.283' }));
vi.mock('@shared/host/shell-env', async (importOriginal) => ({
  ...await importOriginal<typeof import('@shared/host/shell-env')>(),
  captureShellEnvironment: vi.fn(),
}));
vi.mock('../../../src/engine-host/transport', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/engine-host/transport')>(),
  spawnEngine: vi.fn(() => { throw new Error('offline spawn boundary'); }),
}));

let root: string;
let owner: string;
let store: string;
let scratch: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'maws-live-config-test-'));
  owner = join(root, 'owner');
  store = join(owner, '.claude');
  scratch = join(root, 'scratch');
  mkdirSync(store, { recursive: true });
  mkdirSync(scratch);
  vi.stubEnv('HOME', owner);
  vi.mocked(captureShellEnvironment).mockResolvedValue({ HOME: owner, PATH: '/usr/bin' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const guard = (configHome: string) => assertConfigHomeSafe({ configHome, controls: [] });

describe('live config destination safety', () => {
  it('refuses a missing child below a scratch-named symlink into the owner store', () => {
    const link = join(root, 'scratch-link');
    symlinkSync(store, link);
    expect(() => guard(join(link, 'missing', 'child'))).toThrow(/scratch CLAUDE_CONFIG_DIR/);
  });

  it('refuses existing symlinks to the owner home or store', () => {
    for (const [name, destination] of [['home-link', owner], ['store-link', store]]) {
      const link = join(root, name!);
      symlinkSync(destination!, link);
      expect(() => guard(link)).toThrow(/scratch CLAUDE_CONFIG_DIR/);
    }
  });

  it('treats a child segment beginning with two dots as inside the owner store', () => {
    const hidden = join(store, '..hidden');
    mkdirSync(hidden);
    expect(() => guard(hidden)).toThrow(/scratch CLAUDE_CONFIG_DIR/);
    expect(persistingControlOf('session.memoryAppend', { target: { kind: 'path', path: join(hidden, 'note.md') } }, store)).toBe('memory:user');
  });

  it('accepts an existing scratch directory and its symlink, including a store-prefix sibling', () => {
    const sibling = join(owner, '.claude-other');
    mkdirSync(sibling);
    const link = join(root, 'scratch-link');
    symlinkSync(scratch, link);
    for (const configHome of [scratch, link, sibling]) expect(() => guard(configHome)).not.toThrow();
  });

  it('requires an existing directory, not a missing path or a file', () => {
    const file = join(root, 'scratch-file');
    writeFileSync(file, '');
    for (const configHome of [join(root, 'missing'), file]) expect(() => guard(configHome)).toThrow(/scratch CLAUDE_CONFIG_DIR/);
  });
});

describe('direct live session config isolation', () => {
  it('refuses an unset process config before capturing the shell or reaching spawn', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined);
    vi.mocked(captureShellEnvironment).mockResolvedValue({ HOME: owner, CLAUDE_CONFIG_DIR: scratch });
    await expect(startDirectSession(join(root, 'user-data'), liveSpec(scratch), new HostHookRegistry())).rejects.toThrow(/scratch CLAUDE_CONFIG_DIR/);
    expect(captureShellEnvironment).not.toHaveBeenCalled();
    expect(spawnEngine).not.toHaveBeenCalled();
  });

  it.each(['cleared', 'replaced'] as const)('pins the process scratch config when the captured shell has %s it', async (drift) => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', scratch);
    vi.mocked(captureShellEnvironment).mockImplementation(async () => {
      // The selection must be made before the asynchronous shell capture, not re-read afterward.
      process.env.CLAUDE_CONFIG_DIR = store;
      return { HOME: owner, PATH: '/usr/bin', ...(drift === 'replaced' ? { CLAUDE_CONFIG_DIR: store } : {}) };
    });
    await expect(startDirectSession(join(root, 'user-data'), liveSpec(scratch), new HostHookRegistry())).rejects.toThrow(/direct session not ready: exited/);
    expect(spawnEngine).toHaveBeenCalledOnce();
    const plan = vi.mocked(spawnEngine).mock.calls[0]![0];
    expect(plan.env.CLAUDE_CONFIG_DIR).toBe(scratch);
    expect(plan.env.HOME).toBe(owner);
  });
});

// E11 W-E (Decision Log 22): what the login-shell capture inherits from a parent Claude session never reaches the engine.
describe('live engine environments drop inherited CLAUDE* variables', () => {
  const inherited = { CLAUDE_CODE_PLUGIN_DIRS: '/owner/.claude/mods/prompt-autosave', CLAUDE_MODEL: 'opus', CLAUDE_EFFORT: 'high', CLAUDE_CODE_SUBAGENT_MODEL: 'opus' };
  const spawned = () => vi.mocked(spawnEngine).mock.calls[0]![0].env;

  it('a direct session', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', scratch);
    vi.mocked(captureShellEnvironment).mockResolvedValue({ HOME: owner, PATH: '/usr/bin', ...inherited });
    await expect(startDirectSession(join(root, 'user-data'), liveSpec(scratch, { subagentModel: null }), new HostHookRegistry())).rejects.toThrow(/direct session not ready: exited/);
    expect(spawned()).toMatchObject({ CLAUDE_CONFIG_DIR: scratch, PATH: '/usr/bin' });
    for (const key of Object.keys(inherited)) expect(spawned()).not.toHaveProperty(key);
  });

  it('a raw process', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', scratch);
    vi.mocked(captureShellEnvironment).mockResolvedValue({ HOME: owner, PATH: '/usr/bin', ...inherited });
    await expect(withRawProcess({ userData: join(root, 'user-data'), scratch: () => scratch }, liveSpec(scratch, { subagentModel: null }), async () => {})).rejects.toThrow(/offline spawn boundary/);
    expect(spawned()).toMatchObject({ CLAUDE_CONFIG_DIR: scratch, PATH: '/usr/bin' });
    for (const key of Object.keys(inherited)) expect(spawned()).not.toHaveProperty(key);
  });
});
