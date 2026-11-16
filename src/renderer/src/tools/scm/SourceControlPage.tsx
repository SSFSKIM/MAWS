// Stub: Source control's page (UX wave U5b-2, M10), written test first.
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';

export interface PageUi {
  session: AppSessionId;
  directory: string;
  commitsWhole: boolean;
  passedOpen: boolean;
}
export const createPageUi = (session: AppSessionId, directory: string): StoreApi<PageUi> => createStore<PageUi>()(() => ({ session, directory, commitsWhole: false, passedOpen: false }));

export function SourceControlPage(_props: { appSessionId: AppSessionId; directory: string; ui: StoreApi<PageUi>; visible: boolean }) {
  return null;
}
