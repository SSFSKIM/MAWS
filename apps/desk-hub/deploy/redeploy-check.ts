// `deployment redeploy-check`: DC3.G2 against the deployment — a redeploy in the middle of a sync loses and duplicates
// nothing. Two fake machines (M4's, reconnecting by themselves as the daemon does) each write an event to their own feed
// every 100 ms, and a browser writes a web `human` every second, while the hub is redeployed with new code. Cloudflare
// cuts the objects' connections about five minutes after such a deploy (M5 measured +314 to +329 s), so the writing
// lasts 420 s by default. When the writing stops, both machines and a fresh browser resume from 0 must hold exactly the
// events written, each writer's seqs 1..N once, with distinct rising offsets, and the redeploy must have cut each
// machine's stream (otherwise the run proved nothing and fails "not exercised").
//
// Beside them runs RL1's leg (O11 M8, rl1-reconnect.ts; acceptance 3's deploy clause): a v2 machine, listed in the
// throwaway org's state by an admin device (a genesis first when the org has none), holds RL1 through its endpoint, and
// an app holds a channel to it. A socket the redeploy drops must come back, the endpoint under a higher generation and
// the app through a new channel; it reports when each dropped and how long each took. Whether the redeploy cuts RL1
// within the window is Cloudflare's (phase B saw it in one run of three), so once the writing stops the leg cuts both
// sockets from the client's end, twice in a row, and each time both must come back (`rl1: forced cut <n>: …`). Those
// prove the reconnect, not the deploy's cut: only a run whose redeploy cut both RL1 sockets, both back, and whose forced
// cuts came back is a PASS; one whose redeploy left an RL1 socket uncut, all else passing, ends `INCONCLUSIVE: deploy
// cut: not exercised …` with status 3 (REDEPLOY_INCONCLUSIVE).
//
// stdin (deploy.ts, readSecrets): DESK_ACCESS_TOKEN (the owner's Access app token), CF_ACCESS_SETUP_TOKEN and
// CF_DESK_HUB_SERVICE_TOKENS (the redeploy is `deployment deploy`'s own). Options: --test-org (required, the throwaway
// org the deployment serves and is redeployed under, proof.ts), --org-name, --assets and --web as `deploy` takes them,
// --seconds (the writing's length, default 420), --redeploy-at (default 15) and --device-keys (the admin device's keys
// file, org-admin.ts; without it a device made for the run signs the throwaway org's genesis, which needs an org with no
// state yet). It revokes the machines however it ends, a SIGINT or SIGTERM included, and takes the v2 one out of the org
// state.
// The redeploy is `deployHub`'s own, so it acts on `--config`'s Worker alone, under the same target check as `deploy`;
// and since the leg writes org state, the run is refused before anything else on any Worker but a staging one
// (config.ts, checkTestTarget): never production.
import { randomUUID } from 'node:crypto';
import { loadavg } from 'node:os';
import { FakeMachine } from '../fake-machine/machine';
import { importOrgKey, newNonce, seal } from '../src/protocol/codes';
import type { HumanDraft, LogEvent } from '../src/protocol/log';
import { join } from 'node:path';
import { checkTestHub, readDeployConfig } from './config';
import { deployArgs, deployHub, readSecrets, type DeployOptions } from './deploy';
import { enroll, LogFollower, newOrgKey, Person, sleep, STOP_WAIT_MS } from './hub';
import { loadAdminDevice, newAdminDevice, OrgAdmin, type AdminDevice } from './org-admin';
import { Cleanup, interruptible, isTestTarget, revoke, servesOrg, TEST_ORG_OPTION, testOrgArg } from './proof';
import { Rl1Watch } from './rl1-reconnect';

async function until<T>(read: () => Promise<T | undefined>, what: string, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await sleep(1000);
  }
}

/** The status of a run that lost nothing and whose forced cuts came back, but whose redeploy left an RL1 socket uncut:
 * not a PASS (acceptance 3 is the deploy's cut), not a FAIL. */
export const REDEPLOY_INCONCLUSIVE = 3;

