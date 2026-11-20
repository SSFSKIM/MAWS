// The left pane's content. The pane itself is Field's (one sheet of glass, 272 wide, a 20 px continuous corner, at
// 8 px from the window); what is written on it is Quiet's sidebar (quiet/Sidebar.tsx): title-only rows, one
// trailing slot where the state glyph steps aside for the row's actions, group labels whose caret waits for the
// pointer, two nested usage rings, and a card that follows the pointer from row to row.
import { useState } from 'react';
import {
  type BackdropHint,
  GlassMenu,
  GlassMenuContent,
  GlassMenuItem,
  GlassMenuSeparator,
  GlassMenuTrigger,
  GlassPopover,
  GlassPopoverContent,
  GlassPopoverTrigger,
} from '@vitreajs/vitrea-react';
import { Archive, ArrowLeft, ChevronRight, Ellipsis, LayoutGrid, PanelLeft, Pencil, Pin, Settings as Gear, Shapes, SlidersHorizontal, SquarePen } from 'lucide-react';
import { destinations, pinned, projects, settingsNav, settingsSections, usage, type Session } from '../../content/fixtures';
import type { SceneId } from '../../lab/types';
import { Fold, GBtn, go, Ring, StateGlyph } from './parts';

const destIcon = { compose: SquarePen, grid: LayoutGrid, shapes: Shapes, sliders: SlidersHorizontal } as const;

export interface CardApi {
  enter: (id: string, el: HTMLElement) => void;
  leave: () => void;
  hide: () => void;
}

interface Props {
  scene: SceneId;
  live: (x: Session) => Session;
  section: string;
  card: CardApi;
  /** What is behind a platter that opens over the pane. */
  hint: BackdropHint;
  onCollapse: () => void;
}

function RowMenu({ x, hint, onOpen }: { x: Session; hint: BackdropHint; onOpen: () => void }) {
  return (
    <GlassMenu groupProps={{ hint }} onOpenChange={(open) => open && onOpen()}>
      <GlassMenuTrigger className="xo-slot-act" aria-label={`Actions for ${x.title}`}>
        <Ellipsis size={16} strokeWidth={1.75} />
      </GlassMenuTrigger>
      <GlassMenuContent aria-label={`Actions for ${x.title}`} placement="bottom-start" gap={6} radius={16} thickness={8} className="xo-platter xo-menu">
        <GlassMenuItem className="xo-item">
          <Pin size={15} strokeWidth={1.75} />
          <span>{x.pinned ? 'Unpin' : 'Pin'}</span>
        </GlassMenuItem>
        <GlassMenuItem className="xo-item">
          <Pencil size={15} strokeWidth={1.75} />
          <span>Rename</span>
        </GlassMenuItem>
        <GlassMenuSeparator className="xo-sep" />
        <GlassMenuItem className="xo-item">
          <Archive size={15} strokeWidth={1.75} />
          <span>Archive</span>
        </GlassMenuItem>
      </GlassMenuContent>
    </GlassMenu>
  );
}

/** Two nested rings in the footer; the numbers are one click away (Quiet's), on a platter of the same glass. */
function Usage({ hint }: { hint: BackdropHint }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <GlassPopover groupProps={{ hint }}>
      <GlassPopoverTrigger className="xo-gbtn" aria-label={`Usage: ${pct(usage.fiveHour)} of the five-hour limit, ${pct(usage.week)} of the week`}>
        <Ring value={usage.week} inner={usage.fiveHour} />
      </GlassPopoverTrigger>
      <GlassPopoverContent aria-label="Usage" placement="top-end" gap={8} radius={18} thickness={8} className="xo-platter xo-usage">
        <div className="xo-usage-row">
          <Ring value={usage.fiveHour} size={16} />
          <span>5 hours</span>
          <span className="xo-num">{pct(usage.fiveHour)}</span>
        </div>
        <div className="xo-usage-row">
          <Ring value={usage.week} size={16} />
          <span>Week</span>
          <span className="xo-num">{pct(usage.week)}</span>
        </div>
        <div className="xo-usage-note">Resets in {usage.resetsIn}</div>
      </GlassPopoverContent>
    </GlassPopover>
  );
}

