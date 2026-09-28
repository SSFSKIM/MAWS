import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBinaryProbe } from './binary-info';
import { ENGINE_BIN, ENGINE_VERSION, setBinaryConfig } from './launch';

afterEach(() => setBinaryConfig({ binaryPath: null, expectedVersion: ENGINE_VERSION }));

const present = async () => {};
const absent = async () => {
  throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
};

describe('engine.binaryInfo', () => {
  it('runs --version once on the configured binary by absolute path and caches a matching answer', async () => {
    const run = vi.fn(async () => '2.1.283 (Claude Code)\n');
    const probe = createBinaryProbe({ run, access: present });
    expect(await probe()).toEqual({ path: ENGINE_BIN, expectedVersion: ENGINE_VERSION, version: '2.1.283', ok: true, error: null, problem: null });
    await probe();
    expect(run).toHaveBeenCalledExactlyOnceWith(ENGINE_BIN);
  });

  it('reads the configuration at each call: a configured path is probed on its own', async () => {
    const run = vi.fn(async (path: string) => (path === ENGINE_BIN ? '2.1.283 (Claude Code)' : '2.1.290 (Claude Code)'));
    const probe = createBinaryProbe({ run, access: present });
    await probe();
    setBinaryConfig({ binaryPath: '/opt/claude/2.1.290', expectedVersion: '2.1.290' });
    expect(await probe()).toMatchObject({ path: '/opt/claude/2.1.290', expectedVersion: '2.1.290', version: '2.1.290', ok: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('names a missing binary without running it, and a version mismatch, and caches neither', async () => {
    const run = vi.fn(async () => '2.1.200 (Claude Code)');
    const missing = createBinaryProbe({ run, access: absent });
    expect(await missing()).toMatchObject({ ok: false, version: null, problem: 'missing', error: expect.stringContaining(ENGINE_BIN) });
    expect(run).not.toHaveBeenCalled();

    const old = createBinaryProbe({ run, access: present });
    expect(await old()).toMatchObject({ ok: false, version: '2.1.200', problem: 'version', error: `${ENGINE_BIN} is 2.1.200; MAWS expects ${ENGINE_VERSION}` });
    await old();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('treats a binary whose --version fails or prints no version as the wrong version', async () => {
    const failing = createBinaryProbe({ run: async () => Promise.reject(new Error('killed')), access: present });
    expect(await failing()).toMatchObject({ ok: false, version: null, problem: 'version', error: expect.stringContaining('killed') });
    const silent = createBinaryProbe({ run: async () => 'hello', access: present });
    expect(await silent()).toMatchObject({ ok: false, version: null, problem: 'version' });
  });
});
