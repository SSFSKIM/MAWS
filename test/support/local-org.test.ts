// e2e/support/local-org.ts, the org the enrolled idle scene enrolls its mawsd in: the built mawsd (under plain Node, on a
// scratch profile with a scratch HOME and SMINOS_HOME, a private daemon that binds no listener) enrolls through it with
// its code on stdin, is listed by the member and reaches the hub with its own credentials. Skipped without a build, as
// the bundle guard is.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { startLocalOrg, type Ran } from '../../e2e/support/local-org';

const MAWSD = resolve(__dirname, '../../out/main/mawsd.js');
vi.setConfig({ testTimeout: 120_000 }); // the runner's start, up to 60 s on a loaded machine, and the enrollment
const scratch = mkdtempSync(join(tmpdir(), 'maws-local-org-'));
let daemon: ChildProcess | null = null;
afterAll(() => {
  if (daemon?.exitCode === null) daemon.kill('SIGKILL');
  rmSync(scratch, { recursive: true, force: true });
});

const profile = join(scratch, 'ud');
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(scratch, 'home'), SMINOS_HOME: join(scratch, 'sminos'), MAWS_USER_DATA: profile };
const log = () => (existsSync(join(profile, 'mawsd', 'mawsd.log')) ? readFileSync(join(profile, 'mawsd', 'mawsd.log'), 'utf8') : '');

function cli(args: string[], input = ''): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [MAWSD, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => void (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
    child.once('exit', (status) => done({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function until(check: () => boolean | Promise<boolean>, what: () => string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`no ${what()} within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!existsSync(MAWSD))('the local org of the enrolled idle scene', () => {
  it('enrolls a running mawsd with its code on stdin, lists it, and the endpoint reaches the hub', async () => {
    for (const dir of ['home', 'sminos', 'ud']) mkdirSync(join(scratch, dir), { recursive: true });
    const org = await startLocalOrg(scratch, { heartbeatMs: 15_000 });
    try {
      daemon = spawn(process.execPath, ['--disable-sigusr1', MAWSD, 'run', '--private', '--dir', join(profile, 'mawsd')], { env, stdio: 'ignore' });
      await until(() => log().includes(' serving;'), () => `mawsd serving:\n${log()}`);
      const enrolled = await org.enroll('idle-scene', (code) => cli(['enroll', '--name', 'idle-scene', '--wait', '60', '--json'], `${code}\n`));
      expect(JSON.parse(enrolled.stdout)).toMatchObject({ enrollment: 'org-listed', name: 'idle-scene' });
      await until(
        async () => {
          const status = await cli(['endpoint', 'status', '--json']);
          return status.status === 0 && (JSON.parse(status.stdout) as { hub: { connected: boolean } }).hub.connected;
        },
        () => `the hub link:\n${log()}`,
      );
    } finally {
      await org.stop();
    }
  });
});
