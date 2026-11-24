// The question sheet's attention items on the spine (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H;
// S10, the composite's §8.1): each open question without a queued answer of a record whose session the index holds is
// an item of that app session's fifth list (`AttentionService.setSheetItems`), made from the model the sheet service
// last verified, at each of its announcements. A record that goes, or that no longer joins the app session it did (the
// announcement's `was`), takes its items from that session's list; a stopped session's stay, as the owner ruled.
//
// It touches nothing else: a sheet item stops no session, so the session's digest, which counts the lane A list's
// stopping requests (spine-root.ts, `bridged`), never reads it as waiting on the person.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { sheetItemsOf } from '@shared/attention/sheet-item';
import type { SheetService } from './service';

export function feedSheetItems(
  service: Pick<SheetService, 'onChange' | 'verified'>,
  set: (appSessionId: AppSessionId, items: AttentionItem[]) => void,
): () => void {
  const lists = new Map<AppSessionId, Map<string, AttentionItem[]>>(); // each app session's items, by record
  const tell = (appSessionId: AppSessionId) => set(appSessionId, [...(lists.get(appSessionId)?.values() ?? [])].flat());
  return service.onChange((summary, session, was) => {
    const now = summary?.appSessionId ?? null;
    const before = was?.appSessionId ?? null;
    if (before !== null && before !== now) {
      const records = lists.get(before);
      records?.delete(session);
      if (records?.size === 0) lists.delete(before);
      tell(before);
    }
    if (now === null) return;
    const model = service.verified(session);
    const records = lists.get(now) ?? new Map<string, AttentionItem[]>();
    lists.set(now, records.set(session, model === null ? [] : sheetItemsOf(now, model)));
    tell(now);
  });
}
