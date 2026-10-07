// The Keychain step (E4b Design §5; Decision Log 13) over a fake execFile only: nothing here spawns `security`, and no
// test reads any Keychain item. The outcomes per exit, the password zeroed after derivation, and the e2e seam.
import type { ExecFileException } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveKey } from './chrome/crypto';
import { readSafeStorageKey, SECURITY_ARGS, SECURITY_OPTIONS, SECURITY_PATH, type SecurityExecFile } from './keychain';

const dir = mkdtempSync(join(tmpdir(), 'maws-e4b-keychain-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface Call {
  file: string;
  args: readonly string[];
  options: object;
}
// A fake `execFile` answering as Node does: an error carrying `code` (the exit code), `killed` and `signal`.
function fakeExec(answer: { error?: Partial<ExecFileException>; stdout?: Buffer; stderr?: string }) {
  const calls: Call[] = [];
  const stdout = answer.stdout ?? Buffer.alloc(0);
  const execFile: SecurityExecFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    const error: ExecFileException | null = answer.error ? Object.assign(new Error('Command failed'), answer.error) : null;
    queueMicrotask(() => callback(error, stdout, Buffer.from(answer.stderr ?? '')));
  };
  return { execFile, calls, stdout };
}
const LIVE = {} as NodeJS.ProcessEnv; // not under e2e

describe('readSafeStorageKey through the security child (fake)', () => {
  it('runs /usr/bin/security for Chrome Safe Storage with a buffer stdout, an empty environment, a timeout, SIGKILL and 64 KiB', async () => {
    const { execFile, calls } = fakeExec({ stdout: Buffer.from('peanuts\n') });
    await readSafeStorageKey({ env: LIVE, execFile });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.file).toBe('/usr/bin/security');
    expect(SECURITY_PATH).toBe('/usr/bin/security');
    expect(calls[0]!.args).toEqual(['find-generic-password', '-s', 'Chrome Safe Storage', '-a', 'Chrome', '-w']);
    expect(SECURITY_ARGS).toEqual(calls[0]!.args);
    expect(calls[0]!.options).toMatchObject({ encoding: 'buffer', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, env: {} });
    expect(SECURITY_OPTIONS).toEqual({ encoding: 'buffer', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, env: {} });
  });

  it('exit 0: allowed, the key derived from stdout less its newline, and the password buffer zeroed', async () => {
    const { execFile, stdout } = fakeExec({ stdout: Buffer.from('peanuts\n') });
    const result = await readSafeStorageKey({ env: LIVE, execFile });
    expect(result).toEqual({ outcome: 'allowed', key: deriveKey('peanuts') });
    expect(stdout.every((byte) => byte === 0)).toBe(true);
  });

  it('exit 44: missing (errSecItemNotFound)', async () => {
    const { execFile, stdout } = fakeExec({ error: { code: 44 }, stderr: 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n' });
    expect(await readSafeStorageKey({ env: LIVE, execFile })).toEqual({ outcome: 'missing' });
    expect(stdout.every((byte) => byte === 0)).toBe(true);
  });

  it('any other exit: denied, with the first line of stderr', async () => {
    const { execFile } = fakeExec({ error: { code: 51 }, stderr: 'security: SecKeychainItemCopyContent: User interaction is not allowed.\nmore\n' });
    expect(await readSafeStorageKey({ env: LIVE, execFile })).toEqual({ outcome: 'denied', exitCode: 51, error: 'security: SecKeychainItemCopyContent: User interaction is not allowed.' });
  });

  it('the timeout: timeout (Node kills the child and reports it killed)', async () => {
    const { execFile } = fakeExec({ error: { code: undefined, killed: true, signal: 'SIGKILL' } });
    expect(await readSafeStorageKey({ env: LIVE, execFile })).toEqual({ outcome: 'timeout' });
  });

  it('a cancel: the signal reaches execFile, which kills the child; an already aborted signal spawns nothing', async () => {
    const controller = new AbortController();
    const { execFile, calls } = fakeExec({ error: { code: 'ABORT_ERR', name: 'AbortError' } });
    const pending = readSafeStorageKey({ env: LIVE, execFile, signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ outcome: 'cancelled' });
    expect((calls[0]!.options as { signal?: AbortSignal }).signal).toBe(controller.signal);
    const again = fakeExec({ stdout: Buffer.from('peanuts\n') });
    expect(await readSafeStorageKey({ env: LIVE, execFile: again.execFile, signal: controller.signal })).toEqual({ outcome: 'cancelled' });
    expect(again.calls).toHaveLength(0);
  });

  it('a spawn failure or an oversized answer: denied, without the output', async () => {
    const missingTool = fakeExec({ error: { code: 'ENOENT' } });
    expect(await readSafeStorageKey({ env: LIVE, execFile: missingTool.execFile })).toEqual({ outcome: 'denied', exitCode: null, error: 'ENOENT' });
    const big = fakeExec({ error: { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }, stdout: Buffer.from('e4b-sentinel-password') });
    const result = await readSafeStorageKey({ env: LIVE, execFile: big.execFile });
    expect(result).toEqual({ outcome: 'denied', exitCode: null, error: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' });
    expect(big.stdout.every((byte) => byte === 0)).toBe(true);
  });
});

describe('the MAWS_E2E_KEYCHAIN seam (under MAWS_E2E=1 the child is never spawned)', () => {
  const neverSpawn: SecurityExecFile = () => {
    throw new Error('the security child must not run under e2e');
  };
  const e2e = (value?: string): NodeJS.ProcessEnv => (value === undefined ? { MAWS_E2E: '1' } : { MAWS_E2E: '1', MAWS_E2E_KEYCHAIN: value });

  it('file:<path> reads the password from the file', async () => {
    const file = join(dir, 'safe-storage-password.txt');
    writeFileSync(file, 'peanuts');
    expect(await readSafeStorageKey({ env: e2e(`file:${file}`), execFile: neverSpawn })).toEqual({ outcome: 'allowed', key: deriveKey('peanuts') });
    writeFileSync(file, 'peanuts\n');
    expect(await readSafeStorageKey({ env: e2e(`file:${file}`), execFile: neverSpawn })).toEqual({ outcome: 'allowed', key: deriveKey('peanuts') });
    expect(await readSafeStorageKey({ env: e2e(`file:${join(dir, 'absent.txt')}`), execFile: neverSpawn })).toEqual({ outcome: 'denied', exitCode: null, error: 'the e2e keychain file could not be read' });
  });

  it('deny, missing and timeout simulate their outcomes', async () => {
    expect(await readSafeStorageKey({ env: e2e('deny'), execFile: neverSpawn })).toEqual({ outcome: 'denied', exitCode: null, error: null });
    expect(await readSafeStorageKey({ env: e2e('missing'), execFile: neverSpawn })).toEqual({ outcome: 'missing' });
    expect(await readSafeStorageKey({ env: e2e('timeout'), execFile: neverSpawn })).toEqual({ outcome: 'timeout' });
  });

  it('an unset or unknown seam answers denied, so a forgotten seam never raises a dialog', async () => {
    expect(await readSafeStorageKey({ env: e2e(), execFile: neverSpawn })).toEqual({ outcome: 'denied', exitCode: null, error: 'no keychain under e2e' });
    expect(await readSafeStorageKey({ env: e2e('allow'), execFile: neverSpawn })).toEqual({ outcome: 'denied', exitCode: null, error: 'no keychain under e2e' });
  });
});
