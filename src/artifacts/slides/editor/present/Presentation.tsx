// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D13; M6): the show, as the `present` route draws it in
// the audience window or the presenter window. The audience view is the slide alone, fitted to the window on black,
// playing builds and transitions; a click or → ↓ Space advances. The presenter view shows the current slide, the next
// one (or the slide's next build), the speaker notes, the time since the show began and where it is, with buttons for
// what the keys do: → ↓ Space PageDown next, ← ↑ PageUp back, Home, End, B black, Escape ends. With one display the
// audience window is the only one and P shows the presenter view in it. The two windows keep one position over a
// `BroadcastChannel` (channel.ts). The deck is a live replica nobody writes here: an edit, an agent's republish, a slide
// hidden or removed while the show runs shows at once, and the show stays where it can (sequence.ts).
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { DesignSystemScope, type DesignSystemRef } from '../../../design-system/apply';
import { onUpdate, type Doc } from '../../../yjs';
import * as Y from '../../../yjs/slides';
import type { AssetUrl } from '../../canvas';
import { slideOrder } from '../../model';
import { useDeckView } from '../deck-view';
import { faceRules, useCanvasCss } from '../page-styles';
import { openPresentChannel, type PresentChannel, type PresentMessage } from './channel';
import { PRESENT_COPY as C } from './copy';
import { firstPosition, lastPosition, nextPosition, prevPosition, settlePosition, showSlides, slideSteps, startPosition, type Position, type Transition } from './sequence';
import { ShowStage, SLIDE_H, SLIDE_W, type Move, type ShowStageOptions } from './stage';
import './present.css';

export type PresentRole = 'audience' | 'presenter';

export interface PresentationProps {
  doc: Doc;
  artifactId: string;
  role: PresentRole;
  /** A presenter window shows beside the audience's (two displays): P does nothing in the audience window. */
  paired: boolean;
  /** The slide to start at (the editor's current one). */
  start: string | null;
  system: DesignSystemRef | { builtin: 'maws' } | null;
  assetUrl: AssetUrl;
  /** Where an x-embed's page runs (main's `maws-artifact:` route, Decision Log 18). */
  embedUrl?: ShowStageOptions['embedUrl'];
  /** The show ended (Escape, End show, or the other window ended it): the window closes. */
  onEnd: () => void;
}

interface ShowState {
  pos: Position | null;
  move: Move;
  transition: Transition | null;
  black: boolean;
}

/** A number that changes with every update the replica takes. */
function useDocVersion(doc: Doc): number {
  const version = useRef(0);
  const subscribe = useCallback(
    (listener: () => void) =>
      onUpdate(doc, () => {
        version.current++;
        listener();
      }),
    [doc],
  );
  return useSyncExternalStore(subscribe, () => version.current);
}

/**
 * What the views read of the live deck at a position: the position as the deck now has it (a slide removed or hidden
 * while the show runs gives way to its neighbour, a removed one by its place in `seen`, the deck's order as last seen
 * holding it), the step after it, where it stands in the show and its notes, and the deck's order while it holds the
 * position's slide. Read per render with the replica's `version` as an input, so a memoizing compiler reads again after
 * every update.
 */
