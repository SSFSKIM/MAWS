// A word's or a glyph's tooltip that the keyboard reaches (the word cut's rule 5: a secondary fact about one word or
// glyph may be its tooltip, provided the word takes keyboard focus). The system tooltip (`title`) shows to the pointer
// alone, so this is Radix's Tooltip, beside the Radix HoverCard, Popover and Dialog the app already draws: shown after
// POINTING_DELAY_MS of pointing and at once on keyboard focus, closed on Escape, on a press and when focus leaves. Its
// `description` is the owner's accessible description at all times, from an element that stays mounted (Radix names
// its content only while open). The owner is the one child, which must take focus: a control, or a plain word given
// `tabIndex={0}`.
//
// `Unavailable` is a greyed control's enabled owner ("Every hidden fact has an owner that takes keyboard focus"): the
// control drawn `aria-disabled`, still in the Tab order, its reason the tooltip and the description, and its click (by
// pointer, Enter or Space) swallowed before the control's own handler, a form's submit and a checkbox's toggle. The
// control itself must not be `disabled`, which takes it out of the Tab order and out of the pointer's reach.
import { Tooltip } from 'radix-ui';
import { useId, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { POINTING_DELAY_MS } from './pointing';

const TIP = 'z-50 max-w-[20rem] rounded-sm border border-border-strong bg-bg-overlay px-2 py-1 text-ui-sm leading-normal text-fg shadow-float [overflow-wrap:anywhere]';

type OwnerProps = { 'aria-disabled'?: true; onClickCapture?(event: MouseEvent): void };

export function Tip({ content, description, children, ...owner }: { content: ReactNode; description?: string; children: ReactElement } & OwnerProps) {
  const descriptionId = useId();
  const described = description !== undefined && description !== '';
  return (
    <Tooltip.Provider delayDuration={POINTING_DELAY_MS}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild {...owner} {...(described ? { 'aria-describedby': descriptionId } : {})}>
          {children}
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
// What makes a control greyed and still focusable; a glyph or a part that draws its own owner spreads it.
export const unavailableProps = (reason: string | null | undefined): OwnerProps => (reason ? { 'aria-disabled': true, onClickCapture: swallow } : {});

// The look of a greyed control, for a control drawn `aria-disabled`.
export const UNAVAILABLE_LOOK = 'aria-disabled:cursor-default aria-disabled:text-fg-faint aria-disabled:hover:bg-transparent';

export function Unavailable({ reason, children }: { reason: string | null; children: ReactElement }) {
  if (!reason) return children;
  return (
    <Tip content={reason} description={reason} {...unavailableProps(reason)}>
      {children}
    </Tip>
  );
}
