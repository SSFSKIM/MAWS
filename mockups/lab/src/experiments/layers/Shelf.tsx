// What the Artifacts and Customize pages share (DESIGN.md section 21). Both are lists the app draws as walls of
// rows; here both are said in the transcript's own grammar. A thing is one line on the field. A press opens the
// line into a sheet of glass under it, which holds everything else the app's row prints at once and every action
// its menu hides; one sheet is open at a time. What the page makes or adds waits behind one round button of glass
// at the top right, which grows into a card as the side column does on a session.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { useGlassUnder, useKick } from './glass';
import { Fold } from './parts';
import { Growing } from './Session';

/** The sheet a line opens into: glass while it is open and for the length of its closing. */
function Sheet({ clip, on, children }: { clip: HTMLElement | null; on: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGlassUnder(ref, { radius: 18, clip, on });
  return (
    <div ref={ref} className="xl-block xl-s-sheet">
      {children}
    </div>
  );
}

interface LineProps {
  open: boolean;
  onToggle: () => void;
  /** The state's glyph, or the kind's; a line with nothing to say has none. */
  mark?: ReactNode;
  title: ReactNode;
  /** After the title, inside the press: a pin, a badge. */
  badge?: ReactNode;
  /** The quiet words in the middle. */
  line?: ReactNode;
  /** The line's end: quiet words, or a control of its own (a switch, a button). */
  end?: ReactNode;
  weight?: 'unread' | 'rest';
  label: string;
  children: ReactNode;
}

export function Line({ open, onToggle, mark, title, badge, line, end, weight, label, children }: LineProps) {
  const [shown, setShown] = useState(open);
  const [clip, setClip] = useState<HTMLDivElement | null>(null);
  const kick = useKick();
  useEffect(() => {
    kick(520);
    if (open) {
      setShown(true);
      return;
    }
    const t = window.setTimeout(() => setShown(false), 320);
    return () => window.clearTimeout(t);
  }, [open, kick]);
  return (
    <div className="xl-s-item" data-open={open}>
      <div className="xl-o-row xl-s-row" data-weight={weight}>
        <span className="xl-o-mark">{mark}</span>
        <button type="button" className="xl-s-main" aria-expanded={open} aria-label={label} onClick={onToggle}>
          <span className="xl-o-title">{title}</span>
          {badge}
        </button>
        <span className="xl-o-line">{line}</span>
        <span className="xl-o-end xl-s-end">{end}</span>
      </div>
      <Fold open={open} clipRef={setClip}>
        {shown && (
          <div className="xl-calls-wrap xl-s-wrap">
            <Sheet clip={clip} on={shown}>
              {children}
            </Sheet>
          </div>
        )}
      </Fold>
    </div>
  );
}

/** The head of a page's column: its search, read on the field like the lines under it, and what narrows the list. */
export function Find({ words, value, onChange, children }: { words: string; value: string; onChange: (v: string) => void; children?: ReactNode }) {
  return (
    <div className="xl-find">
      <Search size={15} strokeWidth={1.9} />
      <input className="xl-find-in" placeholder={words} aria-label={words} value={value} onChange={(e) => onChange(e.target.value)} />
      {value && (
        <button type="button" className="xl-icon xl-find-x" aria-label="Clear the search" onClick={() => onChange('')}>
          <X size={14} strokeWidth={2} />
        </button>
      )}
      {children}
    </div>
  );
}

/** What narrows the list, said where it is set: a chip that is pressed to take it off. */
export function Narrow({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <button type="button" className="xl-s-narrow" onClick={onClear}>
      {children}
      <X size={12} strokeWidth={2} />
    </button>
  );
}

/** The page's one piece of glass: a round button at the top right that grows into what the page makes or adds. */
export function Plus1({ open, onToggle, icon, words, label, children }: { open: boolean; onToggle: () => void; icon: ReactNode; words: { show: string; hide: string }; label: string; children: ReactNode }) {
  return (
    <aside className="xl-side" aria-label={label} data-open={open} data-form="button" data-plus="">
      <Growing open={open} onToggle={onToggle} icon={icon} words={{ show: words.show, hide: words.hide, tipShow: words.show, tipHide: words.hide }}>
        {children}
      </Growing>
    </aside>
  );
}

/** A fact in a sheet's quiet line. */
export function Facts({ children }: { children: ReactNode }) {
  return <div className="xl-s-facts">{children}</div>;
}
