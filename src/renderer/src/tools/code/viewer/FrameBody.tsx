// A framed file's body (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M5, decisions 3, 7,
// 9, 12, 13, 14 and 15; Interfaces §E): a PDF, an HTML page, a video or a sound a session's path names, drawn by the
// artifact store's own frames from the token main issued (`entry.frame`, the viewer store's).
//
// - Asking, with nothing drawn before: "Loading". Asking with a frame drawn: that frame, until the new token is ready.
// - Ready: `PdfFrame`, `HtmlFrame` or `Media`, each keyed by the URL it is given, so a new URL makes a new element (and
//   the frame loads the file again from the route). A file's HTML frame is given its URL and title and no other prop:
//   no pick, no locate, no connector port (decision 13). Its title is the file's base name (decision 9).
// - Failed: one sentence in the frame's place and, under it, the button that reads the entry again (decision 3; L7).
// - A row: `ExternalRow`, which says why (decision 12). So does an entry read by its artifact alone, which asks nothing.
// - Not in view while its body stays mounted (Files' tree in the file's place, the panel collapsed: "A hide", Decision
//   Log 29): no frame element, so nothing of the file runs or plays; a video's or a sound's time is the entry's and comes
//   back paused, a page starts again, and a named or failed file is read again on show, as a tab shown again is.
//
// Two of the owner's answers live here, each at one place: card 4 in `pdfFragment` (Chromium's PDF toolbar hidden beside
// the chat, kept in the main area; its thumbnail sidebar never opening by itself), and card 2 in the HTML branch (one
// line under the bar when the page names files beside it, the page still drawn).
import { useEffect, useRef, type ReactNode } from 'react';
import { HtmlFrame } from '../../artifacts/viewers/frames/HtmlFrame';
import { Media } from '../../artifacts/viewers/frames/Media';
import { PdfFrame } from '../../artifacts/viewers/frames/PdfFrame';
import { VIEWER_COPY } from '../copy';
import { ExternalRow, rowButton } from './ExternalRow';
import { useViewer, viewState, type ReadyFrame, type ViewerEntry } from './viewer-store';

// Card 4's one place (decision 15; L1, L2): both fragments were found honoured by Electron's viewer (M1, rows h and i).
// The fragment never reaches main; a tab that moves is drawn by a new element in its new place, with its new host's.
export function pdfFragment(host: 'side' | 'main'): string {
  return host === 'side' ? '#toolbar=0&navpanes=0' : '#navpanes=0';
}

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function FrameBody({ entry, host, inView }: { entry: ViewerEntry; host: 'side' | 'main'; inView: boolean }): ReactNode {
  const { frame, tabId } = entry;
  const hidden = useRef(!inView);
  useEffect(() => {
    if (inView && hidden.current) useViewer.getState().revisit(tabId); // reads only a named or a failed entry
    hidden.current = !inView;
  }, [inView, tabId]);
  if (frame === null || frame.status === 'row') return <ExternalRow entry={entry} />;
  if (frame.status === 'failed') return <Stopped tabId={tabId} />;
  const shown = frame.status === 'asking' ? frame.shown : frame;
  if (shown === null) return <p className="p-4 text-ui text-fg-muted">{VIEWER_COPY.loading}</p>;
  if (!inView) return null;
  return <Drawn tabId={tabId} frame={shown} title={nameOf(entry.path)} host={host} />;
}

function Drawn({ tabId, frame, title, host }: { tabId: string; frame: ReadyFrame; title: string; host: 'side' | 'main' }) {
  if (frame.framed === 'pdf') {
    const url = `${frame.url}${pdfFragment(host)}`;
    return <PdfFrame key={url} url={url} title={title} />;
  }
  if (frame.framed === 'html') {
    // Card 2's one place: the line says the page is drawn without the files beside it, which main read from its head
    return (
      <div className="flex h-full min-h-0 flex-col">
        {frame.neighbours === true ? (
          <p data-beside-files className="shrink-0 border-b border-border px-3 py-1 text-ui-sm text-fg-muted">
            {VIEWER_COPY.besideFiles}
          </p>
        ) : null}
        <div className="min-h-0 flex-1">
          <HtmlFrame key={frame.url} url={frame.url} title={title} />
        </div>
      </div>
    );
  }
  // A video's or a sound's position is the entry's view state, which outlives the element (a move, a hide)
  return (
    <Media
      key={frame.url}
      kind={frame.framed}
      url={frame.url}
      startAt={viewState(tabId).mediaAt}
      onTime={(seconds) => void (viewState(tabId).mediaAt = seconds)}
      onError={() => useViewer.getState().frameUnplayable(tabId)}
    />
  );
}

function Stopped({ tabId }: { tabId: string }) {
  return (
    <div data-frame-stopped className="flex h-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-ui text-fg">{VIEWER_COPY.frameStopped}</p>
        <button type="button" className={rowButton} onClick={() => useViewer.getState().openAgain(tabId)}>
          {VIEWER_COPY.openAgain}
        </button>
      </div>
    </div>
  );
}
