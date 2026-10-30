// deploy/vm-dx2-retired.mjs (O14 B4 step 3, the machine-token half), run as the README runs it on the VM: fed to
// `node --input-type=module -` on stdin with HUB and BUILD in its environment, reading the endpoint's service token by
// path from `enrollment.json`. It passes only when `GET /machine/stream` and `POST /machine/frames` both answer the
// Worker's `404 {"error":"not-found"}` under BUILD, and exits nonzero on anything else: M5a's `403 v2-credential`, a
// 404 from another build, Access's redirect. Against the local hub, and a stub for the answers it stands in for.
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enroll } from '../support/clients';
import { ADMIN, startLocalHub, type LocalHub } from '../support/local';

const SCRIPT = readFileSync(resolve(import.meta.dirname, '../../deploy/vm-dx2-retired.mjs'), 'utf8');
const SECRET = 'the-secret-never-printed';
/** A production build's name: the hub's and the web app's ids joined by a space (deploy.ts, `buildName`). */
const COMBINED = 'hub@6e53b882 web@p5-o14-m5b.6e53b882';
/** The README's line that reads BUILD from the credential-free `POST /machine/enroll`, as the owner runs it. */
const BUILD_LINE = readFileSync(resolve(import.meta.dirname, '../../deploy/README.md'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .find((line) => line.startsWith('BUILD=$(curl'))!;

let hub: LocalHub;
const dirs: string[] = [];
beforeAll(async () => {
  hub = await startLocalHub();
});
afterAll(async () => {
  await hub?.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A config home holding the endpoint's `enrollment.json` with `credentials` (or `raw` text in its place). */
function configHome(credentials: { clientId: string; clientSecret: string } | null, raw?: string): string {
  const home = mkdtempSync(join(tmpdir(), 'vm-dx2-'));
  dirs.push(home);
  const dir = join(home, 'MAWS', 'mawsd', 'endpoint');
  mkdirSync(dir, { recursive: true });
  if (credentials !== null || raw !== undefined) writeFileSync(join(dir, 'enrollment.json'), raw ?? JSON.stringify({ version: 1, name: 'vm', credentials }));
  return home;
}

/** The script run as the README runs it; its exit status and everything it printed. */
function run(env: Record<string, string>): Promise<{ code: number | null; out: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--input-type=module', '-'], { env: { PATH: process.env.PATH ?? '', HOME: '/nonexistent', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    child.on('error', fail);
    child.on('close', (code) => done({ code, out }));
    child.stdin.end(SCRIPT);
  });
}

/** A hub stub answering every request `status` with `body` and the build header `build` (none when null). */
async function stub(status: number, body: string, build: string | null, headers: Record<string, string> = {}): Promise<{ url: string; server: Server }> {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(status, { 'content-type': 'application/json', ...(build === null ? {} : { 'x-desk-build': build }), ...headers });
    response.end(body);
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

describe("the VM's check of DX2's removed routes", () => {
  it('passes when both routes answer the Worker’s 404 under the build, and never prints the token', async () => {
    const credentials = await enroll(hub, ADMIN, 'vm-check');
    const { code, out } = await run({ HUB: hub.url, BUILD: 'dev', XDG_CONFIG_HOME: configHome(credentials) });
    expect(out).toMatch(/PASS GET \/machine\/stream: 404 not-found under build dev/);
    expect(out).toMatch(/PASS POST \/machine\/frames: 404 not-found under build dev/);
    expect(out).not.toContain(credentials.clientSecret);
    expect(code).toBe(0);
  });

  it('fails on a 404 from another build', async () => {
    const credentials = await enroll(hub, ADMIN, 'vm-stale');
    const { code, out } = await run({ HUB: hub.url, BUILD: 'abc1234', XDG_CONFIG_HOME: configHome(credentials) });
    expect(out).toMatch(/FAIL GET \/machine\/stream: 404 .*under build dev, not abc1234/);
    expect(code).toBe(1);
  });

  it("fails on M5a's 403 v2-credential, and on Access's redirect with no build header", async () => {
    const home = configHome({ clientId: 'c.access', clientSecret: SECRET });
    const before = await stub(403, '{"error":"v2-credential"}', 'm5a');
    const refused = await run({ HUB: before.url, BUILD: 'm5a', XDG_CONFIG_HOME: home });
    before.server.close();
    expect(refused.out).toMatch(/FAIL GET \/machine\/stream: 403 \{"error":"v2-credential"\}/);
    expect(refused.code).toBe(1);
    const access = await stub(302, '', null, { location: 'https://example.cloudflareaccess.com/login' });
    const redirected = await run({ HUB: access.url, BUILD: 'dev', XDG_CONFIG_HOME: home });
    access.server.close();
    expect(redirected.out).toMatch(/FAIL GET \/machine\/stream: 302 .*no X-Desk-Build/);
    expect(redirected.code).toBe(1);
    expect(refused.out + redirected.out).not.toContain(SECRET);
  });

  it('fails on a 404 whose body is not the Worker’s', async () => {
    const other = await stub(404, '{"error":"unknown-machine"}', 'dev');
    const { code, out } = await run({ HUB: other.url, BUILD: 'dev', XDG_CONFIG_HOME: configHome({ clientId: 'c.access', clientSecret: SECRET }) });
    other.server.close();
    expect(out).toMatch(/FAIL GET \/machine\/stream: 404 \{"error":"unknown-machine"\}/);
    expect(code).toBe(1);
  });

  it("passes on a production build's name, the hub's and the web's ids in one header, as the README reads it", async () => {
    const deployed = await stub(404, '{"error":"not-found"}', COMBINED);
    try {
      // Asynchronously: the stub answering the line's curl runs in this process.
      const { stdout: build } = await promisify(execFile)('sh', ['-c', `${BUILD_LINE}; printf '%s' "$BUILD"`], { env: { PATH: process.env.PATH ?? '', HUB: deployed.url }, timeout: 15_000 });
      expect(build).toBe(COMBINED);
      const home = configHome({ clientId: 'c.access', clientSecret: SECRET });
      const whole = await run({ HUB: deployed.url, BUILD: build, XDG_CONFIG_HOME: home });
      expect(whole.out).toContain(`PASS GET /machine/stream: 404 not-found under build ${COMBINED}`);
      expect(whole.code).toBe(0);
      // The build's first word alone is another build: what an extraction that kept one field passed.
      expect((await run({ HUB: deployed.url, BUILD: 'hub@6e53b882', XDG_CONFIG_HOME: home })).code).toBe(1);
    } finally {
      deployed.server.close();
    }
  });

  it('exits 2 without HUB or BUILD, or without a readable enrollment, printing nothing of the file', async () => {
    expect((await run({ BUILD: 'dev', XDG_CONFIG_HOME: configHome(null) })).code).toBe(2);
    expect((await run({ HUB: hub.url, XDG_CONFIG_HOME: configHome(null) })).code).toBe(2);
    expect((await run({ HUB: hub.url, BUILD: 'dev', XDG_CONFIG_HOME: configHome(null) })).code).toBe(2);
    const garbled = await run({ HUB: hub.url, BUILD: 'dev', XDG_CONFIG_HOME: configHome(null, `{"credentials": ${SECRET}`) });
    expect(garbled.code).toBe(2);
    expect(garbled.out).not.toContain(SECRET);
  });
});
