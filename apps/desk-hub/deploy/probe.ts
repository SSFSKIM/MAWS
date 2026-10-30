// `deployment probe`: DC3.G4's acceptance against the deployed hub, through Access as its parties meet it.
//
// The admission probe's five cases (the DC3 plan, M5):
//   1. a signed-in browser's WebSocket upgrades to a Project and to the Registry;
//   2. a freshly minted machine token is admitted;
//   3. a token minted but never enrolled is refused by the Worker (Access admits it);
//   4. an unauthenticated request is refused by Access (it never reaches the Worker);
//   5. the redeem path is reachable without Access.
// And enrollment: a service token issued and a name claimed, and a name already enrolled refused. (The archive
// designation told at a machine's next hello was told on DX2's stream, which left the hub in O14 M5b; the local suites
// keep the designation, and a v1 machine opens no project any more.)
//
// Credentials as NAME=value lines on stdin (deploy.ts, readSecrets): DESK_ACCESS_TOKEN, the owner's Access app token
// (`cloudflared access token -app=<hub>`), and CF_DESK_HUB_SERVICE_TOKENS, to mint the never-enrolled token of case 3
// (deleted after). It runs only in the throwaway org `--test-org` names, while the deployment serves it (proof.ts),
// and revokes what it enrolled and deletes what it minted however it ends, failing if any of that fails.
//
// `--rpc` runs one case alone instead (O14 B4 step 3): an `rpc` frame on a project socket opened with the owner's
// token is answered `refused retired`. It writes nothing (the frame names nothing a hub could forward or keep), so it
// runs in the deployment's own org, and it needs DESK_ACCESS_TOKEN alone.
//
// `--retired` runs the owner-token half of the same step's route checks: `POST /api/org/keys` and
// `DELETE /api/org/keys/x` answer the Worker's own 404 under the deployed build (the one the credential-free
// `POST /machine/enroll` names, or `--build`), and `GET /api/org/keys` answers `410 retired` or the list. Each request
// carries no body, so a hub before M5b refuses it (the POST a bad shape, the DELETE not the key's holder) and keeps
// nothing: it too runs in the deployment's own org on DESK_ACCESS_TOKEN alone. The machine-token half (DX2's two
// routes) is a recipe in deploy/README.md.
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { newNonce } from '../src/protocol/codes';
import { machineProjectId, ORG_KEYS_PATH, type MachineRecord, type MachineSelf, type ProjectRecord } from '../src/protocol/identity';
import { readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { enroll, Person, redeem, serviceTokenApi, sleep } from './hub';
import { Cleanup, revoke, servesOrg, TEST_ORG_OPTION, testOrgArg } from './proof';

type Case = { id: string; what: string; run: () => Promise<string> };

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { config: { type: 'string', default: join(process.env.DESK_HUB_APP!, 'deploy', 'config.json') }, rpc: { type: 'boolean' }, retired: { type: 'boolean' }, build: { type: 'string' }, ...TEST_ORG_OPTION } });
  const config = readDeployConfig(values.config!);
  if (values.rpc) return rpcMain(`https://${config.host}`, config.org.id);
  if (values.retired) return retiredMain(`https://${config.host}`, config.org.id, values.build);
  const org = testOrgArg(values['test-org'], config.org.id);
  if (!org) return 2;
  const hub = `https://${config.host}`;
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN || !secrets.CF_DESK_HUB_SERVICE_TOKENS) {
    console.error('DESK_ACCESS_TOKEN and CF_DESK_HUB_SERVICE_TOKENS on stdin (deploy/README.md)');
    return 2;
  }
  const owner = new Person(hub, secrets.DESK_ACCESS_TOKEN);
  const api = serviceTokenApi(secrets.CF_DESK_HUB_SERVICE_TOKENS, config.account);
  const tag = Math.random().toString(36).slice(2, 7);
  const machine = `probe-${tag}`;
  // The machine's own project, registered when its first request confirms its enrollment (A2): the project A1 opens.
  const project = machineProjectId(org, machine);
  if (!(await servesOrg(owner, org))) return 2;
  const cleanup = new Cleanup();

  const cases: Case[] = [
    {
      id: 'A4',
      what: 'an unauthenticated request is refused by Access',
      async run() {
        const person = await fetch(`${hub}/api/me`, { redirect: 'manual' });
        const login = person.headers.get('location') ?? '';
        if (person.status !== 302 || !login.includes('.cloudflareaccess.com/cdn-cgi/access/login/')) throw new Error(`a person: ${person.status} ${login}`);
        const bogus = await fetch(`${hub}/machine/enrollment`, { headers: { 'CF-Access-Client-Id': 'nobody.access', 'CF-Access-Client-Secret': 'x' } });
        const body = await bogus.text();
        // Access answers with its own HTML page; the Worker answers JSON only.
        if (bogus.status !== 401 || !body.includes('Cloudflare Access')) throw new Error(`a bogus service token: ${bogus.status} ${body.slice(0, 120)}`);
        return 'a person is sent to the team login (302); a bogus service token is answered 401 by Access, not the Worker';
      },
    },
    {
      id: 'A5',
      what: 'the redeem path is reachable without Access',
      async run() {
        const response = await redeem(hub, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', machine);
        const body = await response.text();
        if (response.status !== 404 || !body.includes('unknown-token')) throw new Error(`${response.status} ${body}`);
        return `POST /machine/enroll with no credentials reaches the Worker: ${response.status} ${body}`;
      },
    },
    {
      id: 'A2',
      what: 'a freshly minted machine token is admitted (enrollment issues it and claims the name)',
      async run() {
        cleanup.add(`revoke ${machine}`, () => revoke(owner, machine));
        const credentials = await enroll(owner, machine);
        const self = await admitted(hub, credentials);
        const record = (await owner.json<{ machines: MachineRecord[] }>('/api/machines')).machines.find((m) => m.name === machine);
        if (record?.state !== 'active' || record.client_id !== credentials.clientId) throw new Error(`the record: ${JSON.stringify(record)}`);
        return `${machine} redeemed, its own request admitted (org ${self.org}, confirmed ${self.confirmed}), its record active under client id ${credentials.clientId}`;
      },
    },
    {
      id: 'E2',
      what: 'a name already enrolled is refused',
      async run() {
        const response = await redeem(hub, await owner.enrollmentToken(), machine.toUpperCase());
        const body = await response.text();
        if (response.status !== 409 || !body.includes('name-taken')) throw new Error(`${response.status} ${body}`);
        return `redeeming a fresh token for ${machine.toUpperCase()}: ${response.status} ${body}`;
      },
    },
    {
      id: 'A3',
      what: 'a token minted but never enrolled is refused by the Worker',
      async run() {
        // Deleted by name, so a token whose create answer was lost is found too.
        const name = `desk-probe-unenrolled-${tag}`;
        cleanup.add(`delete the never-enrolled token ${name}`, async () => {
          for (const token of await api.named(name)) await api.delete(token.id);
          if ((await api.named(name)).length) throw new Error('still listed');
        });
        const token = await api.create(name);
        const credentials = { clientId: token.client_id, clientSecret: token.client_secret };
        // Access admits any service token of the account once the new one reaches its edge (a 401 until then).
        const deadline = Date.now() + 60_000;
        for (;;) {
          const response = await fetch(`${hub}/machine/enrollment`, { headers: { 'CF-Access-Client-Id': credentials.clientId, 'CF-Access-Client-Secret': credentials.clientSecret } });
          const body = await response.text();
          if (response.status === 403 && body.includes('not-enrolled')) return `Access admitted it and the Worker answered ${response.status} ${body}`;
          if (response.status !== 401 || Date.now() > deadline) throw new Error(`${response.status} ${body.slice(0, 200)}`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      },
    },
    {
      id: 'A1',
      what: "a signed-in browser's WebSocket upgrades to a Project and to the Registry",
      run: () => browserCase(owner, project, cleanup),
    },
  ];

  let failed = 0;
  console.log(`probing ${hub} (org ${org})`);
  try {
    for (const c of cases) {
      try {
        console.log(`PASS ${c.id} ${c.what}\n     ${await c.run()}`);
      } catch (error) {
        failed++;
        console.log(`FAIL ${c.id} ${c.what}\n     ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    if ((await cleanup.run()).length) failed++;
    const left = (await api.named(`desk-${org}-${machine}`).catch(() => [{}])).length;
    console.log(`service tokens left under desk-${org}-${machine}: ${left}`);
    if (left) failed++;
  }
  return failed ? 1 : 0;
}

/** `--rpc`: the one case, against the deployment's own org; 0 when it passes, 1 when not, 2 without the token. */
async function rpcMain(hub: string, org: string): Promise<number> {
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin (deploy/README.md)');
    return 2;
  }
  const what = 'an rpc frame on a project socket is answered refused retired';
  console.log(`probing ${hub} (org ${org})`);
  try {
    console.log(`PASS R1 ${what}\n     ${await rpcCase(new Person(hub, secrets.DESK_ACCESS_TOKEN))}`);
    return 0;
  } catch (error) {
    console.log(`FAIL R1 ${what}\n     ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * Case R1: a DX6 `rpc` frame on the socket of one of the org's projects, answered `refused {reason: 'retired'}` with
 * its nonce. The frame carries a nonce alone: a hub before M5b answers it a bad shape and keeps nothing, so the probe
 * fails there without writing, as it writes nothing where it passes. The socket is closed however it ends.
 */
export async function rpcCase(owner: Pick<Person, 'json' | 'socket'>, ms = 15_000): Promise<string> {
  const { projects } = await owner.json<{ projects: Array<Pick<ProjectRecord, 'id' | 'retired'>> }>('/api/projects');
  const project = projects.find((p) => !p.retired);
  if (!project) throw new Error('the org has no project open to a socket');
  const socket = await owner.socket(`/api/projects/${project.id}/socket`);
  try {
    await socket.next((f) => f.t === 'welcome', 'welcome', ms);
    const nonce = newNonce();
    socket.send({ t: 'rpc', rpc: { nonce } });
    const mine = (f: { t: string } & Record<string, unknown>) =>
      (f.t === 'refused' && (f.refusal as { nonce?: unknown } | undefined)?.nonce === nonce) || ((f.t === 'rpc-state' || f.t === 'rpc-ack') && f.nonce === nonce);
    const answer = await socket.next(mine, 'answer', ms).catch(() => {
      throw new Error(`no answer to the rpc frame on project ${project.id} within ${ms} ms`);
    });
    const refusal = answer.refusal as { reason?: unknown; message?: unknown } | undefined;
    if (answer.t !== 'refused' || refusal?.reason !== 'retired') throw new Error(`the rpc frame on project ${project.id} was answered ${JSON.stringify(answer)}, not refused retired`);
    return `an rpc frame on project ${project.id}'s socket was answered refused retired: ${String(refusal.message)}`;
  } finally {
    socket.close();
  }
}

/** `--retired`: K1 to K3, against the deployment's own org; 0 when all pass, 1 when one fails, 2 without the token. */
async function retiredMain(hub: string, org: string, build?: string): Promise<number> {
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin (deploy/README.md)');
    return 2;
  }
  let expected: string;
  try {
    expected = build ?? (await deployedBuild(hub));
  } catch (error) {
    console.log(`FAIL the deployed build: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  console.log(`probing ${hub} (org ${org}), build ${expected}`);
  let failed = 0;
  for (const c of retiredCases(new Person(hub, secrets.DESK_ACCESS_TOKEN), expected)) {
    try {
      console.log(`PASS ${c.id} ${c.what}\n     ${await c.run()}`);
    } catch (error) {
      failed++;
      console.log(`FAIL ${c.id} ${c.what}\n     ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failed ? 1 : 0;
}

/** The build the deployment names on the credential-free `POST /machine/enroll` (Access's bypass), as B4's curl reads it. */
export async function deployedBuild(hub: string): Promise<string> {
  const response = await fetch(`${hub}/machine/enroll`, { method: 'POST', redirect: 'manual' });
  await response.body?.cancel();
  const build = response.headers.get('X-Desk-Build');
  if (!build) throw new Error(`POST /machine/enroll answered ${response.status} with no X-Desk-Build`);
  return build;
}

/**
 * Cases K1 to K3, the org key's routes as M5b leaves them, each request bodyless and its method named: the two removed
 * routes answer the Worker's own 404 (`{error: 'not-found'}`) under `build`, and `GET` answers under it too, `410
 * retired` after the purge or the list before it.
 */
export function retiredCases(owner: Pick<Person, 'fetch'>, build: string): Case[] {
  const answered = async (method: string, path: string) => {
    const response = await owner.fetch(path, { method });
    const text = await response.text();
    const named = response.headers.get('X-Desk-Build');
    const said = `${method} ${path} answered ${response.status} ${text.slice(0, 200)}`;
    if (named === null) throw new Error(`${said} with no X-Desk-Build: not the Worker's answer`);
    if (named !== build) throw new Error(`${said} under build ${named}, not ${build}`);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: response.status, body, said };
  };
  const removed = (id: string, method: string, path: string): Case => ({
    id,
    what: `${method} ${path} answers the Worker's 404`,
    async run() {
      const { status, body, said } = await answered(method, path);
      if (status !== 404 || (body as { error?: unknown } | undefined)?.error !== 'not-found') throw new Error(`${said}, not the Worker's 404 not-found`);
      return `${method} ${path} answered 404 not-found under build ${build}`;
    },
  });
  return [
    removed('K1', 'POST', ORG_KEYS_PATH),
    removed('K2', 'DELETE', `${ORG_KEYS_PATH}/x`),
    {
      id: 'K3',
      what: `GET ${ORG_KEYS_PATH} answers 410 retired or the list`,
      async run() {
        const { status, body, said } = await answered('GET', ORG_KEYS_PATH);
        if (status === 410 && (body as { error?: unknown } | undefined)?.error === 'retired') return `GET ${ORG_KEYS_PATH} answered 410 retired under build ${build}`;
        const keys = (body as { keys?: unknown } | undefined)?.keys;
        if (status === 200 && Array.isArray(keys)) return `GET ${ORG_KEYS_PATH} answered the list (${keys.length} wrapped copies) under build ${build}`;
        throw new Error(`${said}: not 410 retired, and not the list`);
      },
    },
  ];
}

/**
 * A machine's own request, `GET /machine/enrollment`, admitted: its record, which the request confirmed. A freshly
 * minted service token takes a few seconds to reach Access's edge, which refuses it (401) meanwhile, so a 401 is tried
 * again for up to `admitMs`.
 */
async function admitted(hub: string, credentials: { clientId: string; clientSecret: string }, admitMs = 60_000): Promise<MachineSelf> {
  const deadline = Date.now() + admitMs;
  for (;;) {
    const response = await fetch(`${hub}/machine/enrollment`, { headers: { 'CF-Access-Client-Id': credentials.clientId, 'CF-Access-Client-Secret': credentials.clientSecret } });
    const text = await response.text();
    if (response.status === 200) return JSON.parse(text) as MachineSelf;
    if (response.status !== 401 || Date.now() > deadline) throw new Error(`its own request: ${response.status} ${text.slice(0, 200)}`);
    await sleep(2000);
  }
}

/** Case A1: the person's WebSockets to the project and to the grid, each registered for cleanup as it opens. */
export async function browserCase(owner: Pick<Person, 'socket'>, project: string, cleanup: Cleanup): Promise<string> {
  const view = await owner.socket(`/api/projects/${project}/socket`);
  cleanup.add('close the project socket', async () => view.close());
  const welcome = await view.next((f) => f.t === 'welcome', 'welcome');
  const grid = await owner.socket('/api/registry/socket');
  cleanup.add('close the grid socket', async () => grid.close());
  const projects = (await grid.next((f) => f.t === 'grid', 'grid')).projects as Array<{ id: string }>;
  view.close();
  grid.close();
  if (welcome.project !== project || !projects.some((p) => p.id === project)) throw new Error(`welcome ${JSON.stringify(welcome)}`);
  return `the project socket welcomed member ${String(welcome.member)}; the grid lists ${projects.length} project(s), the probe's among them`;
}
