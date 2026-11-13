// The Overview's one mount in the shell (UX wave U7b; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// M5 decision 2 and the M5 review). It stays inside the main region in every state, so the Overview keeps that region's
// landmark and its inertness (a surface sheet or a main area hidden by the side column makes both inert), and it is
// never remounted, so a page opening or closing under it neither moves the keyboard nor drops its state. With no page
// it fills the main region's box, as the layer always has. Under a page the main track may be 0 px wide (a maximized
// or floating side column), so the host is placed over the page's box instead: fixed, at the page region's measured
// rect, which the main region's clipping does not cut. The page decides no size, so nothing else moves.
import { useLayoutEffect, useState } from 'react';
import { OverviewLayer } from '../overview/OverviewPanel';
import { pageOpen, useLayout } from '../stores/layout';
import { PAGE_REGION_ID } from './DestinationPage';

type Box = { left: number; top: number; width: number; height: number };

export function OverviewHost() {
  const page = useLayout(pageOpen);
  const box = usePageBox(page);
  return (
    <div data-overview-host className={`pointer-events-none ${page ? 'fixed z-30' : 'absolute inset-0'}`} style={page && box !== null ? box : undefined}>
      <OverviewLayer />
    </div>
  );
}

// The page region's rect while a page is open, measured before paint and again when it or the window changes size.
function usePageBox(page: boolean): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const element = page ? document.getElementById(PAGE_REGION_ID) : null;
    if (element === null) return;
    const measure = () => {
      const { left, top, width, height } = element.getBoundingClientRect();
      setBox((now) => (now !== null && now.left === left && now.top === top && now.width === width && now.height === height ? now : { left, top, width, height }));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [page]);
  return box;
}
