// The page's frame ("The look", frames 2 to 4; F4, F6, F7, F9): a bar of the toolbar's height, the band under it when
// the page is not connected, and under them what the place draws (the views lay out their own column: the overview one
// centred column of the transcript's measure, a session's sheet the whole width the outline leaves). The bar holds, from
// its left: on a session's sheet the outline's button (F9), the page's name, then where the person is: "This Mac" on the
// overview; on a sheet the link back, "All sessions", then the session's title and "stopped" where no process holds it.
// At its right a quiet menu whose one entry unpairs this browser. The bar says nothing of the connection (F4: the band
// does).
import { DropdownMenu } from 'radix-ui';
import type { MouseEvent, ReactNode } from 'react';
import { GLYPH_BUTTON, NamedGlyph } from '../../../../src/renderer/src/ui/glyph';
import { PAGE } from '../copy';
import { pathOf, type Place } from '../route';
import { Band } from './Band';
import { MenuIcon, OutlineIcon } from './icons';

export interface FrameProps {
  place: Place;
  title?: string | null; // the session's title, on its sheet
  stopped?: boolean; // no process holds the session
  outline?: { open: boolean; toggle(): void }; // the outline's button, on a sheet (F9)
  band?: string | null; // what the band says; null: no band
  navigate(place: Place): void;
  unpair(): void;
  children?: ReactNode;
}

const MENU = 'z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float';
const MENU_ITEM = 'flex h-(--row-h) cursor-default items-center rounded-sm px-2.5 outline-none select-none data-highlighted:bg-bg-hover';

// A plain click moves the page without a load; a modified or middle click is the browser's, as on any link
const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export function Frame({ place, title = null, stopped = false, outline, band = null, navigate, unpair, children }: FrameProps) {
  const onSheet = place.at === 'sheet';
  const overview: Place = { at: 'overview' };
  return (
    <div className="flex h-full flex-col bg-bg text-ui text-fg">
      <header className={`relative flex h-(--toolbar-h) flex-none items-center gap-3 border-b border-border bg-bg pr-2 ${onSheet ? 'pl-2' : 'pl-4'}`}>
        {onSheet && (
          <NamedGlyph data-outline-toggle="" label={outline?.open ? PAGE.hideQuestions : PAGE.showQuestions} pressed={outline?.open ?? false} onClick={outline?.toggle} className={`${GLYPH_BUTTON} -mr-1`}>
            <OutlineIcon />
          </NamedGlyph>
        )}
        <span className="flex-none font-medium">{PAGE.name}</span>
        <nav aria-label="Where you are" className="flex min-w-0 flex-1 items-baseline gap-1.5 whitespace-nowrap text-fg-muted">
          {onSheet ? (
            <>
              <a
                href={pathOf(overview)}
                onClick={(event) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  navigate(overview);
                }}
                className="flex-none rounded-sm text-accent underline underline-offset-2 outline-accent focus-visible:outline-2"
              >
                {PAGE.allSessions}
              </a>
              {title !== null && (
                <>
                  <span aria-hidden className="flex-none text-fg-faint">
                    /
                  </span>
                  <span className="min-w-0 truncate text-fg">{title}</span>
                  {stopped && <span className="flex-none text-ui-sm text-fg-muted">{PAGE.stopped}</span>}
                </>
              )}
            </>
          ) : (
            <span>{PAGE.thisMac}</span>
          )}
        </nav>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <NamedGlyph label={PAGE.menu}>
              <MenuIcon />
            </NamedGlyph>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
              <DropdownMenu.Item className={MENU_ITEM} onSelect={unpair}>
                {PAGE.unpair}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      {band !== null && <Band text={band} />}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
