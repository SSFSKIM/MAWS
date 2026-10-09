import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { guardStdio } from './stdio-guard';

const ioError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`write ${code}`), { code, errno: -5, syscall: 'write' });

// A stream whose reader has gone: every write fails the way a closed terminal's or a dead pipe's does.
const deadPipe = (code: string) => new Writable({ write: (_chunk, _encoding, callback) => callback(ioError(code)) });

describe('guardStdio (cua board #97)', () => {
  it('turns an EIO the stream emits into a dropped write instead of a throw', () => {
    const unguarded = new EventEmitter();
    expect(() => unguarded.emit('error', ioError('EIO'))).toThrow('write EIO');
    const guarded = new EventEmitter();
    guardStdio([guarded]);
    expect(() => guarded.emit('error', ioError('EIO'))).not.toThrow();
  });

  it('keeps a dead pipe non-fatal for the failing write and every write after it', async () => {
    for (const code of ['EIO', 'EPIPE']) {
      const stream = deadPipe(code);
      guardStdio([stream]);
      stream.write('[ipc] git.watch failed NotARepositoryError\n');
      await new Promise((resolve) => setImmediate(resolve)); // the error is emitted after the write returns
      expect(stream.destroyed, code).toBe(true);
      stream.write('the next line\n'); // a write to the destroyed stream errors too, and is dropped as well
      await new Promise((resolve) => setImmediate(resolve));
    }
  });

  it('skips a stream that does not exist', () => {
    expect(() => guardStdio([undefined, null])).not.toThrow();
  });
});
