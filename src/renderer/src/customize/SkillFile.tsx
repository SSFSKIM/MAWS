// A skill's detail on Customize's page (UX wave U11, docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md,
// decisions 1, 3 and 7): "Open in" at the head's trailing edge, U6b-4a's menu over its editor rows and Finder (no
// terminal), handing the skill's file through main's own check (./skill-actions.ts); under the head, in the danger tone,
// why the last choice opened nothing; under the facts, a plugin's skill's line. The refusal belongs to the detail it was
// made on and goes with it.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { OpenInChooser } from '../open-in/OpenInMenu';
import { skillRowKey, type SkillDetailExtras } from '../widgets/skills/SkillsLibrary';
import type { SkillRow } from '../widgets/skills/skills';
import { isSkillFileApp, openSkillFile, skillNoteOf } from './skill-actions';

// The refusal of the detail on screen: `owner`, the mounted "Open in" that asked, and `request`, its latest ask. A reply is
// kept only while both are still current, so a reply that arrives after its detail closed, after another skill's detail
// opened or after a later choice writes nothing.
const useRefusal = create<{ key: string | null; owner: object | null; request: number; text: string | null }>()(() => ({ key: null, owner: null, request: 0, text: null }));

function SkillOpenIn({ cwd, row }: { cwd: string | null; row: SkillRow & { path: string } }) {
  const key = skillRowKey(row);
  const [owner] = useState(() => ({}));
  useEffect(() => () => {
    if (useRefusal.getState().owner === owner) useRefusal.setState({ key: null, owner: null, text: null });
  }, [owner]);
  return (
    <OpenInChooser
      only={(app) => isSkillFileApp(app.id)}
      choose={(app) => {
        if (!isSkillFileApp(app)) return;
        const request = useRefusal.getState().request + 1;
        useRefusal.setState({ key, owner, request, text: null });
        void openSkillFile(cwd, row.path, app).then((text) => {
          const now = useRefusal.getState();
          if (now.owner === owner && now.request === request && now.key === key) useRefusal.setState({ text });
        });
      }}
    />
  );
}

function SkillRefusal({ row }: { row: SkillRow }) {
  const text = useRefusal((s) => (s.key === skillRowKey(row) ? s.text : null));
  if (text === null) return null;
  return (
    <p role="alert" data-skill-refusal className="m-0 max-w-[640px] text-ui-sm text-danger">
      {text}
    </p>
  );
}

/** What Customize adds to a skill's detail on the page of `cwd`. */
export const skillExtrasOf =
  (cwd: string | null) =>
  (row: SkillRow): SkillDetailExtras => ({
    ...(row.path !== undefined && { actions: <SkillOpenIn cwd={cwd} row={{ ...row, path: row.path }} />, alert: <SkillRefusal row={row} /> }),
    note: skillNoteOf(row),
  });
