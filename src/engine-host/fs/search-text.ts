import { createHash, randomUUID } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { isMadeUpFinalAnswer } from '@shared/owner/message-call';
import type { SearchCheckpoint } from '@shared/ipc/schema/fs';

// At worst JSON escaping costs six bytes per UTF-16 code unit: a page is < 1 MiB,
// well below the shared detached transport's 64 MiB line cap.
const PAGE_CHARS = 128 * 1024;
const PAGE_WAIT_MS = 1000; // answer progress well before the supervisor's 10 s command timeout
// A resume is trusted when the file still has the inode it had, is at least as long as the offset, and both its first and
// its last FINGERPRINT_BYTES before the offset digest to what they did: a rewritten or replaced file fails one of them,
// and checking costs two small reads however large the transcript is.
const FINGERPRINT_BYTES = 4096;
interface Page { text: string; done: boolean; offset?: number; started?: boolean; head?: string; bytesRead?: number }
interface Read { id: string; path: string; size: number; mtimeMs: number; from: number; ino: string; lastProgressAt: number; pending: Promise<Page> | null; resolve?: (page: Page) => void; reject?: (error: Error) => void }

// Digest of a file's first and last FINGERPRINT_BYTES before `offset`, with the bytes it took to read them. It is
// stringified into the worker, so it takes what it needs (createHash) as an argument and uses nothing else outside it.
async function fingerprint(createHash: (algorithm: string) => { update(data: Uint8Array): unknown; digest(encoding: 'hex'): string },
  file: { read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }> }, offset: number, span: number): Promise<{ digest: string; bytes: number }> {
  const hash = createHash('sha1');
  const spans = offset <= span ? [[0, offset]] : [[0, span], [offset - span, offset]];
  let bytes = 0;
  for (const [from, to] of spans) {
    const buffer = Buffer.alloc(to - from);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, from);
    hash.update(buffer.subarray(0, bytesRead));
    bytes += bytesRead;
  }
  return { digest: hash.digest('hex'), bytes };
}

// One reusable worker per fs service, with backpressure (one page outstanding).
// A single enormous JSONL record may take time to parse; doing that in the worker
// lets the host still answer progress pages and serve its other commands on time.
// A pass reads lines from byte `from` to the size it was started with and ends at the byte after the last line it
// consumed: a complete line, or a last line that has no newline yet but already parses (a torn one is left for the next
// pass, which starts at it). Lines are split on \n alone; a transcript's JSON never holds a raw line break.
const WORKER = String.raw`
const { parentPort } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const PAGE_CHARS = ${PAGE_CHARS};
const FINGERPRINT_BYTES = ${FINGERPRINT_BYTES};
const isMadeUpFinalAnswer = ${isMadeUpFinalAnswer}; // the to-human plugin's answer after a final message, which said nothing
const fingerprint = ${fingerprint};
// The text blocks a line holds, or null when it is not JSON.
function blocksOf(line) {
  let row;
  try { row = JSON.parse(line.toString('utf8')); } catch { return null; }
  if (row && ['user', 'assistant'].includes(row.type) && row.isMeta !== true && !isMadeUpFinalAnswer(row)) {
    const content = row.message?.content;
    return typeof content === 'string' ? [content] : Array.isArray(content)
      ? content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text) : [];
  }
  return [];
}
async function* extract(file, size, from, started) {
  let page = '', first = !started, scanned = 0, consumed = from, readBytes = 0, bytesRead = 0;
  async function* emit(blocks) {
    for (const block of blocks) {
      const text = (first ? '' : '\n') + block;
      first = false;
      let offset = 0;
      while (offset < text.length) {
        let count = Math.min(PAGE_CHARS - page.length, text.length - offset);
        const end = offset + count;
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) count -= 1;
        page += text.slice(offset, offset + count);
        offset += count;
        if (page.length >= PAGE_CHARS - 1) { yield page; page = ''; scanned = 0; }
      }
    }
  }
  // Destroying the stream closes the file, so the fingerprint is read before it.
  const finish = async () => {
    const head = await fingerprint(createHash, file, consumed, FINGERPRINT_BYTES);
    return { text: page, offset: consumed, started: !first, head: head.digest, bytesRead: bytesRead + head.bytes };
  };
  if (size <= from) return await finish();
  const input = file.createReadStream({ autoClose: false, start: from, end: size - 1 });
  let carry = [], carryLength = 0;
  try {
    for await (const chunk of input) {
      bytesRead += chunk.length;
      readBytes += chunk.length;
      if (readBytes >= 4 * 1024 * 1024) { parentPort.postMessage({ id, progress: true }); readBytes = 0; }
      let at = 0;
      for (let end = chunk.indexOf(10, at); end !== -1; end = chunk.indexOf(10, at)) {
        carry.push(chunk.subarray(at, end));
        const length = carryLength + end - at;
        at = end + 1;
        const line = carry.length === 1 ? carry[0] : Buffer.concat(carry);
        carry = []; carryLength = 0;
        consumed += length + 1;
        scanned += length + 1;
        const blocks = blocksOf(line);
        if (blocks) yield* emit(blocks);
        // Tool-only input also yields progress without scanning the file again.
        if (scanned >= 4 * 1024 * 1024) { yield page; page = ''; scanned = 0; }
      }
      if (at < chunk.length) { carry.push(chunk.subarray(at)); carryLength += chunk.length - at; }
    }
    if (carryLength > 0) {
      const blocks = blocksOf(Buffer.concat(carry));
      if (blocks) { consumed += carryLength; yield* emit(blocks); }
    }
    return await finish();
  } finally { input.destroy(); }
}
let reader, file, id;
let work = Promise.resolve();
parentPort.on('message', (message) => {
  work = work.then(async () => {
    if (message.type === 'start') {
      if (reader) await reader.return();
      if (file) await file.close();
      file = message.file;
      id = message.id;
      reader = extract(file, message.size, message.from, message.started);
    } else if (message.id === id) {
      const result = await reader.next();
      if (result.done) { await file.close(); file = null; reader = null; }
      parentPort.postMessage(result.done ? { id, ...result.value, done: true } : { id, text: result.value, done: false });
    }
  }).catch(async (error) => {
    if (file) await file.close().catch(() => {});
    file = null; reader = null;
    parentPort.postMessage({ id: message.id, error: String(error.message ?? error) });
  });
});
`;

