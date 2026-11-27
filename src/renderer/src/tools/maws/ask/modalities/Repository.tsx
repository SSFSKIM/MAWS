// A repository question (E1 M4): MAWS's projects in the sidebar's order (`selectProjectOrder`), each by its name and
// directory, as radios; the answer is the directory, named by the project. The directory, drawn under the name, is the
// radio's description (board ticket 815: it was also the system tooltip, which said it again to the pointer alone).
import { RadioGroup } from 'radix-ui';
import { useId } from 'react';
import type { ProjectRecord } from '@shared/ipc/schema';
import { SHEET } from '../copy';
import { setRepository } from '../draft';
import { OPTION_ROW, OptionText } from './Choice';
import type { ModalityProps } from './types';

export function Repository({ question, draft, disabled, edit, projects }: ModalityProps & { projects: readonly ProjectRecord[] }) {
  const ids = useId();
  if (projects.length === 0) return <p className="m-0 text-ui-sm text-fg-muted">{SHEET.noProjects}</p>;
  return (
    <RadioGroup.Root
      aria-label={question.question}
      value={draft.repository ?? ''}
      disabled={disabled}
      onValueChange={(directory) => edit((d) => setRepository(d, directory))}
      className="flex flex-col gap-1"
    >
      {projects.map((project, index) => (
        <RadioGroup.Item key={project.id} value={project.directory} aria-label={project.name} aria-describedby={`${ids}-${index}`} className={OPTION_ROW}>
          <span aria-hidden className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border border-border-strong">
            <RadioGroup.Indicator className="size-1.5 rounded-full bg-fg" />
          </span>
          <OptionText label={project.name} description={project.directory} descriptionId={`${ids}-${index}`} />
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
