import type { Settings } from '@shared/ipc/schema';
import { INPUT, Setting, writeSettings } from './parts';

export function SessionsSection({ settings }: { settings: Settings }) {
  return <Setting label="Archive sessions inactive for" note="Pinned, live, waiting and background-running sessions stay, as do worktrees with uncommitted changes. Archived sessions can be restored from the sidebar.">
    <select aria-label="Archive sessions inactive for" value={settings.sessions.archiveInactiveDays ?? 'never'} className={`${INPUT} max-w-[180px]`}
      onChange={(event) => void writeSettings({ sessions: { archiveInactiveDays: event.target.value === 'never' ? null : Number(event.target.value) as 7 | 14 | 30 } })}>
      <option value="never">Never</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option>
    </select>
  </Setting>;
}
