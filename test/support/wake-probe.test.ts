// P5 O15 M2b §K (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): M4's 7e probe, run as the child process it
// is on the day. `extract` prints the evidence lines and nothing else, in the forms the branch writes them; `read` takes
// the counted try that started first among those that succeeded, never one that began before the wake; `watch` starts
// a try every 100 ms whatever the earlier ones are doing.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, 'wake-probe.mjs');
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'wake-probe-'));
  dirs.push(dir);
  return dir;
};

describe('extract', () => {
  // One sample of every pattern, each in the form the branch writes it: main's lines as main's console says them;
  // mawsd's endpoint lines under the daemon's `[endpoint] ` (src/mawsd/daemon.ts); the engine host's under the
  // `warn: ` its routed console adds to the `[engine-host] ` of its ipc's log (src/shared/host/socket-host.ts).
  const SAMPLES = [
    '[wake] slept 3600000 ms (resume)',
    '[wake] slept 12000 ms (clock)',
    '[reach] window open for 60 s (wake)',
    '[reach] window open for 60 s (network)',
    '[reach] desk-hub.example.com:443: reachable after 7 probes, 612 ms',
    '[reach] [fd7a:115c:a1e0::1]:47830: reachable after 1 probes, 14 ms',
    '[reach] 100.64.0.2:47830: window closed after 600 probes, none connected (connect ECONNREFUSED 100.64.0.2:47830 (ECONNREFUSED))',
    '[machines] m-mini: wake after 3600000 ms: dropped the direct channel, the relay socket, 1 attempt(s) in flight',
    '[machines] m-mini: probe wake: held',
    '[machines] m-mini: probe network: seeking',
    '[machines] m-mini: attempt (direct): catch-up, dial 2',
    "[machines] m-mini: attempt failed (today's): connect ETIMEDOUT (ETIMEDOUT); next in 2000 ms",
    '[machines] m-mini: attempt failed (relay): the handshake timed out; no next attempt of its own',
    '[machines] m-mini: lane direct: spent (the bucket holds fewer than two tokens)',
    "[machines] m-mini: floor after 10000 ms: today's attempts from here (both lanes spent)",
    '[machines] m-mini: lanes again: [fd7a:115c:a1e0::1]:47830 answered, 4200 ms after the floor',
    '[machines] m-mini: wrote 2 act message(s), 612 bytes, ahead of the subscriptions',
    '[machines] m-mini: up over the relay carrier',
    '[machines] m-mini: up over the direct carrier (within the grace)',
    '[machines] m-mini: the direct channel was lost (timeout); reconnecting',
    '[machines] m-mini: the  channel was lost (closed); reconnecting',
    '[machines] m-mini: subscription s7 session B:0f3a cards: subbed replay at e1:6400:-, asked from e1:120:-',
    '[machines] m-mini: subscription s8 feed attention: subbed snapshot at e1:0:-, asked from none',
    '[machines] m-mini: subscription s7 session B:0f3a cards: first event after subbed, at e1:6401:-',
    '[machines] m-mini: subscription s8 feed attention: first snapshot after subbed, at e1:0:-',
    '[machines] m-mini: subscription s7: dropped a repeated event at e1:6400:-',
    '[org-feed] wake after 3600000 ms: dropped the socket',
    '[org-feed] no pong within 5000 ms: dropped the socket',
    '[org-feed] probe: ping sent',
    '[org-feed] connected to desk-hub.example.com',
    '[org-feed] listings: last page, 42 records in 3 pages',
    '[org-channel] 3f9a1c2e: wake after 3600000 ms: no socket',
    '[org-channel] 3f9a1c2e: no pong within 5000 ms: dropped the socket',
    '[org-channel] 3f9a1c2e: welcomed, resuming after 118',
    '[org-channel] 3f9a1c2e: caught up at 131',
    '[endpoint] endpoint: channel d1/k9 sub s7 session B:0f3a cards: subbed replay at e1:6400:-, asked from e1:120:-, after 38 ms',
    '[endpoint] endpoint: the hub connection failed: connect ETIMEDOUT (ETIMEDOUT; ETIMEDOUT 192.0.2.1:443, ENETUNREACH 2001:db8::1:443); connecting again in 4000 ms',
    "warn: [engine-host] ring evicted app-0f3a launch L2: events through seq 1200 are the journal's now",
    'warn: [engine-host] session.events app-0f3a after 120: from the journal, 6521 rows read in 31 ms',
    'warn: [engine-host] session.events app-0f3a after start: from the journal, 6521 rows read in 29 ms, from the checkpoint at seq 6000',
    'warn: [engine-host] checkpoint app-0f3a launch L2 at seq 6000: 18432 bytes; 2 held, 36864 bytes',
  ];
  const NOT_EVIDENCE = [
    '[main] the quit guard could not save /Users/someone/Documents/notes.md: EACCES',
    'the model said hello and asked about the weather',
    '[machines] m-mini: a state the endpoint sent did not advance the view: unexpected token',
    '[endpoint] endpoint: connected to the hub (generation 4)',
    '[org-feed] socket error: read ECONNRESET',
  ];
  const at = (i: number) => new Date(Date.UTC(2026, 10, 10, 3, 0, 0) + i * 10).toISOString();

  it('prints exactly the lines of the evidence patterns, with their times, and nothing else', () => {
    const lines: string[] = [];
    const want: string[] = [];
    SAMPLES.forEach((text, i) => {
      lines.push(`${at(2 * i)} ${text}`);
      want.push(`${at(2 * i)} ${text}`);
      lines.push(`${at(2 * i + 1)} ${NOT_EVIDENCE[i % NOT_EVIDENCE.length]}`);
    });
    lines.splice(4, 0, '    at Object.<anonymous> (/Users/someone/app/main.js:12:3)'); // a stack's line, no time of its own
    const file = join(scratch(), 'main.log');
    writeFileSync(file, `${lines.join('\n')}\n`);
    const out = run('extract', file);
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout).toBe(`${want.join('\n')}\n`);
  });

  it('matches the engine host and endpoint lines in the bare form §K writes them too', () => {
    const bare = SAMPLES.filter((text) => /^(warn: |\[endpoint\] )/.test(text)).map((text) => text.replace(/^warn: \[engine-host\] |^\[endpoint\] /, ''));
    const file = join(scratch(), 'host.log');
    writeFileSync(file, `${bare.map((text, i) => `${at(i)} ${text}`).join('\n')}\n`);
    expect(run('extract', file).stdout.trim().split('\n')).toHaveLength(bare.length);
  });

  it('with --since, prints only the lines said at or after that time', () => {
    const file = join(scratch(), 'mawsd.log');
    writeFileSync(file, `${at(0)} [wake] slept 12000 ms (clock)\n${at(1)} [wake] slept 13000 ms (clock)\n${at(2)} [wake] slept 14000 ms (resume)\n`);
    expect(run('extract', file, '--since', at(1)).stdout).toBe(`${at(1)} [wake] slept 13000 ms (clock)\n${at(2)} [wake] slept 14000 ms (resume)\n`);
  });
});

