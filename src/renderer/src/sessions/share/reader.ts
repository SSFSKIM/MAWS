// What this app knows of the signed-in member's reach on a session another member owns (board 525; P5 O8 M6b's shares,
// docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, §Q). A listing names a session's owners, and a private
// one's audience, but never what the reader holds there: its machine says that only by refusing, `grade`, a read below
// View and a send below Converse. So the page learns it from those refusals, for a listed session the member doesn't own
// (an owner's `grade` is the machine not holding the record yet, which is asked again as before):
// - `list`: the session's read refused. Lane A's is the page's watch (`lane-a/watches.ts`), which then asks nothing more;
//   lane B's is main's record read, which says `READ_REFUSED` while it holds no record (`useCantRead`). The pane says what
//   the member can do there and whom to ask for View.
// - `view`: a send refused (the controls ports): the composer closes, naming Converse and whom to ask.
// What was learnt is asked afresh, forgotten so the next read or send asks the machine: when the session's listing moves
// (its revision or policy revision: a private session's shares move it), when another member signs in, and when a pane
// opens the session again (`reader-connect.ts`).
//
// A prompt's author: none is recorded with a send, so a prompt in a session the member doesn't own is its owners', unless
// this app sent it (its message uuid, kept for this run, for the member who sent it; a send queued by the host is held
// as a tail row by its queue id until the entry is submitted and has its uuid).
import { useMemo } from 'react';
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { OrgMember } from '@shared/ipc/schema/org';
import { READ_REFUSED } from '@shared/org/reader';
import { rowId } from '../../transcript/model/keys';
import { useRemoteLaneB } from '../../lane-b/remote-session';
import { useSessions, type ListedSession } from '../../stores/sessions';
import { READER } from './copy';

/** What a refusal taught: `list`, the session can't be read; `view`, it can, and takes no words. */
export type ReaderGrade = 'list' | 'view';
type Learnt = { grade: ReaderGrade; revision: number; policyRev: number | undefined; member: string | null };

export interface ReaderState {
  learnt: ReadonlyMap<AppSessionId, Learnt>;
  sent: ReadonlyMap<AppSessionId, ReadonlySet<string>>; // the message uuids this app sent to each such session
  queued: ReadonlyMap<AppSessionId, ReadonlySet<string>>; // the queue ids of its sends the host queued, not yet submitted
}

export const useReader = create<ReaderState>()(() => ({ learnt: new Map(), sent: new Map(), queued: new Map() }));

export function resetReader(): void {
  useReader.setState({ learnt: new Map(), sent: new Map(), queued: new Map() });
}

/** Another member signs in: what this app sent was the previous member's, so no prompt stays the new member's own. */
export function forgetOwnPrompts(): void {
  useReader.setState({ sent: new Map(), queued: new Map() });
}

const SENT_KEPT = 500;

/** The session's listed row while another member owns it; null for one the member owns, or no listed row. */
export const othersRow = (listed: ReadonlyMap<AppSessionId, ListedSession>, appSessionId: AppSessionId): ListedSession | null => {
  const row = listed.get(appSessionId);
  return row !== undefined && !row.mine ? row : null;
};

/** A refusal at the member's grade on the session, heard; false (nothing learnt) where the member owns it. */
export function learnReaderGrade(appSessionId: AppSessionId, grade: ReaderGrade): boolean {
  const { listed, member } = useSessions.getState();
  const row = othersRow(listed, appSessionId);
  if (row === null) return false;
  const learnt: Learnt = { grade, revision: row.revision, policyRev: row.policyRev, member };
  useReader.setState((s) => ({ learnt: new Map(s.learnt).set(appSessionId, learnt) }));
  return true;
}

export function forgetReaderGrade(appSessionId: AppSessionId): void {
  if (!useReader.getState().learnt.has(appSessionId)) return;
  useReader.setState((s) => {
    const learnt = new Map(s.learnt);
    learnt.delete(appSessionId);
    return { learnt };
  });
}

/** Whether a learnt grade still stands against the rows now: the same row, listing revisions and member. */
export const learntStands = (learnt: Learnt, row: ListedSession | null, member: string | null): boolean =>
  row !== null && row.revision === learnt.revision && row.policyRev === learnt.policyRev && member === learnt.member;

export const readerGradeOf = (appSessionId: AppSessionId): ReaderGrade | null => useReader.getState().learnt.get(appSessionId)?.grade ?? null;
export const useReaderGrade = (appSessionId: AppSessionId): ReaderGrade | null => useReader((s) => s.learnt.get(appSessionId)?.grade ?? null);

