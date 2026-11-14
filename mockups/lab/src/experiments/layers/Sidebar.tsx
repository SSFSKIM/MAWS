// The pane's content: Quiet's sidebar (a row is a title and one trailing slot; the second line, branch, machine and
// age wait in a card beside the row; the approval is answered from that card), standing on Field's pane.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, ChevronRight, Ellipsis, GitBranch, LayoutGrid, Monitor, Pencil, Pin, Settings as Gear, Shapes, SlidersHorizontal, SquarePen } from 'lucide-react';
import { destinations, pinned, projects, settingsNav, settingsSections, usage, type Session } from '../../content/fixtures';
import type { SceneId } from '../../lab/types';
import type { Answer } from './Layers';
import { Fold, Pop, Ring, StateGlyph } from './parts';
import { Ask } from './Session';

const destIcon = { compose: SquarePen, grid: LayoutGrid, shapes: Shapes, sliders: SlidersHorizontal } as const;

interface Props {
  scene: SceneId;
  live: (s: Session) => Session;
  onAnswer: (a: Answer) => void;
  section: string;
  go: (scene: SceneId) => void;
  /** Capture aid: open the waiting row's card at once. */
  card?: boolean;
}

export function Sidebar({ scene, live, onAnswer, section, go, card }: Props) {
  const inSettings = scene === 'settings';
  return (
    <div className="xl-pane-in">
      <div className="xl-pane-top" />
      {inSettings ? (
        <div className="xl-pane-body" key="settings" data-from="right">
          <button type="button" className="xl-back" onClick={() => go('session')}>
            <ArrowLeft size={16} strokeWidth={1.75} />
            Settings
          </button>
          {settingsNav.map((name) => {
            const has = settingsSections.some((s) => s.title === name);
            return (
              <div key={name} className="xl-row" data-selected={section === name}>
                <button
                  type="button"
                  className="xl-row-main"
                  aria-current={section === name ? 'true' : undefined}
                  onClick={() => has && document.getElementById(`xl-settings-${name.toLowerCase()}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  {name}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <Sessions scene={scene} live={live} onAnswer={onAnswer} go={go} card={card} />
      )}
      <div className="xl-pane-foot">
        <button type="button" className="xl-icon" aria-label="Settings" aria-pressed={inSettings} data-tip="Settings" data-tip-at="above-start" onClick={() => go(inSettings ? 'session' : 'settings')}>
          <Gear size={17} strokeWidth={1.75} />
        </button>
        <Usage />
      </div>
    </div>
  );
}

/** Two nested rings in the foot; the numbers are one click away. */
function Usage() {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <button
        type="button"
        ref={setEl}
        className="xl-icon"
        aria-expanded={open}
        aria-label={`Usage: ${pct(usage.fiveHour)} of the five-hour limit, ${pct(usage.week)} of the week`}
        data-tip="Usage"
        data-tip-at="above-end"
        onClick={() => setOpen((v) => !v)}
      >
        <Ring value={usage.week} inner={usage.fiveHour} />
      </button>
      <Pop open={open} anchor={el} place="above-end" onClose={close} className="xl-usage" label="Usage">
        <div className="xl-usage-row">
          <Ring value={usage.fiveHour} size={16} />
          <span>5 hours</span>
          <span className="xl-num">{pct(usage.fiveHour)}</span>
        </div>
        <div className="xl-usage-row">
          <Ring value={usage.week} size={16} />
          <span>Week</span>
          <span className="xl-num">{pct(usage.week)}</span>
        </div>
        <div className="xl-usage-note">Resets in {usage.resetsIn}</div>
      </Pop>
    </>
  );
}

function Sessions({ scene, live, onAnswer, go, card: cardAtOnce }: Pick<Props, 'scene' | 'live' | 'onAnswer' | 'go' | 'card'>) {
  const [openIds, setOpenIds] = useState(() => new Set(projects.filter((p) => p.open).map((p) => p.id)));
  const [menu, setMenu] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [cardEl, setCardEl] = useState<HTMLElement | null>(null);
  const timer = useRef(0);
  const rows = useRef(new Map<string, HTMLElement>());

  // The card waits before it first appears, then follows the pointer from row to row without waiting again.
  const enter = (id: string, el: HTMLElement) => {
    window.clearTimeout(timer.current);
    if (menu) return;
    if (card) {
      setCard({ id, el });
      setCardEl(el);
    } else {
      timer.current = window.setTimeout(() => {
        setCard({ id, el });
        setCardEl(el);
      }, 420);
    }
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    if (cardAtOnce) return;
    timer.current = window.setTimeout(() => setCard(null), 160);
  };
  const stay = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const el = rows.current.get('s2');
    if (cardAtOnce && el) {
      setCard({ id: 's2', el });
      setCardEl(el);
    }
  }, [cardAtOnce]);
  const closeCard = useCallback(() => setCard(null), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const all = [...pinned, ...projects.flatMap((p) => p.sessions)].map(live);
  const shown = card ? all.find((s) => s.id === card.id) : undefined;
  const lastShown = useRef(shown);
  if (shown) lastShown.current = shown;
  const inCard = shown ?? lastShown.current;

  const row = (raw: Session) => {
    const s = live(raw);
    const weight = s.state === 'unread' ? 'unread' : s.state === 'idle' ? 'rest' : undefined;
    return (
      <div
        key={s.id}
        ref={(el) => {
          if (el) rows.current.set(s.id, el);
        }}
        className="xl-row"
        data-selected={scene === 'session' && s.id === 's1'}
        data-weight={weight}
        data-held={menu?.id === s.id || card?.id === s.id}
        onPointerEnter={(e) => enter(s.id, e.currentTarget)}
        onPointerLeave={leave}
      >
        <button type="button" className="xl-row-main" aria-current={scene === 'session' && s.id === 's1' ? 'page' : undefined} onClick={() => go('session')}>
          <span className="xl-fade">{s.title}</span>
        </button>
        <span className="xl-slot">
          <span className="xl-slot-state">
            <StateGlyph state={s.state} />
          </span>
          <button
            type="button"
            className="xl-slot-act"
            aria-label={`Actions for ${s.title}`}
            aria-expanded={menu?.id === s.id}
            onClick={(e) => {
              setCard(null);
              window.clearTimeout(timer.current);
              const el = e.currentTarget;
              setMenu((m) => (m?.id === s.id ? null : { id: s.id, el }));
              setMenuEl(el);
            }}
          >
            <Ellipsis size={16} strokeWidth={1.75} />
          </button>
        </span>
      </div>
    );
  };

  return (
    <div className="xl-pane-body" key="sessions">
      {destinations.map((d) => {
        const Icon = destIcon[d.icon];
        return (
          <div key={d.id} className="xl-row" data-selected={d.id === 'new' && scene === 'home'}>
            <button type="button" className="xl-row-main" onClick={() => d.id === 'new' && go('home')}>
              <Icon size={16} strokeWidth={1.75} />
              <span className="xl-fade">{d.label}</span>
            </button>
            {'shortcut' in d && <span className="xl-keys">{d.shortcut}</span>}
          </div>
        );
      })}

      <div className="xl-group">
        <div className="xl-group-head">
          <span>Pinned</span>
        </div>
        {pinned.map(row)}
      </div>

      {projects.map((p) => {
        const isOpen = openIds.has(p.id);
        return (
          <div className="xl-group" key={p.id} style={p.open ? undefined : { marginTop: 4 }}>
            <button
              type="button"
              className="xl-group-head"
              aria-expanded={isOpen}
              onClick={() =>
                setOpenIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.id)) next.delete(p.id);
                  else next.add(p.id);
                  return next;
                })
              }
            >
              <span>{p.name}</span>
              <ChevronRight className="xl-caret" size={13} strokeWidth={2} />
            </button>
            <Fold open={isOpen}>{p.sessions.map(row)}</Fold>
          </div>
        );
      })}

      <Pop open={menu !== null} anchor={menuEl} place="below-start" onClose={closeMenu} label="Session actions">
        <button type="button" className="xl-item" onClick={closeMenu}>
          <Pin size={15} strokeWidth={1.75} />
          <span>Pin</span>
        </button>
        <button type="button" className="xl-item" onClick={closeMenu}>
          <Pencil size={15} strokeWidth={1.75} />
          <span>Rename</span>
        </button>
        <div className="xl-sep" />
        <button type="button" className="xl-item" onClick={closeMenu}>
          <Archive size={15} strokeWidth={1.75} />
          <span>Archive</span>
        </button>
      </Pop>

      <Pop open={card !== null && menu === null} anchor={cardEl} place="right" onClose={closeCard} className="xl-card" label={inCard?.title} onPointerEnter={stay} onPointerLeave={leave}>
        {inCard && (
          <>
            <div className="xl-card-title">{inCard.title}</div>
            <div className="xl-card-line">{inCard.line}</div>
            <div className="xl-card-meta">
              {inCard.branch && (
                <span>
                  <GitBranch size={12} strokeWidth={1.75} />
                  {inCard.branch}
                </span>
              )}
              {inCard.machine && (
                <span>
                  <Monitor size={12} strokeWidth={1.75} />
                  {inCard.machine}
                </span>
              )}
              <span>{inCard.age}</span>
            </div>
            {inCard.state === 'approval' && <Ask onAnswer={onAnswer} />}
          </>
        )}
      </Pop>
    </div>
  );
}
