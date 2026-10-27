// Acceptance 6 of O11 as one run (docs/doperpowers/plans/2026-10-27-p5-o11-hub-v2.md): the reference client, admitted as
// a member, holds the Registry, Project and Machine sockets at once, and checks what each carries against the hub's own
// routes — the head's version and the listings, the log plane with a device's signed `human`, a channel's frames
// echoed by the machine — and a push subscription bound to the device. The suites run it against the local hub; the
// CLI (cli.ts) against a deployed one.
import { base64urlEncode } from '../src/base64url.ts';
import type { SigningKey } from '../src/keys.ts';
import { HubClient, type PushRecord } from './hub-client.ts';
import { echoCheck, echoPayloads, type RelayApp } from './machine-socket.ts';
import { deviceHuman, type ProjectSocket } from './project-socket.ts';
import type { RegistrySocket } from './registry-socket.ts';
import { until, type Headers } from './socket.ts';

export type CheckOptions = {
  hub: string;
  headers: Headers;
  /** The project whose log plane to join; the first live one `/api/projects` lists when absent. */
  project?: string;
  /** The machine (name or ref) to open a channel to; no Machine socket when absent. */
  machine?: string;
  /** The device whose channel key signs the `human`, and that the push subscription is bound to. */
  device?: { id: string; key: SigningKey };
  /** An https push endpoint: registered bound to the device, read back, then deleted. */
  pushEndpoint?: string;
  /** How many frames the channel echo sends (1 B up to 64 KiB); 16 by default. */
  frames?: number;
};

export type CheckLine = { step: string; status: 'pass' | 'fail' | 'skip'; detail: string };
export type CheckResult = { ok: boolean; member: string | null; lines: CheckLine[] };

const ECHO_MAX = 64 * 1024;

/** A push subscription's keys as a browser makes them: a P-256 point and 16 random bytes, base64url. */
async function subscriptionKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const point = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { p256dh: base64urlEncode(point), auth: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
}

type Closable = { close(): void };

/**
 * Waits for every socket in `opening` (undefined for one not asked for). When any is refused, every one that opened —
 * those that open after the refusal too — is closed, and the first refusal is thrown; else all of them are answered.
 */
export async function openTogether(opening: Array<Promise<Closable> | undefined>): Promise<Array<Closable | undefined>> {
  const settled = await Promise.allSettled(opening.map((socket) => socket ?? Promise.resolve(undefined)));
  const refused = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  const opened = settled.map((s) => (s.status === 'fulfilled' ? s.value : undefined));
  if (refused === undefined) return opened;
  for (const socket of opened) socket?.close();
  throw refused.reason;
}