function readShow(doc: Doc, at: Position | null, seen: readonly string[], version: number) {
  const pos = at && settlePosition(doc, at, seen);
  const settled = pos !== null && at !== null && pos.slideId === at.slideId && pos.build === at.build;
  const now = pos ?? firstPosition(doc);
  const show = showSlides(doc);
  const order = slideOrder(doc);
  return {
    version,
    settled,
    pos: now,
    following: now && nextPosition(doc, now),
    index: now ? show.indexOf(now.slideId) + 1 : 0,
    count: show.length,
    notes: now ? Y.readNotes(doc, now.slideId) : '',
    holding: at !== null && order.includes(at.slideId) ? order : null,
  };
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** How a move from `from` to `to` plays: one step forward or back (with its transition), else a jump. */
function moveOf(doc: Doc, from: Position | null, to: Position): Pick<ShowState, 'move' | 'transition'> {
  const same = (a: Position | null, b: Position) => a !== null && a.slideId === b.slideId && a.build === b.build;
  if (from && same(nextPosition(doc, from), to)) return { move: 'forward', transition: from.slideId === to.slideId ? null : slideSteps(doc, from.slideId).transition };
  if (from && same(prevPosition(doc, from), to)) return { move: 'back', transition: from.slideId === to.slideId ? null : slideSteps(doc, to.slideId).transition };
  return { move: 'jump', transition: null };
}

export function Presentation({ doc, artifactId, role, paired, start, system, assetUrl, embedUrl, onEnd }: PresentationProps) {
  useCanvasCss();
  const deck = useDeckView(doc);
  const version = useDocVersion(doc);
  // the audience's first sight plays the first slide's entry builds (fix wave 1); every later jump shows it built
  const [show, setShow] = useState<ShowState>(() => ({ pos: startPosition(doc, start), move: role === 'audience' ? 'enter' : 'jump', transition: null, black: false }));
  const [presenterShown, setPresenterShown] = useState(role === 'presenter');
  const [startedAt] = useState(() => Date.now());
  // P3-F: the deck's order as last seen holding the show's slide, so a slide removed meanwhile gives way to the one after
  // it (kept from render to render, React's derived-state pattern)
  const [seen, setSeen] = useState<readonly string[]>(() => slideOrder(doc));
  const read = readShow(doc, show.pos, seen, version);
  if (read.holding && !sameIds(read.holding, seen)) setSeen(read.holding);
  const shown: ShowState = read.settled ? show : { pos: read.pos, move: 'jump', transition: null, black: show.black };

  // the other window: told every move, followed without telling it back
  const channel = useRef<PresentChannel | null>(null);
  const latest = useRef({ shown, onEnd });
  useLayoutEffect(() => {
    latest.current = { shown, onEnd };
  });
  useEffect(() => {
    const opened = openPresentChannel(artifactId, (message: PresentMessage) => {
      const now = latest.current.shown;
      if (message.t === 'end') latest.current.onEnd();
      else if (message.t === 'hello') {
        if (now.pos) opened.post({ t: 'at', pos: now.pos, black: now.black });
      } else setShow({ pos: message.pos, ...moveOf(doc, now.pos, message.pos), black: message.black });
    });
    channel.current = opened;
    opened.post({ t: 'hello' });
    return () => {
      opened.close();
      channel.current = null;
    };
  }, [artifactId, doc]);

  // L255: plain functions; as useCallbacks they were memoization the React Compiler could not preserve, and it skipped
  // the whole component in the shipped build
  const go = (to: Position | null, how?: Move) => {
    const now = latest.current.shown;
    if (!to) return;
    const move = how === 'jump' ? { move: 'jump' as const, transition: null } : moveOf(doc, now.pos, to);
    setShow({ pos: to, ...move, black: now.black });
    channel.current?.post({ t: 'at', pos: to, black: now.black });
  };
  const next = () => {
    const now = latest.current.shown.pos;
    if (now) go(nextPosition(doc, now));
  };
  const back = () => {
    const now = latest.current.shown.pos;
    if (now) go(prevPosition(doc, now));
  };
  const toggleBlack = () => {
    const now = latest.current.shown;
    setShow({ ...now, move: 'jump', transition: null, black: !now.black });
    if (now.pos) channel.current?.post({ t: 'at', pos: now.pos, black: !now.black });
  };
  const end = () => {
    channel.current?.post({ t: 'end' });
    latest.current.onEnd();
  };

  // the show's keys, bound once: an Effect Event calls the latest render's functions
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    // P3-F: Enter and Space on a focused button are its activation (End show ends it), not the show's next step
    if ((key === 'Enter' || key === ' ') && event.target instanceof Element && event.target.closest('button')) return;
    if (key === 'ArrowRight' || key === 'ArrowDown' || key === ' ' || key === 'PageDown' || key === 'Enter') next();
    else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' || key === 'Backspace') back();
    else if (key === 'Home') go(firstPosition(doc), 'jump');
    else if (key === 'End') go(lastPosition(doc), 'jump');
    else if (key === 'b' || key === 'B' || key === '.') toggleBlack();
    else if (key === 'Escape') end();
    else if ((key === 'p' || key === 'P') && role === 'audience' && !paired) setPresenterShown((on) => !on);
    else return;
    event.preventDefault();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const scope = (children: ReactNode) => (
    <DesignSystemScope system={system} medium="deck" overrides={deck.overrides} className="present-ds-scope">
      {children}
    </DesignSystemScope>
  );
  const faces = faceRules(deck.faces, assetUrl);
  const stageProps = { doc, version };

  let body: ReactNode;
  if (!shown.pos) body = <p className="present-empty">{C.nothing}</p>;
  else if (presenterShown) {
    const following = read.following;
    body = (
      <div className="present-presenter" data-present-view="presenter">
        {/* P3-F: a pointer press never focuses a bar button and lets go of any focus held (a button's from the keyboard,
            L259: an embed's frame from a click), so the show's Enter and Space follow a click on the bar */}
        <header className="present-bar" onMouseDown={dropBarFocus}>
          <Elapsed since={startedAt} />
          <span className="present-count" data-present-count>
            {C.count(read.index, read.count)}
          </span>
          {shown.black && <span className="present-black-badge">{C.blackShown}</span>}
          <span className="present-bar-spacer" />
          <button type="button" className="present-button" onClick={back} aria-label={C.back}>
            ←
          </button>
          <button type="button" className="present-button" onClick={next} aria-label={C.next}>
            →
          </button>
          <button type="button" className="present-button" aria-pressed={shown.black} onClick={toggleBlack}>
            {C.black}
          </button>
          {role === 'audience' && (
            <button type="button" className="present-button" onClick={() => setPresenterShown(false)}>
              {C.audienceView}
            </button>
          )}
          <button type="button" className="present-button present-end" onClick={end}>
            {C.end}
          </button>
        </header>
        <div className="present-panes">
          <section className="present-current" aria-label={C.current} data-present-current>
            {scope(<StageView {...stageProps} pos={shown.pos} move="jump" transition={null} options={{ assetUrl, ...(embedUrl && { embedUrl }), animate: false }} />)}
          </section>
          <aside className="present-side">
            <section className="present-next" aria-label={C.nextUp} data-present-next>
              <h2 className="present-heading">{following && following.slideId === shown.pos.slideId ? C.nextBuild : C.nextUp}</h2>
              {following ? (
                scope(<StageView {...stageProps} pos={following} move="jump" transition={null} options={{ assetUrl, animate: false }} />)
              ) : (
                <p className="present-end-note">{C.endOfShow}</p>
              )}
            </section>
            <section className="present-notes" aria-label={C.notes} data-present-notes>
              <h2 className="present-heading">{C.notes}</h2>
              <p className="present-notes-text">{read.notes || C.noNotes}</p>
            </section>
          </aside>
        </div>
      </div>
    );
  } else
    body = (
      <div className="present-audience" data-present-view="audience" onClick={next}>
        {scope(<StageView {...stageProps} pos={shown.pos} move={shown.move} transition={shown.transition} options={{ assetUrl, ...(embedUrl && { embedUrl }), animate: true }} />)}
        <div className="present-black" data-present-black={shown.black || undefined} hidden={!shown.black} />
      </div>
    );

  return (
    <div className="present-root" data-present-role={role} data-present-slide={shown.pos?.slideId ?? ''} data-present-build={shown.pos?.build ?? ''} data-present-black={shown.black || undefined}>
      {faces && <style data-deck-faces>{faces}</style>}
      {body}
    </div>
  );
}

/**
 * A press on the presenter bar: no focus moves to a button, and whatever holds focus lets it go: a button a Tab put it on,
 * or (L259) an embed's frame in the current pane, whose page would take every key typed after.
 */
function dropBarFocus(event: ReactMouseEvent<HTMLElement>): void {
  event.preventDefault();
  const focused = event.currentTarget.ownerDocument.activeElement;
  if (focused instanceof HTMLElement) focused.blur();
}

/** One view of the show, fitted to its box. Its ShowStage plays each move it is given (see stage.ts). */
function StageView({ doc, version, pos, move, transition, options }: { doc: Doc; version: number; pos: Position; move: Move; transition: Transition | null; options: ShowStageOptions }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<ShowStage | null>(null);
  const { animate, embedUrl, assetUrl } = options;
  useLayoutEffect(() => {
    const el = host.current!;
    const made = new ShowStage(el, doc, { assetUrl, animate, ...(embedUrl && { embedUrl }) });
    stage.current = made;
    const fit = () => {
      const scale = Math.min(el.clientWidth / SLIDE_W, el.clientHeight / SLIDE_H) || 0;
      made.root.style.transform = `translate(${(el.clientWidth - SLIDE_W * scale) / 2}px, ${(el.clientHeight - SLIDE_H * scale) / 2}px) scale(${scale})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => {
      observer.disconnect();
      made.dispose();
      stage.current = null;
    };
  }, [doc, assetUrl, animate, embedUrl]);
  // every move, and every update of the deck (what is hidden follows it; a slide written anew is drawn anew)
  useLayoutEffect(() => {
    stage.current?.show(pos, slideSteps(doc, pos.slideId), move, transition);
  }, [doc, pos.slideId, pos.build, move, transition, version]);
  return <div ref={host} className="present-stage-box" />;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1_000));
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  const text = `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
  return (
    <span className="present-timer" role="timer" aria-label={C.elapsed(text)} data-present-timer>
      {text}
    </span>
  );
}
