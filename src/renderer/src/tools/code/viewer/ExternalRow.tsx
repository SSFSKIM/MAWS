// The "Open externally" row (C8c execution document, Interfaces *Viewer kinds and caps*; ruling 4 and the P1 addendum):
// PDF, HTML, audio, video, a binary that is not an image and an image past the cap are not drawn in MAWS. The button is
// offered only for a file `files.openExternal` would hand to the OS (`opensExternally`, shared with the service), so a
// binary MAWS will not open reads its size and nothing more.
// P5 O7 M4: for a lane B session on another machine it would open the file on that machine's desktop. P5 O7 M5a (A10):
// it opens a copy of the file here (lane-b/open-copy.ts), and says where the file is ("on <machine>").
// UX wave U6c (M3 decision 1): a session on this Mac asks with `named`, so a file outside its folders that its transcript
// links opens too; a session on another machine is asked as before. UX wave U6e (decision 19): with `agent` while the
// tab holds the agent's mark, so a grant alone opens nothing there.
// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M5, decision 12; card 3, "True sentences
// now"): a PDF, an HTML page, a video or a sound is drawn in MAWS now, so a row of one says why this file is not drawn,
// and offers Open externally only where the act can work (`rowWords`, the one place). A kind MAWS does not frame keeps
// today's words and today's rule for the button.
// UX wave U6f, the branch review (Decision Log 33 (3)): for a session that takes the remote route, the copy carries `open`
// under the test the tab's reads and its frame's ask take (`opens`): a path the person opened on that machine this run.
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { framedKindOf } from '@shared/files/framed';
import { opensExternally } from '@shared/ipc/schema/files';
import { REMOTE_COPY_MAX_BYTES } from '@shared/ipc/schema/remote';
import { ipc } from '../../../ipc/client';
import { machineFor } from '../../../ipc/machine';
import { COPY_WORDS, openSessionFile } from '../../../lane-b/open-copy';
import { ELSEWHERE_WORDS, useElsewhereMachine } from '../../../lane-b/remote-session';
import { formatSize, VIEWER_COPY } from '../copy';
import { externalKindOf } from './kinds';
import { opens, type ViewerEntry } from './viewer-store';

// The row's button shape, which the framed file's failure body takes too (UX wave U6b-2, M5 decision 3).
export const rowButton = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg hover:bg-bg-hover';

export function OpenExternally({ appSessionId, path, agent = false }: { appSessionId: AppSessionId; path: string; agent?: boolean }) {
  const [problem, setProblem] = useState<string | null>(null);
  const elsewhere = useElsewhereMachine(appSessionId);
  const open = async () => {
    const result = machineFor(appSessionId) === ipc.localMachine ? await ipc.invoke('files.openExternal', { appSessionId, path, named: true, ...(agent ? { agent: true as const } : {}) }) : await openSessionFile(appSessionId, path, ipc, opens({ appSessionId, path }));
    if (!result.ok) setProblem(VIEWER_COPY.refused(result.error.message));
    else setProblem(result.value.opened ? null : VIEWER_COPY.notOpened(result.value.message ?? ''));
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={rowButton} title={elsewhere === null ? undefined : COPY_WORDS.title(elsewhere)} onClick={() => void open()}>
        {VIEWER_COPY.openExternally}
      </button>
      {elsewhere !== null ? <span className="text-ui-sm text-fg-faint">{ELSEWHERE_WORDS.on(elsewhere)}</span> : null}
      {problem ? (
        <span role="alert" className="text-ui-sm text-danger">
          {problem}
        </span>
      ) : null}
    </span>
  );
}

// Card 3's one place: the row's sentence, and whether it holds Open externally (still only where `files.openExternal`
// would hand the file out, and for a session). A file of another machine past the copy's bound holds none: its open copy
// has the same bound, so the act could only fail (L4).
export function rowWords(entry: ViewerEntry): { sentence: string; open: boolean } {
  const { frame } = entry;
  if (frame?.status === 'row') {
    if (frame.why === 'too-large') return { sentence: VIEWER_COPY.tooLargeHere(REMOTE_COPY_MAX_BYTES), open: false };
    if (frame.why === 'unplayable') return { sentence: framedKindOf(entry.mime) === 'audio' ? VIEWER_COPY.soundUnplayable : VIEWER_COPY.videoUnplayable, open: true };
    return { sentence: VIEWER_COPY.olderService, open: true };
  }
  const kind = externalKindOf(entry) ?? 'Binary';
  return { sentence: kind === 'Binary' ? VIEWER_COPY.binary(entry.bytes) : VIEWER_COPY.externalKind(kind), open: true };
}

export function ExternalRow({ entry }: { entry: ViewerEntry }) {
  const { sentence, open } = rowWords(entry);
  const binary = entry.frame === null && (externalKindOf(entry) ?? 'Binary') === 'Binary'; // its sentence holds its size
  return (
    <div data-external-row className="flex h-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-ui text-fg">{sentence}</p>
        {binary ? null : <p className="text-ui-sm text-fg-muted">{formatSize(entry.bytes)}</p>}
        {open && opensExternally(entry.path) && entry.appSessionId !== null ? <OpenExternally appSessionId={entry.appSessionId} path={entry.path} agent={entry.agent} /> : null /* P3-L: none for a file read by its artifact (its header opens it) */}
      </div>
    </div>
  );
}
