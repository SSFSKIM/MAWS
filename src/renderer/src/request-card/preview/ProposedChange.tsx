// A file prompt's preview (UX wave U1a, §I): the path relative to the session's working folder (whole in its title), then
// the change as the transcript draws an edit, `EditDiff`'s numbered lines, under a capped height with "Show all"; or the
// input alone (`FileEdits`, the old and new text as removed and added blocks) where no diff against the file is drawn.
// "Show all" lifts the cap and `EditDiff`'s own budget (`whole`), so every line of what is approved, each whole, can be
// read before a button is pressed; the buttons never wait for it.
import { lazy, Suspense, useState } from 'react';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { useWorkingFolder } from '../../sessions/working-folder';
import { partsTruncationOf } from '../../transcript/model/cells';
import type { Hunk } from '../../transcript/model/rows';
import { Muted } from '../controls';
import { filePaths, pathIn } from '../tools';
import type { Proposed } from './proposed';
import { FileEdits } from './ToolPreview';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission.requested' }>;

// The transcript's diff lines, loaded with the transcript's own chunk: a static import would bring the transcript's
// cells (and the Markdown module behind their `Truncated`) into the app's entry, which `transcript/lazy.tsx` keeps out.
const EditDiff = lazy(() => import('../../transcript/view/cells/EditDetail').then((module) => ({ default: module.EditDiff })));

// Collapsed, the diff shows this many lines (`.transcript-diff-line` is 1.75 × --text-code tall, transcript.css) and
// clips the rest; the borders around and between its hunks are a pixel each.
const COLLAPSED_LINES = 12;

function Diff({ request, hunks, change }: { request: PermissionEvent; hunks: Hunk[]; change: 'create' | 'update' }) {
  const [whole, setWhole] = useState(false);
  if (hunks.length === 0) return <Muted>{change === 'create' ? 'An empty file' : 'The file’s text stays as it is'}</Muted>;
  // EditDiff's own measure of a line (its text and a newline); past its budget it leaves lines out, or cuts one
  const sizes = hunks.flatMap((hunk) => hunk.lines.map((line) => (line.startsWith('\\') ? line.length + 1 : line.length)));
  const capped = sizes.length > COLLAPSED_LINES || partsTruncationOf(sizes) !== null;
  return (
    <div className="flex flex-col gap-1">
      <div
        data-proposed-diff={whole ? 'whole' : 'collapsed'}
        className={`[&_.transcript-diff]:max-h-none [&_.transcript-diff]:overflow-visible ${whole ? 'max-h-[60vh] overflow-auto' : 'overflow-x-auto overflow-y-hidden'}`}
        style={whole ? undefined : { maxHeight: `calc(${COLLAPSED_LINES} * 1.75 * var(--text-code) + ${hunks.length + 1}px)` }}
      >
        <Suspense fallback={<FileEdits request={request} />}>
          <EditDiff hunks={hunks} cell={null} whole={whole} />
        </Suspense>
      </div>
      {capped && (
        <button type="button" onClick={() => setWhole((w) => !w)} className="self-start text-ui-sm text-fg-muted underline outline-accent focus-visible:outline-2">
          {whole ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
}

export function ProposedChange({ request, proposed, appSessionId }: { request: PermissionEvent; proposed: Proposed; appSessionId: AppSessionId }) {
  const folder = useWorkingFolder(appSessionId)?.path ?? null;
  const paths = filePaths(request.input);
  return (
    <div className="flex flex-col gap-1.5">
      <ul data-testid="request-input" className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-ui-sm text-fg">
        {(paths.length > 0 ? paths : [request.toolName]).map((path) => (
          <li key={path} className="truncate" title={path}>
            {pathIn(path, folder)}
          </li>
        ))}
      </ul>
      {proposed.kind === 'diff' ? <Diff request={request} hunks={proposed.hunks} change={proposed.change} /> : <FileEdits request={request} />}
    </div>
  );
}
