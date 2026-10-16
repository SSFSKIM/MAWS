// `deployment probe`: DC3.G4's acceptance against the deployed hub, through Access as its parties meet it.
//
// The admission probe's five cases (the DC3 plan, M5):
//   1. a signed-in browser's WebSocket upgrades to a Project and to the Registry;
//   2. a freshly minted machine token is admitted;
//   3. a token minted but never enrolled is refused by the Worker (Access admits it);
//   4. an unauthenticated request is refused by Access (it never reaches the Worker);
//   5. the redeem path is reachable without Access.
// And enrollment: a service token issued and a name claimed, a name already enrolled refused, the project's archive
// machine recorded and told to that machine at its next hello.
//
// Credentials as NAME=value lines on stdin (deploy.ts, readSecrets): DESK_ACCESS_TOKEN, the owner's Access app token
// (`cloudflared access token -app=<hub>`), and CF_DESK_HUB_SERVICE_TOKENS, to mint the never-enrolled token of case 3
// (deleted after). It runs only in the throwaway org `--test-org` names, while the deployment serves it (proof.ts),
// and revokes what it enrolled and deletes what it minted however it ends, failing if any of that fails.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { MachineRecord, ProjectRecord } from '../src/protocol/identity';
import type { DownFrame } from '../src/protocol/machine';
import { readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { enroll, machineLink, Person, redeem, serviceTokenApi, until } from './hub';
import { Cleanup, revoke, servesOrg, TEST_ORG_OPTION, testOrgArg } from './proof';

type Case = { id: string; what: string; run: () => Promise<string> };

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { config: { type: 'string', default: join(process.env.DESK_HUB_APP!, 'deploy', 'config.json') }, ...TEST_ORG_OPTION } });
  const config = readDeployConfig(values.config!);
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
  const project = randomUUID();
  let link: Awaited<ReturnType<typeof machineLink>> | undefined;
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
        const bogus = await fetch(`${hub}/machine/stream`, { headers: { 'CF-Access-Client-Id': 'nobody.access', 'CF-Access-Client-Secret': 'x' } });
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
        link = await machineLink(hub, credentials);
        cleanup.add('drop the stream', () => link!.link.drop());
        const welcome = link.frames.find((f) => f.t === 'welcome') as Extract<DownFrame, { t: 'welcome' }>;
        const record = (await owner.json<{ machines: MachineRecord[] }>('/api/machines')).machines.find((m) => m.name === machine);
        if (record?.state !== 'active' || record.client_id !== credentials.clientId) throw new Error(`the record: ${JSON.stringify(record)}`);
        return `${machine} redeemed, its stream welcomed it (org ${welcome.org}, generation ${welcome.generation}), its record active under client id ${credentials.clientId}`;
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
          const response = await fetch(`${hub}/machine/stream`, { headers: { 'CF-Access-Client-Id': credentials.clientId, 'CF-Access-Client-Secret': credentials.clientSecret } });
          const body = await response.text();
          if (response.status === 403 && body.includes('not-enrolled')) return `Access admitted it and the Worker answered ${response.status} ${body}`;
          if (response.status !== 401 || Date.now() > deadline) throw new Error(`${response.status} ${body.slice(0, 200)}`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      },
    },
    {
      id: 'E3',
      what: "the project's archive machine is recorded and told to that machine",
      async run() {
        if (!link) throw new Error('needs A2');
        const from = link.frames.length;
        await link.link.post([{ t: 'hello', project, name: `dc3-m5 probe ${tag}`, have: {} }]);
        const first = (await until(() => link!.frames.slice(from).find((f) => f.t === 'have' && f.project === project), 'have')) as Extract<DownFrame, { t: 'have' }>;
        const designated = await owner.json<{ project: ProjectRecord }>(`/api/projects/${project}/archive`, { method: 'PUT', body: { machine } });
        const listed = (await owner.json<{ projects: ProjectRecord[] }>('/api/projects')).projects.find((p) => p.id === project);
        const again = link.frames.length;
        await link.link.post([{ t: 'hello', project, name: `dc3-m5 probe ${tag}`, have: {} }]);
        const second = (await until(() => link!.frames.slice(again).find((f) => f.t === 'have' && f.project === project), 'have')) as Extract<DownFrame, { t: 'have' }>;
        if (first.archive || designated.project.archive_machine !== machine || listed?.archive_machine !== machine || !second.archive) {
          throw new Error(`archive: first ${first.archive}, designated ${designated.project.archive_machine}, listed ${listed?.archive_machine}, second ${second.archive}`);
        }
        return `project ${project} registered by the hello; archive_machine ${machine} recorded; have.archive false before, true at the next hello`;
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
