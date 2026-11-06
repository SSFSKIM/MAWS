// The owner's words in a project's channel (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's
// *Words*; P5 Decision Log 75 (7)): v2 only. The draft `{kind: 'human', from: 'human', member, to, text, created,
// nonce}` is signed once with this device's channel key under the org and the project (`signEvent`, as RL2's handshake
// signs with it through the protocol package), carries no `mac`, and goes over the project's socket. ECDSA is
// randomized, so a resend reuses the stored signature: every word not yet answered is sent again, the same bytes, at
// each welcome, and the hub dedupes by the nonce. A `human-ack` (or the word itself in the log) ends it; a `refused`
// keeps it, with the hub's reason, and it is sent no more.
//
// The words live in main's memory: words still unanswered when the channel is released are dropped, never sent later.
// Nothing is signed or sent while signed out.
//
// Electron-free.
import { base64urlEncode, isHubWriter, signEvent, type SigningKey } from '../../../../apps/org-protocol/src/index.ts';
import type { ChannelRecipients, ChannelWord } from '@shared/ipc/schema/org';
import type { DeviceHuman, HumanAck, HumanRefused, LoggedEvent } from './project-socket';

/** Who signs: the signed-in org, member and this device's channel key; null signed out. */
export type WordsSigner = { org: string; member: string; key: SigningKey };
export type SaidResult = { ok: true; nonce: string } | { ok: false; reason: 'signed-out' | 'empty' };

export interface Words {
  /** Signs `text` for `to`, keeps it, and sends it now if the socket can take it. */
  say(text: string, to: ChannelRecipients): Promise<SaidResult>;
  /** At each welcome: every word not yet answered, the same signed bytes. */
  resend(): void;
  answered(answer: HumanAck | HumanRefused): void;
  /** Logged events: a word of this member's that the log now holds needs no answer. */
  logged(events: readonly LoggedEvent[]): void;
  pending(): ChannelWord[];
  onChanged(listener: () => void): () => void;
}

/** A hub refusal's reason as the renderer may show it: the hub's grammar, else `unrecognized`. */
const REASON = /^[a-z][a-z0-9-]{0,39}$/;

export function createWords(deps: {
  project: string;
  signer(): WordsSigner | null;
  send(human: DeviceHuman): boolean;
  now?(): number;
}): Words {
  const now = deps.now ?? Date.now;
  /** By nonce, in the order said. */
  const words = new Map<string, { human: DeviceHuman; state: ChannelWord['state'] }>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };

  return {
    async say(text, to) {
      if (text.trim() === '') return { ok: false, reason: 'empty' };
      const signer = deps.signer();
      if (signer === null) return { ok: false, reason: 'signed-out' };
      const nonce = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
      const draft = { kind: 'human' as const, from: 'human' as const, member: signer.member, to, text, created: new Date(now()).toISOString(), nonce };
      const human = (await signEvent({ org: signer.org, project: deps.project }, draft, signer.key.privateKey, signer.key.pub)) as DeviceHuman;
      words.set(nonce, { human, state: 'sending' });
      deps.send(human);
      changed();
      return { ok: true, nonce };
    },
    resend() {
      for (const { human, state } of words.values()) if (state === 'sending') deps.send(human);
    },
    answered(answer) {
      const nonce = answer.t === 'human-ack' ? answer.nonce : answer.refusal.nonce;
      const word = words.get(nonce);
      if (word === undefined || word.state !== 'sending') return;
      if (answer.t === 'human-ack') words.delete(nonce);
      else word.state = { refused: REASON.test(answer.refusal.reason) ? answer.refusal.reason : 'unrecognized' };
      changed();
    },
    logged(events) {
      let any = false;
      for (const { event } of events) {
        if (!isHubWriter(event.writer) || typeof event.nonce !== 'string') continue;
        const word = words.get(event.nonce);
        if (word === undefined || word.human.member !== event.member) continue;
        words.delete(event.nonce);
        any = true;
      }
      if (any) changed();
    },
    pending: () => [...words.values()].map(({ human, state }) => ({ nonce: human.nonce, text: human.text, to: human.to, state })),
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
