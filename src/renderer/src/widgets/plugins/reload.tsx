// Reload plugins and Reload skills (E8 execution document, M2; parent G3): `reload_plugins` and `reload_skills` as C3's
// session operations, from `/plugins`, `/reload-plugins` (E11 §2.2) and the panel's Plugins section, with one operation
// line for whichever ran last:
// `Working…`, then `Reloaded · N commands · N agents · N plugins · N errors` or `Reloaded · N skills`, or the error in
// the operation's words. A reload's answer also replaces the session's loaded plugins and its catalogue's commands and
// agents (the host's `applyReload`), so the "Loaded in this session" list, the panel's count and the slash palette
// follow it at once.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ReloadPluginsResponseSchema, ReloadSkillsResponseSchema } from '@shared/wire/control';
import { PLUGIN_MANAGEMENT, RELOAD } from '../copy';
import { operationLine, useOperation, type OperationState } from '../operation';
import { TextButton } from '../parts';

export const reloadSummary = (value: unknown): string => {
  const parsed = ReloadPluginsResponseSchema.safeParse(value);
  return parsed.success ? RELOAD.reloaded(parsed.data.commands.length, parsed.data.agents.length, parsed.data.plugins.length, parsed.data.error_count) : RELOAD.done;
};

export const skillsSummary = (value: unknown): string => {
  const parsed = ReloadSkillsResponseSchema.safeParse(value);
  return parsed.success ? RELOAD.skills(parsed.data.skills.length) : RELOAD.done;
};

// The line is an error (drawn in red, G3): a refused invoke, or a failure no late success corrected.
export const lineFailed = (state: OperationState): boolean => state.phase === 'unsent' || (state.phase === 'settled' && !state.outcome.ok && !state.late);

export interface Reloads {
  reloadMods(): void;
  reloadSkills(): void;
  line: string | null; // the last reload's operation line
  failed: boolean; // that line is an error
  busy: boolean;
}

export function useReloads(appSessionId: AppSessionId): Reloads {
  const mods = useOperation(appSessionId, 'session.reloadPlugins');
  const skills = useOperation(appSessionId, 'session.reloadSkills');
  const [last, setLast] = useState<'mods' | 'skills' | null>(null);
  const state = last === 'skills' ? skills.state : last === 'mods' ? mods.state : null;
  const line = last === 'skills' ? operationLine(skills.state, skillsSummary) : last === 'mods' ? operationLine(mods.state, reloadSummary) : null;
  const failed = state !== null && lineFailed(state);
  return {
    reloadMods: () => {
      setLast('mods');
      void mods.run({});
    },
    reloadSkills: () => {
      setLast('skills');
      void skills.run({});
    },
    line,
    failed,
    busy: mods.state.phase === 'working' || skills.state.phase === 'working',
  };
}

// The two buttons and the line beside them.
export function ReloadControls({ reloads }: { reloads: Reloads }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <TextButton onClick={reloads.reloadMods} disabled={reloads.busy}>
        {PLUGIN_MANAGEMENT.reloadMods}
      </TextButton>
      <TextButton onClick={reloads.reloadSkills} disabled={reloads.busy}>
        {PLUGIN_MANAGEMENT.reloadSkills}
      </TextButton>
      {reloads.line !== null && (
        <span role="status" className={`min-w-0 text-ui-sm ${reloads.failed ? 'text-danger' : 'text-fg-muted'}`}>
          {reloads.line}
        </span>
      )}
    </span>
  );
}
