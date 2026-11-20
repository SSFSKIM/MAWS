import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  Ellipsis,
  GitBranch,
  LayoutGrid,
  Monitor,
  Pencil,
  Pin,
  Settings as Gear,
  Shapes,
  SlidersHorizontal,
  SquarePen,
} from 'lucide-react';
import { destinations, pinned, projects, settingsNav, settingsSections, usage, type Session } from '../../content/fixtures';
import type { SceneId } from '../../lab/types';
import { Ring, StateGlyph } from './glyphs';
import { Fold, Pop } from './overlay';
import { Ask } from './Session';
import type { Answer } from './Orange';
import s from './orange.module.css';

const destIcon = { compose: SquarePen, grid: LayoutGrid, shapes: Shapes, sliders: SlidersHorizontal } as const;

interface Props {
  scene: SceneId;
  open: boolean;
  live: (x: Session) => Session;
  answer: Answer;
  onAnswer: (a: Answer) => void;
  section: string;
  go: (scene: SceneId) => void;
}

export function Sidebar({ scene, open, live, onAnswer, section, go }: Props) {
  const inSettings = scene === 'settings';
  return (
    <nav className={`${s.side} ${s.glass}`} data-open={open} data-o-surface="Sidebar" aria-label="Sidebar" inert={!open}>
      <div className={s.sideInner}>
        <div className={s.sideTop} />
        {inSettings ? (
          <div className={s.sideBody} key="settings" data-from="right">
            <button className={s.back} onClick={() => go('session')}>
              <ArrowLeft size={16} strokeWidth={1.75} />
              Settings
            </button>
            {settingsNav.map((name) => {
              const has = settingsSections.some((x) => x.title === name);
              return (
                <div key={name} className={s.row} data-selected={section === name}>
                  <button
                    className={s.rowMain}
                    aria-current={section === name}
                    onClick={() => has && document.getElementById(`x-orange-${name.toLowerCase()}`)?.scrollIntoView({ block: 'start' })}
                  >
                    {name}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <Sessions scene={scene} live={live} onAnswer={onAnswer} go={go} />
        )}
        <div className={s.sideFoot}>
          <button
            className={s.icon}
            aria-label="Settings"
            aria-pressed={inSettings}
            data-tip="Settings"
            data-tip-at="above-start"
            onClick={() => go(inSettings ? 'session' : 'settings')}
          >
            <Gear size={17} strokeWidth={1.75} />
          </button>
          <Usage />
        </div>
      </div>
    </nav>
  );
}

/** Two nested rings in the footer; the numbers are one click away. */
function Usage() {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <button
        ref={setEl}
        className={s.icon}
        aria-expanded={open}
        aria-label={`Usage: ${pct(usage.fiveHour)} of the five-hour limit, ${pct(usage.week)} of the week`}
        data-tip="Usage"
        data-tip-at="above-end"
        onClick={() => setOpen((v) => !v)}
      >
        <Ring value={usage.week} inner={usage.fiveHour} />
      </button>
      <Pop open={open} anchor={el} place="above-end" onClose={close} className={s.usage}>
        <div className={s.usageRow}>
          <Ring value={usage.fiveHour} size={16} />
          <span>5 hours</span>
          <span className={s.num}>{pct(usage.fiveHour)}</span>
        </div>
        <div className={s.usageRow}>
          <Ring value={usage.week} size={16} />
          <span>Week</span>
          <span className={s.num}>{pct(usage.week)}</span>
        </div>
        <div className={s.usageNote}>Resets in {usage.resetsIn}</div>
      </Pop>
    </>
  );
}

function Sessions({ scene, live, onAnswer, go }: Pick<Props, 'scene' | 'live' | 'onAnswer' | 'go'>) {
  const [openIds, setOpenIds] = useState(() => new Set(projects.filter((p) => p.open).map((p) => p.id)));
  const [menu, setMenu] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [cardEl, setCardEl] = useState<HTMLElement | null>(null);
  const timer = useRef(0);

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
    timer.current = window.setTimeout(() => setCard(null), 160);
  };
  const stay = () => window.clearTimeout(timer.current);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const closeCard = useCallback(() => setCard(null), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const all = [...pinned, ...projects.flatMap((p) => p.sessions)].map(live);
  const shown = card ? all.find((x) => x.id === card.id) : undefined;
  const last = useRef(shown);
  if (shown) last.current = shown;
  const inCard = shown ?? last.current;

  const row = (raw: Session) => {
    const x = live(raw);
    const weight = x.state === 'unread' ? 'unread' : x.state === 'idle' ? 'rest' : undefined;
    return (
      <div
        key={x.id}
        className={s.row}
        data-selected={scene === 'session' && x.id === 's1'}
        data-weight={weight}
        data-held={menu?.id === x.id}
        onPointerEnter={(e) => enter(x.id, e.currentTarget)}
        onPointerLeave={leave}
      >
        <button className={s.rowMain} onClick={() => go('session')}>
          <span className={s.fade}>{x.title}</span>
        </button>
        <span className={s.slot}>
          <span className={s.slotState}>
            <StateGlyph state={x.state} />
          </span>
          <button
            className={s.slotAct}
            aria-label={`Actions for ${x.title}`}
            aria-expanded={menu?.id === x.id}
            onClick={(e) => {
              setCard(null);
              window.clearTimeout(timer.current);
              const el = e.currentTarget;
              setMenu((m) => (m?.id === x.id ? null : { id: x.id, el }));
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
    <div className={s.sideBody} key="sessions">
      {destinations.map((d) => {
        const Icon = destIcon[d.icon];
        return (
          <div key={d.id} className={s.row} data-selected={d.id === 'new' && scene === 'home'}>
            <button className={s.rowMain} onClick={() => d.id === 'new' && go('home')}>
              <Icon size={16} strokeWidth={1.75} />
              <span className={s.fade}>{d.label}</span>
            </button>
            {'shortcut' in d && <span className={s.keys}>{d.shortcut}</span>}
          </div>
        );
      })}

      <div className={s.group}>
        <div className={s.groupHead}>
          <span>Pinned</span>
        </div>
        {pinned.map(row)}
      </div>

      {projects.map((p) => {
        const isOpen = openIds.has(p.id);
        return (
          <div className={s.group} key={p.id} style={p.open ? undefined : { marginTop: 4 }}>
            <button
              className={s.groupHead}
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
              <ChevronRight className={s.caret} size={13} strokeWidth={2} />
            </button>
            <Fold open={isOpen}>{p.sessions.map(row)}</Fold>
          </div>
        );
      })}

      <Pop open={menu !== null} anchor={menuEl} place="below-start" onClose={closeMenu}>
        <button className={s.item} onClick={closeMenu}>
          <Pin size={15} strokeWidth={1.75} />
          <span>Pin</span>
        </button>
        <button className={s.item} onClick={closeMenu}>
          <Pencil size={15} strokeWidth={1.75} />
          <span>Rename</span>
        </button>
        <div className={s.sep} />
        <button className={s.item} onClick={closeMenu}>
          <Archive size={15} strokeWidth={1.75} />
          <span>Archive</span>
        </button>
      </Pop>

      <Pop
        open={card !== null && menu === null}
        anchor={cardEl}
        place="right"
        onClose={closeCard}
        className={s.card}
        onPointerEnter={stay}
        onPointerLeave={leave}
      >
        {inCard && (
          <>
            <div className={s.cardTitle}>{inCard.title}</div>
            <div className={s.cardLine}>{inCard.line}</div>
            <div className={s.cardMeta}>
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
