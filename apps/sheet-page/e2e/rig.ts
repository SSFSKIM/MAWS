// The page's rig (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §Q; T24): the built `mawsd` as a
// process, as the app starts a private one, under plain Node over scratch directories, serving the built page on a port
// the system picks; an impostor that takes the daemon's port while it is stopped; and a second origin, a static server
// on another port, whose page tries what a stranger in the same browser can. What a spec asserts of a stranger's try is
// never that page's own account: it is the status Playwright saw on the wire, and what the daemon holds after it.
//
// This is the one launcher that turns the page on (T2), always with a scratch home and a port of its own: no run here
// listens on the real port or writes under a real home. From M4 its daemon names C3's stand-in door (MAWS_SMINOS_CLI),
// its sminos home can hold records of the pin (records.ts), and its engine's store can hold terminal sessions, one a
// live stand-in process holds and one nobody holds, which the daemon's own discovery brings into its index (T29), so a
// session reads running or stopped with no app attached.
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import WebSocket, { WebSocketServer } from 'ws';
// the page's origin and Host come from the server's own module (it imports nothing), so a change there reaches this suite
import { pageOrigin, SHEET_HOST } from '../../../src/mawsd/sheet-page/headers';
import { slugOf } from '../../../src/engine-host/fs/paths';
import { FAKE_SMINOS, seedRecord } from '../../../test/support/sheet-records';
import { closeAll, listenLoopback } from './second-origin.mjs';

export { secondOrigin } from './second-origin.mjs';

export const ROOT = resolve(import.meta.dirname, '../../..');
const MAWSD = join(ROOT, 'out/main/mawsd.js');
const START_MS = 30_000;

// A terminal session in the engine's store (§Q): its transcript, its first prompt the title the index reads, and for a
// held one a registry record naming a live stand-in process
export interface SeededSession {
  session: string;
  title: string;
  held: boolean;
}

