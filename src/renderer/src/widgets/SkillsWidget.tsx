// `/skills` (C11 execution document, the widget table): `get_skills_dialog` when it lists anything, else the
// catalogue's skills from the init frame (the dialog answered empty in every recording while `system/init.skills` held
// the owner's skills; §4.2). "Use" puts `/<skill> ` at the composer's caret through C7's insertion seam; Reload (E8)
// asks the engine to reload its skills.
import * as z from 'zod';
import type { AppSessionId } from '@shared/graph/ids';
import type { GetSkillsDialogResponse } from '@shared/wire/control';
import { insertComposerText } from '../composer';
import { useSessionCatalog, type SessionCatalog } from '../stores/catalog';
import { RELOAD, SKILLS, WIDGET_TITLE } from './copy';
import { operationLine, useOperation } from './operation';
import { parseEach, Row, Rows, TextButton } from './parts';
import { lineFailed, skillsSummary } from './plugins/reload';
import { useEngineRead } from './read';
import { WidgetFrame } from './WidgetFrame';

const DialogSkillSchema = z.looseObject({ name: z.string(), description: z.string().optional() });

export interface SkillsView {
  source: 'dialog' | 'catalogue';
  skills: { name: string; description: string }[];
}

export function present(dialog: GetSkillsDialogResponse, catalog: SessionCatalog): SkillsView {
  const listed = parseEach(DialogSkillSchema, dialog.skills);
  if (listed.length > 0) return { source: 'dialog', skills: listed.map((s) => ({ name: s.name, description: s.description ?? '' })) };
  const described = new Map(catalog.commands.map((c) => [c.name, c.description]));
  return { source: 'catalogue', skills: catalog.skills.map((name) => ({ name, description: described.get(name) ?? '' })) };
}

export function SkillsBody({ view, appSessionId, close }: { view: SkillsView; appSessionId: AppSessionId; close(): void }) {
  if (view.skills.length === 0) return <p className="m-0 text-ui-sm text-fg-muted">{SKILLS.none}</p>;
  const use = (name: string) => {
    close();
    insertComposerText(appSessionId, `/${name} `);
  };
  return (
    <Rows label={SKILLS.list}>
      {view.skills.map((s) => (
        <Row key={s.name} main={`/${s.name}`} detail={s.description ? <span className="line-clamp-2">{s.description}</span> : null} actions={<TextButton onClick={() => use(s.name)}>{SKILLS.use}</TextButton>} />
      ))}
    </Rows>
  );
}

// E8: Reload runs `reload_skills` as an operation (`Reloaded · N skills`); the dialog read refetches on its completion,
// as `useEngineRead` does on any `session.operation` naming the session.
export function SkillsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const read = useEngineRead('session.getSkillsDialog', { appSessionId });
  const catalog = useSessionCatalog(appSessionId);
  const reload = useOperation(appSessionId, 'session.reloadSkills');
  const line = operationLine(reload.state, skillsSummary);
  return (
    <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.skills} command="skills" state={read.state} error={read.error} close={close}>
      <div className="mb-2 flex items-baseline gap-2">
        <TextButton onClick={() => void reload.run({})} disabled={reload.state.phase === 'working'}>
          {RELOAD.reload}
        </TextButton>
        {line !== null && (
          <span role="status" className={`min-w-0 text-ui-sm ${lineFailed(reload.state) ? 'text-danger' : 'text-fg-muted'}`}>
            {line}
          </span>
        )}
      </div>
      {read.data && <SkillsBody view={present(read.data, catalog)} appSessionId={appSessionId} close={close} />}
    </WidgetFrame>
  );
}
