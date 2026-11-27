// Agent-written Markdown on a card: a question's context and an option's preview (the C3 plan's §G, "Markdown"). It is
// the transcript's Markdown, static, which draws no raw HTML and no remote image, under a link policy narrower than the
// transcript's (the composite's §8.2, third rule): a web link goes to the host, a path link naming one of the question's
// own references opens that reference in the card, and every other link does nothing. The policy is `sheetLinkAction`,
// which C4's page may also read; the sheet draws its links itself through the Markdown's `link` seam, by that policy
// alone, so a refused link carries no destination that a middle click, a context menu or a drag could follow, and a path
// is decoded once, by the same code for the policy and for the drawn link. The actions provider names every action the
// transcript's own parts can reach, so none falls through to the app's.
import { createContext, useContext, useMemo, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import type { SheetReference } from '@shared/sheet/model';
import { Markdown } from '../transcript/view/markdown/Markdown';
import { NO_ACTIONS, TranscriptActionsProvider, type TranscriptActions } from '../transcript/view/context';
import type { SheetHost } from './host';
import { Tip } from '../ui/tip';

export type SheetLinkAction = { kind: 'open'; url: string } | { kind: 'reference'; reference: SheetReference } | null;

const WEB = /^https?:/i;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const LINE = /(?:#L\d+|:\d+)$/; // `src/x.ts#L42` and `src/x.ts:42` name a line of the file

/** The file a path link names: its destination decoded once (as written, or as `maws-path:<path>`), a line suffix aside. */
function linkedPath(url: string): string | null {
  const path = url.startsWith('maws-path:') ? url.slice('maws-path:'.length) : SCHEME.test(url) ? null : url;
  if (path === null || path === '') return null;
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    // an undecodable path is matched as written
  }
  return decoded.replace(LINE, '');
}

/**
 * What a link of a card's Markdown does: an `http` or `https` link opens through the host; a path that is one of the
 * question's references (its `path` or its `abs`) opens that reference; anything else is refused (null).
 */
export function sheetLinkAction(url: string, references: readonly SheetReference[]): SheetLinkAction {
  if (WEB.test(url)) return { kind: 'open', url };
  const file = linkedPath(url);
  const reference = file === null ? undefined : references.find((entry) => entry.path === file || entry.abs === file);
  return reference ? { kind: 'reference', reference } : null;
}

interface LinkScope {
  references: readonly SheetReference[];
  host: SheetHost;
  onReference(reference: SheetReference): void;
}
const LinkScopeContext = createContext<LinkScope | null>(null);

function activateOnKey(event: KeyboardEvent<HTMLElement>, run: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  if (!event.repeat) run();
}

// The sheet's one link: drawn as the transcript draws a link (transcript.css), with a destination only where the policy
// allows one to be followed. A link's address and a reference's path are its tip, which the keyboard reaches (board ticket
// 815), as the transcript's links have theirs.
function SheetLink({ href, children }: ComponentProps<'a'>): ReactNode {
  const scope = useContext(LinkScopeContext);
  const action = href && scope ? sheetLinkAction(href, scope.references) : null;
  if (action?.kind === 'open') {
    return (
      <Tip content={action.url} description={action.url}>
        <a
          href={action.url}
          onClick={(event) => {
            event.preventDefault();
            scope?.host.openLink(action.url);
          }}
        >
          {children}
        </a>
      </Tip>
    );
  }
  if (action?.kind === 'reference') {
    const open = () => scope?.onReference(action.reference);
    return (
      <Tip content={action.reference.path} description={action.reference.path}>
        <span role="button" tabIndex={0} className="transcript-inline-link" data-chip="path" onClick={open} onKeyDown={(event) => activateOnKey(event, open)}>
          {children}
        </span>
      </Tip>
    );
  }
  return (
    <a aria-disabled="true" data-link-refused="">
      {children}
    </a>
  );
}

export interface SheetMarkdownProps {
  markdown: string;
  references: readonly SheetReference[];
  host: SheetHost;
  onReference(reference: SheetReference): void;
}

// Every action a part of the transcript's Markdown could reach, none of the app's: links are the sheet's own above.
const NO_APP_ACTIONS: TranscriptActions = {
  ...NO_ACTIONS,
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

export function SheetMarkdown({ markdown, references, host, onReference }: SheetMarkdownProps) {
  const scope = useMemo((): LinkScope => ({ references, host, onReference }), [references, host, onReference]);
  return (
    <div className="min-w-0" data-sheet-markdown="">
      <LinkScopeContext.Provider value={scope}>
        <TranscriptActionsProvider actions={NO_APP_ACTIONS}>
          <Markdown markdown={markdown} live={false} link={SheetLink} />
        </TranscriptActionsProvider>
      </LinkScopeContext.Provider>
    </div>
  );
}
