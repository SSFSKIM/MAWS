// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D10 "Check against the design system"; M6): the panel
// the header's Check opens beside the stage. It runs the governing system's tagged hard don'ts over the deck (D's
// `checkHardDonts` on `unitsOfDeck`, ../../check.ts) and lists each violation under its slide; a click shows the slide
// and selects the element. It runs again a moment after the deck or the system changes, while the panel is open (a drag
// never waits on it). The don'ts no rule checks are listed for the owner to judge, as D's own page lists them.
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useDesignSystem, type DesignSystemRef } from '../../../design-system/apply';
import { onUpdate } from '../../../yjs';
import { checkDeck, elementOfLocator, type DeckCheck } from '../../check';
import { slideOrder } from '../../model';
import type { DeckSession } from '../session';
import { CHECK_COPY as C } from './copy';
import './menus.css';

/** How long the check waits after the deck's last change before it runs again. */
export const CHECK_SETTLE_MS = 300;

export interface CheckPanelProps {
  session: DeckSession;
  system: DesignSystemRef | { builtin: 'maws' } | null;
}

// A number that moves a moment after the deck's last change (the check's cue to run again).
function useSettledVersion(session: DeckSession): number {
  const version = useRef(0);
  const subscribe = useCallback(
    (listener: () => void) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const off = onUpdate(session.doc, () => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          version.current++;
          listener();
        }, CHECK_SETTLE_MS);
      });
      return () => {
        off();
        if (timer !== null) clearTimeout(timer);
      };
    },
    [session],
  );
  return useSyncExternalStore(subscribe, () => version.current);
}

function useDeckCheck(session: DeckSession, law: string | null, tokens: Parameters<typeof checkDeck>[2] | null): DeckCheck | null {
  const version = useSettledVersion(session);
  const run = useMemo(() => ({ version, check: law === null || tokens === null ? null : checkDeck(session.doc, law, tokens) }), [session, law, tokens, version]);
  return run.check;
}

export function CheckPanel({ session, system }: CheckPanelProps) {
  const { view } = useDesignSystem(system);
  const check = useDeckCheck(session, view?.law ?? null, view?.tokens ?? null);
  const order = check ? slideOrder(session.doc) : [];
  const words = (index: number) => check?.donts.find((d) => d.index === index)?.text ?? '';
  const select = (slideId: string, at: string) => {
    session.show(slideId);
    const id = elementOfLocator(at);
    session.select(id ? [id] : []);
  };

  let body;
  if (!view || !check) body = <p className="deck-check-note">{C.loading}</p>;
  else if (check.donts.length === 0) body = <p className="deck-check-note">{C.noDonts(view.name)}</p>;
  else {
    const { report } = check;
    const bySlide = order.map((slideId, i) => ({ slideId, n: i + 1, violations: report.violations.filter((v) => v.unit === slideId) })).filter((s) => s.violations.length > 0);
    const broken = report.checks.filter((c) => c.violations > 0).length;
    body = (
      <>
        <p className="deck-check-summary" role="status">
          {report.violations.length ? C.summary(report.violations.length, broken) : C.clean(report.checks.length)}
        </p>
        {bySlide.map(({ slideId, n, violations }) => (
          <section key={slideId} className="deck-inspector-section" aria-label={C.slide(n)}>
            <h3 className="deck-inspector-heading">{C.slide(n)}</h3>
            <ul className="deck-check-list">
              {violations.map((v, i) => (
                <li key={i}>
                  <button type="button" className="deck-check-violation" data-violation={v.rule} data-element={elementOfLocator(v.element) ?? ''} aria-label={`${C.select(v.element)}: ${v.message}`} onClick={() => select(slideId, v.element)}>
                    <span className="deck-check-message">{v.message}</span>
                    <span className="deck-check-where">{v.element.split(' > ').slice(1).join(' › ') || v.element}</span>
                    <span className="deck-check-rule">
                      {words(v.dont)} [check: {v.rule}]
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {report.manual.length > 0 && (
          <section className="deck-inspector-section" aria-label={C.manual}>
            <h3 className="deck-inspector-heading">{C.manual}</h3>
            <ul className="deck-check-plain">
              {report.manual.map((d) => (
                <li key={d.index}>{d.text}</li>
              ))}
            </ul>
          </section>
        )}
        {report.unknown.length > 0 && (
          <section className="deck-inspector-section" aria-label={C.unknown}>
            <h3 className="deck-inspector-heading">{C.unknown}</h3>
            <ul className="deck-check-plain">
              {report.unknown.map((u, i) => (
                <li key={i}>
                  <code>{u.tag}</code> {u.message}
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }
  return (
    <aside className="deck-inspector deck-check" aria-label={C.panel} data-deck-rail="check">
      <h2 className="deck-inspector-title">{C.panel}</h2>
      <div className="deck-check-body">{body}</div>
    </aside>
  );
}
