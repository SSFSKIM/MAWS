// C5's fallback for each slot (C5 execution document, Slots): tokens only and inert, each saying which child fills it.
// Kept apart from `slots.ts` so the registry module stays free of components (and `./slots` resolves to one file).
import type { ReactNode } from 'react';
import { RequestPreview } from '../sidebar/RequestPreview';
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


const PanelHost: Slots['panelHost'] = () => <Placeholder className="h-full">No tools open · Tools arrive with C8</Placeholder>;

const FileTab: Slots['fileTab'] = ({ tab }) => <Placeholder className="font-mono">{tab.path}</Placeholder>;
const DiffTab: Slots['diffTab'] = ({ tab }) => <Placeholder className="font-mono">{tab.ref}</Placeholder>;
// The setup surface of an unstarted session, rendered in its pane where the transcript will be (owner design
// 2026-09-28: no modal sheet); C10 fills it.
const NewSession: Slots['newSession'] = ({ appSessionId }) => {
  const project = useSessions((s) => {
    const projectId = s.unstarted.get(appSessionId)?.projectId;
    return projectId ? (s.projects.get(projectId)?.name ?? null) : null;
  });
  return (
    <Placeholder className="h-full flex-col gap-2">
      <p className="text-ui text-fg-muted">{project ?? 'No project'}</p>
      <p>Session setup arrives with C10</p>
    </Placeholder>
  );
};

export const FALLBACKS: Slots = {
  transcript: Transcript,
  composer: Composer,
  requestCard: RequestPreview,
  panelHost: PanelHost,
  fileTab: FileTab,
  diffTab: DiffTab,
  newSession: NewSession,
};
