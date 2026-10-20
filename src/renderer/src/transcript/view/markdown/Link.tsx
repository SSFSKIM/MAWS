// The `a` of every markdown surface (residue *Streamdown configuration*): the gates in sanitize.ts leave only
// `https:`, `http:`, `mailto:` and the chip schemes. A web link opens through C5's open-external command and never
// navigates the renderer; `maws-path:` is a path chip opening the file (whether it exists is not known here);
// `maws-image:` is an image chip naming its source, loading nothing (§4.1); `maws-artifact:` (P3-F wave S, F14) is an
// artifact chip; a link whose href the gates removed is its text.
import type { ComponentProps, MouseEvent } from 'react';
import type { ExtraProps } from 'streamdown';
import { artifactLink, parseArtifactLink } from '@shared/artifacts/link'; // P4-B4
import { useActions, useRowSession } from '../context';

const LINE = /(?:#L(\d+)|:(\d+))$/;

// `src/x.ts#L42` and `src/x.ts:42` name a line.
function pathOf(href: string): { path: string; line: number | undefined } {
  let path = href;
  try {
    path = decodeURI(href);
  } catch {
    // an undecodable href is used as written
  }
  const line = LINE.exec(path);
  return line ? { path: path.slice(0, line.index), line: Number(line[1] ?? line[2]) } : { path, line: undefined };
}

// P3-F wave S (F14, the owner's obs 2): the artifact an agent names, `maws-artifact:<artifactId>`, so the human opens it
// with a click instead of asking where it is. Only a store id names one (ids are UUIDs; a handle is the session's, which
// this view cannot resolve): any other is the link's text. P4-B4 (the link grammar, `parseArtifactLink`): a fragment
// names the place it opens at (a document's tab or block, a deck's slide, a retained version), at the latest version
// unless it names one; main's content form (`maws-artifact://<id>/<revision>/<path>`) names the artifact alone. The chip
// carries the place as the grammar writes it (`data-artifact-at`, the fragment alone, so no element carries the link)
// for a surface that takes the click before it.
const ARTIFACT_CHIP_TITLE = 'Open in the panel · ⌘-click opens it in a tab';

export function TranscriptLink({ href, children }: ComponentProps<'a'> & ExtraProps) {
  const actions = useActions();
  const session = useRowSession();
  if (!href) return <span>{children}</span>;
  if (/^maws-artifact:/i.test(href)) {
    const link = parseArtifactLink(href);
    // a mount that cannot open a main tab (the desk) is taken to open no artifact at all: the link is its text
    const openTab = actions.openArtifactTab;
    if (link === null || !openTab) return <span>{children}</span>;
    const { artifactId, at } = link;
    // a click opens it in the row session's panel, a ⌘-click in its main tab; with no session (a Markdown surface outside
    // any Transcript, whose host actions App.tsx gives the tab), the main tab is the one place it can show. Under a
    // plugin's surface (engine-surface/SurfaceTree.tsx) the click is taken before it.
    const open = (event: MouseEvent) => {
      if (session !== null && !event.metaKey) {
        if (at) actions.openArtifact(session, artifactId, undefined, at);
        else actions.openArtifact(session, artifactId);
      } else if (at) openTab(artifactId, at);
      else openTab(artifactId);
    };
    return (
      <button type="button" className="transcript-chip" data-chip="artifact" data-artifact-id={artifactId} data-artifact-at={at && artifactLink(artifactId, at).slice(artifactLink(artifactId).length)} title={ARTIFACT_CHIP_TITLE} onClick={open}>
        {children}
      </button>
    );
  }
  if (href.startsWith('maws-path:')) {
    const { path, line } = pathOf(href.slice('maws-path:'.length));
    return (
      <button type="button" className="transcript-chip" data-chip="path" title={path} onClick={() => actions.openFile(path, line)}>
        {children}
      </button>
    );
  }
  if (href.startsWith('maws-image:')) {
    const source = href.slice('maws-image:'.length);
    return (
      <span className="transcript-chip" data-chip="image" title={source}>
        {children}
        <span className="transcript-chip-detail"> · {source}</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        actions.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}
