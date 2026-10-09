// cua #90: the partition pill's popover (the spec's "The avatar and the profile popover"), Chrome's profile bubble in
// MAWS's chrome: the avatar, the profile's name and the Chrome account it is signed in to, then Switch profile (every
// other profile and Default, each opening a new tab in this session as that profile), Sync bookmarks now with the
// mirror's last read, Re-import this profile…, and the old click, Browser settings, as a muted link. The Default
// partition's has the person glyph, "Default profile", Switch profile and the link. Every action closes the popover
// first; Re-import runs at app level (ProfileSheets.tsx), since its removal closes this tab.
import { useState } from 'react';
import type { BrowserProfileListItem, ImportedBookmarks } from '@shared/browser/profiles';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { useNow } from '../../../app/use-now';
import { useLayout } from '../../../stores/layout';
import { switchProfile } from '../actions';
import { BROWSER_COPY } from '../copy';
import { ImportIcon, SyncIcon } from '../icons';
import { startReimport, syncBookmarks, useBrowserImport } from '../import/store';
import { accountLine, switchTargets, syncLine } from './profile';
import { ProfileAvatar } from './ProfileAvatar';

const COPY = BROWSER_COPY.profile;
const ROW = 'flex w-full items-center gap-2.5 rounded-md px-2 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-muted disabled:hover:bg-transparent';

export interface ProfilePopoverProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  partition: string;
  profiles: readonly BrowserProfileListItem[];
  profile: BrowserProfileListItem | null; // the partition's listed profile; null for Default
  close(): void;
}

export function ProfilePopover({ appSessionId, surface, partition, profiles, profile, close }: ProfilePopoverProps) {
  const isDefault = partition === DEFAULT_PARTITION;
  const record = useBrowserImport((s) => (isDefault ? undefined : s.records.find((r) => r.partition === partition)));
  const targets = switchTargets(profiles, partition);
  const name = isDefault ? COPY.defaultName : (profile?.name ?? record?.name ?? '');
  const act = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <div className="flex flex-col">
      <header className="flex flex-col items-center gap-1 px-4 pt-4 pb-3 text-center">
        <ProfileAvatar profile={isDefault ? null : profile} size={40} />
        <div className="mt-1 max-w-full truncate font-medium text-fg">{name}</div>
        {!isDefault && profile && (
          <div data-profile-account="" title={accountLine(profile)} className="max-w-full truncate text-ui-sm text-fg-muted">
            {accountLine(profile)}
          </div>
        )}
      </header>
      {targets.length > 0 && (
        <section aria-label={COPY.switchProfile} className="border-t border-border px-1 pt-2 pb-1">
          <div className="flex items-baseline justify-between gap-2 px-2 pb-1">
            <span className="text-ui-sm font-medium text-fg-muted">{COPY.switchProfile}</span>
            <span className="text-ui-sm text-fg-faint">{COPY.appliesToNewTabs}</span>
          </div>
          <ul className="m-0 flex max-h-64 list-none flex-col overflow-y-auto p-0">
            {targets.map((target) => (
              <li key={target.partition}>
                <button
                  type="button"
                  data-profile-switch={target.profileDir ?? 'default'}
                  title={COPY.switchTo(target.profile?.name ?? COPY.defaultRow)}
                  onClick={act(() => void switchProfile(appSessionId, surface, target.profileDir))}
                  className={`${ROW} h-8`}
                >
                  <ProfileAvatar profile={target.profile} size={20} />
                  <span className="min-w-0 flex-1 truncate">{target.profile?.name ?? COPY.defaultRow}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {record && (
        <div className="flex flex-col border-t border-border p-1">
          {record.bookmarks !== null && <SyncRow profileDir={record.profileDir} bookmarks={record.bookmarks} />}
          <button type="button" data-profile-reimport="" onClick={act(() => startReimport(record.profileDir))} className={`${ROW} h-8`}>
            <ImportIcon className="size-4 text-fg-muted" />
            {COPY.reimport}
          </button>
        </div>
      )}
      <div className="border-t border-border px-3 py-2">
        <button
          type="button"
          data-profile-settings=""
          onClick={act(() => useLayout.getState().openTab({ kind: 'settings', section: 'browser' }))}
          className="rounded-sm text-ui-sm text-fg-muted outline-accent hover:text-fg hover:underline focus-visible:outline-2"
        >
          {COPY.settings}
        </button>
      </div>
    </div>
  );
}

// Sync bookmarks now, with when the mirror last read Chrome's file (or why it could not) under it. The popover stays
// open while main reads, and the line follows the record main writes.
function SyncRow({ profileDir, bookmarks }: { profileDir: string; bookmarks: ImportedBookmarks }) {
  const [syncing, setSyncing] = useState(false);
  const now = useNow();
  const line = syncLine(bookmarks, now);
  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    await syncBookmarks(profileDir);
    setSyncing(false);
  };
  // aria-disabled rather than disabled while main reads: the button keeps the keyboard
  return (
    <button type="button" data-profile-sync="" aria-disabled={syncing} onClick={() => void sync()} className={`${ROW} min-h-8 py-1.5 aria-disabled:text-fg-muted`}>
      <SyncIcon className={`size-4 self-start text-fg-muted ${line ? 'mt-px' : ''} ${syncing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      <span className="flex min-w-0 flex-col">
        <span>{syncing ? COPY.syncing : COPY.syncNow}</span>
        {line && (
          <span data-profile-sync-line="" className={`text-ui-sm ${bookmarks.error === null ? 'text-fg-muted' : 'text-warning'}`} title={line}>
            {line}
          </span>
        )}
      </span>
    </button>
  );
}