describe('read', () => {
  const T = Date.UTC(2026, 10, 10, 3, 0, 0); // the [wake] line's time
  const iso = (ms: number) => new Date(ms).toISOString();
  const tri = (n: number, started: number, ended: number, ms: number, ok: boolean, code?: string) => JSON.stringify({ n, started: T + started, ended: T + ended, ms, ok, ...(code === undefined ? {} : { code }) });

  it('names, for each target, the first counted try that succeeded, its times to each --at, the median, and the tries it excluded', () => {
    const dir = scratch();
    // Written as the tries ended: the slow try 5 started first among the successes and is written after try 6.
    writeFileSync(
      join(dir, 'hub.jsonl'),
      [
        tri(1, -5000, -4990, 10.2, true),
        tri(2, -4900, -4890, 9.8, true),
        tri(3, -200, 50, 4.1, true), // spans the wake: began before it, so it counts for nothing
        tri(6, 300, 312, 12, true),
        tri(5, 200, 400, 200, true),
        tri(4, 100, 3100, 3000.4, false, 'TIMEOUT'),
        tri(7, 400, 414, 14, true),
        tri(8, 500, 516, 16, true),
        tri(9, 40_000, 40_900, 900, true), // past the 30 s from reachable: not in the median
      ].join('\n') + '\n',
    );
    writeFileSync(join(dir, 'mini.jsonl'), [tri(1, -300, -290, 10, true), tri(2, 100, 110, 9.5, false, 'ECONNREFUSED')].join('\n') + '\n');
    writeFileSync(join(dir, 'https.jsonl'), JSON.stringify({ n: 1, started: T + 10, ended: T + 90, ms: 80, status: 200 }) + '\n');

    const out = run('read', dir, '--after', iso(T), '--at', iso(T + 1200), '--at', iso(T + 700));
    expect(out.stderr).toBe('');
    expect(out.status).toBe(0);
    expect(out.stdout.split('\n').filter(Boolean)).toEqual([
      'hub: 6 tries counted from 2026-11-10T03:00:00.000Z, 3 excluded',
      'hub: excluded: 2 tries that ended before --after',
      'hub: excluded: try 3, started 2026-11-10T02:59:59.800Z, ended 2026-11-10T03:00:00.050Z: began before --after',
      'hub: reachable 2026-11-10T03:00:00.200Z: try 5 started then, ended 2026-11-10T03:00:00.400Z, took 200 ms',
      'hub: --at 2026-11-10T03:00:01.200Z: 1000 ms from the try’s start, 800 ms from its end',
      'hub: --at 2026-11-10T03:00:00.700Z: 500 ms from the try’s start, 300 ms from its end',
      'hub: median 15.0 ms over 4 successful tries in the 30 s from reachable',
      'mini: 1 try counted from 2026-11-10T03:00:00.000Z, 1 excluded',
      'mini: excluded: 1 try that ended before --after',
      'mini: no counted try succeeded (the last: ECONNREFUSED)',
    ]);
  });

  it('refuses without --after, since a try that spans the sleep must be told from one after it', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'hub.jsonl'), tri(1, 0, 10, 10, true) + '\n');
    const out = run('read', dir);
    expect(out.status).toBe(2);
    expect(out.stdout).toBe('');
    expect(out.stderr).toMatch(/--after/);
  });
});

