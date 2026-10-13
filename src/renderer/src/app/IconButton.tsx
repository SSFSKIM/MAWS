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
export function Icon({ children, className = 'size-4' }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={`${className} shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]`}>
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
// P3-G: the floating session card, a card at the frame's bottom left.
export const FloatIcon = () => (
  <Icon>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <rect x="4" y="8" width="5" height="3.5" rx="0.75" />
  </Icon>
);
export const ChevronDownIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m4 6 4 4 4-4" />
  </Icon>
);
export const ChevronLeftIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m10 4-4 4 4 4" />
  </Icon>
);
export const FolderIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2 4h5l1.5 2H14v7H2z" />
  </Icon>
);
export const SearchIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </Icon>
);
export const PinIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="m6 2 6 6-2 1-1 3-5-5 3-1zM6 10l-4 4" />
  </Icon>
);
export const ArchiveIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3 6v7h10V6M2 3h12v3H2zM6 9h4" />
  </Icon>
);
export const PlusIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const SortIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M3 4.5h10M4.5 8h7M6 11.5h4" />
  </Icon>
);
export const GearIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </Icon>
);
