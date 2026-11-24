// A word's or a glyph's tooltip that the keyboard reaches (the word cut's rule 5: a secondary fact about one word or
// glyph may be its tooltip, provided the word takes keyboard focus). The system tooltip (`title`) shows to the pointer
// alone, so this is Radix's Tooltip, beside the Radix HoverCard, Popover and Dialog the app already draws: shown after
// POINTING_DELAY_MS of pointing and at once on keyboard focus, closed on Escape, on a press and when focus leaves. Its
// `description` is the owner's accessible description at all times, from an element that stays mounted (Radix names
// its content only while open), added to whatever the owner is already described by (a row note's id). The owner is
// the one child, which must take focus: a control, or a plain word given `tabIndex={0}`. A caller adding a fact to an
// owner that already has its own `aria-describedby` passes that fact as `description`: a tip with `content` alone
// leaves the owner's ids as they are, and Radix's id of the open tooltip is then not added to them.
//
// The open state is the tip's own, handed to Radix as a controlled `open` that is true only while there is content.
// Focus opens it through Radix at once; the pointing delay is the tip's own timer, armed on pointer enter and dropped
// on leave, on a press and whenever the content goes away, so no pending opening outlives the content (Radix's own
// delay, once armed, would fire its open and dismiss the other tooltips whatever the content). Radix's pointermove is
// cancelled before its handler (which skips a prevented event), and so is its focus while there is no content: a tip
// with no content opens nothing and closes no other tooltip. One tip shows at a time. Content that arrives while its
// owner is already pointed at or focused shows on the next pointing or focus; it is in the owner's description at
// once. The content stays hoverable (WCAG 1.4.13): Radix keeps it open while the pointer crosses into it. Escape, a
// press and an activation of the owner (Enter or Space too) close it and drop a pointing still in its delay; any other
// close Radix asks for while the owner still holds focus (its
// close on an ancestor's scroll, which the focus itself causes when the owner was out of view) is not taken.
//
// `pointedWithin` widens the pointing to a region around the owner (a fact about a whole line, owned by its phrase):
// pointing anywhere in it arms the delay and leaving it closes the tip, while the keyboard owner stays the one child and
// the region's other controls stay outside the tip's trigger. A press within the region closes it as a press on the
// owner does; a close Radix asks for while the pointer is still within the region (its leave of the owner) is not taken,
// and a leave of the region into the tip keeps it open, as a leave of the owner into it does.
//
// Where it opens: below its owner, since what explains an owner (a field's caption, a section's heading, the message a
// rule's words follow, the window's toolbar above a panel's head) stands above it in reading order, and what lies below
// is what comes next. Radix flips it above where the window has no room below and shifts it along the edge it would
// cross, `collisionPadding` from the window's edges; inside a `TipBoundary` it keeps to that container too (a page in a
// panel, so a tip on a word near the page's edge does not run onto the sidebar).
//
// `UnavailableButton` is a greyed click-activated control's enabled owner ("Every hidden fact has an owner that takes
// keyboard focus"): a button, a link, a checkbox or a radio drawn `aria-disabled`, still in the Tab order, its reason
// the tooltip and the description, and its click (by pointer, Enter or Space) swallowed before the control's own
// handler, a form's submit and a checkbox's toggle. It guards clicks only: a field that commits on keys or on input
// (a number field's ArrowUp and ArrowDown, a text field) is not made read-only by it, so a greyed field's reason
// belongs on a focusable owner beside it (its row's note) or on a field that guards its own edits. A control that
// acts on pointerdown (a Radix menu trigger) guards itself too. The control must not be `disabled`, which takes it out
// of the Tab order and out of the pointer's reach.
import { Tooltip } from 'radix-ui';
import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactElement, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import { POINTING_DELAY_MS } from './pointing';

const TIP = 'z-50 max-w-[20rem] rounded-sm border border-border-strong bg-bg-overlay px-2 py-1 text-ui-sm leading-normal text-fg shadow-float [overflow-wrap:anywhere]';

type ClickGuard = { 'aria-disabled'?: true; onClickCapture?(event: MouseEvent): void };
type Owner = ReactElement<{ 'aria-describedby'?: string }>;

// The container the tips inside it keep to, besides the window's edges; none by default.
const Boundary = createContext<Element | null>(null);
export function TipBoundary({ element, children }: { element: Element | null; children: ReactNode }) {
  return <Boundary value={element}>{children}</Boundary>;
}

// The tip that shows, closed when another opens (Radix's own signal for that fires only for the openings it makes).
let showing: { close(): void } | null = null;

