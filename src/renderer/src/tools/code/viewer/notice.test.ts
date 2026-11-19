// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, M3; Interfaces §C, "The sentences a person
// reads"): the classifier of a failed read, as a table. Each failure is what the window meets: the files service's plain
// errors (code `internal`, the message alone), the route's codes, `refusalError`'s `refused <code> by machine <name>`, and
// U6f's answers for the outside act ("Not opened: " and the machine's sentence, or UC-7's sentence with its refusal).
import { describe, expect, it } from 'vitest';
import { failureWords, refusalWords } from '@shared/ipc/remote-unavailable';
import { FILES_MOVED } from '@shared/ipc/schema/files';
import { NOT_KEPT_REFUSAL } from '@shared/files/outside';
import { classifyFailure, failureOf, type FileFailure, type NoticeCause } from './notice';

const OUTSIDE = "path outside the session's directories";
const HERE = "MAWS opens a file from elsewhere when this session's transcript links it, when you choose it with File ▸ Open File…, or when the agent sends it.";
const ASK = 'Ask the agent to send the file to see it here.';
const OTHER_FILE = 'This file could not be opened.';
const OTHER_FOLDER = 'This folder could not be listed.';

const plain = (message: string): FileFailure => ({ code: 'internal', message, refusal: null });
const refusedBy = (code: string, machine = 'studio'): FileFailure => ({ code: 'internal', message: `files.read: refused ${code} by machine ${machine}`, refusal: code });
const act = (sentence: string): FileFailure => failureOf({ code: 'internal', message: failureWords('files.readOutside', sentence) });
const actRefused = (refusal: string, code: 'internal' | 'host_unavailable' = 'internal'): FileFailure =>
  failureOf({ code, message: refusalWords('files.readOutside', 'studio', refusal), issues: { refusal } });

// what main answers when the other machine's ledger kept no answer for the outside act, asked again once (U6f, decision 4):
// the services' words, under main's refusal word (src/main/lane-b/remote-outcomes.ts)
const notKept = failureOf({ code: 'internal', message: 'the answer was not kept: ask again', issues: { refusal: NOT_KEPT_REFUSAL } });

const mac = { machine: null, mine: null } as const;
const studio = (mine: boolean | null) => ({ machine: 'studio', mine });

type Row = [string, FileFailure, { machine: string | null; mine: boolean | null }, 'file' | 'folder', NoticeCause, readonly string[], boolean];

