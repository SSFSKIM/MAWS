// The fake machine's command (bin.ts runs it): enroll once with a code from the web app, then replay recordings into a
// project of the hub — the local stand-in's or a deployment's — and stay connected, serving subscriptions and answering
// RPCs, until interrupted. Its state file (0600) holds the machine's service token, the org key, and the memory a
// restart needs (the RPC ledger above all), so a run after a crash answers a retried nonce without running it again.
import { chmodSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { base64urlDecode, base64urlEncode } from '../src/protocol/base64url';
import { readJsonFile } from './json-file';
import { FakeMachine } from './machine';
import { relayMain } from './relay-cli';
import { emptyMemory, type Memory } from './memory';
import type { Credentials } from './link';
import { loadRecording } from './recording';
import type { Producer } from './session';

type State = { hub: string; machine: string; credentials: Credentials; key: string; memory: Memory };

const USAGE = `usage:
  fake-machine enroll-v2 | endpoint | relay-check …   RL1's fake endpoint (O11 M6): run one with no options for its usage
  fake-machine enroll --state <file>
      reads an enrollment code on stdin (the web app's "Enroll a machine"; never an argument, since it carries the org
      key), redeems it at the hub it names, and writes the state file (0600)
  fake-machine run --state <file> --project <uuid> [options]
      replays into the project and stays connected until Ctrl-C
      --name <name>            the project's name, registered at its first hello (default: the recording's)
      --recording <dir>        a recording directory (default: the committed two-subagents); repeatable
      --session <uuid>         the replayed session's id (default: the recorded one); "new" for a fresh one
      --speed <x>              times the recorded pace (default 1; 0 as fast as it goes)
      --loop                   replay again, as a fresh session each round, until interrupted
      --decisions <how>        recorded (default) | wait: hold at a recorded settlement until the web answers
      --member <id>            the member a recorded web answer names (default: the recording's placeholder)
      --read-only              refuse every RPC and deliver nothing from outside
      --follow                 open the project as a follower (hello.follow): no presence; give it no --recording
      --keep-times             log events keep their recorded ts (default: when first written)
      --producer <daemon>      dc3 (default) | dc8: DX4's widened subagents body, jobs, MCP names, and output |
                               m0: dc8 and capabilities, read status, command | m1: pushed catalogs and measured prompt commands |
                               mw1: m1 and the reads of usage, config, settings and MCP, and capabilities.controls |
                               mw2: mw1 and the side question (btw), and compact's instructions |
                               mw3: mw2 and the scoped allows: once played, the MW3 live check's permission requests
                               raised with the engine's suggestions, and decide's scope |
                               mw4: mw3 and one subagent stopped or told: once played, the MW4 live check's named
                               agent (bg-sleeper) running, for stop-agent and tell |
                               mw5: mw4 and image and PDF intake (media): an upload answered queued, each attachment's
                               states following as op
      --plugin <name>          doperpowers (default) | sminos: the plugin its bridge and ask run in (a rolled machine)`;

function readState(path: string): State {
  return readJsonFile<State>(path, "a fake machine's state");
}

function writeState(path: string, state: State): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

export async function main(argv: string[], defaults: { recording: string }): Promise<number> {
  const [command, ...rest] = argv;
  // RL1's commands (O11 M6): a v2 enrollment, the fake endpoint, and an app's echo check through it.
  if (command === 'enroll-v2' || command === 'endpoint' || command === 'relay-check') return relayMain(command, rest);
  const { values } = parseArgs({
    args: rest,
    options: {
      state: { type: 'string' },
      project: { type: 'string' },
      name: { type: 'string' },
      recording: { type: 'string', multiple: true },
      session: { type: 'string' },
      speed: { type: 'string', default: '1' },
      loop: { type: 'boolean', default: false },
      decisions: { type: 'string', default: 'recorded' },
      member: { type: 'string' },
      'read-only': { type: 'boolean', default: false },
      follow: { type: 'boolean', default: false },
      'keep-times': { type: 'boolean', default: false },
      producer: { type: 'string', default: 'dc3' },
      plugin: { type: 'string', default: 'doperpowers' },
    },
  });
  if (!values.state || (command !== 'enroll' && command !== 'run')) {
    console.error(USAGE);
    return 2;
  }
  if (command === 'enroll') {
    if (process.stdin.isTTY) console.error('paste the enrollment code, then Ctrl-D:');
    const redeemed = await FakeMachine.redeem(await stdin());
    writeState(values.state, { hub: redeemed.hub, machine: redeemed.machine, credentials: redeemed.credentials, key: base64urlEncode(redeemed.orgKey), memory: emptyMemory() });
    console.log(`enrolled ${redeemed.machine} at ${redeemed.hub}; state in ${values.state}`);
    return 0;
  }
  if (!values.project || !existsSync(values.state)) {
    console.error(values.project ? `no state file ${values.state}: run enroll first` : USAGE);
    return 2;
  }
  if (values.decisions !== 'recorded' && values.decisions !== 'wait') {
    console.error('--decisions is recorded or wait');
    return 2;
  }
  if (!['dc3', 'dc8', 'm0', 'm1', 'mw1', 'mw2', 'mw3', 'mw4', 'mw5'].includes(values.producer)) {
    console.error('--producer is dc3, dc8, m0, m1, mw1, mw2, mw3, mw4 or mw5');
    return 2;
  }
  if (values.plugin !== 'doperpowers' && values.plugin !== 'sminos') {
    console.error('--plugin is doperpowers or sminos');
    return 2;
  }
  const state = readState(values.state);
  const dirs = values.recording?.length ? values.recording : values.follow ? [] : [defaults.recording];
  const sessionId = (i: number) => (values.session === 'new' ? randomUUID() : i === 0 ? values.session : undefined);
  let round = 0;
  let machine: FakeMachine | null = null;
  const stop = async () => {
    await machine?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  for (;;) {
    const recordings = dirs.map((dir, i) => loadRecording(dir, { session: round === 0 ? sessionId(i) : randomUUID() }));
    machine = new FakeMachine({
      hub: state.hub,
      machine: state.machine,
      credentials: state.credentials,
      orgKey: base64urlDecode(state.key),
      project: values.project,
      projectName: values.name,
      recordings,
      member: values.member,
      memory: state.memory,
      onMemory: (memory) => writeState(values.state!, { ...state, memory }),
      decisions: values.decisions,
      readOnly: values['read-only'],
      follow: values.follow,
      retime: !values['keep-times'],
      reconnect: true,
      producer: values.producer as Producer,
      plugin: values.plugin,
    });
    await machine.connect();
    console.log(`${state.machine} connected to ${state.hub} (generation ${machine.generation}); project ${values.project}`);
    for (const r of recordings) console.log(`  replaying ${r.name} as session ${r.session} (${r.chunks} chunks, ${r.steps.length} steps)`);
    await machine.play({ speed: Number(values.speed) });
    console.log(`  played; ${machine.rpcs.length} RPCs answered so far`);
    if ((values.producer === 'mw4' || values.producer === 'mw5') && round === 0 && recordings.length > 0) {
      const agentId = await machine.spawnRecordedAgent(recordings[0]!.session);
      console.log(`  spawned the MW4 recording's agent bg-sleeper (${agentId}), running`);
    }
    if ((values.producer === 'mw3' || values.producer === 'mw4' || values.producer === 'mw5') && round === 0 && recordings.length > 0) {
      const raised = await machine.raiseRecordedScoped(recordings[0]!.session);
      console.log(`  raised the MW3 recording's requests: ${raised.map((r) => `${r.request} (${r.suggestions?.length ?? 0} suggestions)`).join(', ')}`);
    }
    if (!values.loop) break;
    round++;
    await machine.close();
  }
  console.log('serving subscriptions and RPCs until Ctrl-C');
  await new Promise(() => {});
  return 0;
}
