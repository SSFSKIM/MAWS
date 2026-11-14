// The page (UX wave U7b, O-40; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M5 and
// Interfaces §F and §H): Customize, Projects or the Artifacts library, drawn beside the sidebar over the main area and
// the side column's place, as a grid item of the shell. It decides the size of nothing: what it covers stays mounted at
// its box, invisible and inert (the shell's, decision 2), and its name and Back are the title bar's.
//
// The keyboard: a page that opens while the keyboard is inside what it hides, or nowhere, takes it on its own region
// (focusable, no tab stop), so Tab goes on into the page; opened from the sidebar, the keyboard stays on the row. Closed by
// Back, Esc or ⌘W, the page hands the keyboard back to the element that had it at the open, while that is still connected
// and not inert, else to the focused pane; left for a tab, to that tab's pane, from wherever the keyboard was. A closing
// act that moved the keyboard itself (into that pane, or anywhere when no tab was shown) is left alone. Esc is the
// page's from a window listener, as the Overview's is, after every taker above it in §H's table.
import { useEffect, useRef, useState } from 'react';
import type { Destination } from '@shared/ipc/schema/layout';
import { useShellView } from '../app/shell-view';
import { useSlot } from '../app/slots';
import { CustomizeView } from '../customize/CustomizeView';
import { focusPaneElement, paneDomId } from '../main/pane-dom';
import { ProjectsView } from '../projects/ProjectsView';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { SECTION_OF_SHOW } from './customize';
import { requestDiscover } from './discover';
import { escapeTaker, leaveField } from './escape';

export const PAGE_REGION_ID = 'region-page';
// The title bar's page name, the page's level-1 heading, which names the page's region.
export const PAGE_TITLE_ID = 'page-title';

const available = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element !== document.body && element.isConnected && !element.closest('[inert], [hidden], [aria-hidden="true"]');

export function DestinationPage() {
  const destination = useLayout((s) => s.destination);
  return destination === null ? null : <Page destination={destination} />;
}

function Page({ destination }: { destination: Destination }) {
  const region = useRef<HTMLElement>(null);
  // Before the commit that makes what the page hides inert, which drops the keyboard from it.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null));

  // At the open, when another page replaces this one's body (which takes the keyboard with it when it held it), and when
  // the sidebar drawn over a narrow window goes (the shell closes it in its own effect after this one ran, so the row it
  // was opened from is made inert only in the commit that runs this again).
  const overlay = useShellView((s) => s.sidebarOverlay);
  useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || active.closest('[inert]') !== null) region.current?.focus({ preventScroll: true });
  }, [destination.kind, overlay]);

  useEffect(() => {
    // Whether the write that closed the page also changed the strip: an act that showed a tab.
    let leftForTab = false;
    const off = useLayout.subscribe((state, previous) => {
      if (previous.destination !== null && state.destination === null) leftForTab = state.main !== previous.main;
    });
    return () => {
      off();
      const pane = currentSet(useLayout.getState().main).focusedPane;
      const active = document.activeElement;
      // Left for a tab: the keyboard goes to that tab's pane, wherever it was (the sidebar row included), unless the act
      // already put it there.
      if (leftForTab) {
        if (!(active instanceof Element && (document.getElementById(paneDomId(pane))?.contains(active) || active.closest(`[data-chrome-pane="${pane}"]`)))) focusPaneElement(pane);
        return;
      }
      if (available(active)) return;
      if (available(opener)) opener.focus({ preventScroll: true });
      else focusPaneElement(pane);
    };
  }, [opener]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const state = useLayout.getState();
      // The dialog and the Overview are above the page in §H's table, and so is any layer or menu open over it.
      if (state.settings !== null || state.overviewOpen || document.querySelector('[aria-modal="true"], [role="menu"][data-state="open"]') !== null) return;
      const taker = escapeTaker(event.target, event); // an input method's Esc ends its composition, nothing else
      if (taker === 'own') return;
      if (taker === 'field') {
        // A field inside the page is left first; a field elsewhere (the sidebar's search) keeps its key.
        if (event.target instanceof Node && region.current?.contains(event.target)) leaveField(event.target, () => region.current);
        return;
      }
      event.preventDefault();
      state.closeDestination();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  return (
    <section
      ref={region}
      id={PAGE_REGION_ID}
      data-region="page"
      data-destination={destination.kind}
      aria-labelledby={PAGE_TITLE_ID}
      tabIndex={-1}
      className="relative z-10 col-[2/-1] row-start-3 flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg outline-none"
    >
      <PageBody key={destination.kind} destination={destination} />
    </section>
  );
}

// Customize at its `show`; its `discover` view reaches the plugins library, which is the only one that takes the request,
// at the open, at a change of the page's fields and at a restored page (a `mine` view asks nothing: until U11c the library
// keeps the tab the person left it on).
function CustomizePage({ destination }: { destination: Extract<Destination, { kind: 'customize' }> }) {
  const section = SECTION_OF_SHOW[destination.show];
  const discover = destination.view === 'discover' && section === 'plugins';
  useEffect(() => {
    if (discover) requestDiscover();
  }, [discover, destination]);
  return <CustomizeView section={section} />;
}

function PageBody({ destination }: { destination: Destination }) {
  const Library = useSlot('artifactsLibrary');
  switch (destination.kind) {
    case 'customize':
      return <CustomizePage destination={destination} />;
    case 'projects':
      return <ProjectsView />;
    case 'library':
      // eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render
      return <Library />;
  }
}
