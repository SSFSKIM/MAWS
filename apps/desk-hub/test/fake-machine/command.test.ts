// The fake machine's command, as a developer runs it against a hub: `enroll` takes the web app's enrollment code on
// stdin and keeps the machine's state in a 0600 file; `run` replays the recording into a project and stays connected.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base64urlEncode } from '../../src/protocol/base64url';
import { importOrgKey, verify } from '../../src/protocol/codes';
import { encodeEnrollmentCode } from '../../src/protocol/identity';
import { BrowserClient, enrollmentToken } from '../support/clients';
import { ADMIN, ORG, startLocalHub, type LocalHub } from '../support/local';

const BIN = resolve(import.meta.dirname, '../../fake-machine/bin.ts');
const node = (args: string[]) => spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', BIN, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });

let hub: LocalHub;
let dir: string;
const children: ChildProcess[] = [];
beforeAll(async () => {
  hub = await startLocalHub();
  dir = mkdtempSync(join(tmpdir(), 'fake-cmd-'));
});
afterAll(async () => {
  for (const child of children) child.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
  await hub?.close();
});

function output(child: ChildProcess): { text: () => string; exited: Promise<number | null> } {
  let text = '';
  child.stdout!.on('data', (d: Buffer) => (text += d.toString()));
  child.stderr!.on('data', (d: Buffer) => (text += d.toString()));
  return { text: () => text, exited: new Promise((done) => child.on('exit', (code) => done(code))) };
}

describe('the fake machine’s command', () => {
  it('enrolls from a code on stdin, then replays into a project whose browser sees the session’s log', async () => {
    const key = new Uint8Array(32).fill(5);
    const code = encodeEnrollmentCode({ hub: hub.url, org: ORG, token: await enrollmentToken(hub, ADMIN), machine: 'cmd-mini', key: base64urlEncode(key) });
    const state = join(dir, 'mini.json');
    const enroll = node(['enroll', '--state', state]);
    const enrolled = output(enroll);
    enroll.stdin!.end(code);
    expect(await enrolled.exited, enrolled.text()).toBe(0);
    expect(statSync(state).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(state, 'utf8'))).toMatchObject({ hub: hub.url, machine: 'cmd-mini', key: base64urlEncode(key) });

    const project = '9c3e0a8e-3b2d-4c5e-9f70-000000000001';
    const run = node(['run', '--state', state, '--project', project, '--speed', '0', '--session', 'new']);
    children.push(run);
    const running = output(run);
    const deadline = Date.now() + 20_000;
    while (!running.text().includes('serving subscriptions')) {
      if (Date.now() > deadline || run.exitCode !== null) throw new Error(`the run did not finish replaying:\n${running.text()}`);
      await new Promise((r) => setTimeout(r, 50));
    }
    const b = await BrowserClient.open(hub, ADMIN, project);
    b.send({ t: 'resume', after: 0 });
    await b.next((f) => f.t === 'caught-up', 'caught-up');
    const message = b.logged.find((e) => e.event.kind === 'message');
    expect(message?.event.writer.startsWith('cmd-mini/')).toBe(true);
    expect(await verify(await importOrgKey(key), 'log', project, message!.event)).toBe(true);
    expect(b.frames.find((f) => f.t === 'machines')).toMatchObject({ machines: [{ machine: 'cmd-mini', online: true }] });
    // The ledger lives in the state file the run keeps.
    expect(JSON.parse(readFileSync(state, 'utf8')).memory.written).not.toEqual({});
    b.close();
    run.kill('SIGTERM');
    expect(await running.exited).toBe(0);
  });
});
