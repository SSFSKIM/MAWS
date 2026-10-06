// E3's replay journals and disk seeds (E3 execution document, M5): each launch the side spec makes runs on a journal
// built here behind C3's handshake prelude, as C7's `c7-replay.ts` builds its turns, but under a session id of the
// case's own, so a parent, its side thread and a promoted thread bind distinct ids (M3's replay seam pins the id the
// journal's spawn row and `system/init` name). The frames are the probes' own, re-addressed: the init of
// `pass2/auto-routed`, the assistant text and result of `pass2/bash-context-echoed`, the open tool call and its result of
// `pass3/steer-next` (the shape a `next` steer is delivered into), and the side questions of
// `pass3/p1-side-question-session` copied whole. The replay matches a `user` write by type and a control request by
// its request, so what MAWS writes as a prompt is its own, and `rename_session` is recorded exactly as `finishBinding`
// writes it. `seedTranscript` writes what the engine itself would leave in its store, for the disk-only cases.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { REPO_ROOT } from './launch';

type Row = { seq: number; direction: 'in' | 'out' | 'meta'; at: string; frame: Record<string, unknown> };
type Frame = Record<string, unknown>;

const FIXTURES = 'spikes/protocol-probe/fixtures';
const rowsOf = (path: string): Row[] =>
  readFileSync(join(REPO_ROOT, path), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Row);
const frameOf = (path: string, seq: number): Frame => rowsOf(path).find((r) => r.seq === seq)!.frame;

// Every string equal to a key of `swap` becomes its value, at any depth.
function swapped<T>(value: T, swap: Record<string, string>): T {
  if (typeof value === 'string') return (swap[value] ?? value) as T;
  if (Array.isArray(value)) return value.map((entry) => swapped(entry, swap)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, swapped(entry, swap)])) as T;
  return value;
}

const AUTO_ROUTED = `${FIXTURES}/pass2/auto-routed.jsonl`;
const ECHOED = `${FIXTURES}/pass2/bash-context-echoed.jsonl`;
const STEER_NEXT = `${FIXTURES}/pass3/steer-next.jsonl`;
const SIDE_QUESTIONS = `${FIXTURES}/pass3/p1-side-question-session.jsonl`;

// The recorded ids each borrowed frame carries, re-addressed to the journal's.
const RECORDED = {
  init: { session: '9d753242-8280-4bb4-a144-501cf423d6a1', cwd: '/private/tmp/maws-probe2-Gcfvti' },
  echoed: { session: 'fd4c2f15-a381-402d-a125-a0f08a713e9c', prompt: 'a37362a6-a117-4985-b0f9-cae7bfad6114' },
  steer: { session: '4e220cb8-9e75-4d8a-b1a9-c37655666eac', prompt: 'fe091b0d-b28b-41a8-aed3-39585769623d' },
  side: { session: '9aa9686c-27a8-44cc-a068-58c1fe15f3ac' },
} as const;

const AT = '2026-10-06T12:00:00.000Z';

export class SideJournal {
  private readonly rows: Row[] = [];
  private minted = 0;
  private initialised = false;

  // `sessionId` is what the seam pins (the spawn row) and the engine reports (`system/init`); `cwd` the init's directory.
  constructor(
    readonly sessionId: string,
    private readonly cwd: string,
  ) {
    for (const row of rowsOf('test/fixtures/engine/replay-handshake.jsonl')) this.push(row.direction, row.frame);
    this.push('meta', { event: 'spawn', args: ['--session-id', sessionId], note: 'E3 M5: the pin the replay seam reads' });
  }

  private push(direction: Row['direction'], frame: Frame): void {
    this.rows.push({ seq: this.rows.length + 1, direction, at: AT, frame });
  }

  // A uuid of this journal's own (its last hex digit is the session id's, so two journals never mint the same one).
  private uuid(): string {
    this.minted += 1;
    return `f${this.sessionId.at(-1)}e30000-0000-4000-8000-${String(this.minted).padStart(12, '0')}`;
  }

