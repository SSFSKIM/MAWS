// The `newSession` slot (C10 execution document, "The unstarted session"; D-20, §5.4 as amended): one heading, "New chat" and then
// the project, as Claude Desktop opens a new chat, above the composer frame C5 centres beneath it. Nothing else is
// chrome of the empty state: the project, branch and worktree are the composer's project row's, and the setup phases are
// the composer's disabled-state reason; the card a start waits on docks in the composer's place (`SetupCard.tsx`). The
// one addition is a failed attempt's checkout the intent still holds once its card is dismissed
// (`RetainedWorktreeNote`), whose resolutions would otherwise be unreachable. A restored tab whose id has neither a
// record nor an intent closes itself.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { NEW_CHAT } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { RetainedWorktreeNote } from './RetainedWorktreeNote';
import { useSetup } from './store';
import { intentProjectName } from './useSetupIntent';

export function NewSessionEmptyState({ appSessionId }: { appSessionId: AppSessionId }) {
  const intent = useSetup((s) => s.intents.get(appSessionId) ?? null);
  const loaded = useSetup((s) => s.loaded);
  const hasRecord = useSessions((s) => s.records.has(appSessionId));
  const openedHere = useSessions((s) => s.unstarted.has(appSessionId)); // created in this window: its intent is on its way
  const project = useSessions((s) => (intent?.projectId ? s.projects.get(intent.projectId) : undefined));
  const gone = loaded && intent === null && !hasRecord && !openedHere;

  useEffect(() => {
    if (!gone) return;
    useLayout.getState().dropSession(appSessionId);
    useSessions.getState().dropUnstarted(appSessionId);
  }, [gone, appSessionId]);

  if (intent === null) return null;
  // New chat (2026-10-01): "New chat" until the project row chooses a project, then the project's name in it
  const name = intentProjectName(intent, project);
  return (
    <>
      <h1 className="m-0 mb-2 text-center text-prose font-medium text-fg">{name === null ? NEW_CHAT : `${NEW_CHAT} in ${name}`}</h1>
      <RetainedWorktreeNote appSessionId={appSessionId} />
    </>
  );
}
