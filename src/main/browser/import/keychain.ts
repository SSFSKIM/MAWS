// The Keychain step (E4b Design §5; Decision Log 12, 13): Chrome's Safe Storage password, asked of macOS once per import
// through `/usr/bin/security`, whose consent dialog the owner answers with Allow. stdout arrives as a Buffer, never a
// string, so the password can be zeroed the moment the key is derived; the key is returned to the import, which zeroes
// it at the end of the cookies phase. The child runs with an empty environment, a timeout, SIGKILL and a 64 KiB cap,
// and a cancel kills it. Under MAWS_E2E=1 the child is never spawned: `MAWS_E2E_KEYCHAIN` answers (`file:<path>`,
// `deny`, `missing`, `timeout`), and an unset or unknown value answers denied, so no forgotten seam raises a dialog.
import { execFile as nodeExecFile, type ExecFileException } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { deriveKey } from './chrome/crypto';

export const SECURITY_PATH = '/usr/bin/security';
export const SECURITY_ARGS: readonly string[] = ['find-generic-password', '-s', 'Chrome Safe Storage', '-a', 'Chrome', '-w'];
export const SECURITY_OPTIONS = { encoding: 'buffer', timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, env: {} } as const;
const ERR_SEC_ITEM_NOT_FOUND = 44;

// `denied` keeps `security`'s exit code and the first line of its stderr (which carries no secret), or the reason the
// child could not answer; `cancelled` is the import's own cancel, which killed the child.
export type KeychainResult =
  | { outcome: 'allowed'; key: Buffer }
  | { outcome: 'denied'; exitCode: number | null; error: string | null }
  | { outcome: 'missing' }
  | { outcome: 'timeout' }
  | { outcome: 'cancelled' };

export type SecurityExecFile = (
  file: string,
  args: readonly string[],
  options: typeof SECURITY_OPTIONS & { signal?: AbortSignal },
  callback: (error: ExecFileException | null, stdout: Buffer, stderr: Buffer) => void,
) => void;

const spawnSecurity: SecurityExecFile = (file, args, options, callback) => {
  nodeExecFile(file, args, options, callback);
};

export async function readSafeStorageKey({
  env,
  signal,
  execFile = spawnSecurity,
}: {
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  execFile?: SecurityExecFile;
}): Promise<KeychainResult> {
  if (signal?.aborted) return { outcome: 'cancelled' };
  if (env.MAWS_E2E === '1') return fromSeam(env.MAWS_E2E_KEYCHAIN);
  const { error, stdout, stderr } = await new Promise<{ error: ExecFileException | null; stdout: Buffer; stderr: Buffer }>((resolve) => {
    execFile(SECURITY_PATH, SECURITY_ARGS, signal ? { ...SECURITY_OPTIONS, signal } : SECURITY_OPTIONS, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
  try {
    if (error === null) return { outcome: 'allowed', key: keyFrom(stdout) };
    if (signal?.aborted || error.code === 'ABORT_ERR') return { outcome: 'cancelled' };
    if (error.code === ERR_SEC_ITEM_NOT_FOUND) return { outcome: 'missing' };
    if (typeof error.code === 'number') return { outcome: 'denied', exitCode: error.code, error: firstLine(stderr) };
    // A string code is Node's own (ENOENT, the maxBuffer overflow, which also kills the child); none is the timeout's kill.
    if (typeof error.code === 'string') return { outcome: 'denied', exitCode: null, error: error.code };
    if (error.killed) return { outcome: 'timeout' };
    return { outcome: 'denied', exitCode: null, error: 'security did not answer' };
  } finally {
    stdout.fill(0);
  }
}

async function fromSeam(value: string | undefined): Promise<KeychainResult> {
  if (value === 'deny') return { outcome: 'denied', exitCode: null, error: null };
  if (value === 'missing') return { outcome: 'missing' };
  if (value === 'timeout') return { outcome: 'timeout' };
  if (value?.startsWith('file:')) {
    let password: Buffer;
    try {
      password = await readFile(value.slice('file:'.length));
    } catch {
      return { outcome: 'denied', exitCode: null, error: 'the e2e keychain file could not be read' };
    }
    try {
      return { outcome: 'allowed', key: keyFrom(password) };
    } finally {
      password.fill(0);
    }
  }
  return { outcome: 'denied', exitCode: null, error: 'no keychain under e2e' };
}

// The password is the output less its trailing newline, derived in place: a view of the buffer, never a copy.
function keyFrom(output: Buffer): Buffer {
  const end = output.length > 0 && output[output.length - 1] === 0x0a ? output.length - 1 : output.length;
  return deriveKey(output.subarray(0, end));
}

function firstLine(stderr: Buffer): string | null {
  return stderr.toString('utf8').split('\n', 1)[0]!.trim().slice(0, 200) || null;
}
