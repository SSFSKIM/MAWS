// "Waiting on you" at the stream's foot (P5 O8 M7a, *The waiting cards*; Q5, P5 Decision Log 11): the project's sessions'
// questions and permission cards that wait now, from every machine, as attention holds them (this Mac's and O7 M6's
// feeds), each the request card attention shows, under its session's title and machine chip. Answering goes through the
// card's own path, so a card answered here is answered everywhere; a MAWS ask answers in place too, through the Question
// sheet's body (`askInPlace`), not by opening its sheet.
// The question sheet's C3 M4 (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H): a session's sheet
// questions together are one card, the session's sheet in place, compact, where its first one stands; a session whose
// sheet this window cannot read keeps a card per question, as today. M4's review: a session whose sheet holds something
// the person acted on (a queued answer, a queued dismissal, an act sending or with a note) keeps its card once its
// questions no longer wait, so what was sent here reads here, and Take back stays at hand; after the waiting ones.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { isSheetItem } from '@shared/attention/sheet-item';
import { MachineChip } from '../app/MachineChip';
import { ipc } from '../ipc/client';
import { RequestCard } from '../request-card';
import { displayTitle, listedTitle } from '../sessions/title';
import { useAttention } from '../stores/attention';
import { selectOrgIndex } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { selectSheetHeld, useSheets } from '../stores/sheet';
import { SheetInPlace } from '../tools/sheet/SheetInPlace';
import { CHANNEL } from './copy';
import { inProject, waitingFor } from './project';

export function Waiting({ project }: { project: string }) {
  const bySession = useAttention((s) => s.bySession);
  const greyed = useAttention((s) => s.greyed);
  const records = useSessions((s) => s.records);
  const projects = useSessions((s) => s.projects);
  const listed = useSessions((s) => s.listed);
  const index = useSessions((s) => selectOrgIndex(s, ipc.localMachine));
  const summaries = useSheets((s) => s.summaries);
  const memories = useSheets((s) => s.memories);
  const items = waitingFor({ project, index, projects, records, listed, bySession, greyed });
  const holds = inProject({ project, index, projects, records, listed });
  const asking = new Set(items.filter((item) => isSheetItem(item.id)).map((item) => item.appSessionId));
  const held = [...summaries.values()].flatMap((summary) => {
    const appSessionId = summary.appSessionId;
    return appSessionId !== null && !asking.has(appSessionId) && !greyed.has(appSessionId) && holds(appSessionId) && selectSheetHeld({ summaries, memories }, appSessionId) ? [appSessionId] : [];
  });
  if (items.length === 0 && held.length === 0) return null;
  return (
    <section data-channel-waiting aria-label={CHANNEL.waiting} className="flex flex-col gap-3 border-t border-border pt-4">
      <h2 className="m-0 text-ui-sm font-medium text-fg-muted">{CHANNEL.waiting}</h2>
      {items.map((item, at) => {
        if (!isSheetItem(item.id)) return <WaitingCard key={item.id} item={item} />;
        const first = items.findIndex((other) => other.appSessionId === item.appSessionId && isSheetItem(other.id)) === at;
        return first ? <SheetCard key={`sheet:${item.appSessionId}`} appSessionId={item.appSessionId} items={items.filter((other) => other.appSessionId === item.appSessionId && isSheetItem(other.id))} /> : null;
      })}
      {held.map((appSessionId) => (
        <SheetCard key={`sheet:${appSessionId}`} appSessionId={appSessionId} items={[]} />
      ))}
    </section>
  );
}

function WaitingCard({ item }: { item: AttentionItem }) {
  const title = useSessionTitle(item.appSessionId);
  return (
    <div data-channel-card={item.id} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-baseline gap-1.5 text-ui-sm">
        <span className="truncate font-medium text-fg">{title}</span>
        <MachineChip address={item.appSessionId} />
      </div>
      <RequestCard item={item} request={null} placement="inline" paneIndex={null} askInPlace />
    </div>
  );
}

// One session's sheet questions: its sheet in place under the session's title, else a card per question.
function SheetCard({ appSessionId, items }: { appSessionId: AppSessionId; items: AttentionItem[] }) {
  const title = useSessionTitle(appSessionId);
  return (
    <SheetInPlace
      appSessionId={appSessionId}
      className="flex min-w-0 flex-col gap-1.5"
      head={
        <div className="flex min-w-0 items-baseline gap-1.5 text-ui-sm">
          <span className="truncate font-medium text-fg">{title}</span>
          <MachineChip address={appSessionId} />
        </div>
      }
      fallback={items.map((item) => <WaitingCard key={item.id} item={item} />)}
    />
  );
}

function useSessionTitle(appSessionId: AppSessionId): string {
  return useSessions((s) => {
    const record = s.records.get(appSessionId);
    if (record !== undefined) return displayTitle(record);
    const listing = s.listed.get(appSessionId);
    return listing === undefined ? displayTitle(null) : listedTitle(listing);
  });
}
