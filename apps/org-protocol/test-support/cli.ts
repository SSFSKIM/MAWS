// The reference client against a deployed hub (O11 M7, acceptance 6):
//
//   printf 'DESK_ACCESS_TOKEN=%s\n' "$(cloudflared access token -app=<hub url>)" \
//     | node --experimental-strip-types apps/org-protocol/test-support/cli.ts --hub <url> \
//         [--project <uuid>] [--machine <name or ref>] [--device-file <file>] [--push-endpoint <https url>] [--frames <n>]
//
// The token (Access's app token, U9's route) comes on stdin, never in an argument or the environment, and is never
// printed. `--device-file` names a JSON file `{"id": "<device id>", "channel": <the device's private channel JWK>}`
// (keep it 0600): with it the run signs a v2 `human` into the project and binds a push subscription to that device.
// Prints one line per step and exits 0 when none failed.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { importSigningKey } from '../src/keys.ts';
import { referenceCheck, type CheckOptions } from './check.ts';
import { accessTokenHeaders } from './hub-client.ts';

export const USAGE = 'usage: printf "DESK_ACCESS_TOKEN=%s\\n" "$token" | cli.ts --hub <url> [--project <uuid>] [--machine <name|ref>] [--device-file <file>] [--push-endpoint <https url>] [--frames <n>]';

/** The run's options from its arguments and stdin; throws with the usage, never echoing what stdin held. */
export async function cliOptions(argv: string[], stdin: string, readFile: (path: string) => string = (path) => readFileSync(path, 'utf8')): Promise<CheckOptions> {
  const { values } = parseArgs({
    args: argv,
    options: {
      hub: { type: 'string' },
      project: { type: 'string' },
      machine: { type: 'string' },
      'device-file': { type: 'string' },
      'push-endpoint': { type: 'string' },
      frames: { type: 'string' },
    },
    strict: true,
  });
  if (!values.hub || !/^https?:\/\//.test(values.hub)) throw new Error(`--hub <url> is required\n${USAGE}`);
  const token = /^DESK_ACCESS_TOKEN=(\S+)\s*$/m.exec(stdin)?.[1];
  if (!token) throw new Error(`no DESK_ACCESS_TOKEN=… line on stdin\n${USAGE}`);
  const frames = values.frames === undefined ? undefined : Number(values.frames);
  if (frames !== undefined && !(Number.isSafeInteger(frames) && frames >= 1)) throw new Error('--frames is a positive integer');
  let device: CheckOptions['device'];
  if (values['device-file'] !== undefined) {
    const file = JSON.parse(readFile(values['device-file'])) as { id?: unknown; channel?: JsonWebKey };
    if (typeof file.id !== 'string' || typeof file.channel !== 'object') throw new Error('--device-file holds {"id": "<device id>", "channel": <private JWK>}');
    device = { id: file.id, key: await importSigningKey(file.channel) };
  }
  return {
    hub: values.hub,
    headers: accessTokenHeaders(token),
    ...(values.project === undefined ? {} : { project: values.project }),
    ...(values.machine === undefined ? {} : { machine: values.machine }),
    ...(device === undefined ? {} : { device }),
    ...(values['push-endpoint'] === undefined ? {} : { pushEndpoint: values['push-endpoint'] }),
    ...(frames === undefined ? {} : { frames }),
  };
}

/** Runs the check with what the process was given; the exit code. */
export async function main(argv: string[], stdin: string, print: (text: string) => void): Promise<number> {
  let options: CheckOptions;
  try {
    options = await cliOptions(argv, stdin);
  } catch (error) {
    print((error as Error).message);
    return 2;
  }
  const result = await referenceCheck(options, (l) => print(`${l.status.toUpperCase()} ${l.step}: ${l.detail}`));
  print(result.ok ? 'reference client: PASS' : 'reference client: FAIL');
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const stdin = readFileSync(0, 'utf8');
  process.exitCode = await main(process.argv.slice(2), stdin, (text) => console.log(text));
}
