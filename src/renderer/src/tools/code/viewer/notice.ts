// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, M3; Interfaces §C, decisions 9, 10 and 19):
// what a person reads when a file cannot be read or a folder cannot be listed, chosen from the failure in hand and nothing
// else. Pure: the caller hands it the machine's display name (null for this Mac) and whether the session is the person's
// own (`listed.mine`; null with no listing), so it sends nothing, asks no store and decides nothing about who owns a
// machine. The viewer's notice, the Files list's two notices and the line under "Open externally" all call it.
//
// Every failure of the files service arrives with the code `internal` and its message, so only the message tells an
// outside path from a missing one; the codes tell the route's own failures. U6f's outside act on another machine answers
// with "Not opened: " before the machine's own sentence (the act ran and failed) or before UC-7's sentence (the act was
// refused, `issues.refusal` set): the act's answer is told by that lead, taken from the function that writes it.
import type { IpcErrorCode } from '@shared/ipc/errors';
import { NOT_KEPT_REFUSAL } from '@shared/files/outside';
import { failureWords } from '@shared/ipc/remote-unavailable';
import { NOTICE_COPY, REFUSAL } from '../copy';

export interface FileFailure {
  code: IpcErrorCode;
  message: string;
  refusal: string | null; // `issues.refusal` when it is a string
}

export const failureOf = (error: { code: IpcErrorCode; message: string; issues?: unknown }): FileFailure => {
  const refusal = (error.issues as { refusal?: unknown } | null | undefined)?.refusal;
  return { code: error.code, message: error.message, refusal: typeof refusal === 'string' ? refusal : null };
};

export type NoticeCause = 'outside' | 'not-found' | 'unreachable' | 'not-on-record' | 'no-access' | 'said' | 'other';

export interface FileNotice {
  cause: NoticeCause;
  lines: readonly string[]; // the sentences, in order; the first is the headline
  retry: boolean;
  copyPath: boolean;
  // the command's own words, drawn small, only under the generic failure (the word cut, N11), where they are the one clue
  // to the cause; empty under a notice that names its cause, and where the headline is those words already
  detail: string;
}

const LEAD = failureWords('files.readOutside', ''); // "Not opened: "

export function classifyFailure(failure: FileFailure, where: { machine: string | null; mine: boolean | null; subject: 'file' | 'folder' }): FileNotice {
  const { code, message, refusal } = failure;
  const { machine, mine, subject } = where;
  const viaAct = message.startsWith(LEAD);
  const said = viaAct ? message.slice(LEAD.length) : message;
  const notice = (cause: NoticeCause, lines: readonly string[], retry: boolean): FileNotice => ({ cause, lines, retry, copyPath: cause === 'outside', detail: cause === 'other' ? message : '' });

  // The machine refused the plain read at its grade: what the listing says of the session decides the words.
  if (machine !== null && !viaAct && refusal === 'grade') {
    if (mine === true) return notice('not-on-record', [NOTICE_COPY.notOnRecord(machine)], true);
    if (mine === false) return notice('no-access', [NOTICE_COPY.noAccess(machine)], false);
    return notice('other', [NOTICE_COPY.other[subject]], true);
  }
  if (code === 'host_unavailable' || code === 'timeout') return notice('unreachable', [machine === null ? NOTICE_COPY.unreachableHere : NOTICE_COPY.unreachable(machine)], true);
  if (said === REFUSAL) {
    const lines = [machine === null ? NOTICE_COPY.outside[subject] : NOTICE_COPY.outsideOn(subject, machine)];
    // The two sentences about opening a file: Open File… is a way in where the daemon that refused ran the open itself
    // (this Mac's always; another machine's only through the act), and no folder is opened from elsewhere.
    if (subject === 'file') {
      if (machine === null || viaAct) lines.push(NOTICE_COPY.chooseIt);
      lines.push(NOTICE_COPY.askAgent);
    }
    return notice('outside', lines, false);
  }
  if (said.startsWith('not found:')) return notice('not-found', [NOTICE_COPY.notFound(subject, machine)], false);
  // The branch review: the machine's ledger kept no answer for the act, and main's one ask again met the same (U6f,
  // decision 4): told by main's own refusal word, it is worth asking again
  if (refusal === NOT_KEPT_REFUSAL) return notice('other', [NOTICE_COPY.other[subject]], true);
  // UC-7's sentence for a refusal of the act, as U6f draws it: the headline as it is, with nothing added
  if (viaAct && refusal !== null) return { cause: 'said', lines: [message], retry: false, copyPath: false, detail: '' };
  return notice('other', [NOTICE_COPY.other[subject]], false);
}
