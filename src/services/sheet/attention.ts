// The question sheet's attention items on the spine (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H;
// S10, the composite's §8.1): each open question without a queued answer of a record whose session the index holds is
// an item of that app session's fifth list (`AttentionService.setSheetItems`), made from the model the sheet service
// last verified, at each of its announcements. A record that goes, or that no longer joins the app session it did (the
// announcement's `was`), takes its items from that session's list; a stopped session's stay, as the owner ruled.
//
// An archived session's list is empty (the attention service's invariant: an archive leaves nothing of the session
// needing anyone), and an unarchive tells its questions again, silent, as the owner channel re-projects; an archive
// moves only the index's flag, so the index's changes are followed here. The questions of a record's first projection
// during the service's first scan were waiting before the launch, so they are silent wherever they are told (§H: a
// launch makes no burst), and the notifier counts their calls as told; the live watcher runs during the scan, so a
// question a later change of the record adds, before the scan ends or after, is told.
//
// It touches nothing else: a sheet item stops no session, so the session's digest, which counts the lane A list's
// stopping requests (spine-root.ts, `bridged`), never reads it as waiting on the person.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, AttentionId } from '@shared/graph/ids';
import { sheetItemId, sheetItemsOf } from '@shared/attention/sheet-item';
import type { SheetModel } from '@shared/sheet/model';
import type { SheetService } from './service';

/** What the feed reads of the index: whether a session is archived, and each change of a session's record. */
export interface SheetItemSessions {
  archived(appSessionId: AppSessionId): boolean;
  onChange(listener: (appSessionId: AppSessionId) => void): () => void;
}

// Every question a record lists, a queued answer's and a queued dismissal's too: each may become an item later.
const questionItems = (session: string, model: SheetModel): AttentionId[] => [...model.open.map((question) => question.id), ...model.hidden.map((hidden) => hidden.id)].map((id) => sheetItemId(session, id));

export function feedSheetItems(
  service: Pick<SheetService, 'onChange' | 'verified' | 'ready'>,
  set: (appSessionId: AppSessionId, items: AttentionItem[], silent: readonly AttentionId[]) => void,
  sessions: SheetItemSessions,
): () => void {
  const lists = new Map<AppSessionId, Map<string, AttentionItem[]>>(); // each app session's items, by record
  const archived = new Set<AppSessionId>(); // the app sessions told as archived
  const before = new Map<string, AttentionId[]>(); // each record's questions as its first projection during the first scan held them
  let scanning = true;
  void service.ready.then(() => (scanning = false));

  const tell = (appSessionId: AppSessionId, rebuilt = false) => {
    const records = lists.get(appSessionId);
    const items = [...(records?.values() ?? [])].flat();
    const quiet = [...(records?.keys() ?? [])].flatMap((session) => before.get(session) ?? []);
    if (sessions.archived(appSessionId)) {
      archived.add(appSessionId);
      return set(appSessionId, [], quiet);
    }
    archived.delete(appSessionId);
    set(appSessionId, items, rebuilt ? [...new Set([...quiet, ...items.map((item) => item.id)])] : quiet);
  };

  const offService = service.onChange((summary, session, was) => {
    const now = summary?.appSessionId ?? null;
    const left = was?.appSessionId ?? null;
    const model = service.verified(session);
    if (scanning && model !== null && !before.has(session)) before.set(session, questionItems(session, model)); // its first projection only: the live watcher runs during the scan
    if (left !== null && left !== now) {
      const records = lists.get(left);
      records?.delete(session);
      if (records?.size === 0) lists.delete(left);
      tell(left);
    }
    if (now === null) return;
    const records = lists.get(now) ?? new Map<string, AttentionItem[]>();
    lists.set(now, records.set(session, model === null ? [] : sheetItemsOf(now, model)));
    tell(now);
  });
  const offSessions = sessions.onChange((appSessionId) => {
    if (!lists.has(appSessionId) || archived.has(appSessionId) === sessions.archived(appSessionId)) return;
    tell(appSessionId, true);
  });
  return () => {
    offService();
    offSessions();
  };
}
