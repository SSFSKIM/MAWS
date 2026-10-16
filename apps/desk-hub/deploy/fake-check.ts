// `deployment fake-check`: DC3.G4's "the fake machine works against the deployment". M4's fake machine is enrolled the
// way the web app enrolls one (an enrollment code built here, so the hub never sees the org key, redeemed by the fake
// machine's own `redeem`), replays the committed recording into a fresh project, and a browser subscribed to the
// session and both subagents must see what M4's local suite sees: every row of each transcript in order with no fault,
// the two requests raised and decided by the web (codes intact), the log's `joined` and `message`, the recorded
// delivery outcomes; and an RPC through the hub answered `done`.
//
// stdin: DESK_ACCESS_TOKEN (the owner's Access app token). It runs only in the throwaway org `--test-org` names, while
// the deployment serves it (proof.ts), and revokes the machine however it ends, failing if that fails.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { FakeMachine, loadRecording } from '../fake-machine';
import { importOrgKey, newNonce, sealRpc, verify } from '../src/protocol/codes';
import type { LogEvent } from '../src/protocol/log';
import type { RpcDraft } from '../src/protocol/rpc';
import type { SessionMessage } from '../src/protocol/session';
import { Dx4Reader } from '../test/support/dx4-reader';
import { readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { enrollmentCode, newOrgKey, Person, sleep, until } from './hub';
import { Cleanup, revoke, servesOrg, TEST_ORG_OPTION, testOrgArg } from './proof';

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { config: { type: 'string', default: join(process.env.DESK_HUB_APP!, 'deploy', 'config.json') }, ...TEST_ORG_OPTION } });
  const config = readDeployConfig(values.config!);
  const org = testOrgArg(values['test-org'], config.org.id);
  if (!org) return 2;
  const secrets = await readSecrets();
  if (!secrets.DESK_ACCESS_TOKEN) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  const hub = `https://${config.host}`;
  const owner = new Person(hub, secrets.DESK_ACCESS_TOKEN);
  if (!(await servesOrg(owner, org))) return 2;
  const cleanup = new Cleanup();
  let code: number;
  try {
    code = await check(owner, hub, cleanup);
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    code = 1;
  }
  return (await cleanup.run()).length ? 1 : code;
}

