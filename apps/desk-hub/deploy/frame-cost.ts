// `deployment frame-cost`: what one up frame costs on the deployment's path from a machine's POST to its project. A
// machine posts batches of N frames that the Project applies and answers nothing to (`pending` with an empty set, after
// the first). The POST's time over N gives the fixed cost of a POST and the cost of each frame. The Machine object hands
// a POST's frames to the Project one Durable Object RPC at a time, so the per-frame slope is that RPC's round trip.
//
// stdin: DESK_ACCESS_TOKEN. Options: --test-org <throwaway org> (required, proof.ts), --sizes 1,5,10,25,50 --rounds 5.
import { randomUUID } from 'node:crypto';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { UpFrame } from '../src/protocol/machine';
import { readDeployConfig } from './config';
import { readSecrets } from './deploy';
import { enroll, machineLink, Person, until } from './hub';
import { Cleanup, revoke, servesOrg, TEST_ORG_OPTION, testOrgArg } from './proof';

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', default: join(process.env.DESK_HUB_APP!, 'deploy', 'config.json') },
      sizes: { type: 'string', default: '1,5,10,25,50' },
      rounds: { type: 'string', default: '5' },
      ...TEST_ORG_OPTION,
    },
  });
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
  const name = `fc-${Math.random().toString(36).slice(2, 7)}`;
  const project = randomUUID();
  const cleanup = new Cleanup();
  let code = 0;
  try {
    cleanup.add(`revoke ${name}`, () => revoke(owner, name));
    const { link, frames } = await machineLink(hub, await enroll(owner, name));
    cleanup.add('drop the stream', () => link.drop());
    await link.post([{ t: 'hello', project, name: 'dc3-m5 frame cost', have: {} }]);
    await until(() => frames.find((f) => f.t === 'have'), 'have');
    const frame: UpFrame = { t: 'pending', project, raised: [] };
    const rows: Array<{ n: number; ms: number[] }> = [];
    for (const n of values.sizes!.split(',').map(Number)) {
      const ms: number[] = [];
      for (let r = 0; r < Number(values.rounds); r++) {
        const at = performance.now();
        await link.post(Array.from({ length: n }, () => frame));
        ms.push(Math.round(performance.now() - at));
      }
      ms.sort((a, b) => a - b);
      rows.push({ n, ms });
      console.log(`${n} frames: POST ${ms.join(', ')} ms (median ${ms[ms.length >> 1]}); load ${loadavg().map((l) => Math.round(l)).join('/')}`);
    }
    // Least squares over the medians: POST ≈ fixed + n × per frame.
    const pts = rows.map((r) => [r.n, r.ms[r.ms.length >> 1]]);
    const mx = pts.reduce((s, [x]) => s + x, 0) / pts.length;
    const my = pts.reduce((s, [, y]) => s + y, 0) / pts.length;
    const slope = pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
    console.log(`per frame ≈ ${slope.toFixed(1)} ms; fixed ≈ ${(my - slope * mx).toFixed(0)} ms per POST`);
  } catch (error) {
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
    code = 1;
  }
  return (await cleanup.run()).length ? 1 : code;
}
