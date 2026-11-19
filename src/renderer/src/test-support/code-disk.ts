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
// UX wave U6b-2 (M5): main's file frames. `layout.frameFile` answers a fresh token of the path's framed kind (`frames`
// answers otherwise when the test gives it), `layout.releaseFrame` is recorded and answered; every token issued is listed.
// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, M4): `answers` stands for
// main's adapter where a test needs what it answers before the disk is asked (a refusal in UC-7's words, `issues.refusal`
// beside it), and `overRl2` makes a session one main runs on another machine over RL2, its machine as the roster says it.
// UX wave U6b-4c (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, M4; Interfaces §F): `files.follow`,
// from the links its setup is given (`links`: per source, the path it links). A follow records the target's real path for
// the session as the daemon does, when its answer is given (so a held follow has recorded nothing yet): for a Markdown
// file, when the source itself is one a named read of the session admits, a save where the source admits one (R4) and
// `linked` where it does not (only a tool's result or the Library names it, or it is MAWS's own); for a subagent, as its
// link says (`why: 'result'` for a result form). `inside` for a path inside the folders, `not-linked` for anything else
// (an unknown source or link, a source not admitted, a target that is not there), and `unknown_command` from an older
// daemon. A record admits a read by name and a save for a caller that is not the agent, as a grant does, after it (one
// that admits a save) or after the tool's result (one that does not, answered `why: 'result', linked: true`, or `why:
// 'result'` alone for a subagent's result form); `unlink` drops it, as a record pushed out is gone.
import type { CommandName } from '@shared/ipc/schema';
import { framedKindOf, frameUrl } from '@shared/files/framed';
import { mimeOf } from '@shared/files/mime';
import { OUTSIDE_FILES_CAPABILITY } from '@shared/files/outside';
import { FILES_MOVED, FILES_READ_DEFAULT_LENGTH } from '@shared/ipc/schema/files';
import type { OpenFileOutput } from '@shared/ipc/schema/layout';
import type { MachineState } from '@shared/ipc/schema/machines';
import { bareOf, machineOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { deferred, fail, installFakeMain, ok } from './code';
import { utf8Length } from '../tools/code/viewer/viewer-store';

// A file on the fake disk: its text, and its size when the test wants it to differ from the text's UTF-8 length (a
// file past a cap), and `utf8: false` for bytes that are not valid UTF-8 (the decoded text a lossy one; main's strict
// decode answers false). A plain string is valid UTF-8.
// UX wave U6b-2: `mime` for a file whose type is not its name's (a file that changed kind under the same path).
export type DiskFile = string | { text: string; bytes: number; utf8?: boolean; mime?: string };

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

// UX wave U6b-2: the `n`th token the fake main issues, 32 lower-case hexadecimal characters built, never written out.
export const frameToken = (n: number): string => n.toString(16).padStart(32, 'a');

type Answer = ReturnType<typeof ok>;
// What main answers `layout.frameFile` for a path: by default a ready token of the path's framed kind (an HTML page that
// names no file beside it), `unframed` for another type.
export type FrameAnswerer = (input: { appSessionId: string; path: string }, issue: (extra?: { neighbours?: boolean }) => Answer) => Answer;

export interface DiskOptions {
  outside?: Iterable<string>; // folders outside the session's; a test adds and removes them through the returned `outside`
  names?: (appSessionId: string, path: string) => boolean; // whether the session's transcript names the path (bare ids); U6e: by a counted form
  frames?: FrameAnswerer; // UX wave U6b-2: main's answer to `layout.frameFile`, when not the default
  // UX wave U6e
  results?: (appSessionId: string, path: string) => boolean; // only a tool's result names the path
  sent?: (appSessionId: string, path: string) => boolean; // the session's agent delivered the file
  added?: Iterable<string>; // files an added record of the Library points at
  own?: Iterable<string>; // MAWS's own folders, through the returned `own`
  older?: boolean; // a daemon of the parent pin, through the returned `daemon.older`
  // UX wave U6f: main's answer before the disk's, where it gives one (null: the disk answers), through the returned `answers`
  answers?: (name: CommandName, input: Record<string, unknown>) => Answer | null;
  links?: Iterable<DiskLink>; // UX wave U6b-4c: what each source links, through the returned `links`
}

/** UX wave U6b-4c: a link the daemon finds: in a Markdown file (its strength the file's own), or in a subagent's transcript. */
export type DiskLink = { from: { file: string } | { agent: string; why?: 'result' }; path: string };

/** UX wave U6f: a failure as main's adapter words one of UC-7's refusals, the code in `issues.refusal`. */
export const refused = (message: string, refusal: string, code = 'internal'): Answer => ({ ok: false, error: { code, message, issues: { refusal } } } as Answer);

/** UX wave U6f: the machine studio, up, listing the capability, the person one of its owners, as the roster says it. */
export const STUDIO = (ref: MachineState['ref'], over: Partial<MachineState> = {}): MachineState => ({
  ref, name: 'studio', local: false, state: 'up', since: '2026-11-17T10:00:00.000Z', generation: 1, carrier: 'relay', capabilities: [OUTSIDE_FILES_CAPABILITY], owner: true, ...over,
});

/** UX wave U6f: the session (an address) is one main runs on another machine over RL2 (`lane` B, or a terminal's A), that machine as `over` says. */
export function overRl2(appSessionId: string, over: Partial<MachineState> = {}, lane: 'A' | 'B' = 'B'): void {
  const machine = machineOf(appSessionId);
  useSessions.setState((s) => ({
    listed: new Map(s.listed).set(appSessionId as never, { ...remoteRow(machine, bareOf(appSessionId), { lane }), appId: appSessionId as never }),
    listedMachines: new Set([...s.listedMachines, machine]),
  }));
  useMachines.getState().applyRoster([STUDIO(machine, over)]);
}

/** The roster again, the session's machine as `over` says it now. */
export function rosterSays(appSessionId: string, over: Partial<MachineState>): void {
  useMachines.getState().applyRoster([STUDIO(machineOf(appSessionId), over)]);
}

/** Forgets every session `overRl2` listed and the roster. */
export function leaveRl2(): void {
  useSessions.setState({ listed: new Map(), listedMachines: new Set() });
  useMachines.setState({ machines: new Map(), roster: 'unread' });
}

const unknownCommand = (name: CommandName) => ({ ok: false as const, error: { code: 'unknown_command', message: `unknown command: ${name}` } });

export function installDisk(files: Record<string, DiskFile>, options: DiskOptions = {}) {
  const outside = new Set(options.outside ?? []);
  const under = (folders: Iterable<string>, path: string) => [...folders].some((folder) => path === folder || path.startsWith(`${folder}/`));
  // a call with no path (the Files tree's listing of the roots) is of no folder
  const isOutside = (path: string | undefined) => path !== undefined && under(outside, path);
  // UX wave U6e
  const own = new Set(options.own ?? []);
  const added = new Set(options.added ?? []);
  const reals: Record<string, string> = {};
  const realOf = (path: string) => reals[path] ?? path;
  const grants = new Set<string>();
  const granted = (appSessionId: string, real: string) => grants.has(`${appSessionId}\0${real}`);
  const daemon = { older: options.older === true };
  // UX wave U6b-4c: the links the daemon would find, and the records its follows wrote (session and real path: why, null a save)
  const links: DiskLink[] = [...(options.links ?? [])];
  const records = new Map<string, 'linked' | 'result' | null>();
  const recordOf = (appSessionId: string, real: string) => records.get(`${appSessionId}\0${real}`);
  let pick: (appSessionId: string) => OpenFileOutput = () => ({ status: 'cancelled' });
  // What admits a path outside the folders for the session (§B's step 5): a save takes no result and no added record.
  // UX wave U6b-4c: and a link record, beside the grant when it admits a save, after the tool's result when it does not.
  const markOf = (appSessionId: string, path: string, { agent, save }: { agent: boolean; save: boolean }): 'chosen' | 'linked' | 'sent' | 'named' | 'result' | 'link-only' | 'added' | null => {
    if (!agent && granted(appSessionId, realOf(path))) return 'chosen';
    const link = agent ? undefined : recordOf(appSessionId, realOf(path));
    if (link === null) return 'linked';
    if (options.sent?.(appSessionId, path)) return 'sent';
    if (options.names?.(appSessionId, path)) return 'named';
    if (save) return null;
    if (options.results?.(appSessionId, path)) return 'result';
    if (link !== undefined) return link === 'result' ? 'result' : 'link-only';
    if (added.has(path)) return 'added';
    return null;
  };
  const readOnlyMark = (mark: ReturnType<typeof markOf>) => mark === 'result' || mark === 'added' || mark === 'link-only';
  // UX wave U6b-4c: the follow, as §D orders it: a path inside the folders needs no record; the source is admitted as a named
  // read admits it, and holds the link; the target is there; the record is written, never lowered from a save.
  const follow = (input: Record<string, unknown>) => {
    if (daemon.older) return unknownCommand('files.follow');
    const appSessionId = input.appSessionId as string;
    const path = input.path as string;
    const from = input.from as { file: string } | { agent: string };
    if (!isOutside(path)) return ok({ status: 'inside' });
    const link = links.find((candidate) => candidate.path === path && ('file' in from ? 'file' in candidate.from && candidate.from.file === from.file : 'agent' in candidate.from && candidate.from.agent === from.agent));
    if (link === undefined || textOf(path) === undefined) return ok({ status: 'not-linked' });
    let why: 'linked' | 'result' | null;
    if ('file' in link.from) {
      const source = link.from.file;
      const mark = isOutside(source) ? markOf(appSessionId, source, { agent: false, save: false }) : null; // inside: admitted as such
      if ((isOutside(source) && mark === null) || textOf(source) === undefined) return ok({ status: 'not-linked' });
      why = readOnlyMark(mark) || under(own, realOf(source)) ? 'linked' : null;
    } else why = link.from.why ?? null;
    const key = `${appSessionId}\0${realOf(path)}`;
    if (records.get(key) !== null) records.set(key, why);
    return ok({ status: 'linked' });
  };
  const held = new Map<CommandName, ReturnType<typeof deferred<void>>[]>();
  const issued: string[] = []; // UX wave U6b-2: every token `layout.frameFile` answered, in order
  const frameFile = (input: { appSessionId: string; path: string }) => {
    const issue = (extra: { neighbours?: boolean } = {}) => {
      const served = files[input.path];
      const framed = framedKindOf((typeof served === 'object' && served.mime) || mimeOf(input.path));
      if (framed === null) return ok({ status: 'row', why: 'unframed' });
      const token = frameToken(issued.length + 1);
      issued.push(token);
      return ok({ status: 'ready', token, url: frameUrl(token, input.path.slice(input.path.lastIndexOf('/') + 1)), framed, ...(framed === 'html' ? { neighbours: extra.neighbours ?? false } : {}) });
    };
    return options.frames ? options.frames(input, issue) : issue();
  };
  const textOf = (path: string) => {
    const file = files[path];
    return file === undefined ? undefined : typeof file === 'string' ? { text: file, bytes: utf8Length(file), utf8: true, mime: undefined } : { utf8: true, ...file };
  };

  const answers = { by: options.answers ?? (() => null) };
  const answer = (name: CommandName, input: Record<string, unknown>) => {
    const said = answers.by(name, input); // UX wave U6f: main's own answer first
    if (said !== null) return said;
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
    if (name === 'files.follow') return follow(input); // UX wave U6b-4c
    if (name === 'layout.frameFile') return frameFile(input as { appSessionId: string; path: string }); // UX wave U6b-2
    if (name === 'layout.releaseFrame') return ok();
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
          ...(named ? { outside: { real: realOf(path), writable: !readOnlyMark(mark), ...(mark === 'result' || mark === 'added' ? { why: mark } : mark === 'link-only' ? { why: 'result', linked: true } : {}) } } : {}),
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
        encoding: 'utf8', content: file.text.slice(offset, end), bytes: file.bytes, offset, length: end - offset, truncated: end < file.bytes, mime: file.mime ?? mimeOf(path),
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

  // A follow is answered as the disk is when its answer is released (U6b-4c: the daemon writes the record right before it
  // answers), every other call as the disk is when it arrives.
  const main = installFakeMain(async (name, input) => {
    const result = name === 'files.follow' ? null : answer(name, input);
    const gate = held.get(name)?.shift();
    if (gate) await gate.promise;
    return result ?? answer(name, input);
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
    answers, // UX wave U6f: `answers.by` replaced by the test as main's adapter answers
    grant: (appSessionId: string, path: string) => void grants.add(`${appSessionId}\0${realOf(path)}`),
    picks: (next: (appSessionId: string) => OpenFileOutput) => void (pick = next),
    issued, // UX wave U6b-2
    links, // UX wave U6b-4c: what each source links, as the daemon would find it now
    /** UX wave U6b-4c: whether a follow recorded the path for the session; `why` null when the record admits a save. */
    linked: (appSessionId: string, path: string) => (records.has(`${appSessionId}\0${realOf(path)}`) ? { why: records.get(`${appSessionId}\0${realOf(path)}`)! } : null),
    unlink: (appSessionId: string, path: string) => void records.delete(`${appSessionId}\0${realOf(path)}`), // UX wave U6b-4c
    released: () => main.callsOf('layout.releaseFrame').map((input) => input.token as string), // UX wave U6b-2
    // The next call of `name` is answered (as the disk is when it arrives) only once the returned gate is released.
    hold(name: CommandName) {
      const gate = deferred<void>();
      held.set(name, [...(held.get(name) ?? []), gate]);
      return { release: () => gate.resolve() };
    },
  };
}
