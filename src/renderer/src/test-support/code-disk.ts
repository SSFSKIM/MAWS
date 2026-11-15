// The editor suites' main (E5 M2): a fake X2 bridge over an in-memory disk that answers `files.read` with the file's
// hash when asked and `files.write` by comparing hashes, as main's service does. Each answer is computed when its call
// arrives (the disk as it is then) and may be held back by the test, so an answer can land after later events: the
// interleavings the editing state machine's commit-time rules are about.
// UX wave U6c: folders outside the session's (`outside`), and the files there its transcript names (`names`): as the
// service, a read or an "Open externally" of such a file answers only when it asks with `named` and the transcript
// names the path, a read then answering `named: true`; any other call on a path there answers the refusal.
// UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, M3): what the daemon gained. A file
// outside the folders stands admitted for a session by a grant (`grant`, which an `agent` read skips), the agent's
// delivery (`sent`), a counted name (`names`), and, for a read alone, a name only a tool's result holds (`results`) or an
// added record of the Library (`added`); a read of such a file answers `named` with `outside: { real, writable, why? }`,
// and a read of a file under MAWS's own folders (`own`) answers `own`. `files.writeOutside` writes by the save's evidence
// alone, refuses MAWS's own folders and a path that no longer resolves to the real path it names (`FILES_MOVED`), and
// `files.write` takes the folders alone. A path's real path is itself unless `reals` says otherwise. `layout.openFile`
// answers `pick`'s answer, an `opened` one recorded as a grant as main and the daemon record it. `older` is a daemon of
// the parent pin (`2c7044231`): `named` with no `outside` and no `own`, and `unknown_command` for the two new commands.
import type { CommandName } from '@shared/ipc/schema';
import { mimeOf } from '@shared/files/mime';
import { FILES_MOVED, FILES_READ_DEFAULT_LENGTH } from '@shared/ipc/schema/files';
import type { OpenFileOutput } from '@shared/ipc/schema/layout';
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
  names?: (appSessionId: string, path: string) => boolean; // whether the session's transcript names the path (bare ids); U6e: by a counted form
  // UX wave U6e
  results?: (appSessionId: string, path: string) => boolean; // only a tool's result names the path
  sent?: (appSessionId: string, path: string) => boolean; // the session's agent delivered the file
  added?: Iterable<string>; // files an added record of the Library points at
  own?: Iterable<string>; // MAWS's own folders, through the returned `own`
  older?: boolean; // a daemon of the parent pin, through the returned `daemon.older`
}

const unknownCommand = (name: CommandName) => ({ ok: false as const, error: { code: 'unknown_command', message: `unknown command: ${name}` } });

