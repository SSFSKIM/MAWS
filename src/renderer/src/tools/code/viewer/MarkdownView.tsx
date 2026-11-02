// A markdown file rendered (C8c execution document, Interfaces *Viewer kinds and caps*): C6's `Markdown` (static, its
// sanitising pipeline), the scroll kept across hidden tabs and handed to the Source view as a ratio on the toggle.
// P5 O7 M5a: an artifact link opens on the machine the file is on (the artifact's it is read by, else its session's).
import { useLayoutEffect, useRef } from 'react';
import { Markdown } from '../../../transcript';
import { isAddress, machineOf } from '@shared/machine/address';
import { artifactMachineOf } from '../../../artifacts/machines';
import { ipc } from '../../../ipc/client';
import { TranscriptActionsProvider, useActions } from '../../../transcript/view/context';
import { openFile } from '../open-file';
import { existingViewState, viewState, type ViewerEntry } from './viewer-store';

export function MarkdownView({ entry }: { entry: ViewerEntry }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { tabId } = entry;
  const openTab = useActions().openArtifactTab;
  const source = entry.artifact ? (artifactMachineOf(entry.artifact.artifactId) ?? ipc.localMachine) : entry.appSessionId !== null && isAddress(entry.appSessionId) ? machineOf(entry.appSessionId) : ipc.localMachine;
  useLayoutEffect(() => {
    const el = scroller.current!;
    const saved = viewState(tabId);
    if (saved.ratioPending && saved.ratio !== null) el.scrollTop = saved.ratio * Math.max(0, el.scrollHeight - el.clientHeight);
    else el.scrollTop = saved.renderedScroll;
    saved.ratioPending = false;
    return () => {
      const saved = existingViewState(tabId);
      if (saved) Object.assign(saved, { renderedScroll: el.scrollTop, ratio: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) });
    };
  }, [tabId]);
  return (
    <div ref={scroller} data-markdown-view className="h-full min-h-0 overflow-auto px-6 py-4">
      <div className="mx-auto max-w-[var(--measure)]">
        <TranscriptActionsProvider actions={{ openFile: (path, line) => openFile(entry.appSessionId, path, line), ...(openTab && { openArtifactTab: (artifactId, location) => openTab(artifactId, location, source) }) }}>
          <Markdown markdown={entry.text} live={false} />
        </TranscriptActionsProvider>
      </div>
    </div>
  );
}
