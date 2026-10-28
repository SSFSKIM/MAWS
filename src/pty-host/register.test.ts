// The pty host's handlers (P5 O2 M4): every pty-host command registered, and `pty.recaptureEnv` starting a fresh
// login-shell capture that the next spawn uses (real node-pty over a scratch shell home).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { HostClientHooks } from '@shared/host/runtime';
import { REGISTRY } from '@shared/ipc/registry';
import { writeScratchShellHome } from '../../test/support/shell-home';
import { ptyHostRegister } from './register';

vi.setConfig({ testTimeout: 20_000 }); // real shells, as table.test.ts waits on them
const SHELL_HOME = writeScratchShellHome(mkdtempSync(join(tmpdir(), 'maws-ptyr-home-')));
const BASE = { ...process.env, HOME: SHELL_HOME.dir, ...SHELL_HOME.env } as Record<string, string>;
afterAll(() => rmSync(SHELL_HOME.dir, { recursive: true, force: true }));

type Handler = (input: unknown) => Promise<unknown>;
const hosts: ReturnType<typeof ptyHostRegister>[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.table()?.shutdown();
});

// The register run against a recording `on`, its captures answering `CAPTURE_TEST_MARK=capture-<n>`.
function registered() {
  let captures = 0;
  const capture = vi.fn(async () => ({ ...BASE, CAPTURE_TEST_MARK: `capture-${++captures}` }));
  const host = ptyHostRegister({ hostVersion: '9.9.9', capture, launcher: {} });
  hosts.push(host);
  const handlers = new Map<string, Handler>();
  const output = new Map<string, Buffer[]>();
  const exits = new Set<string>();
  void host.register(
    (name, handler) => void handlers.set(name, handler as Handler),
    (name, payload) => {
      const event = payload as { ptyId: string; data?: Uint8Array };
      if (name === 'pty.data') output.set(event.ptyId, [...(output.get(event.ptyId) ?? []), Buffer.from(event.data!)]);
      if (name === 'pty.exit') exits.add(event.ptyId);
      return true;
    },
    {} as HostClientHooks,
  );
  const call = (name: string, input?: unknown) => handlers.get(name)!(input);
  let labels = 0;
  const markOfNextShell = async () => {
    const { ptyId } = (await call('pty.spawn', { appSessionId: 'app-1', label: `t${++labels}`, cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/sh', args: ['-c', 'printf "mark=%s\\n" "$CAPTURE_TEST_MARK"'] })) as { ptyId: string };
    await vi.waitFor(() => expect(exits.has(ptyId)).toBe(true), { timeout: 15_000, interval: 10 });
    return Buffer.concat(output.get(ptyId) ?? []).toString('utf8');
  };
  return { handlers, call, capture, markOfNextShell };
}

describe('the pty host register', () => {
  it('registers every command the registry gives the pty host, pty.recaptureEnv included', () => {
    const { handlers } = registered();
    const owned = Object.entries(REGISTRY.commands).filter(([, spec]) => spec.owner === 'pty-host').map(([name]) => name).sort();
    expect([...handlers.keys()].sort()).toEqual(owned);
    expect(owned).toContain('pty.recaptureEnv');
  });

  it('pty.recaptureEnv starts a fresh capture, which the next spawn uses', async () => {
    const { call, capture, markOfNextShell } = registered();
    expect(await markOfNextShell()).toContain('mark=capture-1');
    expect(capture).toHaveBeenCalledOnce(); // the start's capture serves every spawn until asked again
    await expect(call('pty.recaptureEnv')).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await markOfNextShell()).toContain('mark=capture-2');
  });
});