function Sessions({ scene, live, card, hint }: Pick<Props, 'scene' | 'live' | 'card' | 'hint'>) {
  const [openIds, setOpenIds] = useState(() => new Set(projects.filter((p) => p.open).map((p) => p.id)));

  const row = (raw: Session) => {
    const x = live(raw);
    const weight = x.state === 'unread' ? 'unread' : x.state === 'idle' ? 'rest' : undefined;
    return (
      <div
        key={x.id}
        className="xo-row"
        data-selected={scene === 'session' && x.id === 's1'}
        data-weight={weight}
        data-session={x.id}
        onPointerEnter={(e) => card.enter(x.id, e.currentTarget)}
        onPointerLeave={card.leave}
      >
        <button className="xo-row-main" onClick={() => go('session')}>
          <span className="xo-fade">{x.title}</span>
        </button>
        <span className="xo-slot">
          <span className="xo-slot-state">
            <StateGlyph state={x.state} />
          </span>
          <RowMenu x={x} hint={hint} onOpen={card.hide} />
        </span>
      </div>
    );
  };

  return (
    <div className="xo-pane-body" key="sessions">
      {destinations.map((d) => {
        const Icon = destIcon[d.icon];
        return (
          <div key={d.id} className="xo-row" data-selected={d.id === 'new' && scene === 'home'}>
            <button className="xo-row-main" onClick={() => d.id === 'new' && go('home')}>
              <Icon size={16} strokeWidth={1.75} />
              <span className="xo-fade">{d.label}</span>
            </button>
            {'shortcut' in d && <span className="xo-keys">{d.shortcut}</span>}
          </div>
        );
      })}

      <div className="xo-group">
        <div className="xo-group-head">
          <span>Pinned</span>
        </div>
        {pinned.map(row)}
      </div>

      {projects.map((p) => {
        const isOpen = openIds.has(p.id);
        return (
          <div className="xo-group" key={p.id} style={p.open ? undefined : { marginTop: 4 }}>
            <button
              className="xo-group-head"
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
              <ChevronRight className="xo-caret" size={13} strokeWidth={2} />
            </button>
            <Fold open={isOpen}>{p.sessions.map(row)}</Fold>
          </div>
        );
      })}
    </div>
  );
}

export function Sidebar({ scene, live, section, card, hint, onCollapse }: Props) {
  const inSettings = scene === 'settings';
  return (
    <div className="xo-pane-in">
      <div className="xo-pane-top">
        <GBtn label="Hide the sidebar" tip="Hide sidebar" tipAt="start" className="xo-pane-toggle" onClick={onCollapse}>
          <PanelLeft size={17} strokeWidth={1.75} />
        </GBtn>
      </div>
      {inSettings ? (
        <div className="xo-pane-body" key="settings" data-from="right">
          <button className="xo-back" onClick={() => go('session')}>
            <ArrowLeft size={16} strokeWidth={1.75} />
            Settings
          </button>
          {settingsNav.map((name) => {
            const has = settingsSections.some((x) => x.title === name);
            return (
              <div key={name} className="xo-row" data-selected={section === name}>
                <button
                  className="xo-row-main"
                  aria-current={section === name}
                  onClick={() => has && document.getElementById(`x-open-${name.toLowerCase()}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
                >
                  {name}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <Sessions scene={scene} live={live} card={card} hint={hint} />
      )}
      <div className="xo-pane-foot">
        <GBtn label="Settings" tip="Settings" tipAt="above-start" aria-pressed={inSettings} onClick={() => go(inSettings ? 'session' : 'settings')}>
          <Gear size={17} strokeWidth={1.75} />
        </GBtn>
        <Usage hint={hint} />
      </div>
    </div>
  );
}
