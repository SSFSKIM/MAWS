// The lane B session of the endpoint acceptance scene (P5 O10 M11, acceptance 2's lane B half; scene.sh runs it as the
// scratch user, in the scene's namespace): a client of the scratch `mawsd`'s machine.sock, as the command line is
// (src/mawsd/machine-client.ts: the token, the hello, then one JSON request a line), with no app anywhere.
//   node lane-b.mjs up <directory> <tag>   a lane B session started there the way the app starts one (`session.create`,
//                                           then `session.start` with a first message, on the gateway route, which
//                                           the scene points at its stub model) and kept running for the run
//                                           (`session.setKeep`); prints {app, launch, engine} once its first turn ended
//   node lane-b.mjs events <app>            the engine host's own numbering of every event of the session's launch: its
//                                           journal read back by `session.events` from the launch's start, page by
//                                           page, never through the endpoint; `ev <launch> <seq> <idx>` a line, then
//                                           `events <n> complete`
// The daemon's directory is $MAWS_USER_DATA/mawsd. Every request and every wait is bounded.
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as sleep } from 'node:timers/promises';

/** machine.sock's socket protocol (src/shared/host/socket-protocol.ts): a hello of its major is welcomed at any minor. */
export const SOCKET_PROTOCOL = 3;
const PAGE = 500;

/** A link to machine.sock: `request(name, input)` answers the response's value, or throws its error. */
export async function reach(dir, { helloMs = 5000 } = {}) {
  const token = readFileSync(join(dir, 'mawsd.token'), 'utf8').trim();
  const socket = createConnection(join(dir, 'machine.sock'));
  const waiting = new Map();
  let buffered = '';
  let welcomed;
  const hello = new Promise((resolve, reject) => {
    welcomed = { resolve, reject };
    setTimeout(() => reject(new Error(`no answer to the hello within ${helloMs / 1000} s`)), helloMs).unref();
  });
  let closed = null;
  socket.on('error', (error) => {
    closed = error;
    welcomed.reject(error);
    for (const { reject } of waiting.values()) reject(error);
  });
  socket.on('close', () => {
    closed ??= new Error('mawsd closed the connection');
    welcomed.reject(closed);
    for (const { reject } of waiting.values()) reject(closed);
  });
  let first = true;
  socket.on('data', (chunk) => {
    buffered += Buffer.from(chunk).toString('utf8');
    for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (first) {
        first = false;
        if (message.t === 'welcome') welcomed.resolve();
        else welcomed.reject(new Error(`mawsd refused the hello: ${line.slice(0, 200)}`));
        continue;
      }
      if (message.t !== 'res' || typeof message.id !== 'string') continue; // events, and the port's asks: not this client's
      waiting.get(message.id)?.resolve(message);
    }
  });
  socket.on('connect', () => socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: 7, build: 'o10-m11-lane-b', capabilities: [], appPid: process.pid })}\n`));
  await hello;
  let next = 0;
  return {
    async request(name, input, ms = 30_000) {
      if (closed) throw closed;
      const id = `o10-${++next}`;
      const answer = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`mawsd did not answer ${name} within ${ms / 1000} s`));
        }, ms);
        waiting.set(id, {
          resolve: (m) => (clearTimeout(timer), waiting.delete(id), resolve(m)),
          reject: (e) => (clearTimeout(timer), waiting.delete(id), reject(e)),
        });
        socket.write(`${JSON.stringify({ t: 'req', id, name, input })}\n`);
      });
      if (answer.ok !== true) throw new Error(`${name}: ${answer.error?.code ?? 'error'}: ${String(answer.error?.message ?? '').slice(0, 300)}`);
      return answer.value;
    },
    close() {
      socket.destroy();
    },
  };
}

/** An event's place as its id names it (`<app>:<launch>:<seq>:<idx>`, its `seq` the same), or null. */
export function placeOf(app, event) {
  const id = event?.id;
  if (typeof id !== 'string' || !id.startsWith(`${app}:`) || typeof event.seq !== 'number') return null;
  const rest = id.slice(app.length + 1);
  const i = rest.lastIndexOf(':');
  const s = i > 0 ? rest.lastIndexOf(':', i - 1) : -1;
  if (s <= 0) return null;
  const seq = Number(rest.slice(s + 1, i));
  const idx = Number(rest.slice(i + 1));
  if (!Number.isSafeInteger(idx) || idx < 0 || seq !== event.seq) return null;
  return { launch: rest.slice(0, s), seq, idx };
}

/**
 * Every event of the session's launch, as the engine host numbers them: `session.events` from the launch's start, each
 * page after the last row the one before ended on (a page ends on a whole row), until one says it is complete.
 */
export async function events(link, app, { maxPages = 400 } = {}) {
  const out = [];
  let afterSeq = null;
  for (let page = 0; page < maxPages; page++) {
    const value = await link.request('session.events', { appSessionId: app, afterSeq, limit: PAGE });
    if (value.historyUnavailable === true) throw new Error(`session.events: part of the launch's history is unavailable (after seq ${afterSeq})`);
    // Events with no `seq` are the transcript's from disk, not the launch's.
    const mine = (Array.isArray(value.events) ? value.events : []).filter((e) => typeof e?.seq === 'number');
    for (const event of mine) {
      const place = placeOf(app, event);
      if (place === null) throw new Error(`session.events: an event whose id ${JSON.stringify(event.id)} names no place of ${app} at seq ${event.seq}`);
      out.push(place);
    }
    if (value.complete === true || mine.length === 0) return out;
    afterSeq = mine.at(-1).seq;
  }
  throw new Error(`session.events: not complete after ${maxPages} pages`);
}

