// A DX7 / DX2 test client for the browser suites against the local hub: it redeems an enrollment code the web app made,
// as `sminos hub enroll` will, and then speaks DX2 as an enrolled machine's daemon does — its SSE stream down, NDJSON
// POSTs up — writing events sealed with the org key the code carried. It stands in for DC4's uplink until that lands.
import {
  base64urlDecode,
  decodeEnrollmentCode,
  GENERATION_HEADER,
  importOrgKey,
  seal,
  type DownFrame,
  type EnrollmentCode,
  type LogEvent,
  type OrgKey,
  type Redeemed,
  type UpFrame,
} from 'desk-hub/protocol';

export type EventDraft = { kind: string } & Record<string, unknown>;

export class TestMachine {
  readonly frames: DownFrame[] = [];
  private generation = 0;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private readonly seqs = new Map<string, number>();

  private constructor(
    readonly code: EnrollmentCode,
    readonly key: OrgKey,
    readonly redeemed: Redeemed,
  ) {}

  /** Redeems the code `text` (what the owner pastes at `sminos hub enroll`'s prompt) at the hub the code names. */
  static async enroll(text: string): Promise<TestMachine> {
    const code = decodeEnrollmentCode(text);
    const response = await fetch(`${code.hub}/machine/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: code.token, machine: code.machine }),
    });
    if (response.status !== 200) throw new Error(`redeem: ${response.status} ${await response.text()}`);
    return new TestMachine(code, await importOrgKey(base64urlDecode(code.key)), (await response.json()) as Redeemed);
  }

  get name(): string {
    return this.code.machine;
  }

  private get credentials(): Record<string, string> {
    return { 'CF-Access-Client-Id': this.redeemed.client_id, 'CF-Access-Client-Secret': this.redeemed.client_secret };
  }

  /** Opens the stream (the machine's first authenticated connection confirms its enrollment) and waits for welcome. */
  async connect(): Promise<void> {
    const response = await fetch(`${this.code.hub}/machine/stream`, { headers: this.credentials });
    if (response.status !== 200) throw new Error(`stream: ${response.status} ${await response.text()}`);
    const from = this.frames.length;
    this.reader = response.body!.getReader();
    void this.pump(this.reader);
    const welcome = (await this.next((f) => f.t === 'welcome', 'welcome', from)) as Extract<DownFrame, { t: 'welcome' }>;
    this.generation = welcome.generation;
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const data = /^data: (.*)$/m.exec(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          if (data) this.frames.push(JSON.parse(data[1]) as DownFrame);
        }
      }
    } catch {
      // the stream was cut
    }
  }

  async post(frames: UpFrame[]): Promise<void> {
    const response = await fetch(`${this.code.hub}/machine/frames`, {
      method: 'POST',
      headers: { ...this.credentials, 'content-type': 'application/x-ndjson', [GENERATION_HEADER]: String(this.generation) },
      body: frames.map((frame) => JSON.stringify(frame)).join('\n'),
    });
    if (response.status !== 200) throw new Error(`post: ${response.status} ${await response.text()}`);
  }

  /** DX2's handshake for a project this machine holds nothing of yet: `hello`, then the hub's `have`. */
  async hello(project: string, name: string): Promise<void> {
    const from = this.frames.length;
    await this.post([{ t: 'hello', project, name, have: {} }]);
    await this.next((f) => f.t === 'have' && f.project === project, 'have', from);
  }

  /** Writes events as session `session`'s, under `<machine>/<session>`, each at the writer's next seq, sealed with the
   * org key. */
  async write(project: string, session: string, drafts: EventDraft[]): Promise<LogEvent[]> {
    const events: LogEvent[] = [];
    const writer = `${this.name}/${session}`;
    for (const draft of drafts) {
      const seq = (this.seqs.get(writer) ?? 0) + 1;
      this.seqs.set(writer, seq);
      events.push((await seal(this.key, 'log', project, { ts: new Date().toISOString(), writer, seq, ...draft })) as unknown as LogEvent);
    }
    await this.post([{ t: 'events', project, events }]);
    return events;
  }

  async next(predicate: (frame: DownFrame) => boolean, what: string, from = 0, ms = 10_000): Promise<DownFrame> {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.frames.slice(from).find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`no ${what} for ${this.name} within ${ms} ms; received ${JSON.stringify(this.frames.slice(-6))}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async close(): Promise<void> {
    await this.reader?.cancel().catch(() => {});
  }
}
