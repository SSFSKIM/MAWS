// The Design System page (D14 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; Decision Log 13, 17): a
// system's palette, type, space, radius and shadow with their values editable in place, its canon rendered in it, its
// law, and the check of the canon against the law. Every edit writes the token to the replica at once (`setToken`),
// so the page holds nothing unsaved; the previews follow the replica in the same frame. Portable (§4.10): the page
// takes the system's open handle and the host, and draws its chrome in the app's tokens, the system only inside its
// previews' scopes. The app's header registration (X32) and Mark-up are the renderer body's that mounts this page.
import { useLayoutEffect, useRef } from 'react';
import type { ArtifactHost, DocumentHandle } from '../../host';
import type { HtmlParser } from '../canon';
import { Canon } from './Canon';
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

export function DesignSystemPage(props: DesignSystemPageProps) {
  const { artifactId, handle, host, readOnly = false, revealCheck = 0 } = props;
  const doc = handle.doc;
  const { system, resolved } = usePageState(doc);
  const toUrl = (ref: string) => host.assetUrl(artifactId, ref);
  const view = pageViewOf(doc, toUrl);
  const parser = props.parser ?? (new DOMParser() as unknown as HtmlParser);
  const check = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (revealCheck === 0) return;
    check.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    check.current?.focus({ preventScroll: true });
  }, [revealCheck]);

  if (!system.meta) {
    return (
      <div className="dsp-page" data-ds-page={artifactId}>
        <p className="dsp-muted">Loading the design system…</p>
      </div>
    );
  }
  const sections = { doc, tokens: system.tokens, resolved, view, artifactId, readOnly };
  return (
    <div className="dsp-page" data-ds-page={artifactId}>
      <header className="dsp-intro">
        <h1 className="dsp-title">{props.title ?? system.meta.name}</h1>
        {system.meta.persona ? <p className="dsp-muted">persona: {system.meta.persona}</p> : null}
        {resolved.problems.length ? (
          <p role="status" className="dsp-problems">
            {resolved.problems.length === 1 ? 'One token does not resolve' : `${resolved.problems.length} tokens do not resolve`}:{' '}
            {resolved.problems.map((p) => `${p.path} (${p.message})`).join('; ')}
          </p>
        ) : null}
      </header>
      <Palette {...sections} />
      <TypeScale {...sections} />
      <Measures {...sections} />
      <Canon tokens={system.tokens} files={system.files} toUrl={toUrl} />
      <Law law={system.law} askAdopt={props.askAdopt} />
      <Check law={system.law} tokens={system.tokens} files={system.files} parser={parser} sectionRef={check} />
    </div>
  );
}
