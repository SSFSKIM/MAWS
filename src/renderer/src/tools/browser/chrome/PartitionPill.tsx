// E4a (Task 3.3): which profile is browsing (Design §4 "Partition pill"; A-31): "Default", or the imported profile's
// name as `browser.profiles.list` gives it (E4b writes the profiles). It is there because an imported profile's cookies
// make the agent the owner on every site.
// cua board #90: the pill carries the profile's avatar (the Google picture, the initial on its disc, or Default's person)
// and opens the profile popover anchored to it (ProfilePopover.tsx) instead of putting Settings › Browser in the main
// area; the popover is a layer of the chrome's own, so the page freezes to its still while it is open
// (`holdCover()`, as the address suggestions do). Click-away and Esc close it.
import { Popover } from 'radix-ui';
import { useEffect, useState } from 'react';
import type { BrowserProfileListItem } from '@shared/browser/profiles';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { useCommand } from '../../../ipc/query';
import { BROWSER_COPY } from '../copy';
import { holdCover } from '../covering';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfilePopover } from './ProfilePopover';

export interface PartitionPillProps {
  appSessionId: AppSessionId;
  surface: 'panel' | 'main';
  partition: string;
}

// The Default partition's pill asks for the list only once its popover opens (Switch profile's rows).
export function PartitionPill(props: PartitionPillProps) {
  return props.partition === DEFAULT_PARTITION ? <Pill {...props} label={BROWSER_COPY.partition.default} profile={null} /> : <ProfilePill {...props} />;
}

// An imported profile's partition, named by the profile listed for it (its directory until the list answers).
function ProfilePill(props: PartitionPillProps) {
  const profiles = useCommand('browser.profiles.list', undefined).data?.profiles;
  const profile = profiles?.find(({ profileDir }) => profilePartition(profileDir) === props.partition) ?? null;
  return <Pill {...props} label={profile?.name ?? props.partition.slice(profilePartition('').length)} profile={profile} profiles={profiles} />;
}

interface PillProps extends PartitionPillProps {
  label: string;
  profile: BrowserProfileListItem | null;
  profiles?: readonly BrowserProfileListItem[];
}

function Pill({ appSessionId, surface, partition, label, profile, profiles }: PillProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => (open ? holdCover() : undefined), [open]);
  const isDefault = partition === DEFAULT_PARTITION;
  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger
        data-browser-partition=""
        title={BROWSER_COPY.partition.browsingAs(label)}
        className="inline-flex h-6 max-w-36 shrink-0 items-center gap-1.5 rounded-full border border-border py-0.5 pr-2.5 pl-[3px] text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active data-[state=open]:text-fg"
      >
        {isDefault || profile ? <ProfileAvatar profile={profile} size={18} /> : <span aria-hidden className="size-[18px] shrink-0 rounded-full bg-bg-active" />}
        <span data-browser-partition-name="" className="truncate">
          {label}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-profile-popover={isDefault ? 'default' : 'profile'}
          aria-label={BROWSER_COPY.profile.label(isDefault ? BROWSER_COPY.profile.defaultName : label)}
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-[280px] overflow-hidden rounded-lg border border-border-strong bg-bg-overlay text-ui text-fg shadow-float"
        >
          <PopoverBody appSessionId={appSessionId} surface={surface} partition={partition} profile={profile} profiles={profiles} close={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// The popover's content once open, with the list (the Default pill asks for it only now).
function PopoverBody({ profiles, ...props }: Omit<PillProps, 'label'> & { close(): void }) {
  const listed = useCommand('browser.profiles.list', undefined, { enabled: profiles === undefined }).data?.profiles;
  return <ProfilePopover {...props} profiles={profiles ?? listed ?? []} />;
}