async function check(owner: Person, hub: string, cleanup: Cleanup): Promise<number> {
  const me = await owner.json<{ org: { id: string }; member: { id: string } }>('/api/me');
  const name = `fake-${Math.random().toString(36).slice(2, 7)}`;
  const project = randomUUID();
  const rawKey = newOrgKey();
  const key = await importOrgKey(rawKey);
  const problems: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
    if (!ok) problems.push(what);
  };

  cleanup.add(`revoke ${name}`, () => revoke(owner, name));
  const code = enrollmentCode(hub, me.org.id, await owner.enrollmentToken(), name, rawKey);
  const redeemed = await FakeMachine.redeem(code);
  // The committed recording, found from the app's directory: this module runs bundled elsewhere.
  const recording = loadRecording(join(process.env.DESK_HUB_APP!, 'fake-machine', 'recordings', 'two-subagents'));
  const fm: FakeMachine = new FakeMachine({ hub, machine: redeemed.machine, credentials: redeemed.credentials, orgKey: redeemed.orgKey, project, projectName: `dc3-m5 fake ${name}`, recordings: [recording], member: me.member.id });
  cleanup.add('close the fake machine', () => fm.close());
  for (let tries = 0; ; tries++) {
    try {
      await fm.connect();
      break;
    } catch (error) {
      if (tries > 30) throw error;
      await sleep(2000);
    }
  }
  console.log(`${name} enrolled from a code and connected (generation ${fm.generation}); project ${project}`);

  const socket = await owner.socket(`/api/projects/${project}/socket`);
  cleanup.add('close the browser', async () => socket.close());
  const readers = new Map<string, Dx4Reader>();
  const sessionMessages = (kind: string) => socket.frames.flatMap((f) => (f.frame.t === 'session' && (f.frame.message as SessionMessage).kind === kind ? [f.frame.message as SessionMessage] : []));
  const ofType = (t: string) => socket.frames.filter((f) => f.frame.t === t).map((f) => f.frame);
  socket.onFrame = (frame) => {
    const message = frame.message as SessionMessage | undefined;
    if (frame.t === 'session' && message?.sub) readers.get(message.sub)?.read(message);
  };
  socket.send({ t: 'resume', after: 0 });
  const subscribe = async (agentId: string | null) => {
    const sub = newNonce();
    const reader = new Dx4Reader(agentId);
    readers.set(sub, reader);
    socket.send({ t: 'subscribe', machine: name, session: recording.session, agentId, sub });
    await until(() => (reader.kinds.length ? true : undefined), 'a snapshot');
    return reader;
  };
  const main = await subscribe(null);
  const agents: Array<[string, Dx4Reader]> = [];
  for (const agentId of Object.keys(recording.rows.agents)) {
    await fm.play({ speed: 0, until: (s) => s.k === 'agent' && s.agentId === agentId });
    agents.push([agentId, await subscribe(agentId)]);
  }
  await fm.play({ speed: 0 });

  const waitFor = (test: () => boolean, what: string) => until(() => (test() ? true : undefined), what, 30_000).catch(() => undefined);
  await waitFor(() => main.rows.length === recording.rows.main.length, 'every main row');
  check(main.faults.length === 0 && JSON.stringify(main.rows.map((r) => r.uuid)) === JSON.stringify(recording.rows.main.map((r) => r.uuid)), `the main transcript: ${main.rows.length}/${recording.rows.main.length} rows in order, faults ${JSON.stringify(main.faults)}`);
  for (const [agentId, reader] of agents) {
    await waitFor(() => reader.rows.length === recording.rows.agents[agentId].length, `${agentId}'s rows`);
    check(reader.faults.length === 0 && JSON.stringify(reader.rows.map((r) => r.uuid)) === JSON.stringify(recording.rows.agents[agentId].map((r) => r.uuid)), `subagent ${agentId}: ${reader.rows.length}/${recording.rows.agents[agentId].length} rows in order`);
  }
  check(main.kinds.includes('chunk') && main.kinds.includes('block-row') && main.kinds.includes('usage'), `the main sub streamed chunks, block-rows, and usage (${new Set(main.kinds).size} kinds)`);

  await waitFor(() => ofType('decided').length === 2, 'both decisions');
  const raised = sessionMessages('raised');
  const decided = ofType('decided').map((f) => f.decision as { settled: { winner: string; outcome: string; by: string } & object });
  const raisedOk = await Promise.all(raised.map((m) => verify(key, 'raised', project, m.body as object)));
  const settledOk = await Promise.all(decided.map((d) => verify(key, 'settled', project, d.settled)));
  check(
    JSON.stringify(raised.map((m) => (m.body as { tool: string }).tool)) === '["Bash","AskUserQuestion"]' && raisedOk.every(Boolean),
    `two requests raised (${raised.map((m) => (m.body as { tool: string }).tool).join(', ')}), codes verify`,
  );
  check(
    JSON.stringify(decided.map((d) => [d.settled.winner, d.settled.outcome, d.settled.by])) === JSON.stringify([['web', 'allow', me.member.id], ['web', 'answered', me.member.id]]) && settledOk.every(Boolean),
    'the audit record decided both from the settlements, the web the winner, codes verify',
  );

  const logged = () => ofType('log').flatMap((f) => (f.events as Array<{ event: LogEvent }>).map((e) => e.event));
  await waitFor(() => logged().some((e) => e.kind === 'message'), 'the message');
  const own = logged().filter((e) => e.writer === `${name}/${recording.session}`);
  const ownOk = await Promise.all(own.map((e) => verify(key, 'log', project, e)));
  check(JSON.stringify(own.map((e) => e.kind)) === '["joined","message"]' && ownOk.every(Boolean), `the log: ${own.map((e) => e.kind).join(', ')} under ${name}'s writer, codes verify`);
  await waitFor(() => sessionMessages('delivery').length === 2, 'the recorded deliveries');
  check(JSON.stringify(sessionMessages('delivery').map((m) => (m.body as { outcome: string }).outcome)) === '["delivered","uncertain"]', 'the recorded delivery outcomes: delivered, uncertain');

  const rpc = await sealRpc(key, { rpc: 'model', project, machine: name, member: me.member.id, created: new Date().toISOString(), nonce: newNonce(), args: { session: recording.session, model: 'sonnet' } } as unknown as RpcDraft);
  socket.send({ t: 'rpc', rpc });
  const answered = (await until(() => ofType('rpc-state').find((f) => f.nonce === rpc.nonce && (f.state === 'done' || f.state === 'failed')), 'the RPC', 15_000).catch(() => undefined)) as { state: string; outcome?: unknown } | undefined;
  check(answered?.state === 'done', `a model RPC through the hub: ${answered?.state ?? 'no answer'} ${JSON.stringify(answered?.outcome ?? null)}`);

  console.log(problems.length ? `FAIL: ${problems.length} check(s)` : 'PASS: the fake machine works against the deployment');
  return problems.length ? 1 : 0;
}