export async function main(argv: string[]): Promise<number> {
  const { config, values } = deployArgs(argv, {
    seconds: { type: 'string', default: '420' },
    'redeploy-at': { type: 'string', default: '15' },
    'device-keys': { type: 'string' },
    ...TEST_ORG_OPTION,
  });
  if (!isTestTarget(config)) return 2;
  const org = testOrgArg(values['test-org'] as string | undefined, readDeployConfig((values.config as string | undefined) ?? join(process.env.DESK_HUB_APP!, 'deploy', 'config.json')).org.id);
  if (!org) return 2;
  // The redeploy keeps the deployment on the throwaway org it serves.
  config.org = { id: org, name: (values['org-name'] as string | undefined) ?? org };
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN || !secrets.CF_ACCESS_SETUP_TOKEN || !secrets.CF_DESK_HUB_SERVICE_TOKENS) {
    console.error('DESK_ACCESS_TOKEN, CF_ACCESS_SETUP_TOKEN, and CF_DESK_HUB_SERVICE_TOKENS on stdin');
    return 2;
  }
  const cleanup = new Cleanup();
  const owner = new Person(`https://${config.host}`, secrets.DESK_ACCESS_TOKEN, () => cleanup.check());
  if (!(await servesOrg(owner, org))) return 2;
  const device = values['device-keys'] ? await loadAdminDevice(values['device-keys'] as string) : await newAdminDevice();
  // Durable Objects restart for new code, not for the same code redeployed or new variables (M5: neither cut a stream
  // in minutes), so this redeploy is a new version of the code, as a real one is: its build's name is new.
  const redeploy = async () => {
    const before = (await owner.fetch('/api/me')).headers.get('X-Desk-Build');
    const options: DeployOptions = { assets: values.assets as string | undefined, web: values.web as string | undefined, quiet: true };
    await deployHub(config, secrets, { ...options, buildSuffix: `redeploy@${new Date().toISOString()}` });
    const after = await until(async () => {
      const build = (await owner.fetch('/api/me')).headers.get('X-Desk-Build');
      return build !== before ? build : undefined;
    }, 'the new build answering', 60_000);
    console.log(`the new build answers: "${after}" (was "${before}")`);
  };
  // However it ends, a SIGINT or SIGTERM included (proof.ts), the machines are revoked and the v2 one leaves the state.
  return interruptible(
    cleanup,
    () => redeployCheck(owner, org, values, cleanup, redeploy, device),
    async (status) => ((await cleanup.run()).length ? 1 : status),
  );
}

/**
 * The check against the deployment `owner` reaches, serving the throwaway `org`: `redeploy` puts new code on it and
 * resolves once the new build answers (main's is `deployHub`'s; the suites restart the local runtime). Everything it
 * makes is undone through `cleanup`, which the caller runs.
 */
