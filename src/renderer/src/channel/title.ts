// A channel tab's title (P5 O8 M7a, "Where it opens"): "<project> · channel", the project being the org project its
// sminos id names in the sidebar's index; "Channel" while no project names it (a restored tab before the projects load).
import { ipc } from '../ipc/client';
import { selectOrgIndex } from '../stores/org-projects';
import { useSessions } from '../stores/sessions';
import { CHANNEL } from './copy';
import { channelProjectName } from './project';

export function useChannelTitle(project: string | null): string {
  const name = useSessions((s) => (project === null ? null : channelProjectName(selectOrgIndex(s, ipc.localMachine), project)));
  return CHANNEL.title(name);
}
