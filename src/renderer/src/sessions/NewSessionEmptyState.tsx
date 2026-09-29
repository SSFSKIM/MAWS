// The `newSession` slot (C10 execution document, "The unstarted session"; D-20, §5.4 as amended): one heading naming
// the project, as Claude Desktop opens a new chat, above the composer frame C5 centres beneath it. Nothing else is
// chrome of the empty state: the directory, worktree and branch are the location chip's, and the setup phases are
// the composer's disabled-state reason; the card a start waits on docks in the composer's place (`SetupCard.tsx`). The
// one addition is a failed attempt's checkout the intent still holds once its card is dismissed
// (`RetainedWorktreeNote`), whose resolutions would otherwise be unreachable. A restored tab whose id has neither a
// record nor an intent closes itself.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { RetainedWorktreeNote } from './RetainedWorktreeNote';
import { useSetup } from './store';
import { baseDirectoryOf } from './useSetupIntent';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

export function NewSessionEmptyState({ appSessionId }: { appSessionId: AppSessionId }) {
  const intent = useSetup((s) => s.intents.get(appSessionId) ?? null);
  const loaded = useSetup((s) => s.loaded);
  const hasRecord = useSessions((s) => s.records.has(appSessionId));
  const openedHere = useSessions((s) => s.unstarted.has(appSessionId)); // created in this window: its intent is on its way
  const projectName = useSessions((s) => (intent?.projectId ? (s.projects.get(intent.projectId)?.name ?? null) : null));
  const gone = loaded && intent === null && !hasRecord && !openedHere;

  useEffect(() => {
    if (!gone) return;
    useLayout.getState().dropSession(appSessionId);
    useSessions.getState().dropUnstarted(appSessionId);
  }, [gone, appSessionId]);

  if (intent === null) return null;
  const name = projectName ?? basename(baseDirectoryOf(intent.location));
  return (
    <>
      <h1 className="m-0 mb-2 text-center text-prose font-medium text-fg">New session in {name}</h1>
      <RetainedWorktreeNote appSessionId={appSessionId} />
    </>
  );
}
