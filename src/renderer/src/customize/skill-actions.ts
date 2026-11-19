// A skill's actions on Customize's page (UX wave U11, docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md):
// - Open in: main hands the skill's SKILL.md to an editor, or to Finder, which shows it, when its own read of the place's
//   inventory lists that path (`customization.skillFile`, through U6b-4a's launcher); the answer here is only the words a
//   refusal shows, null when it opened.
// - "New skill…": a new chat in the page's place whose composer holds a first message, not sent (Claude Desktop's
//   "Create with Claude", decision 4). It starts with skill-creator's invocation when that plugin's skill can run in a
//   chat started here, the rule "Use in chat" follows (`diskSkillGroups`); else the sentence alone. `where` names the
//   folder the skill goes in (decision 5).
import type { ProjectId } from '@shared/graph/ids';
import { SKILL_FILE_APPS, type CustomizationSkill } from '@shared/ipc/schema/customization';
import type { OpenInAppId } from '@shared/ipc/schema/layout';
import { ipc } from '../ipc/client';
import { createSession } from '../keymap/actions-runtime';
import { prefillComposer } from '../stores/composer';
import { placeOf, useLayout } from '../stores/layout';
import { toast } from '../stores/notices';
import { homeAbbreviated } from '../tools/session-info/model';
import { diskSkillGroups, type SkillRow } from '../widgets/skills/skills';
import { SKILL_ACTIONS } from './copy';

export type SkillPlace = 'project' | 'yours';
export type SkillFileApp = (typeof SKILL_FILE_APPS)[number];

/** A skill's file to a row of "Open in"; the words of a refusal, null when it opened. */
export async function openSkillFile(cwd: string | null, path: string, app: SkillFileApp): Promise<string | null> {
  const answer = await ipc.invoke('customization.skillFile', { cwd, path, app });
  if (!answer.ok) return SKILL_ACTIONS.unreadable(answer.error.message);
  const value = answer.value;
  if (value.status === 'opened') return null;
  if (value.reason === 'missing') return SKILL_ACTIONS.missing;
  return value.reason === 'unreadable' ? SKILL_ACTIONS.unreadable(value.message ?? '') : (value.message ?? SKILL_ACTIONS.missing);
}

/** The rows a skill's file is offered to: an editor or Finder, never a terminal. */
export const isSkillFileApp = (id: OpenInAppId): id is SkillFileApp => (SKILL_FILE_APPS as readonly string[]).includes(id);

const CREATOR = 'skill-creator'; // the official plugin's manifest name and its skill's name (claude-plugins-official)

/** skill-creator's invocation, when its plugin's skill is listed with one and is not off for the chats MAWS starts. */
export function creatorInvocation(skills: readonly CustomizationSkill[], pluginsOff: ReadonlySet<string> | null): string | null {
  const rows = diskSkillGroups(skills, { invocable: true, pluginsOff }).flatMap((group) => group.rows);
  const row = rows.find((r) => r.source === 'plugin' && r.invocation === `${CREATOR}:${CREATOR}` && r.unavailable == null);
  return row?.invocation ?? null;
}

/** The person's skills folder as the first message names it: the configuration home's, else the engine's default. */
export const skillsHomeOf = (configHome: string | null): string => `${configHome === null ? '~/.claude' : homeAbbreviated(configHome)}/skills/`;

/** A new chat in the page's project (none on the user's page, or a folder no project has: that folder is added first,
 * as the Library's "Ask Claude" adds a Space's), its composer filled with `text`. */
export async function startNewSkill(page: { projectId: ProjectId | null; cwd: string | null }, text: string): Promise<void> {
  const front = placeOf(useLayout.getState());
  let appSessionId;
  if (page.projectId === null && page.cwd !== null) {
    const added = await ipc.invoke('session.projects.addFolder', { directory: page.cwd }, { machine: ipc.localMachine });
    if (!added.ok) return void toast({ level: 'warning', text: added.error.message, actions: [], dismissible: true });
    appSessionId = await createSession(added.value.project.id, { location: added.value.location, front });
  } else {
    appSessionId = await createSession(page.projectId, { front });
  }
  if (appSessionId !== null) prefillComposer(appSessionId, { text });
}

/** A plugin's skill's line on its detail: the file is the plugin's copy, which its next update replaces. */
export const skillNoteOf = (row: SkillRow): string | null => (row.source === 'plugin' && row.plugin !== null ? SKILL_ACTIONS.pluginLine(row.plugin) : null);
