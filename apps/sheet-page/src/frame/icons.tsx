// The bar's two glyphs, in the app's 16 px stroke style (R/app/IconButton.tsx's Icon, which the page cannot import: that
// module reads the app's settings store).
import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]">
      {children}
    </svg>
  );
}

// The outline's button (F9): a sidebar
export const OutlineIcon = () => (
  <Icon>
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <path d="M6.5 3v10" />
  </Icon>
);

export const MenuIcon = () => (
  <Icon>
    <path d="M3.5 8v.01M8 8v.01M12.5 8v.01" strokeWidth="2" />
  </Icon>
);
