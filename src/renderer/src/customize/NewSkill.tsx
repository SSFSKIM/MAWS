// "New skill…", the Add action of My items under Show: Skills and All (UX wave U11, docs/doperpowers/ledgers/
// 2026-11-18-ux-wave-U11-skill-actions.md, decisions 4, 5 and 7). On a folder's page a menu of the two places a skill can
// be made, "In this project" and "Created by you"; on the user configuration's page a button that makes the person's own.
// Each opens a new chat in the page's place with its first message filled in (./skill-actions.ts).
import { DropdownMenu } from 'radix-ui';
import { useMemo } from 'react';
import { useSettings } from '../stores/settings';
import { usePluginsEnv } from '../widgets/plugins/read';
import { SKILL_ACTIONS as A } from './copy';
import { usePlace } from './place';
import { creatorInvocation, skillsHomeOf, startNewSkill, type SkillPlace } from './skill-actions';

const BUTTON = 'rounded-sm px-2 py-1 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint';
const ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-highlighted:bg-bg-hover';

export function NewSkill() {
  const { cwd, projectId, inventory } = usePlace();
  const configHome = usePluginsEnv().data?.configHome ?? null;
  // the plugins a chat started here goes without, as the session's Skills dialog reads them (widgets/SkillsWidget.tsx)
  const off = useSettings((s) => s.state?.settings.engine.launchProfile.plugins.off);
  const pluginsOff = useMemo(() => (off === undefined ? null : new Set(off)), [off]);
  const start = (where: SkillPlace) => {
    const creator = inventory.data ? creatorInvocation(inventory.data.skills, pluginsOff) : null;
    void startNewSkill({ projectId, cwd }, A.firstMessage(where, skillsHomeOf(configHome), creator));
  };
  if (cwd === null) {
    return (
      <button type="button" data-new-skill className={BUTTON} onClick={() => start('yours')}>
        {A.newSkill}
      </button>
    );
  }
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" data-new-skill className={BUTTON}>
          {A.newSkill}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float">
          <DropdownMenu.Item className={ITEM} onSelect={() => start('project')}>
            {A.inProject}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={ITEM} onSelect={() => start('yours')}>
            {A.yours}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