  // A human prompt the replay holds at until MAWS writes one (matched by type), then the engine's `started`; the first
  // carries the session's `system/init` after its `started`, as the engine sends it.
  prompt(): string {
    const uuid = this.uuid();
    this.push('out', { type: 'user', uuid, message: { role: 'user', content: '(written by MAWS)' }, parent_tool_use_id: null, origin: { kind: 'human' } });
    this.started(uuid);
    if (!this.initialised) {
      this.initialised = true;
      // the session's own mode (C10's e2e writes `defaultMode: default`), so the host has no mode to correct
      const init = swapped(frameOf(AUTO_ROUTED, 9), { [RECORDED.init.session]: this.sessionId, [RECORDED.init.cwd]: this.cwd });
      this.push('in', { ...init, permissionMode: 'default' });
    }
    return uuid;
  }

  started(uuid: string): void {
    this.push('in', { type: 'command_lifecycle', command_uuid: uuid, state: 'started', uuid: this.uuid(), session_id: this.sessionId });
  }

  completed(uuid: string): void {
    this.push('in', { type: 'command_lifecycle', command_uuid: uuid, state: 'completed', uuid: this.uuid(), session_id: this.sessionId });
  }

  // The assistant's text and the turn's `result` carrying it (what main's summary tap reads as `resultText`).
  reply(prompt: string, text: string): void {
    const swap = { [RECORDED.echoed.session]: this.sessionId, [RECORDED.echoed.prompt]: prompt };
    const assistant = swapped(frameOf(ECHOED, 26), swap) as Frame & { message: Frame };
    this.push('in', { ...assistant, uuid: this.uuid(), message: { ...assistant.message, content: [{ type: 'text', text }] } });
    const result = swapped(frameOf(ECHOED, 30), swap);
    this.push('in', { ...result, result: text, uuid: this.uuid(), user_message_uuid: prompt, user_message_uuids: [prompt] });
  }

  // One whole turn: the prompt, the reply, the result and `completed`.
  turn(text: string): string {
    const uuid = this.prompt();
    this.reply(uuid, text);
    this.completed(uuid);
    return uuid;
  }

  // `finishBinding`'s write for a side thread, exactly (the host adds `source: 'host'`), and the engine's success.
  rename(title: string): void {
    const requestId = this.uuid();
    this.push('out', { type: 'control_request', request_id: requestId, request: { subtype: 'rename_session', title, source: 'host' } });
    this.push('in', { type: 'control_response', response: { subtype: 'success', request_id: requestId } });
  }

  // A Bash call the turn is waiting on (`pass3/steer-next` seq 38): a turn is running until its result arrives.
  toolCall(prompt: string): void {
    this.push('in', swapped(frameOf(STEER_NEXT, 38), { [RECORDED.steer.session]: this.sessionId, [RECORDED.steer.prompt]: prompt }));
  }

  // The tool's result (seq 44), which is the tool boundary a `next` steer is folded in at.
  toolResult(): void {
    this.push('in', swapped(frameOf(STEER_NEXT, 44), { [RECORDED.steer.session]: this.sessionId }));
  }

  // A `next` steer written into the running turn (seq 46's shape), and the engine's `queued` for it.
  steer(): string {
    const uuid = this.uuid();
    this.push('out', { type: 'user', uuid, message: { role: 'user', content: '(written by MAWS)' }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: 'next' });
    this.push('in', { type: 'command_lifecycle', command_uuid: uuid, state: 'queued', uuid: this.uuid(), session_id: this.sessionId });
    return uuid;
  }

  // Rows of `pass3/p1-side-question-session`, whole, under this journal's session id (their request ids are remapped by
  // the transport).
  sideQuestions(seqs: number[]): void {
    const rows = rowsOf(SIDE_QUESTIONS);
    for (const seq of seqs) {
      const row = rows.find((r) => r.seq === seq)!;
      this.push(row.direction, swapped(row.frame, { [RECORDED.side.session]: this.sessionId }));
    }
  }

