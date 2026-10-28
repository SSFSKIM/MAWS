// The delivery lane (P5 O9 M2, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §B and §H): a person's words
// to a terminal session go as the bridge's `deliver` op, which submits them in either turn state, answers `submitted`
// once it has taken the key (before the words enter), and reports their fate later on the stream (`delivered entered`
// or `refused`). Its de-duplication is a high-water mark per writer, so a key below one already taken is dropped: keys
// must reach the child in order, and none is ever reused. So, per session:
//
// - one `deliver` in flight, in the order the sends arrived, from every page; at most `capacity` sends held;
// - each send's seq is the last allocated plus one, written to `<userData>/lane-a/deliveries.json` as the send is taken,
//   before its post, so a crash leaves a gap rather than a reuse;
// - a post that times out or loses its socket is retried under the same key; `duplicate` to a retry means the first copy
//   was taken, to a first copy that the bridge had the key already (refused, never a success); three failed posts make
//   the send `unconfirmed` and the lane moves on;
// - the fate is tracked by the key: `submitted` at the post's answer, then `entered` or `refused` from the state stream;
//   a send still `submitted` when that stream ends is `unconfirmed` once its fresh snapshot arrives, since the stream
//   that would have named its fate is gone. Settled entries are kept a while for the renderer;
// - a bridge lost for a while refuses only what waits: the send being posted keeps retrying on the same lane, so no later
//   key passes the bridge's mark first. The lane's final close (the session gone) posts nothing more.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DeliveryKey, LaneADelivery, LaneASendOutput } from '@shared/ipc/schema/lane-a';
import { atomicWriteFileSync } from '../files/atomic-write';

export interface SeqStore {
  allocate(session: string): number; // the session's next seq, written before it is returned
}

// `deliveries.json`: `{version: 1, seq: {[engineSessionId]: last allocated}}`, 0600, written whole. A file that does not
// parse starts every session above the clock's milliseconds, which no seq counted from 1 reaches, so a lost count never
// reuses a key below a mark the bridge already holds.
export function fileSeqStore(file: string, warn: (line: string) => void = (line) => console.warn(`[lane-a] ${line}`)): SeqStore {
  let seq: Record<string, number> = {};
  let floor = 0;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; seq?: unknown };
    if (parsed.version !== 1 || parsed.seq === null || typeof parsed.seq !== 'object') throw new Error('not version 1');
    seq = Object.fromEntries(Object.entries(parsed.seq as Record<string, unknown>).filter((e): e is [string, number] => Number.isSafeInteger(e[1])));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn(`${file} could not be read (${error instanceof Error ? error.message : String(error)}); sends count on from the clock`);
      floor = Date.now();
    }
  }
  return {
    allocate(session) {
      const next = Math.max((seq[session] ?? 0) + 1, floor);
      const after = { ...seq, [session]: next };
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      atomicWriteFileSync(file, JSON.stringify({ version: 1, seq: after }));
      seq = after;
      return next;
    },
  };
}

export type PostResult = { kind: 'answer'; status: number; body: Record<string, unknown> | null } | { kind: 'lost'; why?: 'timeout' | 'gone' };

export interface LaneTiming {
  retryDelaysMs: readonly number[]; // before the second and third posts
  answerMs: number; // laneA.send answers by then with the state it has
  keepMs: number; // a settled entry stays this long
  capacity: number;
}

export const LANE_TIMING: LaneTiming = { retryDelaysMs: [1000, 3000], answerMs: 5000, keepMs: 60_000, capacity: 8 };

