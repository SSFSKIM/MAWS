// P3-D: a design_system question (docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md D13): the owner's live
// systems from the library (P3-L's index, read again at each committed change), sorted by name, as radios. Each row is the
// system's name, its origin and its five main swatches, both read through the apply API's view of the live system, so a
// swatch is the system's resolved value and follows an edit in place. The swatches are data painted in the system's
// colours; the row around them is app chrome on the app's tokens (Decision Log 13). They are not drawn in a
// `DesignSystemScope`, which would also declare the system's faces: five colours need none of its fonts. "Build one with
// me" closes the list unless the question set `allowCreate: false`.
import { RadioGroup } from 'radix-ui';
import { useDesignSystem } from '@artifacts/design-system/apply';
import { tokenProperties } from '@artifacts/design-system/css';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { useLibraryList } from '../../../../library/store';
import { SHEET } from '../copy';
import { setDesignSystem } from '../draft';
import { OPTION_ROW, OptionText } from './Choice';
import type { ModalityProps } from './types';

const CREATE = '\u0000create'; // the build row's radio value: no artifact id can be it
// Ground, raised ground, ink, muted ink, accent: what a system looks like at a glance.
const SWATCHES = ['--ds-color-bg', '--ds-color-bg-raised', '--ds-color-text', '--ds-color-text-muted', '--ds-color-accent'] as const;

function Mark() {
  return (
    <span aria-hidden className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border border-border-strong">
      <RadioGroup.Indicator className="size-1.5 rounded-full bg-fg" />
    </span>
  );
}

function SystemRow({ system }: { system: LibraryRow }) {
  const { view } = useDesignSystem({ id: system.id });
  const values = view ? tokenProperties(view.tokens, 'document') : null;
  return (
    <RadioGroup.Item value={system.id} aria-label={system.title} data-design-system={system.id} className={OPTION_ROW}>
      <Mark />
      <span className="flex min-w-0 flex-1 flex-col">
        <OptionText label={system.title} description={SHEET.systemOrigin(view?.origin)} />
      </span>
      <span aria-hidden className="mt-0.5 flex shrink-0 gap-0.5">
        {SWATCHES.map((name) => {
          const value = values?.get(name);
          return <span key={name} data-swatch={name} data-swatch-value={value} className="block size-3.5 rounded-[calc(var(--radius-sm)/2)] border border-border" style={value === undefined ? undefined : { backgroundColor: value }} />;
        })}
      </span>
    </RadioGroup.Item>
  );
}

export function DesignSystem({ question, draft, disabled, edit }: ModalityProps) {
  const systems = useLibraryList({ kind: 'design_system' });
  const rows = [...(systems.value?.rows ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id));
  const allowCreate = question.allowCreate !== false;
  const pick = draft.designSystem;
  const choose = (value: string) => {
    if (value === CREATE) return edit((d) => setDesignSystem(d, 'create'));
    const system = rows.find((candidate) => candidate.id === value);
    if (system) edit((d) => setDesignSystem(d, { id: system.id, name: system.title }));
  };
  let note: string | null = null;
  if (systems.value === undefined) note = systems.status === 'error' ? SHEET.systemsUnread : SHEET.readingSystems;
  else if (rows.length === 0) note = SHEET.noSystems;
  return (
    <div className="flex flex-col gap-1.5">
      {note !== null && <p className="m-0 text-ui-sm text-fg-muted">{note}</p>}
      <RadioGroup.Root
        aria-label={question.question}
        value={pick === null ? '' : pick === 'create' ? CREATE : pick.id}
        disabled={disabled}
        onValueChange={choose}
        className="flex flex-col gap-1"
      >
        {rows.map((system) => (
          <SystemRow key={system.id} system={system} />
        ))}
        {allowCreate && (
          <RadioGroup.Item value={CREATE} aria-label={SHEET.buildSystem} className={OPTION_ROW}>
            <Mark />
            <OptionText label={SHEET.buildSystem} description={SHEET.buildSystemDetail} />
          </RadioGroup.Item>
        )}
      </RadioGroup.Root>
    </div>
  );
}
