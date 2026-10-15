// `deployment redeploy-check`: DC3.G2 against the deployment — a redeploy in the middle of a sync loses and duplicates
// nothing. Two fake machines (M4's, reconnecting by themselves as the daemon does) each write an event to their own feed
// every 100 ms, and a browser writes a web `human` every second, while the hub is redeployed (every object restarts,
// every stream and socket is cut). When the writing stops, both machines and a fresh browser resume from 0 must hold
// exactly the events written, each writer's seqs 1..N once, with distinct rising offsets.
//
// stdin (deploy.ts, readSecrets): DESK_ACCESS_TOKEN (the owner's Access app token), CF_ACCESS_SETUP_TOKEN and
// CF_DESK_HUB_SERVICE_TOKENS (the redeploy is `deployment deploy`'s own). Options as `deployment deploy` takes them
// (--org-id, --assets), plus --seconds (the writing's length, default 60) and --redeploy-at (default 15).
import { randomUUID } from 'node:crypto';
import { loadavg } from 'node:os';
import { FakeMachine } from '../fake-machine/machine';
import { importOrgKey, newNonce, seal } from '../src/protocol/codes';
import type { HumanDraft, LogEvent } from '../src/protocol/log';
import { join } from 'node:path';
import { readDeployConfig } from './config';
import { deployArgs, deployHub, readSecrets } from './deploy';
import { enroll, newOrgKey, Person, sleep, type Socket } from './hub';

async function until<T>(read: () => Promise<T | undefined>, what: string, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(1000);
  }
}

