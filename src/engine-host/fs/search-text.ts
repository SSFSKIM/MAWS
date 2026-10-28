import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { isMadeUpFinalAnswer } from '@shared/owner/message-call';

// At worst JSON escaping costs six bytes per UTF-16 code unit: a page is < 1 MiB,
// well below the shared detached transport's 64 MiB line cap.
const PAGE_CHARS = 128 * 1024;
const PAGE_WAIT_MS = 1000; // answer progress well before the supervisor's 10 s command timeout
interface Page { text: string; done: boolean }
interface Read { id: string; path: string; size: number; mtimeMs: number; lastProgressAt: number; pending: Promise<Page> | null; resolve?: (page: Page) => void; reject?: (error: Error) => void }

// One reusable worker per fs service, with backpressure (one page outstanding).
// A single enormous JSONL record may take time to parse; doing that in the worker
// lets the host still answer progress pages and serve its other commands on time.
const WORKER = String.raw`
const { parentPort } = require('node:worker_threads');
const { createInterface } = require('node:readline');
const PAGE_CHARS = ${PAGE_CHARS};
const isMadeUpFinalAnswer = ${isMadeUpFinalAnswer}; // the to-human plugin's answer after a final message, which said nothing
async function* extract(file, size) {
  if (!size) return;
  const input = file.createReadStream({ autoClose: false, end: size - 1 });
  let readBytes = 0;
  input.on('data', (chunk) => {
    readBytes += chunk.length;
    if (readBytes >= 4 * 1024 * 1024) { parentPort.postMessage({ id, progress: true }); readBytes = 0; }
  });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let page = '', first = true, scanned = 0;
  try {
    for await (const line of lines) {
      scanned += Buffer.byteLength(line) + 1;
      let row;
      try { row = JSON.parse(line); } catch { row = null; }
      if (row && ['user', 'assistant'].includes(row.type) && row.isMeta !== true && !isMadeUpFinalAnswer(row)) {
        const content = row.message?.content;
        const blocks = typeof content === 'string' ? [content] : Array.isArray(content)
          ? content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text) : [];
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
      // Tool-only input also yields progress without scanning the file again.
      if (scanned >= 4 * 1024 * 1024) { yield page; page = ''; scanned = 0; }
    }
    return page;
  } finally { lines.close(); input.destroy(); }
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
      reader = extract(file, message.size);
    } else if (message.id === id) {
      const result = await reader.next();
      if (result.done) { await file.close(); file = null; reader = null; }
      parentPort.postMessage({ id, text: result.value ?? '', done: result.done });
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

  async read(path: string, cursor?: string): Promise<{ text: string; cursor: string | null; size: number; mtimeMs: number }> {
    if (this.stopped) throw new Error('Conversation reader stopped');
    if (cursor && (this.active?.id !== cursor || this.active.path !== path)) throw new Error('Conversation read expired; restart indexing');
    if (!cursor) {
      const file = await open(path, 'r');
      try {
        const info = await file.stat();
        if (this.stopped) throw new Error('Conversation reader stopped');
        const worker = this.ensureWorker();
        this.active?.reject?.(new Error('Conversation read superseded'));
        this.active = { id: randomUUID(), path, size: info.size, mtimeMs: info.mtimeMs, lastProgressAt: Date.now(), pending: null };
        worker.postMessage({ type: 'start', id: this.active.id, size: info.size, file }, [file]);
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
      }
      return { text: page?.text ?? '', cursor: page?.done ? null : active.id, size: active.size, mtimeMs: active.mtimeMs };
    } finally { clearTimeout(timer); }
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
