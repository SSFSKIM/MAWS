// The page's rig (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §Q; T24): the built `mawsd` as a
// process, as the app starts a private one, under plain Node over scratch directories, serving the built page on a port
// the system picks; an impostor that takes the daemon's port while it is stopped; and a second origin, a static server
// on another port, whose page tries what a stranger in the same browser can. What a spec asserts of a stranger's try is
// never that page's own account: it is the status Playwright saw on the wire, and what the daemon holds after it.
//
// This is the one launcher that turns the page on (T2), always with a scratch home and a port of its own: no run here
// listens on the real port or writes under a real home.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import WebSocket, { WebSocketServer } from 'ws';
import { closeAll, listenLoopback } from './second-origin.mjs';

export { secondOrigin } from './second-origin.mjs';

export const ROOT = resolve(import.meta.dirname, '../../..');
const MAWSD = join(ROOT, 'out/main/mawsd.js');
const START_MS = 30_000;

export interface Mawsd {
  url: string; // the page's origin, http://sheet.localhost:<port>
  port: number;
  home: string; // the scratch sminos home
  profile: string; // the scratch profile
  cli(...args: string[]): Promise<{ code: number; out: string }>;
  pair(page: Page): Promise<void>; // `mawsd sheet pair`, its code typed into the page's pairing screen, and the frame shown
  browsers(): Promise<{ id: string; label: string }[]>; // `mawsd sheet browsers --json`
  proofFor(id: string): Promise<string>; // a proof the daemon makes now, for that browser and a nonce of the rig's (the impostor's `replay`)
  stop(): Promise<void>;
  kill(): void;
  restart(): Promise<void>; // the same scratch home and profile, and the port it had: the page's origin does not move
  dispose(): Promise<void>; // stopped, and its scratch removed
}

export const until = async (check: () => boolean | Promise<boolean>, ms: number, what: string): Promise<void> => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((wake) => setTimeout(wake, 50))) if (await check()) return;
  throw new Error(`timed out waiting for ${what}`);
};

