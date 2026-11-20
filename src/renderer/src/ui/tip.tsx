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
// With no `content` the tip never reaches Radix's open machinery: the trigger's pointermove and focus are cancelled
// before Radix's own handlers (which skip a prevented event), so it arms no delay, opens nothing and closes no other
// tooltip; the owner keeps its place in the tree, so a tip that comes and goes never remounts its control. Content that
// arrives while its owner is already pointed at or focused shows on the next pointing or focus; it is in the owner's
// description at once. The content is not hoverable, so leaving the trigger closes the tip at once, whatever is drawn.
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
import { cloneElement, useId, type MouseEvent, type ReactElement, type ReactNode, type SyntheticEvent } from 'react';
import { POINTING_DELAY_MS } from './pointing';

const TIP = 'z-50 max-w-[20rem] rounded-sm border border-border-strong bg-bg-overlay px-2 py-1 text-ui-sm leading-normal text-fg shadow-float [overflow-wrap:anywhere]';

type ClickGuard = { 'aria-disabled'?: true; onClickCapture?(event: MouseEvent): void };
type Owner = ReactElement<{ 'aria-describedby'?: string }>;

export function Tip({ content, description, children, ...guard }: { content: ReactNode; description?: string | null; children: Owner } & ClickGuard) {
  const descriptionId = useId();
  const shows = content !== null && content !== undefined && content !== '';
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
  const silent = shows ? {} : SILENT;
  return (
    <Tooltip.Provider delayDuration={POINTING_DELAY_MS} disableHoverableContent>
      <Tooltip.Root>
        <Tooltip.Trigger asChild {...guard} {...silent}>
          {owner}
        </Tooltip.Trigger>
        {shows && (
          <Tooltip.Portal>
            <Tooltip.Content side="top" sideOffset={4} collisionPadding={8} className={TIP}>
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
// A contentless tip's trigger: the events that would open it, cancelled before Radix's handlers read them (neither has
// a default action a control relies on).
const cancel = (event: SyntheticEvent) => event.preventDefault();
const SILENT = { onPointerMove: cancel, onFocus: cancel };

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
