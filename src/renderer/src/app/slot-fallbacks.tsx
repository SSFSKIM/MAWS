// C5's fallback for each slot (C5 execution document, Slots): tokens only and inert, each saying what is missing (W2:
// every child has landed, so these show only where a host registers no slot, as the harness pages and tests do).
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
      <p>Transcript unavailable</p>
    </Placeholder>
  );
};

const Composer: Slots['composer'] = () => (
  <div aria-disabled className="rounded-lg border border-border-strong bg-bg-raised p-3 text-fg-faint">
    Composer unavailable
  </div>
);


const PanelHost: Slots['panelHost'] = () => <Placeholder className="h-full">No tools open</Placeholder>;

const FileTab: Slots['fileTab'] = ({ tab }) => <Placeholder className="font-mono">{tab.path}</Placeholder>;
const DiffTab: Slots['diffTab'] = ({ tab }) => <Placeholder className="font-mono">{tab.ref}</Placeholder>;
// An unstarted session's setup (C10's heading and setup, from its intent store) renders nothing until C10 registers it:
// the pane shows the composer frame alone (C10's ask of C5, 2026-09-28).
const NewSession: Slots['newSession'] = () => null;
const SettingsTab: Slots['settingsTab'] = () => <Placeholder className="h-full">Settings unavailable</Placeholder>;
// The top bar's right end holds nothing until W6 registers the usage pill there.
const TopBarEnd: Slots['topBarEnd'] = () => null;
const BrowserTab: Slots['browserTab'] = () => <Placeholder className="h-full">Browser unavailable</Placeholder>; // E4a
// P3-G (§D5): the Artifacts tab where no host registers P3-L's library (App.tsx does).
const ArtifactsLibrary: Slots['artifactsLibrary'] = () => <Placeholder className="h-full">Artifacts unavailable</Placeholder>;

export const FALLBACKS: Slots = {
  transcript: Transcript,
  composer: Composer,
  requestCard: RequestPreview,
  panelHost: PanelHost,
  fileTab: FileTab,
  diffTab: DiffTab,
  newSession: NewSession,
  settingsTab: SettingsTab,
  topBarEnd: TopBarEnd,
  browserTab: BrowserTab, // E4a
  artifactsLibrary: ArtifactsLibrary, // P3-G
};