export async function redeployCheck(
  owner: Person,
  org: string,
  values: Record<string, string | boolean | undefined>,
  cleanup: Cleanup,
  redeploy: () => Promise<void>,
  device: AdminDevice,
): Promise<number> {
  // Its RL1 leg writes org state: a staging hub, never production, checked before the first enrollment.
  checkTestHub(owner.hub, 'enroll machines and write org state');
  const hub = owner.hub;
  const me = await owner.json<{ org: { id: string }; member: { id: string } }>('/api/me');
  const tag = Math.random().toString(36).slice(2, 7);
  const project = randomUUID();
  const rawKey = newOrgKey();
  const key = await importOrgKey(rawKey);
  const seconds = Number(values.seconds);
  const redeployAt = Number(values['redeploy-at']);

  const names = [`rd-a-${tag}`, `rd-b-${tag}`];
  const machines: FakeMachine[] = [];
  for (const name of names) {
    cleanup.add(`revoke ${name}`, () => revoke(owner, name));
    const credentials = await enroll(owner, name);
    const fm = new FakeMachine({ hub, machine: name, credentials, orgKey: rawKey, project, projectName: `dc3-m5 redeploy ${tag}`, reconnect: true });
    cleanup.add(`close ${name}`, () => fm.close());
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

  // RL1's leg: a v2 machine listed in the throwaway org's state, its endpoint and an app's channel to it.
  const admin = await OrgAdmin.open(owner, { org, throwaway: true }, device);
  const rl1 = await Rl1Watch.start(owner, admin, `rd-ep-${tag}`, cleanup);

  // The browser: follows the log, writes a `human` each second, and on a cut reopens and resumes after the last offset
  // it holds, resending every `human` not acknowledged (the hub answers a known nonce from its record).
  const received = new Map<number, LogEvent>();
  const unacked = new Map<string, LogEvent>();
  let acked = 0;
  let browserReopens = 0;
  const browser = new LogFollower(owner, `/api/projects/${project}/socket`, (s) => {
    s.onFrame = (frame) => {
      if (frame.t === 'log') for (const { offset, event } of frame.events as Array<{ offset: number; event: LogEvent }>) received.set(offset, event);
      if (frame.t === 'human-ack' && unacked.delete(String(frame.nonce))) acked++;
    };
    s.send({ t: 'resume', after: received.size ? Math.max(...received.keys()) : 0 });
    for (const event of unacked.values()) s.send({ t: 'human', event });
  });
  // Registered before the first open: stopping it ends any reconnect still trying, and closes its socket. A connection
  // still opening is waited for no longer than STOP_WAIT_MS from the first stop (the stop-writing step's), so this step
  // holds the revocations after it no longer than that step's bound.
  cleanup.add('stop the browser', () => browser.stop());
  await browser.open();
  let writing = true;
  const running: { watch?: ReturnType<typeof setInterval>; loops: Array<Promise<unknown>> } = { loops: [] };
  // Runs before the browser stops (cleanup runs last first): the writing ends, then its loops settle, a browser loop in
  // a reconnect released by the stop. Bounded, so a loop stuck on the network cannot hold the cleanup.
  cleanup.add('stop writing', async () => {
    writing = false;
    clearInterval(running.watch);
    const stopping = browser.stop();
    await Promise.race([Promise.allSettled([stopping, ...running.loops]), sleep(STOP_WAIT_MS)]);
  });
  const browserLoop = (async () => {
    for (let i = 1; writing; i++) {
      const draft: HumanDraft = { kind: 'human', from: 'human', member: me.member.id, to: '*', text: `human ${i}`, created: new Date().toISOString() };
      const event = (await seal(key, 'log', project, draft, newNonce())) as unknown as LogEvent;
      unacked.set(event.mac.nonce, event);
      const socket = browser.socket;
      if (socket && !socket.closed) socket.send({ t: 'human', event });
      if (socket?.closed) {
        browserReopens++;
        browser.socket = undefined;
        await browser.open();
      }
      await sleep(1000);
    }
  })();
  running.loops.push(browserLoop);

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
  running.loops.push(...writers);
  const started = Date.now();
  await sleep(redeployAt * 1000);
  const generations = machines.map((fm) => fm.generation);
  console.log(`redeploying at ${redeployAt} s; generations ${generations.join(', ')}; written ${JSON.stringify(Object.fromEntries(written))}`);
  const redeployStart = Date.now();
  rl1.mark(redeployStart);
  // When each connection was cut and came back, relative to the redeploy's start.
  const cuts: string[] = [];
  const cut = (what: string) => {
    cuts.push(what);
    console.log(`cut: ${what} (load ${loadavg().map((l) => Math.round(l)).join('/')})`);
  };
  const last = machines.map((fm) => fm.generation);
  let socketSeen = browser.socket;
  running.watch = setInterval(() => {
    machines.forEach((fm, i) => {
      if (fm.generation !== last[i]) cut(`${fm.name} on generation ${(last[i] = fm.generation)} at +${((Date.now() - redeployStart) / 1000).toFixed(1)} s`);
    });
    if (browser.socket !== socketSeen && browser.socket) {
      cut(`the browser reopened at +${((Date.now() - redeployStart) / 1000).toFixed(1)} s`);
      socketSeen = browser.socket;
    }
  }, 250);
  await redeploy();
  console.log(`redeployed in ${((Date.now() - redeployStart) / 1000).toFixed(1)} s`);
  await sleep(Math.max(0, seconds * 1000 - (Date.now() - started)));
  writing = false;
  await Promise.all([...writers, browserLoop]);
  clearInterval(running.watch);
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
    const socket = browser.socket;
    if (socket?.closed || !socket) await browser.open();
    else for (const event of unacked.values()) socket.send({ t: 'human', event });
    await sleep(1000);
  }

  // The verdict, from a browser that resumes from 0: each writer's seqs exactly 1..N, once each, offsets distinct and rising.
  const fresh = await owner.socket(`/api/projects/${project}/socket`);
  cleanup.add('close the verdict browser', async () => fresh.close());
  fresh.send({ t: 'resume', after: 0 });
  await fresh.next((f) => f.t === 'caught-up', 'caught-up', 30_000);
  const all = fresh.frames.flatMap((f) => (f.frame.t === 'log' ? (f.frame.events as Array<{ offset: number; event: LogEvent }>) : []));
  fresh.close();
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
  // RL1: a socket the redeploy dropped must be back, the endpoint under a higher generation, a channel re-opened. A
  // redeploy need not cut RL1 within the window (phase B's runs B and C saw no cut), so the leg then cuts both sockets
  // itself, twice in a row, on the code the redeploy put up: that proves the reconnect, not the deploy's cut, so a
  // redeploy that left an RL1 socket uncut makes the run inconclusive at best (below).
  problems.push(...(await rl1.settle(Date.now() + 60_000, { cutRequired: false })));
  for (const line of rl1.report()) console.log(line);
  const uncut = rl1.uncut();
  problems.push(...(await rl1.forceCuts(2)));
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
  if (problems.length) {
    console.log(`FAIL\n  ${problems.join('\n  ')}`);
    return 1;
  }
  if (uncut.length) {
    const which = uncut.length === 2 ? 'neither RL1 socket' : uncut[0] === 'endpoint' ? "only the app's socket, not the endpoint's" : "only the endpoint's socket, not the app's";
    console.log(`INCONCLUSIVE: deploy cut: not exercised (the redeploy cut ${which}); nothing lost or duplicated, and the leg's own cuts came back`);
    return REDEPLOY_INCONCLUSIVE;
  }
  console.log('PASS: nothing lost, nothing duplicated across the redeploy');
  return 0;
}
