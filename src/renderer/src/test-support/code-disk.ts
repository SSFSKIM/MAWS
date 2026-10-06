// The editor suites' main (E5 M2): a fake X2 bridge over an in-memory disk that answers `files.read` with the file's
// hash when asked and `files.write` by comparing hashes, as main's service does. Each answer is computed when its call
// arrives (the disk as it is then) and may be held back by the test, so an answer can land after later events: the
// interleavings the editing state machine's commit-time rules are about.
import type { CommandName } from '@shared/ipc/schema';
import { mimeOf } from '@shared/files/mime';
import { FILES_READ_DEFAULT_LENGTH } from '@shared/ipc/schema/files';
import { deferred, fail, installFakeMain, ok } from './code';
import { utf8Length } from '../tools/code/viewer/viewer-store';

// A file on the fake disk: its text, and its size when the test wants it to differ from the text's UTF-8 length (a
// lossy decode, a file past a cap).
export type DiskFile = string | { text: string; bytes: number };

// A stand-in for SHA-256: 64 lowercase hex characters, a function of the text alone.
export function fakeHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b + text.charCodeAt(i), 0x5bd1e995) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  return (hex(a) + hex(b)).repeat(4);
}

export function installDisk(files: Record<string, DiskFile>) {
  const held = new Map<CommandName, ReturnType<typeof deferred<void>>[]>();
  const textOf = (path: string) => {
    const file = files[path];
    return file === undefined ? undefined : typeof file === 'string' ? { text: file, bytes: utf8Length(file) } : file;
  };

  const answer = (name: CommandName, input: Record<string, unknown>) => {
    if (name === 'files.watch' || name === 'files.unwatch') return ok();
    const path = input.path as string;
    const file = textOf(path);
    if (name === 'files.read') {
      if (file === undefined) return fail(`not found: ${path}`);
      const offset = (input.offset as number | undefined) ?? 0;
      const length = (input.length as number | undefined) ?? FILES_READ_DEFAULT_LENGTH;
      const end = Math.min(file.text.length, offset + length); // the suites' multi-chunk files are ASCII
      return ok({
        encoding: 'utf8', content: file.text.slice(offset, end), bytes: file.bytes, offset, length: end - offset, truncated: end < file.bytes, mime: mimeOf(path),
        hash: input.hash === true ? fakeHash(file.text) : null,
      });
    }
    if (name === 'files.write') {
      if (file === undefined) return fail(`not found: ${path}`);
      const current = fakeHash(file.text);
      if (current !== input.expectedHash) return ok({ status: 'conflict', hash: current });
      files[path] = input.content as string;
      return ok({ status: 'ok', hash: fakeHash(input.content as string) });
    }
    return fail(`unexpected ${name}`);
  };

  const main = installFakeMain(async (name, input) => {
    const result = answer(name, input);
    const gate = held.get(name)?.shift();
    if (gate) await gate.promise;
    return result;
  });

  return {
    ...main,
    files,
    // The next call of `name` is answered (as the disk is when it arrives) only once the returned gate is released.
    hold(name: CommandName) {
      const gate = deferred<void>();
      held.set(name, [...(held.get(name) ?? []), gate]);
      return { release: () => gate.resolve() };
    },
  };
}