/** Polls `read` until `done(value)` holds, every `everyMs`, at most `ms`; the last value read in the error. */
async function until(read, done, what, ms, everyMs = 1000) {
  const deadline = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await read();
      if (done(last)) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) throw new Error(`${what} not within ${ms / 1000} s (last: ${JSON.stringify(last)?.slice(0, 400)})`);
    await sleep(everyMs);
  }
}

/** The session started and its first turn ended; its ids. */
export async function up(link, directory, tag, { readyMs = 180_000 } = {}) {
  // A status read wakes the engine host, parked until something asks it (the session service's boot waits on it).
  await link.request('daemon.status', null);
  const { appSessionId: app } = await link.request('session.create', { projectId: null, location: { kind: 'directory', path: directory } });
  const text = `o10-m11 lane B up ${tag}`;
  const outcome = await link.request('session.start', { appSessionId: app, message: { content: text, display: text }, options: { gateway: 'gateway', trust: 'accepted' } }, 120_000);
  if (outcome?.status !== 'starting') throw new Error(`session.start answered ${JSON.stringify(outcome).slice(0, 400)}`);
  const status = await until(
    () => link.request('session.status', { appSessionId: app }),
    (s) => s?.process === 'ready' && typeof s.engineSessionId === 'string' && s.turn === null && typeof s.launchId === 'string',
    `the session ${app} ready, its first turn ended`,
    readyMs,
  );
  // Kept running for the run (the owner's Keep running mark): no idle release relaunches it between two answers.
  await link.request('session.setKeep', { appSessionId: app, keep: true });
  return { app, launch: status.launchId, engine: status.engineSessionId };
}

async function main(argv) {
  const [verb, ...args] = argv;
  const dir = join(process.env.MAWS_USER_DATA ?? '', 'mawsd');
  if (!process.env.MAWS_USER_DATA) throw new Error('MAWS_USER_DATA names no profile');
  const link = await reach(dir);
  try {
    if (verb === 'up' && args.length === 2) return void console.log(JSON.stringify(await up(link, args[0], args[1])));
    if (verb === 'events' && args.length === 1) {
      const all = await events(link, args[0]);
      for (const e of all) console.log(`ev ${e.launch} ${e.seq} ${e.idx}`);
      return void console.log(`events ${all.length} complete`);
    }
    throw new Error('lane-b.mjs up <directory> <tag> | events <app>');
  } finally {
    link.close();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main(process.argv.slice(2)).then(
    () => process.exit(0),
    (error) => {
      console.log(`lane-b: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
