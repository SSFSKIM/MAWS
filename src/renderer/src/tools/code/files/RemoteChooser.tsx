// The chooser for a session on another machine, the sheet (UX wave U6f, §E). Not built yet.
import type { AppSessionId } from '@shared/graph/ids';
import type { RemoteChooser as ChooserModel } from './remote-chooser';

export function RemoteChooser(props: { appSessionId: AppSessionId; chooser: ChooserModel; onClose(): void; onChosen(path: string): void }) {
  void props;
  return null;
}
