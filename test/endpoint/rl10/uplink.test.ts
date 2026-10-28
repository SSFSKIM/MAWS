// The log plane's uploads against a hub that stops reading (O10, the carriers' bound after M8): sminos's `events` go up
// RL1 only while the hub link's socket is under its soft cap, and the endpoint stops reading RL10 past its read-ahead,
// so the back-pressure reaches sminos, whose lane holds the rest. Once the hub reads again every upload reaches it, in
// order, none lost or doubled.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSigningKey, keyId, type Certificates } from 'org-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { HubLink } from '../../../src/endpoint/hub-link';
import { EndpointPolicy } from '../../../src/endpoint/policy';
import { Rl10 } from '../../../src/endpoint/rl10/link';
import { READ_AHEAD_BYTES } from '../../../src/endpoint/rl10/server';
import type { SendLimits } from '../../../src/endpoint/send-buffer';
import { EndpointState } from '../../../src/endpoint/state/store';
import { FakeHub, until } from '../fake-hub';
import { genesis, memberId, newDevice, successor } from '../org-fixtures';
import { FakeSminos } from './fake-sminos';

const ORG = 'org-uplink';
const P = '7d2b9c40-1f3e-4a6b-8c5d-9e0f1a2b3c4d';
const NAME = 'host';
const REF = 'q4Hc2Wv9Kp0Lm8Tr1Xy7Za';
const NO_CERTS: Certificates = { certs: [], retirements: [] };

const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

describe('the log plane’s uploads, against a hub that stops reading', () => {
  it('stop at the hub link’s soft cap and stop sminos’s socket past the read-ahead, then all go up in order once the hub reads', async () => {
    const limits: SendLimits = { soft: 256 * 1024, hard: 4 * 1024 * 1024 };
    const a1 = await newDevice('a1');
    const machine = await generateSigningKey();
    const A = memberId();
    let head = await genesis(ORG, A, a1, await generateSigningKey());
    head = await successor(head, [a1], (s) => {
      s.machines.push({ name: NAME, ref: REF, pub: machine.pub, owners: [A] });
      s.machineNames.push({ name: NAME, ref: REF });
    });
    const kid = await keyId(machine.pub);

    const hub = await new FakeHub().start();
    closers.push(() => hub.close());
    hub.heartbeatMs = 60_000;
    const link = new HubLink({ target: () => ({ hub: hub.url, credentials: { clientId: 'id', clientSecret: 'secret' }, ref: REF }), build: 'uplink', log: () => {}, sendLimits: limits });
    closers.push(() => link.stop());
    link.start();
    await until(() => link.connected, 'the welcome');

    const dir = fs.mkdtempSync(join(tmpdir(), 'rl10u-'));
    fs.chmodSync(dir, 0o700);
    closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const state = EndpointState.open(dir);
    /** Uploads sent up, the most the hub link's socket held right after one, and whether an upload found it full. */
    let up = 0;
    let peak = 0;
    let held = false;
    const rl10 = new Rl10({
      stateDir: () => dir,
      build: 'uplink',
      state: () => state,
      head: () => ({ state: head.state, certificates: NO_CERTS }),
      identity: () => ({ org: ORG, hub: hub.url, name: NAME, ref: REF, enrolled: '2026-10-27T18:00:00.000Z' }),
      key: () => ({ key: machine, keyId: kid }),
      policy: new EndpointPolicy(() => state),
      hub: {
        openProject: (project, handler) => link.openProject(project, handler),
        send: (frame) => {
          const sent = link.send(frame as Parameters<HubLink['send']>[0]);
          if (frame.t === 'events') up++;
          peak = Math.max(peak, link.buffered);
          return sent;
        },
        writable: () => {
          if (link.buffered >= limits.soft) held = true;
          return link.writable();
        },
      },
      listings: { report: async () => {}, gone: async () => {}, refresh: async () => {}, listedSessions: () => [] },
      notifier: { pendingSet: () => {}, hostMessage: () => {}, forget: () => {} },
      machineOwners: async () => [],
      dispatch: () => Promise.reject(new Error('none')),
      now: Date.now,
      log: () => {},
    });
    await rl10.serve();
    closers.push(() => rl10.unserve());
    const info = JSON.parse(fs.readFileSync(join(dir, 'rl10.json'), 'utf8')) as { socket: string; token: string };
    const sminos = await FakeSminos.open(info.socket);
    closers.push(() => sminos.close());
    sminos.send({ t: 'hello', protocol: { major: 1, minor: 0 }, capabilities: [], token: info.token, sminos: { version: 'uplink' }, policy: { read_only: false, ceiling: 'settings' } });
    await sminos.next((f) => f.t === 'welcome', 'the welcome');
    sminos.send({ t: 'hello', project: P, name: 'maws', have: {} });
    await until(() => hub.frames('hello').some((r) => r.frame.project === P), 'the project’s hello at the hub');

    // The hub stops reading; sminos uploads 24 MiB, frames of 4 events of 64 KiB (its batch is 256 KiB).
    hub.current.pause();
    const frames = 96;
    const perFrame = 4;
    const text = 'u'.repeat(64 * 1024);
    const frame = (f: number) => ({
      t: 'events',
      project: P,
      events: Array.from({ length: perFrame }, (_, i) => ({ ts: '2026-10-27T18:02:11.482Z', writer: `${NAME}/human`, seq: f * perFrame + i + 1, kind: 'human', from: 'human', to: '*', text })),
    });
    const frameBytes = Buffer.byteLength(JSON.stringify(frame(0))) + 1;
    /** Frames the endpoint's socket took, each written once the last was (sminos's lane). */
    let taken = 0;
    const sending = (async () => {
      for (let f = 0; f < frames; f++) {
        await sminos.write(frame(f));
        taken++;
      }
    })();
    // Held: an upload found the hub link's socket full, and the endpoint then stopped reading sminos (its lane takes no
    // more frames).
    await until(() => held, 'an upload held', 15_000);
    let last = -1;
    let still = 0;
    await until(() => {
      still = taken === last ? still + 1 : 0;
      last = taken;
      return still >= 5;
    }, 'sminos’s lane stopped', 15_000);
    expect(up).toBeLessThan(frames);
    // The endpoint took what went up and its read-ahead (with a read and the kernel's socket buffers past it), no more.
    expect(taken * frameBytes).toBeLessThanOrEqual(up * frameBytes + READ_AHEAD_BYTES + 1024 * 1024);

    hub.current.resume();
    const seqs = () => hub.frames('events').flatMap((r) => (r.frame.events as Array<{ seq: number }>).map((e) => e.seq));
    await until(() => seqs().length === frames * perFrame, 'every upload at the hub', 15_000);
    expect(seqs()).toEqual(Array.from({ length: frames * perFrame }, (_, i) => i + 1));
    await sending;
    // The hub link's socket held its soft cap and about an upload past it (signed, a little larger), the whole burst through.
    expect(peak).toBeLessThanOrEqual(limits.soft + 2 * frameBytes);
  });
});