  write(dir: string, name: string): string {
    const path = join(dir, `${name}.jsonl`);
    writeFileSync(path, this.rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    return path;
  }
}

// The two side questions the fixture asked (seq 88 and 95), as the person types them.
export const SIDE_QUESTION = 'What word did I ask you to remember? Answer with just the word.';
export const SIDE_FOLLOW_UP = 'Repeat that word in lowercase letters, nothing else.';
export const SIDE_QUESTION_ROWS = [88, 91, 92];
export const SIDE_FOLLOW_UP_ROWS = [95, 96, 97];

// ---- the engine's store, as the engine leaves it ------------------------------------------------------------------------

export type TranscriptRecord = Record<string, unknown>;

// The engine's project directory name for a working directory (`/a/b.c` → `-a-b-c`).
export const slugOf = (directory: string) => directory.replace(/[^a-zA-Z0-9]/g, '-');

export function seedTranscript(configHome: string, directory: string, sessionId: string, records: TranscriptRecord[]): string {
  const path = join(configHome, 'projects', slugOf(directory), `${sessionId}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  return path;
}

// A transcript's records in the engine's shape, chained by `parentUuid`, under `sessionId` in `cwd`; `at(k)` stamps the
// k-th record a second apart from `start`.
export function transcript(base: { sessionId: string; cwd: string; start: number }) {
  const records: TranscriptRecord[] = [];
  let parent: string | null = null;
  const stamp = () => new Date(base.start + records.length * 1000).toISOString();
  const add = (fields: TranscriptRecord) => {
    const uuid = String(fields.uuid);
    records.push({ parentUuid: parent, isSidechain: false, cwd: base.cwd, sessionId: base.sessionId, version: '2.1.291', timestamp: stamp(), userType: 'external', entrypoint: 'sdk-ts', ...fields });
    parent = uuid;
  };
  return {
    records,
    // a record copied from another transcript (a fork's history), its own uuid, parent and time kept
    copy(record: TranscriptRecord) {
      records.push({ ...record, sessionId: base.sessionId });
      parent = String(record.uuid);
    },
    user(uuid: string, content: unknown) {
      add({ type: 'user', uuid, message: { role: 'user', content }, origin: { kind: 'human' }, promptSource: 'sdk' });
    },
    text(uuid: string, text: string) {
      add({ type: 'assistant', uuid, message: { id: `msg-${uuid}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } });
    },
    toolCall(uuid: string, id: string, command: string) {
      add({ type: 'assistant', uuid, message: { id: `msg-${uuid}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } });
    },
    toolResult(uuid: string, id: string, output: string) {
      add({ type: 'user', uuid, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output, is_error: false }] }, toolUseResult: { stdout: output, stderr: '', interrupted: false } });
    },
    // A `next` steer as the engine records it (M0's finding, `p1-side-thread-live.jsonl` seq 157; W1's
    // `w1-steer-next-disk.jsonl` line 32): no user record, a `queued_command` attachment after the tool's result.
    steer(uuid: string, sourceUuid: string, prompt: unknown) {
      add({ type: 'attachment', uuid, attachment: { type: 'queued_command', prompt, source_uuid: sourceUuid, commandMode: 'prompt', origin: { kind: 'human' }, timestamp: stamp(), humanTurn: true } });
    },
    turnEnd(uuid: string) {
      add({ type: 'system', subtype: 'turn_duration', uuid, durationMs: 1000, isMeta: false });
    },
  };
}

// ---- a screenshot ------------------------------------------------------------------------------------------------------

// A `width` × `height` PNG of one colour (8-bit RGB), so a drawn attachment is visible in the evidence shots.
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const line = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => line));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
