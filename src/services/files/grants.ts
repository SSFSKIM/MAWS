// The grants of chosen files (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B and
// decisions 2, 4 and 21): the daemon's record that the person chose one file, for one session, in the system's chooser.
import type { AppSessionId } from '@shared/graph/ids';
import type { SpineView } from '@shared/spine/view';

export const GRANTS_PER_SESSION_MAX = 256;

export interface FileGrants {
  add(appSessionId: AppSessionId, real: string): void;
  has(appSessionId: AppSessionId, real: string): boolean;
  drop(appSessionId: AppSessionId): void;
  reconcile(): void;
}

export function openFileGrants(file: string, options: { known(appSessionId: AppSessionId): boolean; now?: () => number; log(line: string): void }): FileGrants {
  void file;
  void options;
  return {
    add: () => {
      throw new Error('file grants are not built yet');
    },
    has: () => false,
    drop: () => {},
    reconcile: () => {},
  };
}

export function followView(grants: Pick<FileGrants, 'drop' | 'reconcile'>, view: Pick<SpineView, 'unavailable' | 'on'>): () => void {
  void grants;
  void view;
  return () => {};
}
