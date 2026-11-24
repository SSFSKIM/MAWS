// Agent-written Markdown on a card: a question's context and an option's preview (the C3 plan's §G, "Markdown"). It is
// the transcript's Markdown, static, which draws no raw HTML and no remote image, under a link policy narrower than the
// transcript's (the composite's §8.2, third rule): a web link goes to the host, a path link naming one of the question's
// own references opens that reference in the card, and every other link does nothing. The policy is `sheetLinkAction`,
// which a surface may also read to draw a refused link as text; the actions provider below names every action a link
// can reach, so none falls through to the app's own. A refused link is still drawn as a link, and is inert.
import { useMemo } from 'react';
import type { SheetReference } from '@shared/sheet/model';
import { Markdown } from '../transcript/view/markdown/Markdown';
import { NO_ACTIONS, TranscriptActionsProvider, type TranscriptActions } from '../transcript/view/context';
import type { SheetHost } from './host';

export type SheetLinkAction = { kind: 'open'; url: string } | { kind: 'reference'; reference: SheetReference } | null;

const WEB = /^https?:/i;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const LINE = /(?:#L\d+|:\d+)$/; // `src/x.ts#L42` and `src/x.ts:42` name a line of the file

function referenceNamed(path: string, references: readonly SheetReference[]): SheetReference | null {
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    // an undecodable path is matched as written
  }
  const file = decoded.replace(LINE, '');
  return references.find((reference) => reference.path === file || reference.abs === file) ?? null;
}

/**
 * What a link of a card's Markdown does: an `http` or `https` link opens through the host; a path, as written or as the
 * transcript's Markdown names it (`maws-path:<path>`), that is one of the question's references (its `path` or its
 * `abs`, a line suffix aside) opens that reference; anything else is refused (null).
 */
export function sheetLinkAction(url: string, references: readonly SheetReference[]): SheetLinkAction {
  if (WEB.test(url)) return { kind: 'open', url };
  const path = url.startsWith('maws-path:') ? url.slice('maws-path:'.length) : SCHEME.test(url) ? null : url;
  if (path === null || path === '') return null;
  const reference = referenceNamed(path, references);
  return reference ? { kind: 'reference', reference } : null;
}

export interface SheetMarkdownProps {
  markdown: string;
  references: readonly SheetReference[];
  host: SheetHost;
  onReference(reference: SheetReference): void;
}

export function SheetMarkdown({ markdown, references, host, onReference }: SheetMarkdownProps) {
  const actions = useMemo((): TranscriptActions => {
    const act = (action: SheetLinkAction) => {
      if (action?.kind === 'open') host.openLink(action.url);
      else if (action?.kind === 'reference') onReference(action.reference);
    };
    return {
      ...NO_ACTIONS,
      openExternal: (url) => act(sheetLinkAction(url, references)),
      openFile: (path) => {
        const reference = referenceNamed(path, references); // the transcript's Markdown hands a path link's path, its line split off
        if (reference) onReference(reference);
      },
      // An artifact link is its text where no main tab can open (Link.tsx); an artifact can be reached no other way.
      openArtifactTab: undefined,
      showOpenArtifactTab: undefined,
      openCommit: undefined,
      undeleteArtifact: undefined,
      userRowMark: undefined,
      droppedRowMark: undefined,
      outputAction: undefined,
      renderBlockedCall: undefined,
      forkFrom: undefined,
    };
  }, [host, onReference, references]);
  return (
    <div className="min-w-0" data-sheet-markdown="">
      <TranscriptActionsProvider actions={actions}>
        <Markdown markdown={markdown} live={false} />
      </TranscriptActionsProvider>
    </div>
  );
}
