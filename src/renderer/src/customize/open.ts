import { create } from 'zustand';
import type { ProjectId } from '@shared/graph/ids';
import type { TabRef } from '@shared/ipc/schema/layout';
import { focusedProject } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';

export type CustomizeSection = Extract<TabRef, { kind: 'customize' }>['section'];
// Undefined is a restored tab's focused project; null is an explicit choice of user scope.
export const useCustomizeProject = create<{ projectId: ProjectId | null | undefined }>(() => ({ projectId: undefined }));
export function openCustomize(section: CustomizeSection = 'plugins', projectId: ProjectId | null = focusedProject()): void {
  useCustomizeProject.setState({ projectId });
  const layout = useLayout.getState();
  layout.revealMain();
  layout.openTab({ kind: 'customize', section });
}
export function openProjects(): void {
  const layout = useLayout.getState();
  layout.revealMain();
  layout.openTab({ kind: 'projects' });
}
