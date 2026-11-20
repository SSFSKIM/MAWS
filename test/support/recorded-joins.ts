// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md): the joins the probes recorded, read off their
// journals. In each, MAWS wrote two waiting messages (its `next` user frames, in writing order; the scenario's
// `uxw_messages_written` row names them) and the engine replayed them as one message under the last-written one's uuid.
// Each member is an answer envelope (`askSteerText`'s, for the recording's real or invented ask) or the prompt.
import type { ContentBlock } from '@shared/graph/events';
import { parseAskSteer } from '@shared/maws/ask';
import type { JournalRow } from '@shared/wire/journal';
import { loadUxwaveJournal } from './fixtures';

export type Content = string | ContentBlock[];
export interface RecordedMessage {
  seq: number;
  uuid: string;
  content: Content;
}
export interface RecordedJoin {
  name: string;
  rows: JournalRow[];
  /** What MAWS wrote, in writing order. */
  members: RecordedMessage[];
  /** The engine's replay of the members as one message. */
  joined: RecordedMessage;
  /** The members that are envelopes: their texts, in writing order. */
  envelopes: string[];
  /** The member that is the person's prompt, as MAWS wrote it; null where every member is an envelope. */
  prompt: Content | null;
}

/** Probe 1's joins (and probe 2's run and probe 3's), the ask real, the engine's file kept whole beside each. */
export const PROBE_JOINS = ['u704-end-env-first-1', 'u704-end-env-first-2', 'u704-end-prompt-first-1', 'u704-end-prompt-first-2', 'u704-end-two-envelopes-1', 'u704-end-two-envelopes-2', 'u704-end-image-1', 'u704-end-image-2', 'u704-rewind-1'];
/** U4b's joins: the live route only (their file is a reduction) and their ask invented. */
export const U4B_JOINS = ['u4b-env-end-env-first-1', 'u4b-env-end-env-first-2', 'u4b-env-end-prompt-first-1', 'u4b-env-end-prompt-first-2', 'u4b-env-end-env-first-multi-1', 'u4b-env-end-env-first-multi-2', 'u4b-env-two-env-first-1', 'u4b-env-two-env-first-2', 'u4b-env-two-prompt-first-1', 'u4b-env-two-prompt-first-2'];
/** Probe 1's control: the same two members written once the running call was a task, which the engine did not join. */
export const PROBE_CONTROLS = ['u704-two-late-env-first-1', 'u704-two-late-env-first-2'];

interface UserFrame {
  type: 'user';
  uuid: string;
  isReplay?: boolean;
  priority?: string;
  message: { content: Content };
}
const userFrame = (row: JournalRow): UserFrame | null => {
  const frame = row.frame as Partial<UserFrame> | null;
  return frame !== null && typeof frame === 'object' && frame.type === 'user' && typeof frame.uuid === 'string' ? (frame as UserFrame) : null;
};
const messageOf = (row: JournalRow, frame: UserFrame): RecordedMessage => ({ seq: row.seq, uuid: frame.uuid, content: frame.message.content });
const same = (a: Content, b: Content) => JSON.stringify(a) === JSON.stringify(b);

export function recordedJoin(name: string): RecordedJoin {
  const rows = loadUxwaveJournal(name);
  const members = rows.flatMap((row) => {
    const frame = row.direction === 'out' ? userFrame(row) : null;
    return frame !== null && frame.priority === 'next' ? [messageOf(row, frame)] : [];
  });
  const last = members.at(-1);
  if (members.length < 2 || last === undefined) throw new Error(`${name}: no two waiting members`);
  const replay = rows.find((row) => row.direction === 'in' && userFrame(row)?.isReplay === true && userFrame(row)!.uuid === last.uuid && !same(userFrame(row)!.message.content, last.content));
  if (replay === undefined) throw new Error(`${name}: no joined replay under ${last.uuid}`);
  const isEnvelope = (member: RecordedMessage) => typeof member.content === 'string' && parseAskSteer(member.content) !== null;
  return {
    name,
    rows,
    members,
    joined: messageOf(replay, userFrame(replay)!),
    envelopes: members.filter(isEnvelope).map((member) => member.content as string),
    prompt: members.find((member) => !isEnvelope(member))?.content ?? null,
  };
}
