// The Design System page (D14 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; Decision Log 13, 17): a
// system's palette, type, space, radius and shadow with their values editable in place, its canon rendered in it, its
// law, and the check of the canon against the law. Every edit writes the token to the replica at once (`setToken`),
// so the page holds nothing unsaved; the previews follow the replica in the same frame. Portable (§4.10): the page
// takes the system's open handle and the host, and draws its chrome in the app's tokens, the system only inside its
// previews' scopes. The app's header registration (X32) and Mark-up are the renderer body's that mounts this page.
// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4): the page mounts on a replica past its
// first sync (the tab's open waits for it, under its own quiet spinner), so a replica that holds no system is no wait:
// the page says it is empty and what to do, settled, and draws the system as soon as one is written (G562; M5 task 4's review). Tokens
// that do not resolve are one line with their count that opens to each (G565). The empty page is the app's empty state:
// its title, the hint right under it (the pair review's G562). The page is the boundary of its tooltips, so one on a word
// near its edge stays on the page (G584).
import { useLayoutEffect, useRef, useState } from 'react';
import { TipBoundary } from '../../../renderer/src/ui/tip';
import type { ArtifactHost, DocumentHandle } from '../../host';
import type { HtmlParser } from '../canon';
import type { SystemOrigin } from '../model';
import { scopeKeyOf } from '../scope-style';
import { Canon } from './Canon';
import { PAGE_COPY } from './copy';
import { Check } from './Check';
import { Law, type AskAdopt } from './Law';
import { Measures } from './Measures';
import { Palette } from './Palette';
import { TypeScale } from './TypeScale';
import { pageViewOf, usePageState } from './use-system';
import './page.css';

export interface DesignSystemPageProps {
  artifactId: string;
  /** The system's replica, open for as long as the page shows it (the mounting body's). */
  handle: Pick<DocumentHandle, 'doc'>;
  /** Where the system's assets load from (`assetUrl`). */
  host: Pick<ArtifactHost, 'assetUrl'>;
  /** Shows the values without letting them be edited. */
  readOnly?: boolean;
  /** A serial: each new value brings the check into view (the header's "Check against law"). */
  revealCheck?: number;
  /** Reads canon for the check; the window's `DOMParser` when absent. */
  parser?: HtmlParser;
  /** A system without a law offers to ask the agent to adopt it (the app's route to the shown session); none, no offer. */
  askAdopt?: AskAdopt;
  /** The page's title: the artifact's (Decision Log 29); the system's name when absent. The law keeps its own title. */
  title?: string;
}

// The bundled system a seeded default (or a duplicate of one, which keeps its route and key) holds; null for any other.
const bundledKeyOf = (origin: SystemOrigin): string | null => (origin.route === 'default' && origin.key !== undefined ? origin.key : null);

export function DesignSystemPage(props: DesignSystemPageProps) {
  const { artifactId, handle, host, readOnly = false, revealCheck = 0 } = props;
  const doc = handle.doc;
  const { system, resolved } = usePageState(doc);
  const toUrl = (ref: string) => host.assetUrl(artifactId, ref);
  const view = pageViewOf(doc, toUrl);
  const parser = props.parser ?? (new DOMParser() as unknown as HtmlParser);
  const check = useRef<HTMLElement>(null);
  const [page, setPage] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (revealCheck === 0) return;
    check.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    check.current?.focus({ preventScroll: true });
  }, [revealCheck]);

  if (!system.meta) {
    return (
      <div className="dsp-page" data-ds-page={artifactId}>
        <div className="dsp-empty">
          <p className="dsp-empty-title">{PAGE_COPY.empty}</p>
          <p className="dsp-empty-hint dsp-muted">{PAGE_COPY.emptyNext}</p>
        </div>
      </div>
    );
  }
  const sections = { doc, tokens: system.tokens, resolved, view, scopeKey: scopeKeyOf(host, `page:${artifactId}`), readOnly };
  return (
    <div ref={setPage} className="dsp-page" data-ds-page={artifactId}>
      <TipBoundary element={page}>
      <header className="dsp-intro">
        <h1 className="dsp-title">{props.title ?? system.meta.name}</h1>
        {system.meta.persona ? <p className="dsp-muted">persona: {system.meta.persona}</p> : null}
        {resolved.problems.length ? (
          <div role="status" className="dsp-problems">
            <details>
              <summary>{PAGE_COPY.unresolved(resolved.problems.length)}</summary>
              <ul>
                {resolved.problems.map((p, i) => (
                  <li key={i}>
                    <code className="dsp-name">{p.path}</code> {p.message}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
      </header>
      <Palette {...sections} />
      <TypeScale {...sections} />
      <Measures {...sections} />
      <Canon tokens={system.tokens} files={system.files} toUrl={toUrl} bundledKey={bundledKeyOf(system.meta.origin)} />
      <Law law={system.law} askAdopt={props.askAdopt} />
      <Check law={system.law} tokens={system.tokens} files={system.files} parser={parser} sectionRef={check} />
      </TipBoundary>
    </div>
  );
}
