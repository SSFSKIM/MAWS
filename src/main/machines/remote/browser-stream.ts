// The device's half of a `browser.screencast` stream (P5 O17 M9a; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// Interfaces §K): one viewer of one agent tab on a remote session, over the link's streams (streams.ts), which open it
// only on a channel whose endpoint listed `rl2.browser-screencast` (else it ends `not-offered`, and the consumer draws its
// unsupported state). This is the seam main's bridge consumes (`browser.remote.*`, M9b).
//
// The frames come as screencast.ts' envelope across `streamData` chunks: each is read whole and handed to the consumer
// once its last byte is in, a chunk off its offset or an envelope out of shape closing the stream `malformed`. Byte credit
// is refunded per chunk as it is taken into the frame being read (one opening credit is smaller than a maximum frame, so
// holding it to a whole frame would stall the stream); frame credit is the consumer's: the producer sends the next frame
// only after `ack(seq)` of the last, which the consumer sends once it has drawn or deliberately dropped it, never on
// receipt. `input(seq, event)` goes only on a controlling stream (the endpoint closes a read-only one that sends any); a
// stream is fixed at its open, so control is taken by opening a new stream under a grant. The consumer hears `closed`
// once, with the endpoint's word (`tab-closed`, `engine-changed`, `control-revoked`, `removed`, …), `carrier` with the
// channel, or the link's end; never after its own `close()`.
import { ScreencastFrameReader, type StreamBrowserOpen, type StreamBrowserOpened } from '../../../../apps/org-protocol/src/index.ts';
import type { BrowserFrame, BrowserInput } from '@shared/browser/screencast';
import type { RemoteStream, StreamRequest, StreamSink } from './streams';

export interface BrowserStreamSink {
  /** The endpoint admitted it: the epoch and tab it views, and whether it takes input. */
  opened(view: StreamBrowserOpened): void;
  /** One whole frame; the next comes only after `ack(frame.seq)`. */
  frame(frame: BrowserFrame): void;
  /** Final: the endpoint's close or refusal, `malformed` for a stream this side could not read, `carrier`, `not-offered`, or the link's end. */
  closed(reason: string): void;
}

export interface RemoteBrowserStream {
  readonly id: string;
  /** Frame `seq` drawn or deliberately dropped: the producer may send the next. */
  ack(seq: number): void;
  /** One input, in order, on a controlling stream. */
  input(seq: number, event: BrowserInput): void;
  close(): void;
}

/** The link's streams, as a screencast opens one (`RemoteLink.openStream`). */
export type BrowserStreamLink = { openStream(request: StreamRequest, sink: StreamSink): RemoteStream };

export function openBrowserStream(link: BrowserStreamLink, open: StreamBrowserOpen, sink: BrowserStreamSink): RemoteBrowserStream {
  const reader = new ScreencastFrameReader();
  let over = false;
  const end = (reason: string) => {
    if (over) return;
    over = true;
    sink.closed(reason);
  };
  const stream = link.openStream(
    { kind: 'browser.screencast', browser: open },
    {
      opened(opened) {
        if (over) return;
        if (opened.browser === undefined) {
          stream.close('malformed');
          return end('malformed');
        }
        sink.opened(opened.browser);
      },
      data(offset, bytes) {
        if (over) return;
        let frames: BrowserFrame[];
        try {
          frames = reader.push(offset, bytes);
        } catch {
          stream.close('malformed');
          return end('malformed');
        }
        stream.credit(bytes.byteLength);
        for (const frame of frames) if (!over) sink.frame(frame);
      },
      credit() {},
      closed: end,
    },
  );
  return {
    id: stream.id,
    ack(seq) {
      if (!over) stream.control({ ack: { seq } });
    },
    input(seq, event) {
      if (!over) stream.control({ input: { seq, event } });
    },
    close() {
      if (over) return;
      over = true;
      stream.close('closed');
    },
  };
}
