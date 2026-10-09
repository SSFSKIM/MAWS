// cua board #97: main's stdout and stderr are pipes (or a terminal) owned by whoever launched the app. When that end goes
// away (a Ctrl-C'd `pnpm dev` whose Electron lives on, a closed terminal) the next console line fails with EIO or EPIPE.
// Node's console swallows only an error raised during its own write call; one the stream emits afterwards has no
// listener, becomes an uncaught exception, and Electron shows its main-process error dialog. A standing `error` listener
// on each stream makes every console call in main safe at once: a write that cannot reach its reader is dropped, never
// fatal. Nothing is logged about it, since the only place to log is the stream that just failed.
import type { EventEmitter } from 'node:events';

const dropWriteError = (): void => {};

export function guardStdio(streams: readonly (EventEmitter | null | undefined)[]): void {
  for (const stream of streams) stream?.on('error', dropWriteError);
}
