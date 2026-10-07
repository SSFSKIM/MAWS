// E4a (Task 3.3): which profile is browsing (Design §4 "Partition pill"; A-31): "Default", or the imported profile's
// name as `browser.profiles.list` gives it (E4b writes the profiles). It is there because an imported profile's cookies
// make the agent the owner on every site; a click opens Settings › Browser, where the profile is chosen.
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import { useCommand } from '../../../ipc/query';
import { useLayout } from '../../../stores/layout';
import { BROWSER_COPY } from '../copy';

export function PartitionPill({ partition }: { partition: string }) {
  return partition === DEFAULT_PARTITION ? <Pill label={BROWSER_COPY.partition.default} /> : <ProfilePill partition={partition} />;
}

// An imported profile's partition, named by the profile listed for it (its directory until the list answers).
function ProfilePill({ partition }: { partition: string }) {
  const profiles = useCommand('browser.profiles.list', undefined);
  const profile = profiles.data?.profiles.find(({ profileDir }) => profilePartition(profileDir) === partition);
  return <Pill label={profile?.name ?? partition.slice(profilePartition('').length)} />;
}

function Pill({ label }: { label: string }) {
  return (
    <button
      type="button"
      data-browser-partition=""
      title={BROWSER_COPY.partition.browsingAs(label)}
      onClick={() => useLayout.getState().openTab({ kind: 'settings', section: 'browser' })}
      className="inline-flex h-6 max-w-32 shrink-0 items-center rounded-sm border border-border px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
    >
      <span className="truncate">{label}</span>
    </button>
  );
}