/** Whether the member can't read the session: its read was refused at their grade, on either lane. */
export function useCantRead(appSessionId: AppSessionId): boolean {
  const learnt = useReader((s) => s.learnt.get(appSessionId)?.grade === 'list');
  const refused = useRemoteLaneB((s) => s.states.get(appSessionId)?.reason === READ_REFUSED);
  const others = useSessions((s) => othersRow(s.listed, appSessionId) !== null && !s.records.has(appSessionId));
  return others && (learnt || refused);
}

/** The session's owners other than the member, by the names main gave; an id the head doesn't list is not named. */
export function ownersNamed(row: ListedSession, me: string | null, members: ReadonlyMap<string, OrgMember>): string[] {
  const named: string[] = [];
  for (const id of new Set(row.owners)) {
    const member = members.get(id);
    if (id !== me && member !== undefined && member.email !== null) named.push(member.name);
  }
  return named;
}

const whomIn = (s: Pick<ReturnType<typeof useSessions.getState>, 'listed' | 'member' | 'members'>, appSessionId: AppSessionId): string => {
  const row = s.listed.get(appSessionId);
  return READER.whom(row === undefined ? [] : ownersNamed(row, s.member, s.members));
};
/** Whom the member asks for more on the session: its owners by name, "its owner" when none is named. */
export const whomToAsk = (appSessionId: AppSessionId): string => whomIn(useSessions.getState(), appSessionId);
export const useWhomToAsk = (appSessionId: AppSessionId): string => useSessions((s) => whomIn(s, appSessionId));

/** Why the member's words don't go to the session, at the grade a refusal taught, naming whom to ask. */
export const closedWords = (grade: ReaderGrade, whom: string): string => (grade === 'view' ? READER.cantTalk(whom) : `${READER.cantRead} ${READER.askForView(whom)}`);
/** The same for a component, null while nothing was refused. */
export function useReaderClosed(appSessionId: AppSessionId): string | null {
  const grade = useReaderGrade(appSessionId);
  const whom = useWhomToAsk(appSessionId);
  return grade === null ? null : closedWords(grade, whom);
}

/** A prompt this app sent to another member's session, by its message uuid: it is the member's own. */
export function noteOwnPrompt(appSessionId: AppSessionId, messageUuid: string | null | undefined): void {
  if (messageUuid === null || messageUuid === undefined || othersRow(useSessions.getState().listed, appSessionId) === null) return;
  if (useReader.getState().sent.get(appSessionId)?.has(messageUuid)) return;
  useReader.setState((s) => {
    const kept = [...(s.sent.get(appSessionId) ?? []), messageUuid].slice(-SENT_KEPT);
    return { sent: new Map(s.sent).set(appSessionId, new Set(kept)) };
  });
}

/** A send the host queued for another member's session, by its queue id: its tail row is the member's own. */
export function noteOwnQueued(appSessionId: AppSessionId, queueId: string | null | undefined): void {
  if (queueId === null || queueId === undefined || othersRow(useSessions.getState().listed, appSessionId) === null) return;
  if (useReader.getState().queued.get(appSessionId)?.has(queueId)) return;
  useReader.setState((s) => {
    const kept = [...(s.queued.get(appSessionId) ?? []), queueId].slice(-SENT_KEPT);
    return { queued: new Map(s.queued).set(appSessionId, new Set(kept)) };
  });
}

/** A prompt row as the author is asked for it: a held row has no message uuid, only an id made of its queue id. */
export type PromptRow = { id: string; messageUuid: string | null };

/**
 * Who wrote each prompt of the session, as the member names them: null for their own (it reads "Your message"), else
 * the session's owners. Undefined for a session the member owns, or one no listed row names: every prompt is theirs.
 */
export function usePromptAuthor(appSessionId: AppSessionId | null): ((row: PromptRow) => string | null) | undefined {
  const author = useSessions((s) => {
    const row = appSessionId === null ? null : othersRow(s.listed, appSessionId);
    return row === null ? null : READER.author(ownersNamed(row, s.member, s.members));
  });
  const sent = useReader((s) => (appSessionId === null ? undefined : s.sent.get(appSessionId)));
  const queued = useReader((s) => (appSessionId === null ? undefined : s.queued.get(appSessionId)));
  return useMemo(() => {
    if (author === null) return undefined;
    const ownQueued = (id: string) => queued !== undefined && [...queued].some((queueId) => id === rowId.held(queueId));
    return ({ id, messageUuid }: PromptRow) => ((messageUuid !== null && sent?.has(messageUuid) === true) || ownQueued(id) ? null : author);
  }, [author, sent, queued]);
}
