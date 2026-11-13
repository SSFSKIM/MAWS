// The session's working folder for a component that holds only the session's id (UX wave U8, contract UC-4); a reader
// that holds the record already calls `workingFolder` on it. The same object while the four fields are equal: zustand
// requires a selector's result to be cached, and readers key effects on these strings.
import type { AppSessionId } from '@shared/graph/ids';
import { workingFolder, type WorkingFolder } from '@shared/sessions/working-folder';
import { useShallow } from 'zustand/react/shallow';
import { useSessions } from '../stores/sessions';

// null: this window holds no record of the session
export function useWorkingFolder(appSessionId: AppSessionId): WorkingFolder | null {
  return useSessions(
    useShallow((state) => {
      const record = state.records.get(appSessionId);
      return record ? workingFolder(record) : null;
    }),
  );
}
