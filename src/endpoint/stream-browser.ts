// The `browser.screencast` read open's plane (P5 O17 M9a; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M9,
// Interfaces §G, §K; O7's Interfaces §N): one viewer of one agent tab on a lane B session, over `mawsd`'s feed seam
// (`EndpointServices.browser`). streams.ts admits the open by its stream row (`browser.screencast`, `view` on the session,
// `approve` for a controlling one: by-effect.ts) before this runs, from a device that listed `rl2.browser-screencast`.
//
// A controlling open also names its grant (`browser.control.op`): a done `machine.browserControl` act in the endpoint's own
// ledger, read without a tombstone, of this channel's member and device, whose result is the open's `{appSessionId,
// epoch}`; else `grade` (`unknown` for an op the ledger holds nothing of). Control is the caller's to decide, never the
// device's boolean: the subscription is opened with `control` only on that grant and the decision at `approve`. Then the
// feed's `open` (its refusals mapped by browser-words.ts: another epoch `engine-changed`, a tab it doesn't hold `unknown`,
// a second controller `control-busy`, …); the stream is published in the step its decision is found to stand, answering
// `streamOpened {browser: {epoch, tabId, control}}`. A frame the producer sends before then is held and sent after the
// answer (the producer sends one at a time, so one is all there can be).
//
// Frames go as screencast.ts' envelope under the device's byte credit, the next frame only after the device's `ack`
// (frame credit spans the whole path: nothing here refunds it). What waits past the credit is bounded by one frame plus
// 4 KiB (SCREENCAST_BACKLOG_BYTES, in place of a pty's backlog): a device that acknowledges frames it never took is closed
// `behind`. The device sends no data (`malformed`); its controls are `{ack: {seq}}` and, on a controlling stream only,
// `{input: {seq, event}}`, each input passed on in order once the stream's decision stands (a re-check holds it; past the
// feed's 32 waiting here, `input-overflow`). An input the feed finds out of shape (a point off the viewport the producer
// moved meanwhile) is dropped and logged; any other refusal of it is the subscription's end, which closes the stream.
//
// The end. The producer's (a closed tab, an engine change, a frame past the bound, …) closes the stream with its word
// hyphenated (browser-words.ts; one this build doesn't know `producer-failed`, logged). The stream's own end, by its
// device, its channel or a re-check, closes the subscription, which releases the keys and buttons a controller held. A
// controlling stream whose re-check refuses `approve` is decided again read-only (`lesser`): it closes `control-revoked`
// when `view` stands, `removed` when nothing does; the device reopens with a new stream.
import { encodeScreencastFrame, readScreencastControl, SCREENCAST_BACKLOG_BYTES, ScreencastError, type StreamBrowserOpen, type StreamControlMessage } from 'org-protocol';
import { BROWSER_LIMITS, type BrowserFeed, type BrowserFrame, type BrowserSubscription } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import { closeWord, isBrowserWord, refusalWord } from './browser-words';
import { browserGrantOf } from './endpoint-actions';
import { Stream, type LedgerRead, type ReadAccess, type ReadOpening, type ReadPlane } from './stream-base';

export type BrowserPlaneDeps = {
  /** The feed seam's subscriptions (`EndpointServices.browser.open`). */
  browser: Pick<BrowserFeed, 'open'>;
  /** The endpoint's own ledger, read for a controlling open's grant. */
  ledger(op: string): LedgerRead;
};

/** A refusal's word, read by its `reason` (the feed's BrowserRefused may be another chunk's class), else `producer_failed`. */
const wordOf = (error: unknown): string => {
  const reason = typeof error === 'object' && error !== null ? (error as { reason?: unknown }).reason : undefined;
  return typeof reason === 'string' ? reason : 'producer_failed';
};

export function browserPlane(deps: BrowserPlaneDeps): ReadPlane {
  return async (opening) => {
    const { appSessionId, epoch, tabId, control: grant } = opening.input as StreamBrowserOpen;
    const control = grant !== undefined;
    if (grant !== undefined) {
      const read = deps.ledger(grant.op);
      if (read.kind === 'refused') return opening.refuse(read.reason);
      const granted = read.name === 'machine.browserControl' ? browserGrantOf(read.outcome) : null;
      const ours = read.member === opening.binding.member && read.device === opening.binding.device;
      if (!ours || granted?.appSessionId !== appSessionId || granted.epoch !== epoch) return opening.refuse('grade');
    }
    const early = new HeldSink();
    let subscription: BrowserSubscription;
    try {
      subscription = await deps.browser.open({ appSessionId: appSessionId as AppSessionId, epoch, tabId, control }, early);
    } catch (error) {
      const word = wordOf(error);
      if (!isBrowserWord(word)) opening.log(`endpoint: a screencast open was refused with a word this build does not know (${word}): ${(error as Error).message}`);
      return opening.refuse(refusalWord(word));
    }
    const decided = await opening.decide((access) => {
      if (opening.cancelled()) return false;
      // A controlling stream that loses `approve` is decided again as the read-only open it would otherwise be.
      const read: ReadAccess = control ? { ...access, lesser: { input: { appSessionId, epoch, tabId }, reason: 'control-revoked' } } : access;
      const stream = new BrowserStream(opening, read, subscription, control);
      opening.install(stream);
      stream.open({ browser: { epoch, tabId, control } });
      early.attach(stream);
      return true;
    });
    if (decided.ok && decided.value) return;
    subscription.close();
    if (!decided.ok) opening.refuse(decided.reason);
  };
}

