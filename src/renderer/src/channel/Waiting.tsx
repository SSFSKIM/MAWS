// "Waiting on you" at the stream's foot (P5 O8 M7a, *The waiting cards*; Q5, P5 Decision Log 11): the project's sessions'
// questions and permission cards that wait now, from every machine, as attention holds them (this Mac's and O7 M6's
// feeds), each the request card attention shows, under its session's title and machine chip. Answering goes through the
// card's own path, so a card answered here is answered everywhere; a MAWS ask answers in place too, through the Question
// sheet's body (`askInPlace`), not by opening its sheet.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { MachineChip } from '../app/MachineChip';
import { ipc } from '../ipc/client';
import { RequestCard } from '../request-card';
import { displayTitle, listedTitle } from '../sessions/title';
import { useAttention } from '../stores/attention';
import { selectOrgIndex } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { CHANNEL } from './copy';
import { waitingFor } from './project';

export function Waiting({ project }: { project: string }) {
  const bySession = useAttention((s) => s.bySession);
  const greyed = useAttention((s) => s.greyed);
  const records = useSessions((s) => s.records);
  const projects = useSessions((s) => s.projects);
  const listed = useSessions((s) => s.listed);
  const index = useSessions((s) => selectOrgIndex(s, ipc.localMachine));
  const items = waitingFor({ project, index, projects, records, listed, bySession, greyed });
  if (items.length === 0) return null;
  return (
    <section data-channel-waiting aria-label={CHANNEL.waiting} className="flex flex-col gap-3 border-t border-border pt-4">
      <h2 className="m-0 text-ui-sm font-medium text-fg-muted">{CHANNEL.waiting}</h2>
      {items.map((item) => (
        <WaitingCard key={item.id} item={item} />
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

function useSessionTitle(appSessionId: AppSessionId): string {
  return useSessions((s) => {
    const record = s.records.get(appSessionId);
    if (record !== undefined) return displayTitle(record);
    const listing = s.listed.get(appSessionId);
    return listing === undefined ? displayTitle(null) : listedTitle(listing);
  });
}
