// The endpoint acceptance run end to end on this machine (P5 O10 M11, part 1's proof): `deployment endpoint-acceptance`'s
// own run (apps/desk-hub/deploy/endpoint-acceptance.ts, its items and verdicts unchanged) against desk-hub's Worker in
// Miniflare, with the built mawsd as its machine (acceptance/local-machine.ts). It is what the staging run is, short
// of what only the VM has: a real sminos and its session (items 4's local spawn and 5's sminos half), and a hub deploy
// (item 2's). Those checks say `skip`, so items 2, 4 and 5 are NOT SHOWN here and every other item PASSes; nothing
// fails, the cleanup leaves nothing, and no line printed holds a secret the run handled. Skipped without a build, as
// M10's process scene is; class 1a builds first.
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runEndpointAcceptance } from '../../apps/desk-hub/deploy/endpoint-acceptance';
import { ITEMS } from '../../apps/desk-hub/deploy/endpoint-items';
import { Secrets } from '../../apps/desk-hub/deploy/endpoint-verdicts';
import { Person } from '../../apps/desk-hub/deploy/hub';
import { newAdminDevice } from '../../apps/desk-hub/deploy/org-admin';
import { Cleanup } from '../../apps/desk-hub/deploy/proof';
import { LocalMachine, writeFakeTailnet } from './acceptance/local-machine';
import { ADMIN, credentials, ORG, startMiniflareHub, type LocalHub } from './miniflare-hub';

const MAWSD = resolve(__dirname, '../../out/main/mawsd.js');
vi.setConfig({ testTimeout: 30 * 60_000, hookTimeout: 120_000 });

/** The owner as the local hub's Access stand-in knows them. */
class LocalPerson extends Person {
  override get headers(): Record<string, string> {
    return credentials(ADMIN);
  }
}

function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });
}

let scratch: string;
let hub: LocalHub;
let stopHub: () => Promise<void>;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-o10m11-'));
  if (!existsSync(MAWSD)) return;
  ({ hub, stop: stopHub } = await startMiniflareHub());
});

afterAll(async () => {
  await stopHub?.();
  rmSync(scratch, { recursive: true, force: true });
});

describe.skipIf(!existsSync(MAWSD))('the endpoint acceptance run on a local mawsd', () => {
  it('passes every item the scene can show, says what it cannot, and leaves nothing', async () => {
    writeFakeTailnet(join(scratch, 'fake-tailnet.cjs'));
    const machine = new LocalMachine({ scratch, mawsd: MAWSD, preload: join(scratch, 'fake-tailnet.cjs'), hub: hub.url, port: await freePort() });
    const scan = join(scratch, 'scan');
    const lines: string[] = [];
    const cleanup = new Cleanup(60_000);
    const status = await runEndpointAcceptance(
      {
        target: 'local',
        person: new LocalPerson(hub.url, 'unused', () => cleanup.check()),
        machine,
        items: ITEMS,
        cleanup,
        secrets: new Secrets(scan),
        print: (line) => {
          lines.push(line);
          // The run's own lines kept where the suite is told to (a passing case prints nothing).
          if (process.env.O10_M11_TRANSCRIPT) appendFileSync(process.env.O10_M11_TRANSCRIPT, `${line}\n`);
        },
        admin: { scope: { org: ORG, throwaway: true }, device: await newAdminDevice('a1') },
        production: null,
        hubDeploy: null,
      },
      { signals: new EventEmitter() },
    );
    const transcript = lines.join('\n');
    expect(lines.filter((line) => line.startsWith('FAIL') || line.startsWith('LEFT')), transcript).toEqual([]);
    const verdicts = lines.filter((line) => /^(PASS|FAIL|NOT SHOWN) /.test(line)).map((line) => line.replace(/:.*/, ''));
    expect(verdicts, transcript).toEqual(['NOT SHOWN 2', 'PASS 3', 'NOT SHOWN 4', 'NOT SHOWN 5', 'PASS 8', 'PASS 9']);
    // What is not shown is what only the VM has.
    const notShown = lines.filter((line) => line.startsWith('NOT SHOWN')).join('\n');
    expect(notShown).toMatch(/NOT SHOWN 2: .*this scene deploys no hub/);
    expect(notShown).toMatch(/NOT SHOWN 4: a local `sminos spawn` .*no real sminos in this scene/);
    expect(notShown).toMatch(/NOT SHOWN 5: .*no real sminos in this scene/);
    expect(lines).toContain('cleanup: the head lists none of the run’s members, devices or machines, the hub holds none of its machines, and the scene on a local scratch mawsd is ended');
    // The run's secrets (the enrollment's token, its pairing secret, the code) reached neither a line nor the daemon's
    // log, and none was ever printed for the scrub to catch.
    const secrets = readFileSync(scan, 'utf8').split('\n').filter(Boolean);
    expect(secrets.length).toBeGreaterThanOrEqual(3);
    for (const secret of secrets) {
      expect(transcript).not.toContain(secret);
      expect(machine.log()).not.toContain(secret);
    }
    expect(transcript).not.toContain('<secret>');
    expect(status, transcript).toBe(1);
  });
});