export async function startMawsd(options: { env?: Record<string, string> } = {}): Promise<Mawsd> {
  if (!existsSync(MAWSD)) throw new Error(`${MAWSD} is not built (pnpm -w run build:main-preload)`);
  if (!existsSync(join(ROOT, 'out/sheet-page/index.html'))) throw new Error('out/sheet-page is not built (vite build)');
  const scratch = mkdtempSync(join(tmpdir(), 'sheet-rig-'));
  const dirs = { profile: join(scratch, 'profile'), home: join(scratch, 'home'), sminos: join(scratch, 'sminos'), config: join(scratch, 'claude-config') };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: dirs.home,
    MAWS_USER_DATA: dirs.profile,
    CLAUDE_CONFIG_DIR: dirs.config,
    SMINOS_HOME: dirs.sminos,
    MAWS_SHEET_PAGE: '1',
    MAWS_E2E: '1', // under which sminosHome refuses the real home
    MAWS_ENGINE_REPLAY: '1', // no engine runs
    ...options.env,
  };
  let port = 0;
  let child: ChildProcess | null = null;
  let output = '';

  const log = () => {
    try {
      return readFileSync(join(dirs.profile, 'mawsd', 'mawsd.log'), 'utf8');
    } catch {
      return '';
    }
  };
  const cli = (...args: string[]) =>
    new Promise<{ code: number; out: string }>((done) => {
      execFile(process.execPath, [MAWSD, ...args], { env: base, timeout: 20_000 }, (error, stdout) => done({ code: error ? Number((error as { code?: unknown }).code ?? 1) : 0, out: stdout }));
    });
  const status = async (): Promise<{ state?: string; url?: string | null } | null> => {
    const { code, out } = await cli('status', '--json');
    if (code !== 0) return null;
    return (JSON.parse(out) as { sheetPage?: { state: string; url: string | null } }).sheetPage ?? null;
  };

  async function start(): Promise<void> {
    output = '';
    const running = spawn(process.execPath, ['--disable-sigusr1', MAWSD, 'run', '--private', '--dir', join(dirs.profile, 'mawsd')], { env: { ...base, MAWS_SHEET_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child = running;
    running.stdout!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    running.stderr!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
    let page: { state?: string; url?: string | null } | null = null;
    await until(
      async () => {
        if (running.exitCode !== null) throw new Error(`mawsd exited ${running.exitCode}:\n${output}\n${log()}`);
        page = await status();
        return page?.state === 'listening';
      },
      START_MS,
      `the sheet page to listen:\n${output}\n${log()}`,
    );
    const url = page!.url!;
    port = Number(new URL(url).port);
  }

  async function stop(): Promise<void> {
    const running = child;
    child = null;
    if (running === null || running.exitCode !== null || running.signalCode !== null) return;
    const exited = new Promise<void>((done) => running.once('exit', () => done()));
    running.kill('SIGTERM');
    const late = setTimeout(() => running.kill('SIGKILL'), 10_000);
    await exited;
    clearTimeout(late);
  }

  await start();
  return {
    get url() {
      return `http://sheet.localhost:${port}`;
    },
    get port() {
      return port;
    },
    home: dirs.sminos,
    profile: dirs.profile,
    cli,
    async pair(page) {
      const { code, out } = await cli('sheet', 'pair');
      if (code !== 0) throw new Error(`mawsd sheet pair exited ${code}`);
      await page.getByLabel('Then type the code it prints:').fill(out.split('\n')[0]!);
      await page.getByRole('button', { name: 'Pair', exact: true }).click();
      await page.getByRole('banner').waitFor();
    },
    async browsers() {
      const { code, out } = await cli('sheet', 'browsers', '--json');
      if (code !== 0) throw new Error(`mawsd sheet browsers exited ${code}`);
      return (JSON.parse(out) as { browsers: { id: string; label: string }[] }).browsers;
    },
    async proofFor(id) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { Host: `sheet.localhost:${port}`, Origin: `http://sheet.localhost:${port}` } });
      await new Promise((done, failed) => socket.once('open', done).once('error', failed));
      socket.send(JSON.stringify({ t: 'hello', v: 1, id, nonce: randomBytes(32).toString('base64url') }));
      const answer = await new Promise<string>((done) => socket.once('message', (data: Buffer) => done(data.toString())));
      socket.close();
      return (JSON.parse(answer) as { mac: string }).mac;
    },
    stop,
    kill() {
      child?.kill('SIGKILL');
      child = null;
    },
    async restart() {
      await stop();
      await start();
    },
    async dispose() {
      await stop();
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

// --- the impostor ----------------------------------------------------------------------------------------------------

// What the impostor does after a tab's hello: nothing; a MAC under another key; the proof it was handed, recorded from
// the real daemon for another nonce; `paired` and `ready` with no proof at all; or a close with 4401.
export type ImpostorPlay = 'silent' | 'wrong-mac' | 'replay' | 'paired-unproven' | 'refuses';

export interface Heard {
  frames: string[];
  requests: { method: string; target: string; headers: string[] }[]; // every request and every upgrade, raw headers flat
}

export async function impostor(port: number, plays: ImpostorPlay, recorded?: string): Promise<{ heard: Heard; close(): Promise<void> }> {
  const heard: Heard = { frames: [], requests: [] };
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const note = (req: IncomingMessage) => heard.requests.push({ method: req.method ?? '', target: req.url ?? '', headers: [...req.rawHeaders] });
  wss.on('connection', (socket: WebSocket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (data: Buffer) => {
      const text = data.toString();
      heard.frames.push(text);
      let hello: { t?: string; id?: string; nonce?: string } = {};
      try {
        hello = JSON.parse(text) as typeof hello;
      } catch {
        return;
      }
      if (hello.t !== 'hello') return;
      if (plays === 'wrong-mac') socket.send(JSON.stringify({ t: 'proof', mac: createHmac('sha256', randomBytes(32)).update(`maws.sheet.live.v1\n${hello.id}\n${hello.nonce}`).digest('base64url') }));
      else if (plays === 'replay') socket.send(JSON.stringify({ t: 'proof', mac: recorded }));
      else if (plays === 'paired-unproven') {
        socket.send(JSON.stringify({ t: 'paired' }));
        socket.send(JSON.stringify({ t: 'ready', v: 1, sessions: [], door: { state: 'available' } }));
      } else if (plays === 'refuses') socket.close(4401, 'refused');
    });
  });
  const make = () => {
    const server = createServer((req, res) => {
      note(req);
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not here');
    });
    server.on('upgrade', (req, socket, head) => {
      note(req);
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    return server;
  };
  const { servers } = await listenLoopback(make, port);
  return {
    heard,
    async close() {
      for (const socket of sockets) socket.terminate();
      await closeAll(servers);
    },
  };
}
