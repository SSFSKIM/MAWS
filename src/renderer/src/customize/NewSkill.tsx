// "New skill…", the Add action of My items under Show: Skills and All (UX wave U11, docs/doperpowers/ledgers/
// 2026-11-18-ux-wave-U11-skill-actions.md, decisions 4, 5 and 7). On a folder's page a menu of the two places a skill can
// be made, "In this project" and "Created by you"; on the user configuration's page a button that makes the person's own.
// Each opens a new chat in the page's place with its first message filled in (./skill-actions.ts). While the engine's
// configuration folder is unknown, the button and "Created by you" stay reachable, greyed, and give the reason as their
// description (word cut N133: every hidden fact has an owner that takes keyboard focus); when the folder's read failed,
// a Retry beside it reads it again, the error's own way out where it stands (G247 took Refresh from Skills).
import { DropdownMenu } from 'radix-ui';
import { useMemo } from 'react';
import { useSettings } from '../stores/settings';
import { useQueryClient } from '@tanstack/react-query';
import type { CommandOutput } from '@shared/ipc/schema';
import { pluginsReadKey, usePluginsEnv, usePluginsRead } from '../widgets/plugins/read';
import { RefusedMenuItem } from '../ui/refused-menu-item';
import { UnavailableButton } from '../ui/tip';
import { SKILL_ACTIONS as A } from './copy';
import { usePlace } from './place';
import { creatorInvocation, skillsHomeOf, startNewSkill, type SkillPlace } from './skill-actions';

const BUTTON = 'rounded-sm px-2 py-1 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 aria-disabled:text-fg-faint';
const ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none aria-disabled:text-fg-faint data-highlighted:bg-bg-hover';

export function NewSkill() {
  const { cwd, projectId, directory, inventory } = usePlace();
  // the folder a person's skill goes in: the engine's configuration home, once plugins.env has answered; until then
  // "Created by you" waits, greyed, rather than guess it; a failed read offers its own Retry beside the button (word
  // cut G247: Skills has no Refresh to point at)
  const env = usePluginsEnv();
  const configHome = env.data?.configHome ?? null;
  const retry = env.state === 'error' && (
    <button type="button" data-new-skill-retry className={BUTTON} onClick={() => void env.reread()}>
      {A.retry}
    </button>
  );
  // the plugins a chat started here goes without, as the session's Skills dialog reads them (widgets/SkillsWidget.tsx)
  const off = useSettings((s) => s.state?.settings.engine.launchProfile.plugins.off);
  const pluginsOff = useMemo(() => (off === undefined ? null : new Set(off)), [off]);
  // the plugins in effect for this place, as the plugin library counts them (widgets/plugins/library.ts, `enabledHere`),
  // read when it is pressed and from a current listing only: one being read again, invalidated or whose last read failed
  // is unknown, the plain sentence. Read from the query client at the press, not from the last render, whose state a
  // refresh begun or failed just before may not have reached yet (the query client tells its observers a moment later).
  usePluginsRead('plugins.list', directory);
  const client = useQueryClient();
  const enabledNow = (): ReadonlySet<string> | null => {
    const state = client.getQueryState<CommandOutput<'plugins.list'>>(pluginsReadKey('plugins.list', directory));
    if (state === undefined || state.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || state.data === undefined) return null;
    return new Set(state.data.plugins.filter((p) => p.enabled).map((p) => p.id));
  };
  const start = (where: SkillPlace) => {
    if (where === 'yours' && configHome === null) return;
    const creator = inventory.data ? creatorInvocation(inventory.data.skills, pluginsOff, enabledNow()) : null;
    void startNewSkill({ projectId, cwd }, A.firstMessage(where, configHome === null ? '' : skillsHomeOf(configHome), creator));
  };
  const waiting = configHome === null;
  if (cwd === null) {
    return (
      <>
        <UnavailableButton reason={waiting ? A.homeUnknown : null}>
          <button type="button" data-new-skill className={BUTTON} onClick={() => start('yours')}>
            {A.newSkill}
          </button>
        </UnavailableButton>
        {retry}
      </>
    );
  }
  return (
    <>
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
            {waiting ? (
              <RefusedMenuItem kit={DropdownMenu} label={A.yours} reason={A.homeUnknown} className={ITEM} />
            ) : (
              <DropdownMenu.Item className={ITEM} onSelect={() => start('yours')}>
                {A.yours}
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {retry}
    </>
  );
}