export interface Mawsd {
  url: string; // the page's origin, http://sheet.localhost:<port>
  port: number;
  home: string; // the scratch sminos home
  profile: string; // the scratch profile
  scratch: string; // the scratch root, for a test's own files
  release(): void; // with `barrier`: the stand-in door's held puts go on (C3's §E, FAKE_SMINOS_BARRIER)
  cli(...args: string[]): Promise<{ code: number; out: string }>;
  pair(page: Page): Promise<void>; // `mawsd sheet pair`, its code typed into the page's pairing screen, and the frame shown
  browsers(): Promise<{ id: string; label: string }[]>; // `mawsd sheet browsers --json`
  connections(): Promise<number>; // the live connections paired on the connection, as `mawsd status --json` counts them
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

export async function startMawsd(options: { records?: string[]; sessions?: SeededSession[]; barrier?: boolean; env?: Record<string, string> } = {}): Promise<Mawsd> {
  if (!existsSync(MAWSD)) throw new Error(`${MAWSD} is not built (pnpm -w run build:main-preload)`);
  if (!existsSync(join(ROOT, 'out/sheet-page/index.html'))) throw new Error('out/sheet-page is not built (vite build)');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'sheet-rig-'))); // the index keeps a project's real directory
  const dirs = { profile: join(scratch, 'profile'), home: join(scratch, 'home'), sminos: join(scratch, 'sminos'), config: join(scratch, 'claude-config'), project: join(scratch, 'proj') };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  mkdirSync(join(dirs.sminos, 'sheet'), { recursive: true });
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    ...options.env, // a test's own, which can name none of what follows: the scratch homes and the switches are enforced
    HOME: dirs.home,
    SHELL: '/bin/sh', // the login shell the daemon captures: this scratch's, never the runner's
    MAWS_USER_DATA: dirs.profile,
    CLAUDE_CONFIG_DIR: dirs.config,
    SMINOS_HOME: dirs.sminos,
    MAWS_SHEET_PAGE: '1',
    MAWS_E2E: '1', // under which sminosHome refuses the real home, and the door's locator reads MAWS_SMINOS_CLI alone
    MAWS_ENGINE_REPLAY: '1', // no engine runs
    MAWS_SMINOS_CLI: FAKE_SMINOS, // C3's stand-in door (§E): no test reaches an installed sminos
    ...(options.barrier && { FAKE_SMINOS_BARRIER: join(scratch, 'barrier') }), // a put waits until the file exists
  };
  for (const name of options.records ?? []) seedRecord(dirs.sminos, name);
  const holders: ChildProcess[] = [];
  for (const seeded of options.sessions ?? []) holders.push(...seedSession(dirs.config, dirs.project, seeded));
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
  const status = async (): Promise<{ state?: string; url?: string | null; connections?: number | null } | null> => {
    const { code, out } = await cli('status', '--json');
    if (code !== 0) return null;
    return (JSON.parse(out) as { sheetPage?: { state: string; url: string | null; connections: number | null } }).sheetPage ?? null;
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

  const endHolders = () => {
    for (const holder of holders) if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL');
  };
  try {
    await start();
  } catch (error) {
    await stop(); // a daemon that never came to listen
    endHolders();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
  return {
    get url() {
      return pageOrigin(port);
    },
    get port() {
      return port;
    },
    home: dirs.sminos,
    profile: dirs.profile,
    scratch,
    release: () => writeFileSync(join(scratch, 'barrier'), ''),
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
    async connections() {
      return (await status())?.connections ?? 0;
    },
    async proofFor(id) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { Host: `${SHEET_HOST}:${port}`, Origin: pageOrigin(port) } });
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
      endHolders();
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

// A terminal session's transcript in the engine's store, and for a held one a registry record naming a live stand-in
// process with its start time as the engine renders it (e2e/support/lane-a.ts's terminal). Answers the processes it
// started, which the rig ends.
function seedSession(config: string, cwd: string, { session, title, held }: SeededSession): ChildProcess[] {
  const folder = join(config, 'projects', slugOf(cwd));
  mkdirSync(folder, { recursive: true });
  const first = { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: title }, uuid: `${session.slice(0, -2)}ff`, timestamp: '2026-11-24T09:00:00.000Z', cwd, sessionId: session, version: '2.1.300' };
  writeFileSync(join(folder, `${session}.jsonl`), `${JSON.stringify(first)}\n`);
  if (!held) return [];
  const child = spawn('/bin/sh', ['-c', 'read -r _'], { stdio: ['pipe', 'ignore', 'ignore'] });
  const pid = child.pid!;
  const procStart = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8' }).trim();
  mkdirSync(join(config, 'sessions'), { recursive: true });
  writeFileSync(join(config, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: session, cwd, kind: 'interactive', procStart, status: 'idle' }));
  return [child];
}

// --- the impostor ----------------------------------------------------------------------------------------------------

// What the impostor does after a tab's hello: nothing; a MAC under another key; the proof it was handed, recorded from
// the real daemon for another nonce; `paired` and `ready` with no proof at all; or a close with 4401.
export type ImpostorPlay = 'silent' | 'wrong-mac' | 'replay' | 'paired-unproven' | 'refuses';

export interface Heard {
  frames: string[];
  requests: { method: string; target: string; headers: string[] }[]; // every request and every upgrade, raw headers flat
}

// `scripts`: every HTTP request is answered 200 with a script that counts itself in `__strangerRan`, as a stand-in
// that wanted to run its own code in the page's origin would answer a chunk (T28's "no chunk from a stranger")
export const STRANGER_SCRIPT = 'globalThis.__strangerRan = (globalThis.__strangerRan ?? 0) + 1; export default {};';
export async function impostor(port: number, plays: ImpostorPlay, recorded?: string, options: { scripts?: boolean } = {}): Promise<{ heard: Heard; close(): Promise<void> }> {
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
      } else if (plays === 'refuses') socket.close(4401, 'refused'); // §L's close for a browser not known (handler.ts, CLOSE.refused)
    });
  });
  const make = () => {
    const server = createServer((req, res) => {
      note(req);
      if (options.scripts) res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(STRANGER_SCRIPT);
      else res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not here');
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
