// One local terminal session's jobs, followed from its transcript on disk (P5 O9 M5, the Decision Log's derived-jobs
// entry): each `read` catches the ledger (./jobs.ts) up with the rows appended since the last, a line not yet whole
// waiting for its end. A file replaced (another inode) or cut short is read again from its start. The engine's request
// records hold no row and repeat the conversation, so they are skipped unparsed, as sminos's `task_rows` skips them.
// Read-only: the file is opened with 'r' per read and no descriptor is held between reads.
import { open } from 'node:fs/promises';
import type { Job } from 'desk-hub/protocol';
import { Ledger } from './jobs';

const CHUNK = 4 * 1024 * 1024;
const NEWLINE = 0x0a;
const REQUEST_RECORD = Buffer.from('{"type":"api-request');

const missing = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');

export class TranscriptJobs {
  private ledger = new Ledger();
  private ino: number | null = null;
  private offset = 0;
  private rest: Buffer = Buffer.alloc(0); // the last line's bytes while it has no end
  private path: string | null = null;
  private reading: Promise<void> = Promise.resolve();

  // `locate`: the transcript's path, or null while none is known.
  constructor(private readonly locate: () => Promise<string | null>) {}

  // Catches up with the file as it is now; one catch-up at a time, a second waiting for the first.
  read(): Promise<void> {
    const next = this.reading.then(() => this.catchUp());
    this.reading = next.catch(() => {});
    return next;
  }

  body(sessionRunning: boolean): Job[] {
    return this.ledger.jobsBody(sessionRunning);
  }

  running(task: string): boolean {
    return this.ledger.running(task);
  }

  private async catchUp(): Promise<void> {
    this.path ??= await this.locate();
    if (this.path === null) return;
    let file;
    try {
      file = await open(this.path, 'r');
    } catch (error) {
      if (missing(error)) return;
      throw error;
    }
    try {
      const { ino, size } = await file.stat();
      if (ino !== this.ino || size < this.offset) {
        this.ledger = new Ledger();
        this.ino = ino;
        this.offset = 0;
        this.rest = Buffer.alloc(0);
      }
      while (this.offset < size) {
        const chunk = Buffer.alloc(Math.min(CHUNK, size - this.offset));
        const { bytesRead } = await file.read(chunk, 0, chunk.length, this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        this.lines(Buffer.concat([this.rest, chunk.subarray(0, bytesRead)]));
      }
    } finally {
      await file.close();
    }
  }

  private lines(bytes: Buffer): void {
    let start = 0;
    for (let end = bytes.indexOf(NEWLINE); end >= 0; start = end + 1, end = bytes.indexOf(NEWLINE, start)) {
      const line = bytes.subarray(start, end);
      if (line.length === 0 || line.subarray(0, REQUEST_RECORD.length).equals(REQUEST_RECORD)) continue;
      try {
        this.ledger.add(JSON.parse(line.toString('utf8')));
      } catch {
        // a line that is no JSON is no row
      }
    }
    this.rest = Buffer.from(bytes.subarray(start));
  }
}
