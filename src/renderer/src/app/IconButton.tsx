// A square icon button for the toolbar and region headers. When it mirrors an action of the table its tooltip carries
// the action's effective chord (overrides included), so the tooltip, the menu and the palette never disagree.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { effectiveChord, type ActionId } from '@shared/keymap/actions';
import { formatChord } from '@shared/keymap/chord';
import { useSettings } from '../stores/settings';

export function useChordHint(action: ActionId | undefined): string | null {
  const overrides = useSettings((s) => s.state?.settings.keymap);
  if (!action) return null;
  const chord = effectiveChord(action, overrides ?? {});
  return chord ? formatChord(chord) : null;
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> {
  label: string;
  action?: ActionId; // adds the action's chord to the tooltip
  pressed?: boolean;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, action, pressed, children, className = '', ...rest },
  ref,
) {
  const chord = useChordHint(action);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={chord ? `${label} · ${chord}` : label}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent [-webkit-app-region:no-drag] hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent aria-pressed:bg-bg-active aria-pressed:text-fg ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});

// The mockup's 16 px stroke icons (mockups/01-shell.html), drawn in currentColor.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]">
      {children}
    </svg>
  );
}

export const SidebarIcon = () => (
  <Icon>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M6 3v10" />
  </Icon>
);
export const PanelIcon = () => (
  <Icon>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M10 3v10" />
  </Icon>
);
export const MaximizeIcon = () => (
  <Icon>
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
  </Icon>
);
export const RestoreIcon = () => (
  <Icon>
    <path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5 14 2M6.5 9.5 2 14" />
  </Icon>
);
