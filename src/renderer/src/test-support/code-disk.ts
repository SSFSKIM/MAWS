// The editor suites' main (E5 M2): a fake X2 bridge over an in-memory disk that answers `files.read` with the file's
// hash when asked and `files.write` by comparing hashes, as main's service does. Each answer is computed when its call
// arrives (the disk as it is then) and may be held back by the test, so an answer can land after later events: the
// interleavings the editing state machine's commit-time rules are about.
// UX wave U6c: folders outside the session's (`outside`), and the files there its transcript names (`names`): as the
// service, a read or an "Open externally" of such a file answers only when it asks with `named` and the transcript
// names the path, a read then answering `named: true`; any other call on a path there answers the refusal.
import type { CommandName } from '@shared/ipc/schema';
import { mimeOf } from '@shared/files/mime';
import { FILES_READ_DEFAULT_LENGTH } from '@shared/ipc/schema/files';
import { deferred, fail, installFakeMain, ok } from './code';
import { utf8Length } from '../tools/code/viewer/viewer-store';

// A file on the fake disk: its text, and its size when the test wants it to differ from the text's UTF-8 length (a
// file past a cap), and `utf8: false` for bytes that are not valid UTF-8 (the decoded text a lossy one; main's strict
// decode answers false). A plain string is valid UTF-8.
export type DiskFile = string | { text: string; bytes: number; utf8?: boolean };

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

export const OUTSIDE_REFUSAL = "path outside the session's directories";

export interface DiskOptions {
  outside?: Iterable<string>; // folders outside the session's; a test adds and removes them through the returned `outside`
  names?: (appSessionId: string, path: string) => boolean; // whether the session's transcript names the path (bare ids)
}

export function installDisk(files: Record<string, DiskFile>, options: DiskOptions = {}) {
  const outside = new Set(options.outside ?? []);
  const isOutside = (path: string) => [...outside].some((folder) => path === folder || path.startsWith(`${folder}/`));
  const held = new Map<CommandName, ReturnType<typeof deferred<void>>[]>();
  const textOf = (path: string) => {
    const file = files[path];
    return file === undefined ? undefined : typeof file === 'string' ? { text: file, bytes: utf8Length(file), utf8: true } : { utf8: true, ...file };
  };

  const answer = (name: CommandName, input: Record<string, unknown>) => {
    if (name === 'files.watch' && isOutside(input.path as string)) return fail(OUTSIDE_REFUSAL); // a folder outside is never watched
    if (name === 'files.watch' || name === 'files.unwatch') return ok();
    if (name === 'layout.unsavedFiles' || name === 'layout.saveAllDone') return ok(); // M5: the quit guard's, recorded only
    const path = input.path as string;
    const file = textOf(path);
    const named = isOutside(path) && (name === 'files.read' || name === 'files.openExternal') && input.named === true && options.names?.(input.appSessionId as string, path) === true;
    if (isOutside(path) && !named) return fail(OUTSIDE_REFUSAL);
    if (name === 'files.openExternal') return file === undefined ? fail(`not found: ${path}`) : ok({ opened: true, message: null });
    if (name === 'files.read') {
      if (file === undefined) return fail(`not found: ${path}`);
      const offset = (input.offset as number | undefined) ?? 0;
      const length = (input.length as number | undefined) ?? FILES_READ_DEFAULT_LENGTH;
      // the suites' multi-chunk files are ASCII; past the end, zero bytes (main's `Math.max(0, …)`)
      const end = Math.max(offset, Math.min(file.text.length, offset + length));
      return ok({
        encoding: 'utf8', content: file.text.slice(offset, end), bytes: file.bytes, offset, length: end - offset, truncated: end < file.bytes, mime: mimeOf(path),
        hash: input.hash === true ? fakeHash(file.text) : null,
        utf8: input.hash === true ? file.utf8 : null,
        ...(named ? { named: true } : {}),
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
    outside,
    // The next call of `name` is answered (as the disk is when it arrives) only once the returned gate is released.
    hold(name: CommandName) {
      const gate = deferred<void>();
      held.set(name, [...(held.get(name) ?? []), gate]);
      return { release: () => gate.resolve() };
    },
  };
}