export async function main(argv: string[]): Promise<number> {
  const { config, values } = deployArgs(argv, { seconds: { type: 'string', default: '60' }, 'redeploy-at': { type: 'string', default: '15' } });
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN || !secrets.CF_ACCESS_SETUP_TOKEN || !secrets.CF_DESK_HUB_SERVICE_TOKENS) {
    console.error('DESK_ACCESS_TOKEN, CF_ACCESS_SETUP_TOKEN, and CF_DESK_HUB_SERVICE_TOKENS on stdin');
    return 2;
  }
  if (config.org.id === readDeployConfig(join(process.env.DESK_HUB_APP!, 'deploy', 'config.json')).org.id) {
    console.error("redeploy-check registers a project and seals events under a throwaway key: run it under a throwaway org (--org-id), never the owner's");
    return 2;
  }
  const hub = `https://${config.host}`;
  const owner = new Person(hub, secrets.DESK_ACCESS_TOKEN);
  const me = await owner.json<{ org: { id: string }; member: { id: string } }>('/api/me');
  if (me.org.id !== config.org.id) throw new Error(`the deployment serves org ${me.org.id}, not ${config.org.id}`);
  const tag = Math.random().toString(36).slice(2, 7);
  const project = randomUUID();
  const rawKey = newOrgKey();
  const key = await importOrgKey(rawKey);
  const seconds = Number(values.seconds);
  const redeployAt = Number(values['redeploy-at']);

  const names = [`rd-a-${tag}`, `rd-b-${tag}`];
  const machines: FakeMachine[] = [];
  for (const name of names) {
    const credentials = await enroll(owner, name);
    const fm = new FakeMachine({ hub, machine: name, credentials, orgKey: rawKey, project, projectName: `dc3-m5 redeploy ${tag}`, reconnect: true });
    // A fresh service token reaches Access's edge in seconds; until then it is refused 401.
    for (let tries = 0; ; tries++) {
      try {
        await fm.connect();
        break;
      } catch (error) {
        if (tries > 30) throw error;
        await sleep(2000);
      }
    }
    machines.push(fm);
  }
  console.log(`machines ${names.join(', ')} connected; project ${project}`);

  // The browser: follows the log, writes a `human` each second, and on a cut reopens and resumes after the last offset
  // it holds, resending every `human` not acknowledged (the hub answers a known nonce from its record).
  const received = new Map<number, LogEvent>();
  const unacked = new Map<string, LogEvent>();
  let acked = 0;
  let socket: Socket | undefined;
  let browserReopens = 0;
  const openBrowser = async (): Promise<void> => {
    for (;;) {
      try {
        const s = await owner.socket(`/api/projects/${project}/socket`);
        s.onFrame = (frame) => {
          if (frame.t === 'log') for (const { offset, event } of frame.events as Array<{ offset: number; event: LogEvent }>) received.set(offset, event);
          if (frame.t === 'human-ack' && unacked.delete(String(frame.nonce))) acked++;
        };
        s.send({ t: 'resume', after: received.size ? Math.max(...received.keys()) : 0 });
        for (const event of unacked.values()) s.send({ t: 'human', event });
        socket = s;
        return;
      } catch {
        await sleep(1000);
      }
    }
  };
  await openBrowser();
  let writing = true;
  const browserLoop = (async () => {
    for (let i = 1; writing; i++) {
      const draft: HumanDraft = { kind: 'human', from: 'human', member: me.member.id, to: '*', text: `human ${i}`, created: new Date().toISOString() };
      const event = (await seal(key, 'log', project, draft, newNonce())) as unknown as LogEvent;
      unacked.set(event.mac.nonce, event);
      if (socket && !socket.closed) socket.send({ t: 'human', event });
      if (socket?.closed) {
        browserReopens++;
        socket = undefined;
        await openBrowser();
      }
      await sleep(1000);
    }
  })();

  // The machines write; the hub is redeployed partway.
  const written = new Map<string, number>();
  const writers = machines.map((fm) =>
    (async () => {
      const writer = `${fm.name}/feed`;
      for (let i = 1; writing; i++) {
        await fm.write(`rd:${i}`, writer, { kind: 'say', from: fm.name, to: '*', text: `say ${i}` });
        written.set(writer, i);
        await sleep(100);
      }
    })(),
  );
  const started = Date.now();
  await sleep(redeployAt * 1000);
  const generations = machines.map((fm) => fm.generation);
  console.log(`redeploying at ${redeployAt} s; generations ${generations.join(', ')}; written ${JSON.stringify(Object.fromEntries(written))}`);
  const redeployStart = Date.now();
  // When each connection was cut and came back, relative to the redeploy's start.
  const cuts: string[] = [];
  const cut = (what: string) => {
    cuts.push(what);
    console.log(`cut: ${what} (load ${loadavg().map((l) => Math.round(l)).join('/')})`);
  };
  const last = machines.map((fm) => fm.generation);
  let socketSeen = socket;
  const watch = setInterval(() => {
    machines.forEach((fm, i) => {
      if (fm.generation !== last[i]) cut(`${fm.name} on generation ${(last[i] = fm.generation)} at +${((Date.now() - redeployStart) / 1000).toFixed(1)} s`);
    });
    if (socket !== socketSeen && socket) {
      cut(`the browser reopened at +${((Date.now() - redeployStart) / 1000).toFixed(1)} s`);
      socketSeen = socket;
    }
  }, 250);
  // Durable Objects restart for new code, not for the same code redeployed or new variables (M5: neither cut a stream
  // in minutes), so this redeploy is a new version of the code, as a real one is: its build's name is new.
  const before = (await owner.fetch('/api/me')).headers.get('X-Desk-Build');
  await deployHub(config, secrets, { assets: values.assets as string | undefined, web: values.web as string | undefined, buildSuffix: `redeploy@${new Date().toISOString()}`, quiet: true });
  const after = await until(async () => {
    const build = (await owner.fetch('/api/me')).headers.get('X-Desk-Build');
    return build !== before ? build : undefined;
  }, 'the new build answering', 60_000);
  console.log(`the new build answers: "${after}" (was "${before}")`);
  console.log(`redeployed in ${((Date.now() - redeployStart) / 1000).toFixed(1)} s`);
  await sleep(Math.max(0, seconds * 1000 - (Date.now() - started)));
  writing = false;
  await Promise.all([...writers, browserLoop]);
  clearInterval(watch);
  console.log(`connections cut and back: ${cuts.join('; ') || 'none'}`);
  const humans = acked + unacked.size;
  console.log(`writing stopped: ${JSON.stringify(Object.fromEntries(written))}, ${humans} humans (${unacked.size} unacknowledged yet)`);

  // Settling: the machines' mirrors and the browser reach every writer's last seq.
  const deadline = Date.now() + 90_000;
  const expected = (): Record<string, number> => ({ ...Object.fromEntries(written), [`hub/${me.member.id}`]: humans });
  const complete = (vector: Record<string, number>) => Object.entries(expected()).every(([w, n]) => vector[w] === n);
  const browserVector = () => {
    const v: Record<string, number> = {};
    for (const e of received.values()) v[e.writer] = Math.max(v[e.writer] ?? 0, e.seq);
    return v;
  };
  while (Date.now() < deadline && !(unacked.size === 0 && machines.every((fm) => complete(fm.vector())) && complete(browserVector()))) {
    if (socket?.closed || !socket) await openBrowser();
    else for (const event of unacked.values()) socket.send({ t: 'human', event });
    await sleep(1000);
  }

  // The verdict, from a browser that resumes from 0: each writer's seqs exactly 1..N, once each, offsets distinct and rising.
  const fresh = await owner.socket(`/api/projects/${project}/socket`);
  fresh.send({ t: 'resume', after: 0 });
  await fresh.next((f) => f.t === 'caught-up', 'caught-up', 30_000);
  const all = fresh.frames.flatMap((f) => (f.frame.t === 'log' ? (f.frame.events as Array<{ offset: number; event: LogEvent }>) : []));
  fresh.close();
  socket?.close();
  const problems: string[] = [];
  const offsets = all.map((e) => e.offset);
  if (new Set(offsets).size !== offsets.length || offsets.some((o, i) => i > 0 && o <= offsets[i - 1])) problems.push('offsets repeat or fall');
  const byWriter = new Map<string, number[]>();
  for (const { event } of all) byWriter.set(event.writer, [...(byWriter.get(event.writer) ?? []), event.seq]);
  for (const [writer, n] of Object.entries(expected())) {
    const seqs = byWriter.get(writer) ?? [];
    if (seqs.length !== n || seqs.some((s, i) => s !== i + 1)) problems.push(`${writer}: ${seqs.length} events for ${n} written`);
  }
  for (const writer of byWriter.keys()) if (!(writer in expected())) problems.push(`an unexpected writer ${writer}`);
  for (const fm of machines) {
    if (!complete(fm.vector())) problems.push(`${fm.name} holds ${JSON.stringify(fm.vector())}`);
    if (fm.refusals.length) problems.push(`${fm.name} was refused: ${JSON.stringify(fm.refusals.slice(0, 3))}`);
    if (fm.rejected.length) problems.push(`${fm.name} rejected: ${JSON.stringify(fm.rejected.slice(0, 3))}`);
  }
  if (!complete(browserVector())) problems.push(`the live browser holds ${JSON.stringify(browserVector())}`);
  // The proof needs the redeploy to have cut the machines' streams; one that cut nothing proved nothing.
  machines.forEach((fm, i) => {
    if (fm.generation === generations[i]) problems.push(`the redeploy never cut ${fm.name}'s stream (still generation ${fm.generation}): not exercised`);
  });
  console.log(
    `${all.length} events on the hub: ${[...byWriter].map(([w, s]) => `${w} ${s.length}`).join(', ')}; generations after ${machines.map((fm) => fm.generation).join(', ')}; ` +
      `the browser reopened ${browserReopens} time(s); post errors ${machines.map((fm) => fm.postErrors.length).join(', ')}`,
  );

  for (const fm of machines) {
    const kinds = [...new Set(fm.postErrors.map((e) => e.message.slice(0, 120)))];
    if (kinds.length) console.log(`${fm.name}'s refused POSTs (${fm.postErrors.length}): ${kinds.slice(0, 3).join(' | ')}`);
  }
  for (const fm of machines) await fm.close();
  for (const name of names) console.log(`revoked ${name}: ${(await owner.fetch(`/api/machines/${name}`, { method: 'DELETE' })).status}`);
  if (problems.length) {
    console.log(`FAIL\n  ${problems.join('\n  ')}`);
    return 1;
  }
  console.log('PASS: nothing lost, nothing duplicated across the redeploy');
  return 0;
}
