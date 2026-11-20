// A word's or a glyph's tooltip that the keyboard reaches (the word cut's rule 5: a secondary fact about one word or
// glyph may be its tooltip, provided the word takes keyboard focus). The system tooltip (`title`) shows to the pointer
// alone, so this is Radix's Tooltip, beside the Radix HoverCard, Popover and Dialog the app already draws: shown after
// POINTING_DELAY_MS of pointing and at once on keyboard focus, closed on Escape, on a press and when focus leaves. Its
// `description` is the owner's accessible description at all times, from an element that stays mounted (Radix names
// its content only while open), added to whatever the owner is already described by (a row note's id). The owner is
// the one child, which must take focus: a control, or a plain word given `tabIndex={0}`. With no `content` the tip
// never opens, and the owner keeps its place in the tree, so a tip that comes and goes never remounts its control.
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
import { cloneElement, useId, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { POINTING_DELAY_MS } from './pointing';

const TIP = 'z-50 max-w-[20rem] rounded-sm border border-border-strong bg-bg-overlay px-2 py-1 text-ui-sm leading-normal text-fg shadow-float [overflow-wrap:anywhere]';

type ClickGuard = { 'aria-disabled'?: true; onClickCapture?(event: MouseEvent): void };
type Owner = ReactElement<{ 'aria-describedby'?: string }>;

export function Tip({ content, description, children, ...guard }: { content: ReactNode; description?: string | null; children: Owner } & ClickGuard) {
  const descriptionId = useId();
  const [open, setOpen] = useState(false); // what pointing and focus ask; shown only while there is content
  const shows = content !== null && content !== undefined && content !== '';
  const described = description !== undefined && description !== null && description !== '';
  // the owner's own descriptions first, then this one, on the owner itself (its props win over the trigger's)
  const describedBy = [children.props['aria-describedby'], described ? descriptionId : null].filter((ids) => ids).join(' ');
  return (
    <Tooltip.Provider delayDuration={POINTING_DELAY_MS}>
      <Tooltip.Root open={open && shows} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild {...guard}>
          {cloneElement(children, { 'aria-describedby': describedBy === '' ? undefined : describedBy })}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="top" sideOffset={4} collisionPadding={8} className={TIP}>
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
      {described && (
        <span id={descriptionId} hidden>
          {description}
        </span>
      )}
    </Tooltip.Provider>
  );
}

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
