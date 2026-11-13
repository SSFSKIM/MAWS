// The card column (UX wave U8b; UC-9 and its execution document, Interfaces §D). The shell owns its placement. A
// scrolling list holds the waiting requests' card (U1b's slot) first, while a request of the session waits, then the
// three cards a record feeds, each folded as `cards.open` says, then the two cards for running work (M8), each drawn
// only while something runs; under the list, outside it, the foot (U4b's slot). The two come and go last, so their
// coming and going moves no other card. The column watches the session's task graph while it is drawn.
import { useEffect, type FunctionComponent } from 'react';
import { waitsOnAnswer } from '@shared/attention/kinds';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CardId } from '@shared/ipc/schema/layout';
import { workingFolder } from '@shared/sessions/working-folder';
import { useSlot } from '../../app/slots';
import { cardsSpeakOf } from '../../app/shell-view';
import { machineFor } from '../../ipc/machine';
import { selectPendingOf, useAttention } from '../../stores/attention';
import { useGit } from '../../stores/git';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { useTaskGraph } from '../../tools/agents/store';
import { BackgroundTasksCard } from './BackgroundWork';
import { Connectors } from './Connectors';
import { Context } from './Context';
import { Environment } from './Environment';
import type { CardFold } from './FloatingCard';
import { SubagentsCard } from './Subagents';

export interface SummaryProps {
  appSessionId: AppSessionId | null;
}

// Existing host API, also named for the shell's floating placement. No position or full-height reservation: it fits a
// narrow viewport and scrolls within the height the caller gives it. A session the column cannot speak of draws nothing.
export const FloatingSummary: FunctionComponent<SummaryProps> = ({ appSessionId }) => {
  const record = useSessions((s) => (appSessionId ? s.records.get(appSessionId) : undefined));
  const known = useSessions((s) => cardsSpeakOf(s, appSessionId));
  if (!appSessionId || !known) return null;
  return <SessionCards key={appSessionId} appSessionId={appSessionId} record={record ?? null} />;
};

export const Summary = FloatingSummary;

function SessionCards({ appSessionId, record }: { appSessionId: AppSessionId; record: SessionRecord | null }) {
  const Waiting = useSlot('sessionCardWaiting');
  const Foot = useSlot('sessionCardFoot');
  // UC-1: the one predicate of a request that waits (U1b may replace this line with the selector it supplies).
  const waiting = useAttention((s) => selectPendingOf(s, appSessionId).some(waitsOnAnswer));
  useEffect(() => useTaskGraph.getState().watch(appSessionId), [appSessionId]); // M8 decision 1: a listed session's too
  return (
    <div className="flex max-h-full w-70 max-w-full min-h-0 flex-col">
      <div aria-label="Session cards" className="flex min-h-0 flex-col gap-1.5 overflow-y-auto p-1">
        {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
        {waiting && <Waiting appSessionId={appSessionId} />}
        {record && <RecordCards appSessionId={appSessionId} record={record} />}
        <SubagentsCard appSessionId={appSessionId} />
        <BackgroundTasksCard appSessionId={appSessionId} />
      </div>
      {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render */}
      <Foot appSessionId={appSessionId} />
    </div>
  );
}

// UX wave U8c-2 (§H): the selector's answer once; every card's folder is the working folder, and Environment draws the
// agent's folder and where the session was launched beside it.
function RecordCards({ appSessionId, record }: { appSessionId: AppSessionId; record: SessionRecord }) {
  const folder = workingFolder(record);
  const directory = folder.path;
  const machine = machineFor(appSessionId);
  useEffect(() => useGit.getState().watch(machine, directory, appSessionId), [machine, directory, appSessionId]); // P5 O7 M4: made from the session
  const open = useLayout((s) => s.cardsOpen);
  const fold = (card: CardId): CardFold => ({ open: open.includes(card), onToggle: () => useLayout.getState().setCardOpen(card, !open.includes(card)) });
  return (
    <>
      <Environment appSessionId={appSessionId} record={record} folder={folder} fold={fold('environment')} />
      <Context appSessionId={appSessionId} directory={directory} fold={fold('context')} />
      <Connectors appSessionId={appSessionId} fold={fold('connectors')} />
    </>
  );
}
