// C5's fallback for each slot (C5 execution document, Slots): tokens only and inert, each saying which child fills it.
// Kept apart from `slots.ts` so the registry module stays free of components (and `./slots` resolves to one file).
import type { ReactNode } from 'react';
import { useSessions } from '../stores/sessions';
import type { Slots } from './slots';

function Placeholder({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center justify-center p-6 text-center text-ui-sm text-fg-faint ${className}`}>{children}</div>;
}

const Transcript: Slots['transcript'] = ({ appSessionId }) => {
  const line = useSessions((s) => s.digests.get(appSessionId)?.lastAssistantLine ?? null);
  return (
    <Placeholder className="h-full flex-col gap-2">
      {line && <p className="max-w-(--measure) text-ui text-fg-muted">{line}</p>}
      <p>Transcript arrives with C6</p>
    </Placeholder>
  );
};

const Composer: Slots['composer'] = () => (
  <div aria-disabled className="rounded-lg border border-border-strong bg-bg-raised p-3 text-fg-faint">
    Composer arrives with C7
  </div>
);

// Replaced by the full request preview with the sidebar (M3).
const RequestCard: Slots['requestCard'] = ({ item }) => (
  <div className="rounded-md border border-border bg-bg-overlay p-3 text-ui-sm">
    <span className="text-warning">{item.kind}</span> <span className="text-fg-muted">{item.summary}</span>
  </div>
);

const PanelHost: Slots['panelHost'] = () => <Placeholder className="h-full">No tools open · Tools arrive with C8</Placeholder>;

const FileTab: Slots['fileTab'] = ({ tab }) => <Placeholder className="font-mono">{tab.path}</Placeholder>;
const DiffTab: Slots['diffTab'] = ({ tab }) => <Placeholder className="font-mono">{tab.ref}</Placeholder>;
const NewSession: Slots['newSession'] = () => null;

export const FALLBACKS: Slots = {
  transcript: Transcript,
  composer: Composer,
  requestCard: RequestCard,
  panelHost: PanelHost,
  fileTab: FileTab,
  diffTab: DiffTab,
  newSession: NewSession,
};
