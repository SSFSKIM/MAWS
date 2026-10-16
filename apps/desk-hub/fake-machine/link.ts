// The fake machine's connection to the hub (DX2): the SSE stream down, held open, and NDJSON POSTs up, posted one at a
// time as a daemon should, each frame over the frame bound sent as parts and each body kept under the POST bound.
import { GENERATION_HEADER, POST_LIMIT, type DownFrame, type UpFrame } from '../src/protocol/machine';
import { FRAME_LIMIT, PartAssembler, toWire, type Part } from '../src/protocol/parts';

export type Credentials = { clientId: string; clientSecret: string };

export const credentialHeaders = (c: Credentials): Record<string, string> => ({ 'CF-Access-Client-Id': c.clientId, 'CF-Access-Client-Secret': c.clientSecret });

export class LinkError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export class Link {
  generation = 0;
  /** Whether each `hb` is answered with `hb-ack` (a suspended daemon's are not, and its lease lapses). */
  answerHeartbeats = true;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private parts = new PartAssembler();
  private queue: Promise<unknown> = Promise.resolve();
  private open = false;

  constructor(
    readonly hub: string,
    readonly credentials: Credentials,
    private readonly onFrame: (frame: DownFrame) => void,
    private readonly onClose: () => void,
    /** A POST the hub refused, the hb-acks' included (a write's refusal its caller sees too). */
    private readonly onRefused: (error: LinkError) => void = () => {},
  ) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** Opens the stream and resolves with its `welcome`; rejects when the stream ends before one. */
  async connect(): Promise<Extract<DownFrame, { t: 'welcome' }>> {
    const response = await fetch(`${this.hub}/machine/stream`, { headers: credentialHeaders(this.credentials) });
    if (response.status !== 200) throw new LinkError(`the stream was refused: ${response.status}`, response.status, await response.text());
    const reader = response.body!.getReader();
    this.reader = reader;
    this.parts = new PartAssembler();
    this.open = true;
    let welcomed!: (frame: Extract<DownFrame, { t: 'welcome' }>) => void;
    let ended!: (error: Error) => void;
    let hasWelcome = false;
    const welcome = new Promise<Extract<DownFrame, { t: 'welcome' }>>((resolve, reject) => ((welcomed = resolve), (ended = reject)));
    void this.pump(reader, (frame) => {
      if (frame.t === 'welcome' && !hasWelcome) {
        hasWelcome = true;
        this.generation = frame.generation;
        welcomed(frame);
      }
    }).then(() => {
      if (!hasWelcome) ended(new Error('the stream ended before its welcome'));
    });
    return welcome;
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>, first: (frame: DownFrame) => void) {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = /^data: (.*)$/m.exec(block);
          if (!data) continue;
          let frame = JSON.parse(data[1]) as DownFrame;
          if (frame.t === 'part') {
            const whole = this.parts.add(frame as Part);
            if (whole === undefined) continue;
            frame = whole as DownFrame;
          }
          first(frame);
          if (frame.t === 'hb' && this.answerHeartbeats) void this.post([{ t: 'hb-ack', generation: this.generation, at: frame.at }]).catch((error: unknown) => error instanceof LinkError && this.onRefused(error));
          this.onFrame(frame);
        }
      }
    } catch {
      // the stream was cut
    }
    if (this.reader === reader) {
      this.reader = undefined;
      this.open = false;
      this.onClose();
    }
  }

  /** Ends the stream from this side, as a daemon that dropped its connection. */
  async drop(): Promise<void> {
    const reader = this.reader;
    this.reader = undefined;
    this.open = false;
    await reader?.cancel().catch(() => {});
  }

  /**
   * Posts frames in order, after every earlier post: a frame over the frame bound goes as parts, and a body that would
   * pass the POST bound is split across several POSTs. Throws on any answer but 200.
   */
  post(frames: UpFrame[]): Promise<void> {
    const run = this.queue.then(() => this.send(frames));
    this.queue = run.catch(() => {});
    return run;
  }

  private async send(frames: UpFrame[]): Promise<void> {
    const lines = frames.flatMap((frame) => toWire(frame, FRAME_LIMIT));
    let body: string[] = [];
    let size = 0;
    const flush = async () => {
      if (!body.length) return;
      const response = await fetch(`${this.hub}/machine/frames`, {
        method: 'POST',
        headers: { ...credentialHeaders(this.credentials), 'content-type': 'application/x-ndjson', [GENERATION_HEADER]: String(this.generation) },
        body: body.join('\n'),
      });
      const text = await response.text();
      body = [];
      size = 0;
      if (response.status !== 200) throw new LinkError(`a POST was refused: ${response.status} ${text}`, response.status, text);
    };
    for (const line of lines) {
      const bytes = new TextEncoder().encode(line).length + 1;
      if (size + bytes > POST_LIMIT) await flush();
      body.push(line);
      size += bytes;
    }
    await flush();
  }
}