// `launch`: the one the send was admitted under, carried by every post of it. `lost`: the state stream that would name its
// fate ended after its post went (or while it was out); `resnapped`: and the fresh snapshot has come since.
type Send = LaneADelivery & {
  text: string;
  launch: string | null;
  lost: 'no' | 'lost' | 'resnapped';
  code?: string;
  waiters: ((answer: LaneASendOutput) => void)[];
  expiry: NodeJS.Timeout | null;
};
// Settled: nothing posts it again. `entered` and `refused` are its fate; `unconfirmed` stops the posting without one, and
// a fate the stream names later still settles it.
const FINAL = new Set<LaneADelivery['state']>(['entered', 'refused', 'unconfirmed']);
const KNOWN = new Set<LaneADelivery['state']>(['entered', 'refused']);
const LOST_REASON = 'the bridge’s stream was lost before it said whether this entered';
const CLOSED_REASON = 'the session left the terminal before its bridge said whether this entered';
const sameKey = (a: DeliveryKey, b: { writer?: unknown; seq?: unknown }) => a.writer === b.writer && a.seq === b.seq;

export class DeliveryLane {
  private readonly sends: Send[] = []; // in arrival order; the settled ones until they expire
  private posting = false;
  private head: Send | null = null; // the send being posted
  private closed = false;
  private down = false; // the state stream ended, and its fresh snapshot has not come yet

  constructor(
    private readonly options: {
      writer: string;
      session: string;
      seqs: SeqStore;
      launch(): string | null; // the session's launch now: a send is admitted under it
      post(body: Record<string, unknown>, launch: string | null): Promise<PostResult>; // a `deliver` command's answer, or lost (a timeout, a closed socket)
      changed(): void;
      timing: LaneTiming;
    },
  ) {}

  send(text: string): Promise<LaneASendOutput> {
    const { timing } = this.options;
    if (this.closed) return Promise.resolve({ key: null, state: 'refused', reason: 'the session’s bridge went away', code: 'no-bridge' });
    if (this.sends.filter((s) => !FINAL.has(s.state)).length >= timing.capacity) {
      return Promise.resolve({ key: null, state: 'refused', reason: 'too many messages waiting for this session', code: 'busy' });
    }
    let seq: number;
    try {
      seq = this.options.seqs.allocate(this.options.session);
    } catch (error) {
      return Promise.resolve({ key: null, state: 'refused', reason: `the send could not be numbered: ${error instanceof Error ? error.message : String(error)}`, code: 'failed' });
    }
    const send: Send = { key: { writer: this.options.writer, seq }, at: new Date().toISOString(), state: 'queued', text, launch: this.options.launch(), lost: 'no', waiters: [], expiry: null };
    this.sends.push(send);
    this.options.changed();
    const answer = new Promise<LaneASendOutput>((resolve) => {
      send.waiters.push(resolve);
      const timer = setTimeout(() => resolve(this.answerOf(send)), timing.answerMs);
      timer.unref();
      send.waiters.push(() => clearTimeout(timer));
    });
    void this.pump();
    return answer;
  }

  // A `delivered` from the state stream: the send's fate, while its entry is kept, whatever the posting did (an
  // `unconfirmed` send gets the fate the stream names later).
  fate(key: { writer?: unknown; seq?: unknown }, outcome: string, uuid?: string, reason?: string): void {
    const send = this.sends.find((s) => sameKey(s.key, key));
    if (!send || KNOWN.has(send.state)) return;
    if (outcome === 'entered') this.settle(send, 'entered', { ...(uuid !== undefined && { uuid }) });
    else if (outcome === 'refused') this.settle(send, 'refused', { reason: reason ?? 'the session refused it' });
  }

  // The state stream ended: a submitted send, and the one whose post is out, may have had their fate on it.
  streamLost(): void {
    this.down = true;
    for (const s of this.sends) if (s.state === 'submitted' || s === this.head) s.lost = 'lost';
  }

  // Its fresh snapshot came: a submitted send whose fate went with the lost stream is unconfirmed; the one whose post is
  // still out is, once its post answers.
  snapshotArrived(): void {
    this.down = false;
    for (const s of this.sends) {
      if (s.lost !== 'lost') continue;
      if (s.state === 'submitted') this.settle(s, 'unconfirmed', { reason: LOST_REASON });
      else if (s.state === 'queued') s.lost = 'resnapped';
    }
  }

  entries(): LaneADelivery[] {
    return this.sends.map(({ key, at, state, uuid, reason }) => ({ key, at, state, ...(uuid !== undefined && { uuid }), ...(reason !== undefined && { reason }) }));
  }