export async function referenceCheck(options: CheckOptions, log: (line: CheckLine) => void = () => {}): Promise<CheckResult> {
  const lines: CheckLine[] = [];
  const line = (step: string, status: CheckLine['status'], detail: string) => {
    const entry = { step, status, detail };
    lines.push(entry);
    log(entry);
  };
  const attempt = async (step: string, run: () => Promise<string | { skip: string }>) => {
    try {
      const detail = await run();
      if (typeof detail === 'string') line(step, 'pass', detail);
      else line(step, 'skip', detail.skip);
    } catch (error) {
      line(step, 'fail', error instanceof Error ? error.message : String(error));
    }
  };

  const hub = new HubClient(options.hub, options.headers);
  let me: Awaited<ReturnType<HubClient['me']>> | undefined;
  await attempt('admitted', async () => {
    me = await hub.me();
    return `as member ${me.member.id} (${me.member.role}) of ${me.org.id}`;
  });
  if (!me) return { ok: false, member: null, lines };
  const member = me.member.id;
  const org = me.org.id;

  let project = options.project;
  if (project === undefined) {
    const { projects } = await hub.projects();
    project = projects.find((p) => !p.retired)?.id;
  }

  // The three sockets, opened together and held through every step; closed at the end, whatever failed.
  let registry: RegistrySocket | undefined;
  let projectSocket: ProjectSocket | undefined;
  let machine: RelayApp | undefined;
  try {
    await attempt('sockets', async () => {
      const opened = await openTogether([hub.registry(), project === undefined ? undefined : hub.project(project), options.machine === undefined ? undefined : hub.machine(options.machine)]);
      [registry, projectSocket, machine] = opened as [RegistrySocket, ProjectSocket | undefined, RelayApp | undefined];
      return `Registry${projectSocket ? `, Project ${project}` : ''}${machine ? `, Machine ${options.machine}` : ''} open`;
    });
    if (lines.at(-1)?.status === 'fail') return { ok: false, member, lines };

    await attempt('registry', async () => {
      if (!registry) throw new Error('no Registry socket');
      const [{ head }, { listings }] = await Promise.all([hub.orgState(), hub.listings()]);
      const routed = head?.state.version ?? null;
      if (registry.version !== routed) throw new Error(`the socket noticed version ${registry.version}, the route answers ${routed}`);
      if (registry.listings.size !== listings.length) throw new Error(`the socket holds ${registry.listings.size} listings, the route ${listings.length}`);
      return `head version ${routed ?? 'none'}, ${listings.length} listing(s), as the routes answer`;
    });

    await attempt('project', async () => {
      if (project === undefined) return { skip: 'no project to join' };
      if (!projectSocket) throw new Error('no Project socket');
      const offset = await projectSocket.catchUp();
      if (!options.device) return `log caught up at offset ${offset}; no device key, so no signed human`;
      const words = await deviceHuman({ org, project }, member, options.device.key, `reference client ${new Date().toISOString()}`);
      const answer = await projectSocket.say(words);
      if (answer.t !== 'human-ack') throw new Error(`the device's human was refused: ${answer.refusal.reason} ${answer.refusal.message ?? ''}`);
      if (answer.writer !== `hub/${member}`) throw new Error(`stored under ${answer.writer}`);
      await until(() => (projectSocket!.log.some((e) => e.offset === answer.offset) ? true : undefined), 'the human back on the log');
      return `log caught up at offset ${offset}; the device's signed human stored at offset ${answer.offset} as ${answer.writer}#${answer.seq}`;
    });

    await attempt('machine', async () => {
      if (options.machine === undefined) return { skip: 'no machine named' };
      if (!machine) throw new Error('no Machine socket');
      const presence = await machine.until(() => machine!.presence.at(-1), 'presence');
      if (!presence.online) return { skip: `${options.machine}'s endpoint is offline; the socket is held, no channel tried` };
      const echoed = await echoCheck(machine, echoPayloads(options.frames ?? 16, ECHO_MAX));
      return `${echoed.frames} frames (${echoed.bytes} B) echoed byte-identical in order on channel ${echoed.channel}, ${echoed.ms} ms`;
    });

    await attempt('push', async () => {
      if (!options.device || options.pushEndpoint === undefined) return { skip: 'no device or push endpoint named' };
      const endpoint = options.pushEndpoint;
      const { subscription } = await hub.registerPush({ endpoint, keys: await subscriptionKeys(), device: options.device.id });
      try {
        const { subscriptions } = await hub.pushSubscriptions();
        const held: PushRecord | undefined = subscriptions.find((s) => s.endpoint === endpoint);
        if (held?.device !== options.device.id) throw new Error(`the subscription reads back bound to ${held?.device ?? 'no device'}`);
        return `a subscription bound to device ${subscription.device} kept and read back`;
      } finally {
        await hub.deletePush(endpoint);
      }
    });

    await attempt('held', async () => {
      const sockets: Array<[string, { ended?: { code: number } } | undefined]> = [
        ['Registry', registry],
        ['Project', projectSocket],
        ['Machine', machine],
      ];
      const ended = sockets.flatMap(([name, socket]) => (socket?.ended ? [`${name} (${socket.ended.code})`] : []));
      if (ended.length > 0) throw new Error(`closed during the run: ${ended.join(', ')}`);
      return `every socket held to the end as member ${member}`;
    });
  } finally {
    registry?.close();
    projectSocket?.close();
    machine?.close();
  }
  return { ok: lines.every((l) => l.status !== 'fail'), member, lines };
}
