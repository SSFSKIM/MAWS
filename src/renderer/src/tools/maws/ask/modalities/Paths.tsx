// A file or folder question (E1 M4): a button that opens main's native picker (`layout.pickFiles`, from the session's
// directory, several at once when the question says `multiple`) and the chosen absolute paths, each with a remove
// glyph. Only the paths are kept: whatever bytes main reads for an image or a PDF are dropped.
import { ipc } from '../../../../ipc/client';
import { CardButton } from '../../../../request-card/controls';
import { SHEET } from '../copy';
import { addPaths, removePath } from '../draft';
import type { ModalityProps } from './types';

function chooseLabel(folder: boolean, multiple: boolean): string {
  if (folder) return multiple ? SHEET.chooseFolders : SHEET.chooseFolder;
  return multiple ? SHEET.chooseFiles : SHEET.chooseFile;
}

export function Paths({ question, draft, disabled, edit, directory }: ModalityProps & { directory: string | null }) {
  const folder = question.modality === 'folder';
  const multiple = question.multiple === true;
  const pick = async () => {
    const result = await ipc.invoke('layout.pickFiles', { kind: folder ? 'directory' : 'files', directory, multiple });
    if (!result.ok) {
      console.warn(`[maws] layout.pickFiles refused: ${result.error.message}`);
      return;
    }
    const paths = result.value.files.map((file) => file.path);
    if (paths.length > 0) edit((d) => addPaths(question, d, paths));
  };
  return (
    <div className="flex flex-col items-start gap-1.5">
      {draft.paths.length > 0 && (
        <ul aria-label={question.question} className="m-0 flex w-full list-none flex-col gap-1 p-0">
          {draft.paths.map((path) => (
            <li key={path} className="flex min-w-0 items-center gap-2 rounded-sm border border-border px-2.5 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-code text-fg" title={path}>
                {path}
              </span>
              <button
                type="button"
                aria-label={SHEET.remove(path)}
                disabled={disabled}
                onClick={() => edit((d) => removePath(d, path))}
                className="shrink-0 rounded-sm px-1 text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
              >
                <svg viewBox="0 0 12 12" aria-hidden className="size-3 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.5]">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CardButton disabled={disabled} onClick={() => void pick()}>
        {chooseLabel(folder, multiple)}
      </CardButton>
    </div>
  );
}