export class SearchTextReader {
  private worker: Worker | null = null;
  private active: Read | null = null;
  private stopped = false;
  // Bytes of transcript read by every pass so far, fingerprint reads included: what the incremental pass is tested against.
  readonly stats = { bytesRead: 0 };

  // A first call (no cursor) starts a pass: from byte 0, or from `resume.offset` when the file still agrees with it, and
  // the answer's `from` says which. The last page carries the `checkpoint` the next pass can resume from.
  async read(path: string, cursor?: string, resume?: SearchCheckpoint): Promise<{ text: string; cursor: string | null; size: number; mtimeMs: number; from: number; checkpoint?: SearchCheckpoint }> {
    if (this.stopped) throw new Error('Conversation reader stopped');
    if (cursor && (this.active?.id !== cursor || this.active.path !== path)) throw new Error('Conversation read expired; restart indexing');
    if (!cursor) {
      const file = await open(path, 'r');
      try {
        const info = await file.stat();
        const ino = String(info.ino);
        const from = resume && ino === resume.ino && info.size >= resume.offset && await this.agrees(file, resume) ? resume.offset : 0;
        if (this.stopped) throw new Error('Conversation reader stopped');
        const worker = this.ensureWorker();
        this.active?.reject?.(new Error('Conversation read superseded'));
        this.active = { id: randomUUID(), path, size: info.size, mtimeMs: info.mtimeMs, from, ino, lastProgressAt: Date.now(), pending: null };
        worker.postMessage({ type: 'start', id: this.active.id, size: info.size, from, started: from > 0 && resume!.started, file }, [file]);
      } catch (error) { await file.close(); throw error; }
    }
    const active = this.active!;
    if (!active.pending) {
      active.lastProgressAt = Date.now();
      active.pending = new Promise<Page>((resolve, reject) => { active.resolve = resolve; active.reject = reject; });
      this.worker!.postMessage({ type: 'next', id: active.id });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const page = await Promise.race([active.pending, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PAGE_WAIT_MS); })]);
      if (this.active !== active) throw new Error('Conversation read superseded');
      if (!page && Date.now() - active.lastProgressAt >= 8000) {
        this.reset();
        throw new Error('Conversation extraction stalled');
      }
      if (page) {
        active.pending = null;
        if (page.done) this.active = null;
        this.stats.bytesRead += page.bytesRead ?? 0;
      }
      const checkpoint = page?.done ? { offset: page.offset!, ino: active.ino, head: page.head!, started: page.started! } : undefined;
      return { text: page?.text ?? '', cursor: page?.done ? null : active.id, size: active.size, mtimeMs: active.mtimeMs, from: active.from, ...(checkpoint ? { checkpoint } : {}) };
    } finally { clearTimeout(timer); }
  }

  private async agrees(file: FileHandle, resume: SearchCheckpoint): Promise<boolean> {
    const head = await fingerprint(createHash, file, resume.offset, FINGERPRINT_BYTES);
    this.stats.bytesRead += head.bytes;
    return head.digest === resume.head;
  }

  stop(): void {
    this.stopped = true;
    this.reset();
  }

  private reset(): void {
    this.active?.reject?.(new Error('Conversation reader stopped'));
    this.active = null;
    void this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(WORKER, { eval: true });
    worker.on('message', (page: Page & { id: string; error?: string; progress?: boolean }) => {
      if (this.active?.id !== page.id) return;
      this.active.lastProgressAt = Date.now();
      if (page.error) this.active.reject?.(new Error(page.error));
      else if (!page.progress) this.active.resolve?.(page);
    });
    worker.on('error', (error) => { if (this.worker === worker) { this.active?.reject?.(error); this.worker = null; } });
    worker.on('exit', () => {
      if (this.worker === worker) { this.active?.reject?.(new Error('Conversation worker exited')); this.worker = null; }
    });
    worker.unref();
    this.worker = worker;
    return worker;
  }
}
