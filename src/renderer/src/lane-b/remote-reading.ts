// A lane B session's reading on its machine (P5 O8 M6a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md,
// Interfaces §P): the person's pinned, last seen and unread, kept per member on that machine's index and written with
// `session.reader.update`, whose `ReaderState` answer (never the record) is applied to the record the stores hold. The
// machine's own `session.changed` follows on the session's checkout feed while a tab holds it (M6a Task 2, item 5).
//
// - Where the machine keeps them (./reader-rows.ts), its word is the record's, and this run's marks (./read-marks.ts) give
//   way to it; where it refuses them they are the fallback exactly as before, and it is asked nothing more. The marks are
//   kept as ever either way, so a machine still being learnt shows them, as it did.
// - On screen is read: a session this app shows is marked seen there as it comes on screen, and again whenever its record
//   says unread while it stays (a turn ended there, which marks every reader unread, since nothing there shows it). The
//   record held reads it at once, the write on its way.
// - A reply says the reading as of its request (M6a's branch review, F2): a record the stores take for the session while
//   it is out (the feed's: a new turn that marked the member unread, a pin from another of their devices) is the later
//   word, and the reply is then heard but not shown. Each session's generation moves with every write sent and every
//   record taken while one is out.
import type { AppSessionId } from '@shared/graph/ids';
import type { ReaderState, SessionRecord } from '@shared/graph/session';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { ReaderPatch } from '@shared/ipc/schema/session';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';
import { setRemoteUnread, setRemoteVisible, useRemoteReadMarks } from './read-marks';
import { forgetReaderRowsRefusal, heardReaderRows, isNotOffered, readerRowsOf } from './reader-rows';

type Reading = Pick<SessionRecord, 'pinned' | 'lastSeen' | 'unread'>;

/** Each session's writes out, and its generation: moved by each write sent and each record taken while one is out. */
const fences = new Map<AppSessionId, { out: number; generation: number }>();
let showing = false; // this file's own write of a record, which moves no generation

/** A record the stores took for a session with a write out (not this file's own): its replies so far are older. */
function told(appSessionId: AppSessionId): void {
  const fence = fences.get(appSessionId);
  if (fence !== undefined) fence.generation += 1;
}

/** The reading on the record held for the session, if one is (one write, only when it differs). */
function showReading(appSessionId: AppSessionId, reading: Partial<Reading>): void {
  const { records, recordsVersion } = useSessions.getState();
  const record = records.get(appSessionId);
  if (record === undefined) return;
  const next = { ...record, ...reading };
  if (next.pinned === record.pinned && next.unread === record.unread && next.lastSeen.messageUuid === record.lastSeen.messageUuid && next.lastSeen.at === record.lastSeen.at) return;
  showing = true;
  try {
    useSessions.setState({ records: new Map(records).set(appSessionId, next), recordsVersion: recordsVersion + 1 });
  } finally {
    showing = false;
  }
}

/** The machine's answer, the reader's own reading, on the record held. */
export function applyReaderState(state: ReaderState): void {
  showReading(state.appSessionId, { pinned: state.pinned, lastSeen: state.lastSeen, unread: state.unread });
}

/** The patch written there, what its answer says of the machine heard, and the answer shown unless a record came since. */
async function writeReading(appSessionId: AppSessionId, patch: ReaderPatch, client: MawsBridge): Promise<CommandResult<'session.reader.update'>> {
  const fence = fences.get(appSessionId) ?? { out: 0, generation: 0 };
  fences.set(appSessionId, fence);
  fence.out += 1;
  fence.generation += 1;
  const sent = fence.generation;
  const result = await client.invoke('session.reader.update', { appSessionId, patch });
  fence.out -= 1;
  if (fence.out === 0 && fences.get(appSessionId) === fence) fences.delete(appSessionId);
  heardReaderRows(appSessionId, result);
  if (result.ok && fence.generation === sent) applyReaderState(result.value);
  return result;
}

/** Null when the machine took it, or refused it to the marks' keeping; else the words to say. */
const unkeptWords = (result: CommandResult<'session.reader.update'>): string | null => (result.ok || isNotOffered(result) ? null : result.error.message);

/** The person's unread toggle or Mark all read: in this run's marks, and on the machine unless it refuses them. */
export function setRemoteReading(appSessionId: AppSessionId, patch: Pick<ReaderPatch, 'unread' | 'lastSeen'> & { unread: boolean }, client: MawsBridge = ipc): Promise<string | null> {
  setRemoteUnread(appSessionId, patch.unread);
  return readerRowsOf(appSessionId) === 'refused' ? Promise.resolve(null) : writeReading(appSessionId, patch, client).then(unkeptWords);
}

/** Pin or unpin, on the machine; the words when it didn't (a machine heard refusing it offers no Pin: `sessionActionsFor`). */
export async function pinRemote(appSessionId: AppSessionId, pinned: boolean, client: MawsBridge = ipc): Promise<string | null> {
  const result = await writeReading(appSessionId, { pinned }, client);
  return result.ok ? null : result.error.message;
}

/** Seen up to now: the record held reads it at once, and the machine is told unless it refuses. */
function markSeen(appSessionId: AppSessionId, client: MawsBridge): void {
  if (readerRowsOf(appSessionId) === 'refused') return;
  const record = useSessions.getState().records.get(appSessionId);
  showReading(appSessionId, { unread: false });
  const at = new Date().toISOString();
  void writeReading(appSessionId, record === undefined ? { unread: false } : { unread: false, lastSeen: { messageUuid: record.lastSeen.messageUuid, at } }, client).then((result) => {
    const words = unkeptWords(result);
    if (words !== null) console.warn('[lane B] the session on screen could not be marked read on its machine', words);
  });
}

/** On screen or not (`connectVisibility`): in this run's marks as ever, and coming on screen marks it seen there. */
export function showRemote(appSessionId: AppSessionId, visible: boolean, client: MawsBridge = ipc): void {
  setRemoteVisible(appSessionId, visible);
  if (visible) markSeen(appSessionId, client);
}

/** App-wide, beside the marks: on screen stays read on a machine that keeps the reading; a refusal asked afresh at a new feed. */
export function connectRemoteReading(client: MawsBridge = ipc): () => void {
  const offRecords = useSessions.subscribe((state, before) => {
    if (state.records === before.records) return;
    if (!showing) for (const appSessionId of fences.keys()) if (state.records.get(appSessionId) !== before.records.get(appSessionId)) told(appSessionId);
    for (const appSessionId of useRemoteReadMarks.getState().visible) {
      const record = state.records.get(appSessionId);
      // only where the machine's word is the record's: elsewhere the marks show it read (./read-marks.ts)
      if (record?.unread !== true || record === before.records.get(appSessionId) || readerRowsOf(appSessionId) !== 'kept') continue;
      markSeen(appSessionId, client);
    }
  });
  const offResync = client.on('artifacts.resync', (_resync, from) => forgetReaderRowsRefusal(from.machine));
  return () => {
    offRecords();
    offResync();
  };
}