export function Tip({ content, description, pointedWithin, children, ...guard }: { content: ReactNode; description?: string | null; pointedWithin?: RefObject<HTMLElement | null>; children: Owner } & ClickGuard) {
  const descriptionId = useId();
  const boundary = useContext(Boundary);
  const shows = content !== null && content !== undefined && content !== '';
  const [open, setOpen] = useState(false);
  if (open && !shows) setOpen(false); // the content went away: the tip is closed, not merely undrawn
  const showsNow = useRef(shows);
  const pointing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null); // the owner, typed as Radix types its default element
  const dismissed = useRef(false); // Escape or a press: the person's close, which focus on the owner does not hold off
  const stopPointing = useCallback(() => {
    if (pointing.current !== null) clearTimeout(pointing.current);
    pointing.current = null;
  }, []);
  // A press or an activation of the owner: the person's close, which Radix asks for next (its own trigger handlers run
  // after these), and which a press that closes nothing does not carry later.
  const dismissByOwner = () => {
    stopPointing();
    dismissed.current = true;
    queueMicrotask(() => (dismissed.current = false));
  };
  useLayoutEffect(() => {
    showsNow.current = shows;
    if (!shows && pointing.current !== null) {
      clearTimeout(pointing.current);
      pointing.current = null;
    }
  }, [shows]);
  useEffect(
    () => () => {
      if (pointing.current !== null) clearTimeout(pointing.current);
    },
    [],
  );
  // Pointing at the owner, or anywhere in the region that stands for it: the delay armed on entering, dropped on leaving
  const point = useCallback(() => {
    stopPointing();
    pointing.current = setTimeout(() => {
      pointing.current = null;
      if (showsNow.current) setOpen(true);
    }, POINTING_DELAY_MS);
  }, [stopPointing]);
  const inRegion = useRef(false);
  const tip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const region = pointedWithin?.current;
    if (!region) return;
    // the region or the tip itself, which stays hoverable while the pointer crosses into it (WCAG 1.4.13)
    const inside = (node: EventTarget | null) => node instanceof Node && (region.contains(node) || tip.current?.contains(node) === true);
    // While within, each element the pointer comes over says whether it still is: a crossing of the region's own
    // children is no leave, whatever the element the pointer left names.
    function watch(event: PointerEvent) {
      if (!inside(event.target)) leave();
    }
    function leave() {
      inRegion.current = false;
      document.removeEventListener('pointerover', watch, true);
      document.documentElement.removeEventListener('pointerleave', leave);
      stopPointing();
      if (!trigger.current?.contains(document.activeElement)) setOpen(false);
    }
    const enter = () => {
      if (inRegion.current) return;
      inRegion.current = true;
      document.addEventListener('pointerover', watch, true);
      document.documentElement.addEventListener('pointerleave', leave); // out of the window, where nothing is come over
      point();
    };
    const press = () => {
      stopPointing();
      setOpen(false);
    };
    region.addEventListener('pointerover', enter);
    region.addEventListener('pointerdown', press);
    return () => {
      region.removeEventListener('pointerover', enter);
      region.removeEventListener('pointerdown', press);
      document.removeEventListener('pointerover', watch, true);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, [pointedWithin, point, stopPointing]);
  const drawn = open && shows;
  useEffect(() => {
    if (!drawn) return;
    const me = { close: () => setOpen(false) };
    showing?.close();
    showing = me;
    return () => {
      if (showing === me) showing = null;
    };
  }, [drawn]);

  const described = description !== undefined && description !== null && description !== '';
  const own = children.props['aria-describedby'];
  // The owner's own descriptions first, then this one, set on the owner itself (its props win over the trigger's). With
  // no description of its own the owner is left alone, so an open tooltip describes it through Radix; with nothing to
  // show either, the owner keeps only its own ids.
  const owner = described
    ? cloneElement(children, { 'aria-describedby': [own, descriptionId].filter((ids) => ids).join(' ') })
    : shows
      ? children
      : cloneElement(children, { 'aria-describedby': own });
  return (
    <Tooltip.Provider delayDuration={POINTING_DELAY_MS}>
      <Tooltip.Root
        open={drawn}
        onOpenChange={(next) => {
          const dismissal = dismissed.current;
          dismissed.current = false;
          // A close while the owner still holds focus is Radix's own, not the person's (the scroll its own focus
          // caused, which Radix reads as the owner moving away): the tip stays while its owner is focused.
          if (!next && !dismissal && trigger.current !== null && trigger.current.contains(document.activeElement)) return;
          if (!next && !dismissal && inRegion.current) return; // the pointer left the owner for the rest of its region, or the tip
          setOpen(next && showsNow.current);
        }}
      >
        <Tooltip.Trigger
          ref={trigger}
          asChild
          {...guard}
          onPointerMove={cancel}
          onFocus={shows ? undefined : cancel}
          onPointerEnter={pointedWithin ? undefined : point}
          onPointerLeave={pointedWithin ? undefined : stopPointing}
          onPointerDown={dismissByOwner}
          onClick={dismissByOwner} // an activation by the keyboard, which keeps the focus (a disclosure's chevron)
        >
          {owner}
        </Tooltip.Trigger>
        {shows && (
          <Tooltip.Portal>
            <Tooltip.Content
              ref={tip}
              side="bottom"
              sideOffset={4}
              collisionPadding={8}
              collisionBoundary={boundary ?? []}
              className={TIP}
              onEscapeKeyDown={() => {
                stopPointing(); // a dismissed tip is not reopened by a pointing still in its delay
                dismissed.current = true;
              }}
            >
              {content}
            </Tooltip.Content>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
      {described && (
        <span id={descriptionId} hidden>
          {description}
        </span>
      )}
    </Tooltip.Provider>
  );
}
// Cancelled before Radix's trigger handlers read it (neither pointermove nor focus has a default action a control
// relies on).
const cancel = (event: SyntheticEvent) => event.preventDefault();

const swallow = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};
// What makes a click-activated control greyed and still focusable; a part that draws its own owner spreads it.
export const unavailableClickProps = (reason: string | null | undefined): ClickGuard => (reason ? { 'aria-disabled': true, onClickCapture: swallow } : {});

// The look of a greyed control, for a control drawn `aria-disabled`.
export const UNAVAILABLE_LOOK = 'aria-disabled:cursor-default aria-disabled:text-fg-faint aria-disabled:hover:bg-transparent';

export function UnavailableButton({ reason, children }: { reason: string | null; children: Owner }) {
  return (
    <Tip content={reason} description={reason} {...unavailableClickProps(reason)}>
      {children}
    </Tip>
  );
}
