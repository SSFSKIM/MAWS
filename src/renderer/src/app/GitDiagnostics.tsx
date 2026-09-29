// The git detail of the Store section (C4 execution document, M6; acceptance item 8): for the row whose Git button is
// pressed, the directory, then `branch · ahead / behind · dirty · K files` and the changed files, kept current by
// `git.changed`. It reads what main's read-only git service answers; nothing here changes a repository.
import { useEffect } from 'react';
import { describeGit, describeGitFile, useGitDiagnostics } from '../stores/git-diagnostics';

export function GitDiagnostics() {
  const directory = useGitDiagnostics((s) => s.directory);
  const status = useGitDiagnostics((s) => s.status);
  const error = useGitDiagnostics((s) => s.error);

  useEffect(() => useGitDiagnostics.getState().connect(), []);

  if (directory === null) return null;
  return (
    <div aria-label="Git" className="flex flex-col gap-1 border-b border-border px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 font-mono text-fg-faint">git</span>
        <span className="min-w-0 flex-1 truncate font-mono text-fg-faint">{directory}</span>
        <output aria-label="git status" className="shrink-0 font-mono">
          {error ?? (status ? describeGit(status) : '…')}
        </output>
      </div>
      {status && status.files.length > 0 && (
        <ol aria-label="Changed files" className="max-h-40 overflow-auto font-mono text-fg-faint">
          {status.files.map((file) => (
            <li key={file.path} className="truncate">
              {describeGitFile(file)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
