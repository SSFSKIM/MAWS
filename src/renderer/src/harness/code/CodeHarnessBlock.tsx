// The `#panel` page's left column for the code tools (C8c execution document, Interfaces *Harness API*): the focused
// pane's active tab through the registered `fileTab` and `diffTab` slots when it is a file or a diff tab; else C6's
// Transcript for fake session A with C8c's transcript callbacks, so the receipt's "Review changes" is the real
// hand-off; else the page's own content. The transcript is the one C8a's `loadTranscript('A', …)` loaded, rendered over
// that HarnessSession's own source (key `harness:<n>`), which its constructor attached before any history was released:
// the Transcript re-attaches that same object, and C6's replay source has an empty snapshot, so any other object (the
// source re-keyed to 'A', as the document first planned) would start its key over with no history. Review reads the
// turn under 'A' all the same: the receipt's hand-off opens it for the focused pane's session, and C8a attached the
// same player under 'A'. The block loads, plays and tears down nothing: C8a's page owns the lifecycle.
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { TabRef } from '@shared/ipc/schema/layout';
import { useSlot } from '../../app/slots';
import { useLayout } from '../../stores/layout';
import { activeTab } from '../../stores/layout-model';
import { codeTranscriptActions } from '../../tools/code';
import { Transcript, type TranscriptSource } from '../../transcript';
import type { HarnessSession } from '../player';
import { loadedSession, onTranscriptLoaded } from '../panel/summaryProbes';

const TRANSCRIPT_OF = 'A'; // the fake session whose transcript the column shows

// The session shown is taken when a load has released its history, never mid-load (C8a's page is then attaching it).
let shown: HarnessSession | null = null;
const subscribeLoads = (listener: () => void) =>
  onTranscriptLoaded((appSessionId) => {
    if (appSessionId !== TRANSCRIPT_OF) return;
    shown = loadedSession(TRANSCRIPT_OF);
    listener();
  });
const currentSession = () => shown;

// The key the column's Transcript renders over, while it is mounted (the harness's `transcriptKey()`).
const mounted: { key: string | null } = { key: null };
export const transcriptKey = (): string | null => mounted.key;

export function CodeHarnessBlock({ fallback }: { fallback: ReactNode }) {
  const tab = useLayout((s) => activeTab(s.main));
  const session = useSyncExternalStore(subscribeLoads, currentSession);
  const source = session?.source ?? null;

  if (tab?.kind === 'file' || tab?.kind === 'diff') {
    return <div className="h-full w-full min-w-0 self-stretch">{tab.kind === 'file' ? <FileTab tab={tab} /> : <DiffTab tab={tab} />}</div>;
  }
  if (source) return <ColumnTranscript source={source} />;
  return fallback;
}

// The slots as C5's Pane renders them.
function FileTab({ tab }: { tab: Extract<TabRef, { kind: 'file' }> }) {
  const Slot = useSlot('fileTab');
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Slot tab={tab} />;
}

function DiffTab({ tab }: { tab: Extract<TabRef, { kind: 'diff' }> }) {
  const Slot = useSlot('diffTab');
  // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
  return <Slot tab={tab} />;
}

function ColumnTranscript({ source }: { source: TranscriptSource }) {
  useEffect(() => {
    mounted.key = source.key ?? null;
    return () => void (mounted.key = null);
  }, [source]);
  return (
    <div data-code-harness-transcript className="flex h-full w-full min-w-0 flex-col self-stretch">
      <Transcript source={source} variant="session" actions={codeTranscriptActions} className="min-h-0 flex-1" />
    </div>
  );
}
