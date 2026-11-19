import { useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronRight, LayoutGrid, Pin, Shapes, SlidersHorizontal, SquarePen } from 'lucide-react';
import { destinations, pinned, projects, usage, type Project, type Session } from '../../content/fixtures';
import { lampOf, lampsOf } from './field';
import { Bead, stateWord } from './glyphs';
import { useSignal } from './store';

const destIcon = { compose: SquarePen, grid: LayoutGrid, shapes: Shapes, sliders: SlidersHorizontal } as const;

/** The session on screen. */
export const CURRENT = 's1';

export interface Peek {
  title: string;
  line: string;
  age: string;
  top: number;
}

export function SessionRow({ s, onOpen, open, onPeek }: { s: Session; onOpen?: (id: string, el: HTMLElement) => void; open?: boolean; onPeek?: (p: Peek | null) => void }) {
  const sig = useSignal();
  const state = sig.stateOf(s.id, s.state);
  const line = state === s.state ? s.line : stateWord[state];
  const click = (ev: MouseEvent<HTMLButtonElement>) => {
    if (ev.altKey) sig.cycle(s.id, state);
    else onOpen?.(s.id, ev.currentTarget);
  };
  return (
    <button
      type="button"
      className="row"
      data-lamp={lampOf(state)}
      data-fid={s.id}
      data-state={state}
      data-open={open || undefined}
      data-pop-anchor={state === 'approval' ? true : undefined}
      aria-current={s.id === CURRENT ? 'page' : undefined}
      aria-label={`${s.title}. ${stateWord[state]}. ${line}`}
      onClick={click}
      onPointerEnter={(e) => onPeek?.({ title: s.title, line, age: s.age, top: e.currentTarget.getBoundingClientRect().top })}
      onPointerLeave={() => onPeek?.(null)}
      onFocus={(e) => onPeek?.({ title: s.title, line, age: s.age, top: e.currentTarget.getBoundingClientRect().top })}
      onBlur={() => onPeek?.(null)}
    >
      <span className="slot">
        <Bead state={state} />
        {state === 'idle' && <span className="rest" />}
      </span>
      <span className="text">
        <span className="title">{s.title}</span>
        <span className="line">
          <span className="sentence">{line}</span>
          <span className="age">
            {s.machine ? `${s.machine} · ` : ''}
            {s.age}
          </span>
        </span>
      </span>
      {s.pinned && <Pin className="pin" size={12} strokeWidth={2} aria-label="Pinned" />}
    </button>
  );
}

function ProjectGroup({ p, onOpen, openId, onPeek }: { p: Project; onOpen: (id: string, el: HTMLElement) => void; openId: string | null; onPeek: (p: Peek | null) => void }) {
  const sig = useSignal();
  const [open, setOpen] = useState(p.open);
  const states = p.sessions.map((s) => sig.stateOf(s.id, s.state));
  const empty = p.sessions.length === 0;
  return (
    <div className="proj" data-open={open && !empty}>
      <button
        type="button"
        className="proj-head"
        data-lamp={open ? 'none' : lampsOf(states)}
        data-fid={`proj-${p.id}`}
        aria-expanded={empty ? undefined : open}
        onClick={() => {
          if (empty) return;
          sig.kick();
          setOpen((v) => !v);
        }}
      >
        <span className="slot">
          {!empty && <ChevronRight className="caret" size={13} strokeWidth={2.2} aria-hidden />}
          <span className="monogram" aria-hidden>
            {p.name.slice(0, 1)}
          </span>
        </span>
        <span className="proj-name">{p.name}</span>
        {!empty && (
          <span className="proj-beads" aria-label={`${p.sessions.length} sessions`}>
            {states.some((st) => st !== 'idle') ? states.filter((st) => st !== 'idle').map((st, i) => <Bead state={st} size={13} key={i} />) : <span className="proj-count">{p.sessions.length}</span>}
          </span>
        )}
      </button>
      {!empty && (
        <div className="proj-body" aria-hidden={!open}>
          <div className="proj-rows">
            {p.sessions.map((s) => (
              <SessionRow key={s.id} s={s} onOpen={onOpen} open={openId === s.id} onPeek={onPeek} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Usage as two nested rings, the week outside and the five hours inside: round where the app draws two gauges. */
function Rings() {
  const arc = (r: number, v: number) => {
    const c = 2 * Math.PI * r;
    return { r, strokeDasharray: `${c * v} ${c}` };
  };
  return (
    <svg className="ring" width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="8" fill="none" className="ring-track" strokeWidth="2.3" />
      <circle cx="10" cy="10" fill="none" className="ring-fill" strokeWidth="2.3" strokeLinecap="round" transform="rotate(-90 10 10)" {...arc(8, usage.week)} />
      <circle cx="10" cy="10" r="4" fill="none" className="ring-track" strokeWidth="2.3" />
      <circle cx="10" cy="10" fill="none" className="ring-fill" strokeWidth="2.3" strokeLinecap="round" transform="rotate(-90 10 10)" {...arc(4, usage.fiveHour)} />
    </svg>
  );
}

export function SidebarContent({ onOpen, openId, onPeek, children }: { onOpen: (id: string, el: HTMLElement) => void; openId: string | null; onPeek: (p: Peek | null) => void; children?: ReactNode }) {
  const sig = useSignal();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="pane-in">
      <nav className="dest" aria-label="Destinations">
        {destinations.map((d) => {
          const Icon = destIcon[d.icon];
          return (
            <button type="button" className="dest-row" key={d.id}>
              <span className="slot">
                <Icon size={16} strokeWidth={1.9} aria-hidden />
              </span>
              <span className="dest-label">{d.label}</span>
              {'shortcut' in d && <kbd className="keys">{d.shortcut}</kbd>}
            </button>
          );
        })}
      </nav>
      <div className="sessions" role="group" aria-label="Sessions" onScroll={sig.kick}>
        {pinned.map((s) => (
          <SessionRow key={s.id} s={s} onOpen={onOpen} onPeek={onPeek} />
        ))}
        {projects.map((p) => (
          <ProjectGroup key={p.id} p={p} onOpen={onOpen} openId={openId} onPeek={onPeek} />
        ))}
      </div>
      <button type="button" className="usage" aria-label={`Usage: ${pct(usage.fiveHour)} of the five-hour limit, ${pct(usage.week)} of the week. Resets in ${usage.resetsIn}.`}>
        <span className="slot">
          <Rings />
        </span>
        <span className="usage-words">
          {pct(usage.fiveHour)} now · {pct(usage.week)} this week · resets in {usage.resetsIn}
        </span>
      </button>
      {children}
    </div>
  );
}
