// Open File… in the window (UX wave U6e, docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §D).
// The red suite's stand-ins: the module exists, and does nothing yet.
import type { AppSessionId } from '@shared/graph/ids';

export async function openChosen(appSessionId: AppSessionId): Promise<void> {
  void appSessionId;
}

export function connectOpenFile(): () => void {
  return () => {};
}
