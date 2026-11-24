// Whether the outline is open (F9). At 1120 px of window and above it stands beside the column, and whether it is open
// there is remembered in the browser's storage for the page's origin, one value for the page and not per session, so a
// person who opened it finds it open on every sheet; closed on a first visit. Below 1120 px it is a drawer over the
// sheet, open only until a line is chosen, Escape, the scrim or the button closes it, and that changes nothing of what
// is remembered for wide windows.
import { useEffect, useState } from 'react';
import { STORAGE_PREFIX } from '../credential';

export const OUTLINE_KEY = `${STORAGE_PREFIX}outline`;
export const WIDE_QUERY = '(min-width: 1120px)';

export interface Outline {
  wide: boolean; // beside the column; else a drawer
  open: boolean; // the panel shows now
  toggle(): void; // the bar's button
  close(): void; // the drawer's: a line chosen, Escape, the scrim
}

function remembered(): boolean {
  try {
    return (JSON.parse(localStorage.getItem(OUTLINE_KEY) ?? 'null') as { open?: unknown } | null)?.open === true;
  } catch {
    return false;
  }
}

export function useOutline(): Outline {
  const [wide, setWide] = useState(() => matchMedia(WIDE_QUERY).matches);
  const [beside, setBeside] = useState(remembered);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const query = matchMedia(WIDE_QUERY);
    const changed = () => {
      setWide(query.matches);
      setDrawer(false);
    };
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return {
    wide,
    open: wide ? beside : drawer,
    toggle() {
      if (!wide) return setDrawer(!drawer);
      setBeside(!beside);
      try {
        localStorage.setItem(OUTLINE_KEY, JSON.stringify({ v: 1, open: !beside }));
      } catch {
        // a full store: the panel still opens, and is not remembered
      }
    },
    close: () => setDrawer(false),
  };
}
