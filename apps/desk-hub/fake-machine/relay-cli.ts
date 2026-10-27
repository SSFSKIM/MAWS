// The fake endpoint's commands (O11 M6), for the staging runs (acceptance 3, M8's measurement):
//   - `enroll-v2` redeems a v2 enrollment code (stdin) as a fresh machine with its own key and ref, and writes a state
//     file (0600) holding its service token and private key;
//   - `endpoint` holds RL1 for that machine until interrupted: it echoes every channel, reconnects under the next
//     generation whenever its socket drops, and opens the projects it is given;
//   - `relay-check` is the app's side: as a member (the Access token on stdin), it opens a channel through the hub to a
//     running endpoint and checks that every frame comes back byte-identical and in order, then that a message over
//     1 MiB is refused.
import { chmodSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generateSigningKey, importSigningKey } from 'org-protocol';
import { FakeEndpoint } from './endpoint';
import { readJsonFile } from './json-file';
import type { Credentials } from './link';
import { enrollV2 } from './org';
import { echoCheck, echoPayloads, RelayApp } from './relay-app';

/** A v2 machine's state file: its hub, name and ref, its service token, and its private key as a JWK. */
type V2State = { hub: string; org: string; machine: string; ref: string; enrollment: string; credentials: Credentials; key: JsonWebKey };

const USAGE = `usage:
  fake-machine enroll-v2 --state <file> [--name <machine>]
      reads a v2 enrollment code (smns-enroll-v2.…) on stdin, enrolls a fresh machine with its own key and ref, and
      writes the state file (0600); a member's device then signs the machine into the org state
  fake-machine endpoint --state <file> [--project <uuid> [--name <project name>]]
      holds RL1 until Ctrl-C: echoes every channel, reconnects under a higher generation when the socket drops
  fake-machine relay-check --hub <url> --machine <ref or name> [--frames <n>]
      DESK_ACCESS_TOKEN=<a member's Access token> on stdin; with an endpoint running, sends <n> frames (default 1000)
      of 1 B to 256 KiB through a channel and checks they come back byte-identical and in order, then that a message
      over 1 MiB closes the socket 1009`;

function writeState(path: string, state: V2State): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

async function stdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function relayMain(command: 'enroll-v2' | 'endpoint' | 'relay-check', argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { state: { type: 'string' }, name: { type: 'string' }, project: { type: 'string' }, hub: { type: 'string' }, machine: { type: 'string' }, frames: { type: 'string', default: '1000' } },
  });
  if (command === 'enroll-v2') {
    if (!values.state) return usage();
    const code = (await stdin()).trim();
    const key = await generateSigningKey(true);
    const machine = await enrollV2(code, values.name, { key });
    const jwk = (await crypto.subtle.exportKey('jwk', key.privateKey)) as JsonWebKey;
    writeState(values.state, { hub: machine.hub, org: machine.org, machine: machine.name, ref: machine.ref, enrollment: machine.enrollment, credentials: machine.credentials, key: jwk });
    console.log(`enrolled ${machine.name} (ref ${machine.ref}) at ${machine.hub}; its key and ref await a member's device (enrollment ${machine.enrollment}); state in ${values.state}`);
    return 0;
  }
  if (command === 'endpoint') {
    if (!values.state || !existsSync(values.state)) return usage();
    const state = readJsonFile<V2State>(values.state, "a v2 machine's state");
    await importSigningKey(state.key);
    const endpoint = new FakeEndpoint({ hub: state.hub, credentials: state.credentials, ref: state.ref, reconnect: true, log: (line) => console.log(`${new Date().toISOString()} ${state.machine} ${line}`) });
    const stop = () => {
      endpoint.close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    await endpoint.connect();
    if (values.project) {
      const have = await endpoint.project(values.project, values.name ?? `fake endpoint ${state.machine}`);
      console.log(`opened project ${values.project} (${Object.keys(have.have).length} writers held)`);
    }
    console.log('echoing every channel until Ctrl-C');
    await new Promise(() => {});
    return 0;
  }
  if (!values.hub || !values.machine) return usage();
  const token = /^DESK_ACCESS_TOKEN=(.+)$/m.exec(await stdin())?.[1]?.trim() ?? process.env.DESK_ACCESS_TOKEN;
  if (!token) {
    console.error('DESK_ACCESS_TOKEN on stdin');
    return 2;
  }
  const headers = { 'cf-access-token': token };
  const app = await RelayApp.open(values.hub, values.machine, headers);
  const count = Number(values.frames);
  try {
    const checked = await echoCheck(app, echoPayloads(count));
    console.log(`PASS ${checked.frames} frames (${checked.bytes} B) came back byte-identical and in order on channel ${checked.channel}, in ${checked.ms} ms`);
    const channel = await app.openChannel();
    app.send(channel, new Uint8Array(1024 * 1024));
    await app.until(() => app.ended, 'the close of the socket');
    const refused = app.ended?.code === 1009;
    console.log(`${refused ? 'PASS' : 'FAIL'} a message over 1 MiB closed the socket ${app.ended?.code} ${app.ended?.reason}`);
    return refused ? 0 : 1;
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    app.close();
    return 1;
  }
}

function usage(): number {
  console.error(USAGE);
  return 2;
}
