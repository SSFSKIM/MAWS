// The app's Project socket (OX8), `/api/projects/<id>/socket`: the project's log plane, as DX3 gives it to a browser —
// `welcome`, then the log from an offset (`resume`), paged (`more`) until `caught-up`, then live — and a device's own
// words: a v2 `human` (RL8), signed by the device's channel key under the org and the project, carrying its `nonce`
// for resend dedupe instead of DX1's `mac` (O11 M5). The hub gives it its position (`hub/<member>`, seq, ts) and answers
// `human-ack`, or `refused` naming the nonce.
import { base64urlEncode } from '../src/base64url.ts';
import { signEvent } from '../src/events.ts';
import type { Sig, SigningKey } from '../src/keys.ts';
import { JsonSocket, openSocket, socketUrl, type Frame, type Headers } from './socket.ts';

export const projectSocketPath = (project: string) => `/api/projects/${project}/socket`;

/** A device's `human` before the hub positions it. */
export type DeviceHuman = { kind: 'human'; from: 'human'; member: string; to: '*'; text: string; created: string; nonce: string; sig: Sig };
export type HumanAck = { t: 'human-ack'; nonce: string; offset: number; writer: string; seq: number };
export type HumanRefused = { t: 'refused'; refusal: { reason: string; nonce?: string; message?: string } };
export type LoggedEvent = { offset: number; event: Record<string, unknown> & { writer: string; seq: number } };

/** `text` from `member`'s device to everyone in `project`, signed by the device's channel key. */
export function deviceHuman(ctx: { org: string; project: string }, member: string, key: SigningKey, text: string): Promise<DeviceHuman> {
  const draft = { kind: 'human' as const, from: 'human' as const, member, to: '*' as const, text, created: new Date().toISOString(), nonce: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))) };
  return signEvent(ctx, draft, key.privateKey, key.pub);
}

export class ProjectSocket extends JsonSocket {
  /** The log received, in offset order as the hub sent it. */
  readonly log: LoggedEvent[] = [];
  /** The highest offset the hub said this socket is caught up to. */
  caughtUp: number | null = null;

  /** Opens the socket and resolves once the project welcomes it (`readyMs` at most, the upgrade included; a socket that
   * times out is closed). */
  static async open(base: string, headers: Headers, project: string, readyMs = 10_000): Promise<ProjectSocket> {
    const deadline = Date.now() + readyMs;
    const socket = new ProjectSocket(await openSocket(socketUrl(base, projectSocketPath(project)), headers, `project ${project}`, readyMs));
    await socket.untilReady((f) => f.t === 'welcome', 'welcome', deadline - Date.now());
    return socket;
  }

  protected override received(frame: Frame): void {
    super.received(frame);
    if (frame.t === 'log') this.log.push(...(frame.events as LoggedEvent[]));
    if (frame.t === 'more') this.send({ t: 'resume', after: frame.offset });
    if (frame.t === 'caught-up') this.caughtUp = frame.offset as number;
  }

  /** The log from `after` on, every page followed, until the hub says caught up. */
  async catchUp(after = 0): Promise<number> {
    const from = this.frames.length;
    this.send({ t: 'resume', after });
    const done = await this.next((f) => f.t === 'caught-up', 'caught-up', from, 60_000);
    return done.offset as number;
  }

  /** Sends a device's `human` and resolves with the hub's answer to its nonce. */
  async say(event: DeviceHuman): Promise<HumanAck | HumanRefused> {
    const from = this.frames.length;
    this.send({ t: 'human', event });
    const answer = await this.next(
      (f) => (f.t === 'human-ack' && f.nonce === event.nonce) || (f.t === 'refused' && (f.refusal as { nonce?: string }).nonce === event.nonce),
      `the answer to ${event.nonce}`,
      from,
    );
    return answer as unknown as HumanAck | HumanRefused;
  }
}