export function installDisk(files: Record<string, DiskFile>, options: DiskOptions = {}) {
  const outside = new Set(options.outside ?? []);
  const under = (folders: Iterable<string>, path: string) => [...folders].some((folder) => path === folder || path.startsWith(`${folder}/`));
  const isOutside = (path: string) => under(outside, path);
  // UX wave U6e
  const own = new Set(options.own ?? []);
  const added = new Set(options.added ?? []);
  const reals: Record<string, string> = {};
  const realOf = (path: string) => reals[path] ?? path;
  const grants = new Set<string>();
  const granted = (appSessionId: string, real: string) => grants.has(`${appSessionId}\0${real}`);
  const daemon = { older: options.older === true };
  let pick: (appSessionId: string) => OpenFileOutput = () => ({ status: 'cancelled' });
  // What admits a path outside the folders for the session (§B's step 5): a save takes no result and no added record.
  const markOf = (appSessionId: string, path: string, { agent, save }: { agent: boolean; save: boolean }): 'chosen' | 'sent' | 'named' | 'result' | 'added' | null => {
    if (!agent && granted(appSessionId, realOf(path))) return 'chosen';
    if (options.sent?.(appSessionId, path)) return 'sent';
    if (options.names?.(appSessionId, path)) return 'named';
    if (save) return null;
    if (options.results?.(appSessionId, path)) return 'result';
    if (added.has(path)) return 'added';
    return null;
  };
  const held = new Map<CommandName, ReturnType<typeof deferred<void>>[]>();
  const textOf = (path: string) => {
    const file = files[path];
    return file === undefined ? undefined : typeof file === 'string' ? { text: file, bytes: utf8Length(file), utf8: true } : { utf8: true, ...file };
  };

  const answer = (name: CommandName, input: Record<string, unknown>) => {
    if (name === 'files.watch' && isOutside(input.path as string)) return fail(OUTSIDE_REFUSAL); // a folder outside is never watched
    if (name === 'files.watch' || name === 'files.unwatch') return ok();
    if (name === 'layout.unsavedFiles' || name === 'layout.saveAllDone') return ok(); // M5: the quit guard's, recorded only
    if (name === 'layout.get') return ok({ value: null }); // UX wave U6b-1 (M3): nothing stored, Files' tree state among it
    if (name === 'layout.set') return ok();
    if (name === 'layout.openFile') {
      const answer = pick(input.appSessionId as string);
      if (answer.status === 'opened') grants.add(`${input.appSessionId as string}\0${realOf(answer.path)}`);
      return ok(answer);
    }
    if ((name === 'files.writeOutside' || name === 'files.grant') && daemon.older) return unknownCommand(name);
    const path = input.path as string;
    const file = textOf(path);
    const appSessionId = input.appSessionId as string;
    if (name === 'files.writeOutside') {
      if (isOutside(path) && markOf(appSessionId, path, { agent: false, save: true }) === null) return fail(OUTSIDE_REFUSAL);
      if (file === undefined) return fail(`not found: ${path}`);
      if (under(own, realOf(path))) return fail(`not writable: ${path}`);
      if (realOf(path) !== input.real) return fail(FILES_MOVED);
      return written(path, file.text, input);
    }
    const reading = (name === 'files.read' || name === 'files.openExternal') && input.named === true;
    const mark = isOutside(path) && reading ? (daemon.older ? (options.names?.(appSessionId, path) || options.results?.(appSessionId, path) ? 'named' : null) : markOf(appSessionId, path, { agent: input.agent === true, save: false })) : null;
    const named = mark !== null;
    if (isOutside(path) && !named) return fail(OUTSIDE_REFUSAL);
    // U6e: what a read of this build's daemon answers beside `named`, and of MAWS's own
    const admission = daemon.older
      ? {}
      : {
          ...(named ? { outside: { real: realOf(path), writable: mark !== 'result' && mark !== 'added', ...(mark === 'result' || mark === 'added' ? { why: mark } : {}) } } : {}),
          ...(under(own, realOf(path)) ? { own: true } : {}),
        };
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
        ...admission,
      });
    }
    if (name === 'files.write') {
      if (file === undefined) return fail(`not found: ${path}`);
      if (!daemon.older && under(own, realOf(path))) return fail(`not writable: ${path}`);
      return written(path, file.text, input);
    }
    return fail(`unexpected ${name}`);
  };
  // The hash compared and the file written in place, as both writes share it.
  const written = (path: string, text: string, input: Record<string, unknown>) => {
    const current = fakeHash(text);
    if (current !== input.expectedHash) return ok({ status: 'conflict', hash: current });
    files[path] = input.content as string;
    return ok({ status: 'ok', hash: fakeHash(input.content as string) });
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
    // UX wave U6e
    own,
    added,
    reals,
    daemon,
    grant: (appSessionId: string, path: string) => void grants.add(`${appSessionId}\0${realOf(path)}`),
    picks: (next: (appSessionId: string) => OpenFileOutput) => void (pick = next),
    // The next call of `name` is answered (as the disk is when it arrives) only once the returned gate is released.
    hold(name: CommandName) {
      const gate = deferred<void>();
      held.set(name, [...(held.get(name) ?? []), gate]);
      return { release: () => gate.resolve() };
    },
  };
}
