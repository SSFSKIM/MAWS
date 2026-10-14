// P3-D (2026-10-13): Settings › Artifacts (docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D9; settings version
// 14), the design-system defaults, each row writing its field of `settings.artifacts`:
//
// - Default design system: the house system (null) or one of the library's live systems. A saved id the library no
//   longer has stays shown, marked, since the chain skips it (the house system applies) and the owner should see why.
// - By Space: per Space, "Use my default" (no entry) or a system; the Spaces' record is written whole.
//
// The systems and Spaces are main's index (P3-L's library store), read again at each committed change. Main relays the
// settings to the engine host (`artifacts.setDefaults`), which resolves the chain for the agent.
import type { ArtifactsSettings } from '@shared/ipc/schema/settings';
import type { LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import { useLibraryList, useLibrarySpaces } from '../library/store';
import { ARTIFACTS } from './copy';
import { INPUT, Setting, writeSettings } from './parts';

const NONE = ''; // a select's value for null (the house system) or no Space entry (my default)

export function ArtifactsSection({ artifacts }: { artifacts: ArtifactsSettings }) {
  const systems = useLibraryList({ kind: 'design_system' });
  const spaces = useLibrarySpaces();
  const rows = [...(systems.value?.rows ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id));
  const note = systems.status === 'error' && systems.value === undefined ? ARTIFACTS.readFailed(systems.error ?? '') : ARTIFACTS.defaultSystemNote;
  return (
    <>
      <Setting label={ARTIFACTS.defaultSystem} note={note}>
        <SystemSelect
          label={ARTIFACTS.defaultSystem}
          value={artifacts.defaultDesignSystem}
          none={ARTIFACTS.house}
          systems={rows}
          known={systems.value !== undefined}
          missing={ARTIFACTS.missing}
          onChange={(id) => void writeSettings({ artifacts: { defaultDesignSystem: id } })}
        />
      </Setting>
      <Setting label={ARTIFACTS.bySpace} note={(spaces.value?.length ?? 0) > 0 ? ARTIFACTS.bySpaceNote : ARTIFACTS.noSpaces}>
        {(spaces.value ?? []).length > 0 && (
          <div className="flex w-full flex-col gap-1.5">
            {[...spaces.value!].sort((a, b) => a.name.localeCompare(b.name, 'en')).map((space) => (
              <SpaceRow key={space.id} space={space} artifacts={artifacts} systems={rows} known={systems.value !== undefined} />
            ))}
          </div>
        )}
      </Setting>
    </>
  );
}

function SpaceRow({ space, artifacts, systems, known }: { space: LibrarySpace; artifacts: ArtifactsSettings; systems: LibraryRow[]; known: boolean }) {
  const write = (id: string | null) => {
    const next = { ...artifacts.spaceDesignSystems };
    if (id === null) delete next[space.id];
    else next[space.id] = id;
    void writeSettings({ artifacts: { spaceDesignSystems: next } });
  };
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-fg">{space.name}</span>
      <SystemSelect label={ARTIFACTS.spaceSystem(space.name)} value={artifacts.spaceDesignSystems[space.id] ?? null} none={ARTIFACTS.useMine} systems={systems} known={known} missing={ARTIFACTS.missingSpace} onChange={write} />
    </label>
  );
}

function SystemSelect(props: { label: string; value: string | null; none: string; systems: LibraryRow[]; known: boolean; missing: string; onChange(id: string | null): void }) {
  const { label, value, none, systems, known, missing, onChange } = props;
  // A saved id the library does not list: a deleted system, marked once the list has answered (its id until then) with
  // what applies instead, which is the chain's next link (the house for the owner's default, the owner's for a Space's).
  const unlisted = value !== null && !systems.some((system) => system.id === value);
  return (
    <select aria-label={label} value={value ?? NONE} onChange={(event) => onChange(event.target.value === NONE ? null : event.target.value)} className={`${INPUT} max-w-[260px]`}>
      <option value={NONE}>{none}</option>
      {systems.map((system) => (
        <option key={system.id} value={system.id}>
          {system.title}
        </option>
      ))}
      {unlisted && <option value={value}>{known ? missing : value}</option>}
    </select>
  );
}
