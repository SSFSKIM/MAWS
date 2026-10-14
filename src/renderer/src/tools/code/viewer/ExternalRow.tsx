// The "Open externally" row (C8c execution document, Interfaces *Viewer kinds and caps*; ruling 4 and the P1 addendum):
// PDF, HTML, audio, video, a binary that is not an image and an image past the cap are not drawn in MAWS. The button is
// offered only for a file `files.openExternal` would hand to the OS (`opensExternally`, shared with the service), so a
// binary MAWS will not open reads its size and nothing more.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { opensExternally } from '@shared/ipc/schema/files';
import { ipc } from '../../../ipc/client';
import { formatSize, VIEWER_COPY } from '../copy';
import { externalKindOf } from './kinds';
import type { ViewerEntry } from './viewer-store';

const button = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg hover:bg-bg-hover';

export function OpenExternally({ appSessionId, path }: { appSessionId: AppSessionId; path: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const open = async () => {
    const result = await ipc.invoke('files.openExternal', { appSessionId, path });
    if (!result.ok) setProblem(VIEWER_COPY.refused(result.error.message));
    else setProblem(result.value.opened ? null : VIEWER_COPY.notOpened(result.value.message ?? ''));
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={button} onClick={() => void open()}>
        {VIEWER_COPY.openExternally}
      </button>
      {problem ? (
        <span role="alert" className="text-ui-sm text-danger">
          {problem}
        </span>
      ) : null}
    </span>
  );
}

export function ExternalRow({ entry }: { entry: ViewerEntry }) {
  const kind = externalKindOf(entry) ?? 'Binary';
  return (
    <div data-external-row className="flex h-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-ui text-fg">{kind === 'Binary' ? VIEWER_COPY.binary(entry.bytes) : VIEWER_COPY.externalKind(kind)}</p>
        {kind === 'Binary' ? null : <p className="text-ui-sm text-fg-muted">{formatSize(entry.bytes)}</p>}
        {opensExternally(entry.path) && entry.appSessionId !== null ? <OpenExternally appSessionId={entry.appSessionId} path={entry.path} /> : null /* P3-L: none for a file read by its artifact (its header opens it) */}
      </div>
    </div>
  );
}
