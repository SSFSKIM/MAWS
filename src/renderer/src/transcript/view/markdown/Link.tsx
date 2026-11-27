// The `a` of every markdown surface (residue *Streamdown configuration*): the gates in sanitize.ts leave only
// `https:`, `http:`, `mailto:` and the chip schemes. A web link opens through C5's open-external command and never
// navigates the renderer; `maws-path:` is a path link opening the file (whether it exists is not known here; beside the
// chat, and ⌘-click in the main area: UX wave U6b-1), made of a scheme-less destination or, in the window, of an inline
// `file:` link with an empty host, whose rest it names (UX wave U6b-4b: sanitize.ts, `remarkTranscriptSources`);
// `maws-image:` is an image chip naming its source, loading nothing (§4.1); `maws-artifact:` (P3-F wave S, F14) is an
// artifact mention; a link whose href the gates removed is its text. P5 O7 M3: a web link carries its row's session, whose
// machine decides whether a loopback link is a forward (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md). UX
// wave U6b-4b (R3): its ⌘-click carries `{ external: true }`, so a loopback link of a session on this Mac, which opens in
// the in-app browser, opens in the system browser instead; Enter on a focused link is the browser's own click, ⌘ included.
// UX wave U6d (O-44; docs/doperpowers/plans/2026-11-14-ux-wave-U6d-artifact-link.md, Interfaces §E and §F): a mention
// and a path link are link text, not a box: a span with the role of a button (a <button> is an inline-block box, so a
// long title could not wrap with the prose), activated by a click, Enter and Space; the attribute `data-chip` keeps its
// name for the surfaces and tests that read it. The image chip keeps its box.
import type { ComponentProps, KeyboardEvent, ReactNode } from 'react';
import type { ExtraProps } from 'streamdown';
import type { AppSessionId } from '@shared/graph/ids';
import { artifactLink, parseArtifactLink, type ArtifactLocation } from '@shared/artifacts/link'; // P4-B4
import { isAddress, machineOf } from '@shared/machine/address';
import { Tip } from '../../../ui/tip';
import { useActions, useRowSession, type TranscriptActions } from '../context';

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
// unless it names one; main's content form (`maws-artifact://<id>/<revision>/<path>`) names the artifact alone. The
// mention carries the place as the grammar writes it (`data-artifact-at`, the fragment alone, so no element carries the
// link) for a surface that takes the click before it. U6d (decision 16): one tooltip, true wherever the click lands; the
// word cut (N125): the shortcut alone, since a click on the mention says it opens the artifact. Ticket 815: a tip the
// keyboard reaches, as the path link's path and a web link's address are, never the system tooltip.
export const ARTIFACT_LINK_TITLE = '⌘-click opens it in a tab';

// UX wave U6d (Interfaces §F): what a click on a mention opens, the one rule of both click sites (this component, and a
// mod's surface, engine-surface/SurfaceTree.tsx, which takes the click before it). With no session (a Markdown surface
// outside any Transcript, whose host actions App.tsx gives the tab) the main tab is the one place it can show; ⌘ opens
// it in its main tab, on the session's machine when the session's id is an address (P5 O7 M5a); otherwise the main tab
// that already shows it comes forward (card C5, "Show that tab"), and with none it opens in the row session's side
// column. The argument forms are today's, which the tests compare whole.
export function openArtifactMention(actions: TranscriptActions, session: AppSessionId | null, link: { artifactId: string; at?: ArtifactLocation }, metaKey: boolean): void {
  const { artifactId, at } = link;
  if (session === null || (metaKey && actions.openArtifactTab)) {
    const machine = session !== null && isAddress(session) ? machineOf(session) : undefined;
    if (machine !== undefined) actions.openArtifactTab?.(artifactId, at, machine);
    else if (at) actions.openArtifactTab?.(artifactId, at);
    else actions.openArtifactTab?.(artifactId);
    return;
  }
  const shown = at ? actions.showOpenArtifactTab?.(session, artifactId, at) : actions.showOpenArtifactTab?.(session, artifactId);
  if (shown === true) return;
  if (at) actions.openArtifact(session, artifactId, undefined, at);
  else actions.openArtifact(session, artifactId);
}

// UX wave U6d (decision 12): a click that ends a selection touching the link (a drag across its words) opens nothing; a
// click from the keyboard (detail 0) is never one. Exported for a mod's surface, whose capture handler opens the link.
export function endsSelection(event: { detail: number }, element: Node): boolean {
  if (event.detail <= 0) return false;
  const selection = element.ownerDocument?.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let k = 0; k < selection.rangeCount; k++) if (selection.getRangeAt(k).intersectsNode(element)) return true;
  return false;
}

// UX wave U6d (decisions 8 and 9): Enter or Space is a click on the link, carrying ⌘, so whatever handles the click
// handles the key (under a mod's surface, the surface's capture); Space's default, the scroll, is prevented, and a held
// key opens once. A key an earlier listener consumed (the keymap's dispatcher, on the window in the capture phase,
// prevents the default of a key it ran a binding for and does not stop it) is left alone.
function activateOnKey(event: KeyboardEvent<HTMLElement>): void {
  if (event.nativeEvent.defaultPrevented) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  if (event.repeat) return;
  event.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: event.metaKey }));
}

// The mention's and the path link's one element (Interfaces §E): their look is `.transcript-inline-link`
// (transcript.css), a path link's monospace by its `data-chip`.
interface InlineLinkProps {
  'data-chip': 'artifact' | 'path';
  'data-artifact-id'?: string;
  'data-artifact-at'?: string;
  'data-path'?: string; // a path link's path, which its tip shows, for the tests and surfaces that find a link by it
  tip: string;
  open: (metaKey: boolean) => void;
  children?: ReactNode;
}
function InlineLink({ open, tip, children, ...attributes }: InlineLinkProps) {
  return (
    <Tip content={tip} description={tip}>
      <span
        role="button"
        tabIndex={0}
        className="transcript-inline-link"
        {...attributes}
        onClick={(event) => {
          if (!endsSelection(event.nativeEvent, event.currentTarget)) open(event.metaKey);
        }}
        onKeyDown={activateOnKey}
      >
        {children}
      </span>
    </Tip>
  );
}

export function TranscriptLink({ href, children }: ComponentProps<'a'> & ExtraProps) {
  const actions = useActions();
  const session = useRowSession();
  if (!href) return <span>{children}</span>;
  if (/^maws-artifact:/i.test(href)) {
    const link = parseArtifactLink(href);
    // a mount that cannot open a main tab (the desk) is taken to open no artifact at all: the link is its text
    if (link === null || !actions.openArtifactTab) return <span>{children}</span>;
    const { artifactId, at } = link;
    return (
      <InlineLink data-chip="artifact" data-artifact-id={artifactId} data-artifact-at={at && artifactLink(artifactId, at).slice(artifactLink(artifactId).length)} tip={ARTIFACT_LINK_TITLE} open={(metaKey) => openArtifactMention(actions, session, link, metaKey)}>
        {children}
      </InlineLink>
    );
  }
  if (href.startsWith('maws-path:')) {
    const { path, line } = pathOf(href.slice('maws-path:'.length));
    return (
      <InlineLink data-chip="path" data-path={path} tip={path} open={(metaKey) => actions.openFile(path, line, session, { main: metaKey })}>
        {children}
      </InlineLink>
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
    <Tip content={href} description={href}>
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          if (event.metaKey) actions.openExternal(href, session, { external: true });
          else actions.openExternal(href, session);
        }}
      >
        {children}
      </a>
    </Tip>
  );
}