  // The bridge went away: what is waiting behind the send being posted is refused. The lane stays, so a send still
  // retrying keeps its place ahead of any later key.
  dropQueued(reason: string): void {
    for (const s of this.sends) if (s.state === 'queued' && s !== this.head) this.settle(s, 'refused', { reason, code: 'no-bridge' });
  }

  // The session is gone: nothing more is taken or posted. The send being posted, and any the bridge took whose fate the
  // closed stream would have named, are unconfirmed: whether they entered, nothing can say now.
  close(reason: string): void {
    this.closed = true;
    this.dropQueued(reason);
    for (const s of this.sends) if ((s === this.head && !FINAL.has(s.state)) || s.state === 'submitted') this.settle(s, 'unconfirmed', { reason: CLOSED_REASON });
  }

  private async pump(): Promise<void> {
    if (this.posting) return;
    this.posting = true;
    try {
      for (let send = this.next(); send; send = this.next()) {
        this.head = send;
        await this.deliver(send);
        this.head = null;
      }
    } finally {
      this.posting = false;
    }
  }

  private next(): Send | undefined {
    return this.closed ? undefined : this.sends.find((s) => s.state === 'queued');
  }

  private async deliver(send: Send): Promise<void> {
    const { retryDelaysMs } = this.options.timing;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt - 1]));
      if (FINAL.has(send.state) || this.closed) return; // its fate came on the stream meanwhile, or the lane closed (settling it)
      if (this.down) send.lost = 'lost'; // posted with no stream to name its fate
      const posted = await this.options.post({ op: 'deliver', key: send.key, text: send.text }, send.launch);
      if (FINAL.has(send.state)) return; // the stream named its fate before the post answered
      if (posted.kind === 'lost' || posted.status === 504 || posted.status === 503) continue; // it may have been taken: the same key again
      const body = posted.body ?? {};
      const result = (body.result ?? {}) as Record<string, unknown>;
      if (posted.status === 200 && body.ok === true) {
        if (result.duplicate === true && attempt === 0) this.settle(send, 'refused', { reason: 'the bridge had already taken this key' });
        else if (send.lost === 'resnapped') this.settle(send, 'unconfirmed', { reason: LOST_REASON });
        else if (send.state === 'queued') {
          send.state = 'submitted';
          this.options.changed();
        }
        return;
      }
      const code = typeof body.code === 'string' ? body.code : undefined;
      this.settle(send, 'refused', { reason: typeof body.error === 'string' ? body.error : `the bridge answered ${posted.status}`, ...(code !== undefined && { code }) });
      return;
    }
    if (!FINAL.has(send.state)) this.settle(send, 'unconfirmed', { reason: 'the bridge did not answer its post' });
  }

  private settle(send: Send, state: 'entered' | 'refused' | 'unconfirmed', extra: { uuid?: string; reason?: string; code?: string }): void {
    send.state = state;
    if (state === 'entered') {
      delete send.reason; // an unconfirmed send's doubt, answered
      delete send.code;
    }
    if (extra.uuid !== undefined) send.uuid = extra.uuid;
    if (extra.reason !== undefined) send.reason = extra.reason;
    if (extra.code !== undefined) send.code = extra.code;
    const answer = this.answerOf(send);
    for (const waiter of send.waiters.splice(0)) waiter(answer);
    this.options.changed();
    if (send.expiry) clearTimeout(send.expiry); // kept a while from its latest settlement
    send.expiry = setTimeout(() => {
      const at = this.sends.indexOf(send);
      if (at >= 0) this.sends.splice(at, 1);
      this.options.changed();
    }, this.options.timing.keepMs);
    send.expiry.unref();
  }

  private answerOf(send: Send): LaneASendOutput {
    return {
      key: send.key,
      state: send.state,
      ...(send.uuid !== undefined && { uuid: send.uuid }),
      ...(send.reason !== undefined && { reason: send.reason }),
      ...(send.code !== undefined && { code: send.code }),
    };
  }
}
