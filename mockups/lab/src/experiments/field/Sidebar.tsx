import { useState } from 'react';
import {
  GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuSeparator, GlassMenuTrigger,
  GlassPopover, GlassPopoverClose, GlassPopoverContent, GlassPopoverTrigger,
} from '@vitreajs/vitrea-react';
import { Ellipsis, LayoutGrid, Settings, Shapes, SlidersHorizontal, SquarePen } from 'lucide-react';
import { approval, destinations, pinned, projects, usage, type Project, type Session, type SessionState } from '../../content/fixtures';
import type { SceneId } from '../../lab/types';
import { Chevron, Fold, Mark, Pie } from './bits';

const PLANE = { backdrop: { kind: 'texture', id: 'xf-plane' } } as const;
const icons = { compose: SquarePen, grid: LayoutGrid, shapes: Shapes, sliders: SlidersHorizontal } as const;
const needs = (s: SessionState) => s === 'approval' || s === 'question' || s === 'plan';

function RowMenu({ s }: { s: Session }) {
  const facts = [s.line, s.branch, s.machine && `on ${s.machine}`, s.age === 'now' ? null : `${s.age} ago`].filter(Boolean);
  return (
    <GlassMenu groupProps={PLANE}>
      <GlassMenuTrigger className="xf-row-more" aria-label={`Actions for ${s.title}`}>
        <Ellipsis size={16} strokeWidth={2} />
      </GlassMenuTrigger>
      <GlassMenuContent aria-label={`Actions for ${s.title}`} placement="bottom-end" gap={6} radius={16} thickness={8} className="xf-menu">
        <div className="xf-menu-note" role="presentation">
          {facts.map((f) => (
            <span key={String(f)}>{f}</span>
          ))}
        </div>
        <GlassMenuSeparator className="xf-menu-rule" />
        <GlassMenuItem className="xf-menu-item">{s.pinned ? 'Unpin' : 'Pin'}</GlassMenuItem>
        <GlassMenuItem className="xf-menu-item">Rename</GlassMenuItem>
        <GlassMenuItem className="xf-menu-item">Mark as unread</GlassMenuItem>
        <GlassMenuItem className="xf-menu-item">Archive</GlassMenuItem>
      </GlassMenuContent>
    </GlassMenu>
  );
}

function RowBody({ s, state }: { s: Session; state: SessionState }) {
  return (
    <>
      <Mark state={state} />
      <span className="xf-row-text">
        <span className="xf-row-title">{s.title}</span>
        {needs(state) && <span className="xf-row-line">{s.line}</span>}
      </span>
    </>
  );
}

function SessionRow({ s, current, approved, onApprove }: { s: Session; current: boolean; approved: boolean; onApprove: () => void }) {
  const state: SessionState = s.state === 'approval' && approved ? 'running' : s.state;
  return (
    <li className="xf-row" data-current={current} data-needs={needs(state)}>
      {state === 'approval' ? (
        <GlassPopover groupProps={PLANE}>
          <GlassPopoverTrigger className="xf-row-main" surface="fill">
            <RowBody s={s} state={state} />
          </GlassPopoverTrigger>
          <GlassPopoverContent aria-label={approval.title} placement="bottom-start" gap={6} radius={18} thickness={8} className="xf-approve">
            <p className="xf-approve-title">{approval.title}</p>
            <code className="xf-approve-cmd">{approval.command}</code>
            <p className="xf-approve-why">{approval.why}</p>
            <div className="xf-approve-acts">
              <GlassPopoverClose className="xf-pbtn" onClick={onApprove}>Deny</GlassPopoverClose>
              <GlassPopoverClose className="xf-pbtn xf-pbtn-go" onClick={onApprove}>Approve</GlassPopoverClose>
            </div>
          </GlassPopoverContent>
        </GlassPopover>
      ) : (
        <button type="button" className="xf-row-main" aria-current={current ? 'page' : undefined}>
          <RowBody s={s} state={state} />
        </button>
      )}
      <span className="xf-row-trail">
        {s.age !== 'now' && <span className="xf-row-age">{s.age}</span>}
        <RowMenu s={s} />
      </span>
    </li>
  );
}

function ProjectGroup({ p, approved, onApprove, scene }: { p: Project; approved: boolean; onApprove: () => void; scene: SceneId }) {
  const [open, setOpen] = useState(p.open);
  return (
    <section className="xf-group">
      <button type="button" className="xf-group-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{p.name}</span>
        <Chevron open={open} />
      </button>
      <Fold open={open}>
        <ul className="xf-rows">
          {p.sessions.map((s) => (
            <SessionRow key={s.id} s={s} current={scene === 'session' && s.id === 's1'} approved={approved} onApprove={onApprove} />
          ))}
          {p.sessions.length === 0 && <li className="xf-empty">No sessions yet</li>}
        </ul>
      </Fold>
    </section>
  );
}

export function Sidebar({ scene, approved, onApprove, go }: { scene: SceneId; approved: boolean; onApprove: () => void; go: (scene: SceneId) => void }) {
  return (
    <div className="xf-pane-in">
      <div className="xf-pane-top" />
      <div className="xf-pane-scroll">
        <ul className="xf-rows">
          {destinations.map((d) => {
            const Icon = icons[d.icon];
            const current = d.id === 'new' && scene === 'home';
            return (
              <li key={d.id} className="xf-row" data-current={current}>
                <button type="button" className="xf-row-main xf-dest" aria-current={current ? 'page' : undefined} onClick={d.id === 'new' ? () => go('home') : undefined}>
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className="xf-row-title">{d.label}</span>
                  {'shortcut' in d && <kbd className="xf-kbd">{d.shortcut}</kbd>}
                </button>
              </li>
            );
          })}
        </ul>
        <section className="xf-group">
          <div className="xf-group-head xf-group-static">Pinned</div>
          <ul className="xf-rows">
            {pinned.map((s) => (
              <SessionRow key={s.id} s={s} current={false} approved={approved} onApprove={onApprove} />
            ))}
          </ul>
        </section>
        {projects.map((p) => (
          <ProjectGroup key={p.id} p={p} approved={approved} onApprove={onApprove} scene={scene} />
        ))}
      </div>
      <div className="xf-pane-foot">
        <button type="button" className="xf-usage" aria-label={`Usage: ${Math.round(usage.fiveHour * 100)}% of the five-hour window, ${Math.round(usage.week * 100)}% of the week, resets in ${usage.resetsIn}`}>
          <Pie share={Math.max(usage.fiveHour, usage.week)} />
          <span className="xf-usage-text">
            <span>{Math.round(usage.fiveHour * 100)}% of 5 hours · {Math.round(usage.week * 100)}% of the week</span>
            <span>Resets in {usage.resetsIn}</span>
          </span>
        </button>
        <button type="button" className="xf-icon-btn xf-on-glass" aria-label="Settings" aria-current={scene === 'settings' ? 'page' : undefined} onClick={() => go(scene === 'settings' ? 'session' : 'settings')}>
          <Settings size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
