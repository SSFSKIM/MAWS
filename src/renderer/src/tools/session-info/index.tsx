// The Session info tool (C11 execution document, Interfaces "Session info tool"; X5 as C8a landed it): one tab per
// session, pinnable, registered with C8a's host through `registerPanelTool`; the six sections in `SessionInfoView`.
import { Icon } from '../../app/IconButton';
import type { PanelTool } from '../../panel/tool';
import { INFO } from './copy';
import { SessionInfoView, type SessionInfoState } from './SessionInfoView';

export const SESSION_INFO_TOOL_ID = 'session-info';

function InfoIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.25v3.5M8 5.25v.01" />
    </Icon>
  );
}

export const sessionInfoTool: PanelTool<SessionInfoState> = {
  id: SESSION_INFO_TOOL_ID,
  title: INFO.title,
  icon: InfoIcon,
  pinnable: true,
  multiInstance: false,
  createState: () => ({ openedAt: new Date().toISOString() }),
  beforeClose: async () => true,
  dispose: () => {},
  render: SessionInfoView,
};

export { autoModeLane, reviewsOf, type Lane } from './lane';
export { SessionInfoView, type SessionInfoState } from './SessionInfoView';
