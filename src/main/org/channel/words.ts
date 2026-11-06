// The owner's words in a project's channel (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's
// *Words*; P5 Decision Log 75 (7)): v2 only. The draft `{kind: 'human', from: 'human', member, to, text, created,
// nonce}` is signed once with this device's channel key under the org and the project (`signEvent`, as RL2's handshake
// signs with it through the protocol package), carries no `mac`, and goes over the project's socket. ECDSA is
// randomized, so a resend reuses the stored signature: every word not yet answered is sent again, the same bytes, at
// each welcome, and the hub dedupes by the nonce. A `human-ack` makes it `sent`, kept until the word itself is in the
// log (so a tab reads the ack from main, however the changes it is told were coalesced); a `refused` keeps it, with the
// hub's reason, and it is sent no more.
//
// Main is the one source of a word's state (Task 2's fix round 2). Each word stays bound to the org, member and device
// that signed it: `pending` shows only the signed-in signer's words (none signed out), and a word is sent only while its
// signer is the one signed in. Another signer's words are kept as they are, neither sent nor refused, and show again
// when their signer is back. A word whose signing outlives a change of signer is sent nowhere.
//
// The words live in main's memory, nothing on disk. At the channel's release (`release`) a word acknowledged is done
// (the log has it) and dropped; one never acknowledged goes to the not-sent list (`NotSent`, the newest NOT_SENT_KEPT of
// the run, every project's), from which its signer's next open of the project takes it (`recall`), shown `not-sent` for
// that channel's life and dropped at its release. A not-sent word is never sent again; the log holding it ends it, heard
// by any channel of the project (the list's copy too: another member may hold the channel when it arrives), or held
// already at the recall (Task 2's fix round 3).
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

/** Why a word isn't said: the signer changed while it was being signed. */
export const CONTEXT_CHANGED = 'context-changed';

/** A word its channel let go unacknowledged, for its signer's next open of the project. */
export type UnsentWord = { project: string; org: string; context: string; member: string; nonce: string; text: string; to: ChannelRecipients };

/** How many unacknowledged words the run keeps, every project's and signer's, the newest. */
export const NOT_SENT_KEPT = 50;

/** The run's not-sent list, one for every channel. */
export interface NotSent {
  put(word: UnsentWord): void;
  /** The project's words that signer let go, taken: none are kept after. */
  take(project: string, context: string): UnsentWord[];
  /** The org's log holds the member's word: it was delivered. */
  retire(project: string, org: string, member: string, nonce: string): void;
}

export function createNotSent(kept = NOT_SENT_KEPT): NotSent {
  let list: UnsentWord[] = [];
  return {
    put(word) {
      list = [...list, word].slice(-kept);
    },
    take(project, context) {
      const mine = (w: UnsentWord) => w.project === project && w.context === context;
      const taken = list.filter(mine);
      list = list.filter((w) => !mine(w));
      return taken;
    },
    retire(project, org, member, nonce) {
      list = list.filter((w) => !(w.project === project && w.org === org && w.member === member && w.nonce === nonce));
    },
  };
}

export interface Words {
  /** Signs `text` for `to`, keeps it, and sends it now if the socket can take it. */
  say(text: string, to: ChannelRecipients): Promise<SaidResult>;
  /** At each welcome: every word not yet answered that the signer in now signed, the same signed bytes. */
  resend(): void;
  /**
   * At each open and change of the session: the not-sent words the signed-in signer let go here before, `not-sent`, but
   * none the project's log already holds (`inLog`, by nonce and member).
   */
  recall(inLog: (nonce: string, member: string) => boolean): void;
  /** The channel is released: the acknowledged dropped, the rest not sent (`NotSent`). */
  release(): void;
  answered(answer: HumanAck | HumanRefused): void;
  /** Logged events, the signed-in org's: a word of this member's that the log now holds needs no answer, nor any copy the not-sent list keeps. */
  logged(events: readonly LoggedEvent[]): void;
  /** The signed-in signer's words, in the order said; none signed out. */
  pending(): ChannelWord[];
  onChanged(listener: () => void): () => void;
}

/** A hub refusal's reason as the renderer may show it: the hub's grammar, else `unrecognized`. */
const REASON = /^[a-z][a-z0-9-]{0,39}$/;

export function createWords(deps: {
  project: string;
  signer(): WordsSigner | null;
  send(human: DeviceHuman): boolean;
  notSent: NotSent;
  now?(): number;
}): Words {
  const now = deps.now ?? Date.now;
  /** By nonce, in the order said (a recalled word: in the order taken). The signed bytes while it may be sent. */
  type Word = { nonce: string; text: string; to: ChannelRecipients; org: string; member: string; context: string; state: ChannelWord['state']; human: DeviceHuman | null };
  const words = new Map<string, Word>();
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
      words.set(nonce, { nonce, text, to, org: signer.org, member: signer.member, context, state: 'sending', human });
      deps.send(human);
      changed();
      return { ok: true, nonce };
    },
    resend() {
      const signedIn = current();
      for (const { human, context, state } of words.values()) if (state === 'sending' && context === signedIn && human !== null) deps.send(human);
    },
    recall(inLog) {
      const signedIn = current();
      if (signedIn === null) return;
      let any = false;
      for (const { nonce, text, to, org, member, context } of deps.notSent.take(deps.project, signedIn)) {
        if (words.has(nonce) || inLog(nonce, member)) continue;
        words.set(nonce, { nonce, text, to, org, member, context, state: 'not-sent', human: null });
        any = true;
      }
      if (any) changed();
    },
    release() {
      for (const { nonce, text, to, org, member, context, state } of words.values()) {
        if (state === 'sent' || state === 'not-sent') continue; // delivered; or shown not sent for this channel's life
        deps.notSent.put({ project: deps.project, org, context, member, nonce, text, to });
      }
      words.clear();
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
      const org = deps.signer()?.org ?? null;
      let any = false;
      for (const { event } of events) {
        if (!isHubWriter(event.writer) || typeof event.nonce !== 'string' || typeof event.member !== 'string') continue;
        if (org !== null) deps.notSent.retire(deps.project, org, event.member, event.nonce);
        const word = words.get(event.nonce);
        if (word === undefined || word.member !== event.member) continue;
        words.delete(event.nonce);
        any = true;
      }
      if (any) changed();
    },
    pending() {
      const signedIn = current();
      return [...words.values()].filter((w) => w.context === signedIn).map(({ nonce, text, to, state }) => ({ nonce, text, to, state }));
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
