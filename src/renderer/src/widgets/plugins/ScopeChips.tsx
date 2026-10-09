// The detail's scopes as chips (P2-B execution document §5.7; the parent's G3): one per installation of the plugin that
// can matter here ("This project · only you", "This project", "User", a parent project of this worktree by its folder's
// name, "Created by you", "Synced"), then "N other projects". The chip chooses where the detail's switch, Update and
// Uninstall… act (Desktop passes the installation's own scope and draws no chips). "N other projects" opens a read-only
// list of those installations, each with its project's name, its version and E8's words for where it is managed.
import { RadioGroup } from 'radix-ui';
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import { LIBRARY as L } from '../copy';
import { chipLabel, OTHER_PROJECTS, projectCount, projectLabels, type ScopeChip } from './detail';
import { versionWords } from './library';

const CHIP =
  'inline-flex h-6 shrink-0 items-center rounded-full border border-border px-2.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=checked]:border-border-strong data-[state=checked]:bg-bg-active data-[state=checked]:text-fg';

export function ScopeChips({ chips, others, value, onChange }: { chips: readonly ScopeChip[]; others: readonly InstalledPlugin[]; value: string; onChange(key: string): void }) {
  return (
    <RadioGroup.Root value={value} onValueChange={onChange} orientation="horizontal" aria-label={L.installedAt} className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <RadioGroup.Item key={chip.key} value={chip.key} data-scope-chip={chip.installation.scope} className={CHIP}>
          {chipLabel(chip)}
        </RadioGroup.Item>
      ))}
      {others.length > 0 && (
        <RadioGroup.Item value={OTHER_PROJECTS} data-scope-chip={OTHER_PROJECTS} className={CHIP}>
          {L.otherProjects(projectCount(others))}
        </RadioGroup.Item>
      )}
    </RadioGroup.Root>
  );
}

// The installations of other projects, read-only, one row each: the project by its folder's name (its parent's too when
// two share it; never a path, in the words or a tooltip), "only you" for a local one, the version, and where it is
// managed.
export function OtherProjects({ installations }: { installations: readonly InstalledPlugin[] }) {
  const labels = projectLabels(installations.map((p) => p.projectPath ?? p.scope));
  return (
    <ul aria-label={L.group.otherProjects} className="m-0 list-none rounded-md border border-border p-0">
      {installations.map((p) => {
        const version = versionWords(p.version);
        return (
          <li key={`${p.scope}:${p.projectPath}`} className="flex min-w-0 items-baseline gap-2 border-b border-border px-3 py-1.5 text-ui-sm last:border-b-0">
            <span className="min-w-0 truncate font-medium text-fg">{labels.get(p.projectPath ?? p.scope)}</span>
            {p.scope === 'local' && <span className="shrink-0 text-fg-muted">{L.onlyYou}</span>}
            {version !== null && <span className="shrink-0 text-fg-muted tabular-nums">{version}</span>}
            <span className="ml-auto shrink-0 text-fg-muted">{L.manageThere}</span>
          </li>
        );
      })}
    </ul>
  );
}
