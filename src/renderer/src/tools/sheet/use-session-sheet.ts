// One app session's sheet as a MAWS window draws it (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md
// §H): the record its summary joins (`selectSheetSession`), its model read while something draws it (`watchSheet`), the
// window's memory of it with the update the components hand (`updateSheetMemory`), the app's host, and why Send is
// replaced, when the door is known not to run, and whether a process holds the session, from its summary. The side sheet, the Overview's card and the channel's waiting card read
// it alike, so a draft typed in one is the draft in the others.
import { useCallback, useEffect, useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SheetModel } from '@shared/sheet/model';
import { EMPTY_MEMORY, SHEET_WORDS, type SheetHost, type SheetMemory } from '../../sheet';
import { selectSheetMemory, selectSheetSession, updateSheetMemory, useSheets, watchSheet } from '../../stores/sheet';
import { appSheetHost } from './host';

export type SessionSheetState =
  | { shown: 'none' } // no record of this session on this Mac, or it was read and is gone
  | { shown: 'unreadable' } // a record this build cannot read
  | { shown: 'reading'; session: string }
  | { shown: 'sheet'; session: string; model: SheetModel; memory: SheetMemory; onMemory(update: (current: SheetMemory) => SheetMemory): void; host: SheetHost; unavailable: string | null; live: boolean | null };

const NO_MEMORY_UPDATE = () => {};

/** `watch`: keep the model read (a drawing on screen); false reads nothing new and draws what the store holds. */
export function useSessionSheet(appSessionId: AppSessionId, watch = true): SessionSheetState {
  const session = useSheets((s) => selectSheetSession(s, appSessionId));
  const unreadable = useSheets((s) => (session === null ? false : (s.summaries.get(session)?.unreadable ?? false)));
  const live = useSheets((s) => (session === null ? null : (s.summaries.get(session)?.live ?? null))); // the summary's: the model does not carry it
  const model = useSheets((s) => (session === null ? null : s.models.get(session)));
  const memory = useSheets((s) => (session === null ? EMPTY_MEMORY : selectSheetMemory(s, session)));
  const door = useSheets((s) => s.door);
  useEffect(() => (session === null || !watch ? undefined : watchSheet(session)), [session, watch]);
  const host = useMemo(() => appSheetHost(appSessionId), [appSessionId]);
  const onMemory = useCallback((update: (current: SheetMemory) => SheetMemory) => (session === null ? NO_MEMORY_UPDATE() : updateSheetMemory(session, update)), [session]);
  if (session === null) return { shown: 'none' };
  if (unreadable) return { shown: 'unreadable' };
  if (model === undefined) return { shown: 'reading', session };
  if (model === null) return { shown: 'none' };
  const unavailable = door.known && !door.available ? SHEET_WORDS.unavailable : null;
  return { shown: 'sheet', session, model, memory, onMemory, host, unavailable, live };
}