describe('watch', () => {
  const freePort = () =>
    new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number };
        server.close(() => resolve(port));
      });
    });
  type Try = { n: number; started: number; ended: number; ms: number; ok: boolean; code?: string };
  const triesIn = (file: string): Try[] =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Try)
      : [];
  const until = async (what: string, test: () => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (!test()) {
      if (Date.now() > end) throw new Error(`no ${what} within ${ms} ms`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  // The listener accepts what its kernel queue holds and then nothing: a process whose event loop is blocked for good
  // after its listen, with a backlog of 1, so that once the queue is full a connect neither connects nor is refused.
  const LISTENER = [
    "const server = require('node:net').createServer(() => {});",
    "server.listen({ host: '127.0.0.1', port: Number(process.argv[1]), backlog: 1 }, () => {",
    "  process.stdout.write('listening\\n', () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0));",
    '});',
  ].join('\n');

  it(
    'against a loopback port that refuses and then accepts, records tries 100 ms apart that overlap, and a first success',
    async () => {
      const port = await freePort();
      const dir = join(scratch(), 'probe');
      const file = join(dir, 'local.jsonl');
      const watch = spawn(process.execPath, [SCRIPT, 'watch', '--target', `local=127.0.0.1:${port}`, '--out', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(watch);
      let stdout = '';
      watch.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      await until('refused tries', () => triesIn(file).length >= 4, 5_000);

      const listener = spawn(process.execPath, ['-e', LISTENER, String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
      children.push(listener);
      await new Promise<void>((resolve) => listener.stdout.once('data', () => resolve()));
      await until('two tries that ran out their 3 s', () => triesIn(file).filter((t) => t.code === 'TIMEOUT').length >= 2, 10_000); // a try's line is written when it ends
      watch.kill('SIGTERM');
      await new Promise((resolve) => watch.once('exit', resolve));

      expect(stdout).toMatch(/^watch: started \d{4}-\d\d-\d\dT[\d:.]+Z, local every 100 ms into /);
      const tries = triesIn(file).sort((a, b) => a.started - b.started);
      for (const t of tries) {
        expect(t.ended).toBeGreaterThanOrEqual(t.started);
        expect(t.ms).toBeGreaterThanOrEqual(0);
      }
      expect(tries.map((t) => t.n)).toEqual([...tries.map((t) => t.n)].sort((a, b) => a - b)); // numbered in the order they started

      const firstOk = tries.findIndex((t) => t.ok);
      expect(firstOk).toBeGreaterThanOrEqual(4);
      expect(tries.slice(0, firstOk).every((t) => !t.ok && t.code === 'ECONNREFUSED')).toBe(true);

      const gaps = tries.slice(1).map((t, i) => t.started - tries[i].started);
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      expect(median).toBeGreaterThanOrEqual(80);
      expect(median).toBeLessThanOrEqual(250);

      const hung = tries.find((t) => t.code === 'TIMEOUT')!;
      expect(hung.ended - hung.started).toBeGreaterThanOrEqual(2_900);
      expect(tries.some((t) => t.started > hung.started && t.started < hung.ended)).toBe(true); // the next tries did not wait for it
    },
    30_000,
  );

  it('refuses a target named https, whose file the GET cross-check writes', () => {
    const out = run('watch', '--target', 'https=127.0.0.1:443', '--out', scratch());
    expect(out.status).toBe(2);
    expect(out.stderr).toMatch(/https/);
  });
});