/** The subscription's sink: what it gives before the stream is published is held for it (one frame, the end). */
class HeldSink {
  #stream: BrowserStream | null = null;
  #frame: BrowserFrame | null = null;
  #closed: string | null = null;

  frame(frame: BrowserFrame): void {
    if (this.#stream !== null) this.#stream.frame(frame);
    else this.#frame = frame;
  }

  closed(reason: string): void {
    if (this.#stream !== null) this.#stream.producerClosed(reason);
    else this.#closed ??= reason;
  }

  attach(stream: BrowserStream): void {
    this.#stream = stream;
    const [frame, closed] = [this.#frame, this.#closed];
    this.#frame = null;
    if (frame !== null) stream.frame(frame);
    if (closed !== null) stream.producerClosed(closed);
  }
}

class BrowserStream extends Stream {
  /** The bytes of frames queued so far: the next frame's offset. */
  #offset = 0;
  /** Inputs waiting for the stream's decision to stand. */
  #waiting = 0;
  #inputs: Promise<void> = Promise.resolve();
  readonly #log: (line: string) => void;

  constructor(
    opening: ReadOpening,
    access: ReadAccess,
    private readonly subscription: BrowserSubscription,
    /** Whether it takes input (a controlling open, its grant read). */
    private readonly controlling: boolean,
  ) {
    super(opening.id, opening.channel, opening.act, opening.binding, opening.credit, opening.window, opening.over);
    this.read = access;
    this.#log = opening.log;
  }

  /** One frame of the producer's, queued in the envelope. */
  frame(frame: BrowserFrame): void {
    if (this.ended) return;
    let bytes: Uint8Array;
    try {
      bytes = encodeScreencastFrame(frame);
    } catch (error) {
      const reason = error instanceof ScreencastError ? error.reason : 'malformed';
      this.#log(`endpoint: a screencast frame could not be sent (${reason}): ${(error as Error).message}`);
      return this.end(reason === 'frame-too-large' ? 'frame-too-large' : 'producer-failed');
    }
    const offset = this.#offset;
    this.#offset += bytes.byteLength;
    this.push(offset, bytes);
  }

  /** The producer ended the subscription with its word. */
  producerClosed(word: string): void {
    if (!isBrowserWord(word)) this.#log(`endpoint: a screencast ended with a word this build does not know (${word}): closed producer-failed`);
    this.end(closeWord(word));
  }

  protected override queued(): void {
    if (this.backlog > SCREENCAST_BACKLOG_BYTES) this.end('behind');
  }

  protected idle(): boolean {
    return true;
  }

  /** The subscription let go (a controller's held keys and buttons released by the producer); a second close is nothing. */
  protected closed(): void {
    this.subscription.close();
  }

  /** A device sends no data on a screencast. */
  input(): void {
    this.end('malformed');
  }

  control(m: StreamControlMessage): void {
    const read = readScreencastControl(m.control);
    if (read === null) return this.end('malformed');
    if ('ack' in read) {
      try {
        this.subscription.ack(read.ack.seq);
      } catch (error) {
        this.#log(`endpoint: a screencast's ack was refused (${wordOf(error)}): ${(error as Error).message}`);
        this.end('malformed');
      }
      return;
    }
    if (!this.controlling) return this.end('malformed');
    if (this.#waiting >= BROWSER_LIMITS.inputQueue) return this.end('input-overflow');
    this.#waiting++;
    const { seq, event } = read.input;
    this.#inputs = this.#inputs.then(async () => {
      // Input rides its grant's standing now: a decision that moved is held and decided again before it goes.
      while (!this.ended && (this.held || !this.stands())) await this.gate;
      this.#waiting--;
      if (this.ended) return;
      this.subscription.input(seq, event as Parameters<BrowserSubscription['input']>[1]).catch((error: unknown) => {
        if (wordOf(error) === 'invalid') this.#log(`endpoint: a screencast's input ${seq} was dropped: ${(error as Error).message}`);
      });
    });
  }

  closedByDevice(): void {
    this.end(null);
  }
}
