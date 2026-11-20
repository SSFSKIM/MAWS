import { useState } from 'react';
import { ChevronRight, Clock, LayoutGrid, PanelLeft, Pin, Settings as Gear, Shapes, SlidersHorizontal, SquarePen } from 'lucide-react';
import { destinations, pinned, projects, usage, type Session } from '../../content/fixtures';
import type { SceneId } from '../../lab/types';
import { Glass, StateMark, goScene, stateWord, useShell } from './shell';

const destinationIcon = { compose: SquarePen, grid: LayoutGrid, shapes: Shapes, sliders: SlidersHorizontal } as const;

/** A session needs the person when it waits on them; only then does its line show at rest. */
const needsYou = (s: Session) => s.state === 'approval' || s.state === 'question' || s.state === 'plan';

function SessionRow({ s, current }: { s: Session; current: boolean }) {
  const line = s.machine ? `${s.line} · ${s.machine}` : s.line;
  return (
    <button
      className="x-windows-row x-windows-session-row"
      aria-current={current ? 'true' : undefined}
      aria-label={`${s.title}. ${stateWord[s.state]}. ${line}`}
    >
      {s.pinned ? <Pin size={14} strokeWidth={2.4} style={{ marginTop: 2 }} /> : <StateMark state={s.state} />}
      <span className="x-windows-session-text">
        <span className="x-windows-session-title">
          <span className="x-windows-clip">{s.title}</span>
          <span className="x-windows-age x-windows-num">{s.age}</span>
        </span>
        {needsYou(s) ? (
          <span className="x-windows-session-line">{line}</span>
        ) : (
          <span className="x-windows-fold">
            <span style={{ display: 'block' }}>
              <span className="x-windows-session-line" style={{ display: 'block' }}>
                {line}
              </span>
            </span>
          </span>
        )}
      </span>
    </button>
  );
}

function Ring({ value, label }: { value: number; label: string }) {
  const c = 2 * Math.PI * 7;
  return (
    <span className="x-windows-ring" data-hot={value >= 0.8}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="7" />
        <circle cx="9" cy="9" r="7" strokeDasharray={c} strokeDashoffset={c * (1 - value)} transform="rotate(-90 9 9)" />
      </svg>
      <span className="x-windows-ring-text">
        <span>{label}</span>
        <span className="x-windows-num">{Math.round(value * 100)}%</span>
      </span>
    </span>
  );
}

export function Sidebar({ scene }: { scene: SceneId }) {
  const shell = useShell();
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(projects.map((p) => [p.id, p.open])));
  return (
    <Glass id="x-windows-sidebar" role="window" label="Sessions" className="x-windows-sidebar" radius={28}>
      <div className="x-windows-body">
        <div className="x-windows-sb-top">
          <button className="x-windows-round" aria-label="Hide the sidebar" onClick={() => shell.setSidebar(false)}>
            <PanelLeft size={16} strokeWidth={2.2} />
          </button>
        </div>
        <nav className="x-windows-scroll" aria-label="Sessions">
          <div className="x-windows-sb-list">
            {destinations.map((d) => {
              const Icon = destinationIcon[d.icon];
              return (
                <button
                  key={d.id}
                  className="x-windows-row"
                  aria-current={d.id === 'new' && scene === 'home' ? 'page' : undefined}
                  onClick={d.id === 'new' ? () => goScene('home') : undefined}
                >
                  <Icon size={16} strokeWidth={2.2} />
                  <span className="x-windows-clip">{d.label}</span>
                  {'shortcut' in d && <span className="x-windows-sb-kbd">{d.shortcut}</span>}
                </button>
              );
            })}
            <div className="x-windows-sb-gap" />
            {pinned.map((s) => (
              <SessionRow key={s.id} s={s} current={false} />
            ))}
            <div className="x-windows-sb-gap" />
            {projects.map((p) => (
              <div key={p.id}>
                <button
                  className="x-windows-project"
                  aria-expanded={open[p.id] && p.sessions.length > 0}
                  onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
                >
                  <ChevronRight size={13} strokeWidth={2.6} />
                  <span>{p.name}</span>
                  {!open[p.id] && p.sessions.length > 0 && <span className="x-windows-project-n x-windows-num">{p.sessions.length}</span>}
                </button>
                <div className="x-windows-fold" data-open={open[p.id] && p.sessions.length > 0}>
                  <div>
                    {p.sessions.map((s) => (
                      <SessionRow key={s.id} s={s} current={scene === 'session' && s.id === 's1'} />
                    ))}
                    <div style={{ height: 8 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </nav>
        <div className="x-windows-sb-foot">
          <div className="x-windows-usage" aria-label={`Usage: ${Math.round(usage.fiveHour * 100)}% of five hours, ${Math.round(usage.week * 100)}% of the week, resets in ${usage.resetsIn}`}>
            <Ring value={usage.fiveHour} label="5h" />
            <Ring value={usage.week} label="Week" />
            <span className="x-windows-usage-more">
              <Clock size={12} strokeWidth={2.6} /> {usage.resetsIn}
            </span>
          </div>
          <button
            className="x-windows-round"
            aria-label="Settings"
            aria-current={scene === 'settings' ? 'page' : undefined}
            onClick={() => goScene(scene === 'settings' ? 'session' : 'settings')}
          >
            <Gear size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </Glass>
  );
}