// [what, failure, where, subject, cause, lines, retry]
const ROWS: Row[] = [
  // this Mac: every message of "What a failed read carries"
  ['outside, a file, this Mac', plain(OUTSIDE), mac, 'file', 'outside', ['This file is outside the folders this session works in.', HERE, ASK], false],
  ['outside, a folder, this Mac', plain(OUTSIDE), mac, 'folder', 'outside', ['This folder is outside the folders this session works in.'], false],
  ['not found, a file', plain('not found: /r/gone.md'), mac, 'file', 'not-found', ['No file at this path.'], false],
  ['not found, a folder', plain('not found: /r/gone'), mac, 'folder', 'not-found', ['No folder at this path.'], false],
  ['a relative path', plain('path must be absolute'), mac, 'file', 'other', [OTHER_FILE], false],
  ['an unknown session', plain('unknown app session: app-x'), mac, 'file', 'other', [OTHER_FILE], false],
  ['not a regular file', plain('not a regular file: /r/dev'), mac, 'file', 'other', [OTHER_FILE], false],
  ['changed while reading', plain('changed while reading: /r/a.ts'), mac, 'file', 'other', [OTHER_FILE], false],
  ['anything else, a folder', plain('not a directory: /r/a.ts'), mac, 'folder', 'other', [OTHER_FOLDER], false],
  ['this Mac’s daemon not answering', { code: 'host_unavailable', message: 'files.read: the files service is not running', refusal: null }, mac, 'file', 'unreachable', ["MAWS's service on this Mac is not answering."], true],
  ['this Mac’s daemon timing out, a folder', { code: 'timeout', message: 'files.list: no answer in 10 s', refusal: null }, mac, 'folder', 'unreachable', ["MAWS's service on this Mac is not answering."], true],
  ['a grade refusal means nothing on this Mac', refusedBy('grade'), { machine: null, mine: true }, 'file', 'other', [OTHER_FILE], false],

  // another machine, the plain read
  ['outside there, the plain read', plain(OUTSIDE), studio(true), 'file', 'outside', ['This file is outside the folders this session works in on studio.', ASK], false],
  ['outside there, a folder', plain(OUTSIDE), studio(false), 'folder', 'outside', ['This folder is outside the folders this session works in on studio.'], false],
  ['not found there', plain('not found: /r/gone.md'), studio(null), 'file', 'not-found', ['No file at this path on studio.'], false],
  ['not found there, a folder', plain('not found: /r/gone'), studio(true), 'folder', 'not-found', ['No folder at this path on studio.'], false],
  ['the link offline', { code: 'host_unavailable', message: 'files.read: machine studio is not reachable', refusal: null }, studio(true), 'file', 'unreachable', ['studio is not reachable.'], true],
  ['the machine unavailable', { code: 'host_unavailable', message: 'files.read: machine studio is unavailable', refusal: null }, studio(false), 'folder', 'unreachable', ['studio is not reachable.'], true],
  ['a timeout there', { code: 'timeout', message: 'files.read: machine studio did not answer in time', refusal: null }, studio(null), 'file', 'unreachable', ['studio is not reachable.'], true],
  ['an IPC code passed through', { code: 'invalid_input', message: 'files.read: bad input', refusal: null }, studio(true), 'file', 'other', [OTHER_FILE], false],
  ['grade, the person’s own session', refusedBy('grade'), studio(true), 'file', 'not-on-record', ['studio does not have this session on record right now.'], true],
  ['grade, someone else’s session', refusedBy('grade'), studio(false), 'file', 'no-access', ['Your access to this session on studio does not include its files.'], false],
  ['grade, no listing', refusedBy('grade'), studio(null), 'file', 'other', [OTHER_FILE], true],
  ['grade, no listing, a folder', refusedBy('grade'), studio(null), 'folder', 'other', [OTHER_FOLDER], true],
  ['grade, someone else’s, a folder', refusedBy('grade'), studio(false), 'folder', 'no-access', ['Your access to this session on studio does not include its files.'], false],
  ['a link that closed mid-call', refusedBy('closed'), studio(true), 'file', 'other', [OTHER_FILE], false],
  ['a link removed mid-call', refusedBy('removed'), studio(true), 'file', 'other', [OTHER_FILE], false],
  ['a machine that offers no read at all', refusedBy('not-offered'), studio(true), 'file', 'other', [OTHER_FILE], false],

  // another machine, the outside act (U6f): its answer leads with "Not opened: "
  ['the act ran and found the path outside', act(OUTSIDE), studio(true), 'file', 'outside', ['This file is outside the folders this session works in on studio.', HERE, ASK], false],
  ['the act ran and found no file', act('not found: /elsewhere/gone.md'), studio(true), 'file', 'not-found', ['No file at this path on studio.'], false],
  ['the act ran and the path moved', act(FILES_MOVED), studio(true), 'file', 'other', [OTHER_FILE], false],
  ['the act refused: only the owners', actRefused('owners-only'), studio(false), 'file', 'said', ['Not opened: only studio’s owners can'], false],
  ['the act refused: an older MAWS there', actRefused('not-offered'), studio(true), 'file', 'said', ['Not opened: update MAWS on studio and try again'], false],
  ['the act refused: the confirmation cancelled', actRefused('step-up'), studio(true), 'file', 'said', ['Not opened: the confirmation was cancelled'], false],
  ['the act refused at grade is the act’s sentence, not the read’s', actRefused('grade'), studio(true), 'file', 'said', [refusalWords('files.readOutside', 'studio', 'grade')], false],
  ['the act not sent, the machine offline', actRefused('offline', 'host_unavailable'), studio(true), 'file', 'unreachable', ['studio is not reachable.'], true],
  // the branch review: an answer the machine did not keep, twice, is asked for again by Retry
  ['the act’s answer not kept', notKept, studio(true), 'file', 'other', [OTHER_FILE], true],
  ['the listing’s answer not kept', notKept, studio(true), 'folder', 'other', [OTHER_FOLDER], true],
];

describe('classifyFailure', () => {
  it.each(ROWS)('%s', (_, failure, where, subject, cause, lines, retry) => {
    const notice = classifyFailure(failure, { ...where, subject });
    expect(notice).toMatchObject({ cause, lines, retry, copyPath: cause === 'outside' });
    // the command's own words, drawn small; none under UC-7's sentence, which is the message already
    expect(notice.detail).toBe(cause === 'said' ? '' : failure.message);
  });

  it('no sentence of any notice begins with “Refused” or with a command’s name', () => {
    for (const [, failure, where, subject] of ROWS) {
      for (const line of classifyFailure(failure, { ...where, subject }).lines) expect(line).not.toMatch(/^(Refused|files\.)/);
    }
  });

  it('the act is told by failureWords’ own lead: the same sentence without it is the plain read’s', () => {
    const viaAct = classifyFailure(act(OUTSIDE), { ...studio(true), subject: 'file' });
    const plainRead = classifyFailure(plain(OUTSIDE), { ...studio(true), subject: 'file' });
    expect(viaAct.lines).toContain(HERE);
    expect(plainRead.lines).not.toContain(HERE);
    // a message that merely ends like the lead's sentence is not the act's
    expect(classifyFailure(plain(`Not opened ${OUTSIDE}`), { ...studio(true), subject: 'file' }).cause).toBe('other');
  });
});

describe('failureOf', () => {
  it('keeps the code, the message and a string refusal; anything else is no refusal', () => {
    expect(failureOf({ code: 'internal', message: 'm', issues: { refusal: 'grade' } })).toEqual({ code: 'internal', message: 'm', refusal: 'grade' });
    expect(failureOf({ code: 'timeout', message: 'm' })).toEqual({ code: 'timeout', message: 'm', refusal: null });
    expect(failureOf({ code: 'internal', message: 'm', issues: { refusal: 7 } })).toEqual({ code: 'internal', message: 'm', refusal: null });
    expect(failureOf({ code: 'invalid_input', message: 'm', issues: [{ path: ['x'] }] })).toEqual({ code: 'invalid_input', message: 'm', refusal: null });
  });
});
