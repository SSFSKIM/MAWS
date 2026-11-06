// The owner's words in a project's channel (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's
// *Words*; P5 Decision Log 75 (7)): v2 only. The draft `{kind: 'human', from: 'human', member, to, text, created,
// nonce}` is signed once with this device's channel key under the org and the project (`signEvent`, as RL2's handshake
// signs with it through the protocol package), carries no `mac`, and goes over the project's socket. ECDSA is
// randomized, so a resend reuses the stored signature: every word not yet answered is sent again, the same bytes, at
// each welcome, and the hub dedupes by the nonce. A `human-ack` makes it `sent`, kept until the word itself is in the
// log (so a tab reads the ack from main, however the changes it is told were coalesced); a `refused` keeps it, with the
// hub's reason, and it is sent no more.
//
// The words live in main's memory: words still unanswered when the channel is released are dropped, never sent later.
// Nothing is signed or sent while signed out. Each word belongs to the org, member and device that signed it: it is sent
// only while that signer is the one signed in, and once another signs in (`reconcile`) it is refused `context-changed`
// and sent no more; a sign-out alone keeps it. A word whose signing outlives a change of signer is sent nowhere.
//
// Electron-free.
import { base64urlEncode, isHubWriter, signEvent, type SigningKey } from '../../../../apps/org-protocol/src/index.ts';
import type { ChannelRecipients, ChannelWord } from '@shared/ipc/schema/org';
import type { DeviceHuman, HumanAck, HumanRefused, LoggedEvent } from './project-socket';

/** Who signs: the signed-in org, member, this device and its channel key; null signed out. */
export type WordsSigner = { org: string; member: string; device: string; key: SigningKey };
export type SaidResult = { ok: true; nonce: string } | { ok: false; reason: 'signed-out' | 'empty' | 'context-changed' };

/** The signer a word belongs to. */
const contextOf = (signer: WordsSigner): string => JSON.stringify([signer.org, signer.member, signer.device]);

/** The refusal a word gets when another signer signs in. */
export const CONTEXT_CHANGED = 'context-changed';

export interface Words {
  /** Signs `text` for `to`, keeps it, and sends it now if the socket can take it. */
  say(text: string, to: ChannelRecipients): Promise<SaidResult>;
  /** At each welcome: every word not yet answered that the signer in now signed, the same signed bytes. */
  resend(): void;
  /** At each change of the session: words another signer signed are refused `context-changed`. */
  reconcile(): void;
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
  const words = new Map<string, { human: DeviceHuman; context: string; state: ChannelWord['state'] }>();
  const current = (): string | null => {
    const signer = deps.signer();
    return signer === null ? null : contextOf(signer);
  };
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
      const context = contextOf(signer);
      const human: DeviceHuman = await signEvent({ org: signer.org, project: deps.project }, draft, signer.key.privateKey, signer.key.pub);
      const after = current(); // the signer in once the signature is made
      if (after === null) return { ok: false, reason: 'signed-out' };
      if (after !== context) return { ok: false, reason: CONTEXT_CHANGED };
      words.set(nonce, { human, context, state: 'sending' });
      deps.send(human);
      changed();
      return { ok: true, nonce };
    },
    resend() {
      const signedIn = current();
      for (const { human, context, state } of words.values()) if (state === 'sending' && context === signedIn) deps.send(human);
    },
    reconcile() {
      const signedIn = current();
      if (signedIn === null) return;
      let any = false;
      for (const word of words.values()) {
        if (word.state !== 'sending' || word.context === signedIn) continue;
        word.state = { refused: CONTEXT_CHANGED };
        any = true;
      }
      if (any) changed();
    },
    answered(answer) {
      const nonce = answer.t === 'human-ack' ? answer.nonce : answer.refusal.nonce;
      const word = words.get(nonce);
      if (word === undefined || word.state !== 'sending') return;
      if (answer.t === 'human-ack') word.state = 'sent';
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
