// The six names M3 builds (model, effort, fast, compact, rename, resume), registered from M2 so every palette name opens
// a widget; M3 replaces each with its own component.
import type { AppSessionId } from '@shared/graph/ids';
import type { WidgetCommandName } from '../composer';
import { ARRIVES_IN_M3, WIDGET_FOOT, WIDGET_TITLE } from './copy';
import { WidgetFrame } from './WidgetFrame';

export function pendingWidget(name: WidgetCommandName) {
  return function PendingWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
    return (
      <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE[name]} command={name} foot={WIDGET_FOOT[name]} state="ready" error={null} close={close}>
        <p className="m-0 text-fg-muted">{ARRIVES_IN_M3}</p>
      </WidgetFrame>
    );
  };
}
