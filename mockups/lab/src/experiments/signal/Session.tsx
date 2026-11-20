import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Check, ChevronDown, ChevronRight, Clock, FileCode, GitBranch, PanelRight, Plus, Square, Terminal, Waypoints, X } from 'lucide-react';
import {
  approval,
  composer,
  overview,
  projects,
  tabs,
  transcript,
  type SessionState,
  type ToolCall,
  type TranscriptItem,
} from '../../content/fixtures';
import { Bead, stateWord } from './glyphs';
import { useSignal } from './store';

const fixtureState = new Map<string, SessionState>(projects.flatMap((p) => p.sessions.map((s) => [s.id, s.state] as const)));

/** A popover that stays mounted, so it can leave the way it came. Closes on Escape and on a press outside. */
export function Pop({ open, onClose, className, style, children, label }: { open: boolean; onClose: () => void; className?: string; style?: React.CSSProperties; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const press = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('[data-pop-anchor]')) onClose();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', press);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', press);
    };
  }, [open, onClose]);
  return (
    <div ref={ref} className={`pop ${className ?? ''}`} data-open={open} role="dialog" aria-label={label} aria-hidden={!open} inert={!open} style={style}>
      {children}
    </div>
  );
}

/** The approval, opened from its row in the sidebar: the one place the warm light leads to. */
export function ApprovalPop({ anchor, onClose }: { anchor: { id: string; top: number } | null; onClose: () => void }) {
  const sig = useSignal();
  const last = useRef(anchor);
  if (anchor) last.current = anchor;
  const at = last.current;
  const decide = (state: SessionState) => {
    if (at) sig.setState(at.id, state);
    onClose();
  };
  return (
    <Pop open={!!anchor} onClose={onClose} className="approval" label={approval.title} style={{ top: Math.max(12, (at?.top ?? 0) - 16) }}>
      <div className="approval-head">
        <Bead state="approval" />
        <span className="approval-title">{approval.title}</span>
        <span className="approval-waited">{approval.waited}</span>
      </div>
      <code className="approval-cmd">{approval.command}</code>
      <p className="approval-why">{approval.why}</p>
      <div className="approval-acts">
        <button type="button" className="btn quiet" onClick={() => decide('idle')}>
          Deny
        </button>
        <button type="button" className="btn go" onClick={() => decide('running')}>
          Approve
        </button>
      </div>
    </Pop>
  );
}

export function Tabs({ scene, asideOpen, onAside }: { scene: 'session' | 'settings'; asideOpen: boolean; onAside: () => void }) {
  const sig = useSignal();
  return (
    <header className="tabs">
      <div className="tablist" role="tablist" aria-label="Open tabs">
        {tabs.map((t) => {
          const state = t.kind === 'session' ? sig.stateOf(t.id, fixtureState.get(t.id) ?? t.state ?? 'idle') : null;
          const active = scene === 'session' && !!t.active;
          return (
            <button type="button" role="tab" aria-selected={active} className="tab" key={t.id} title={state ? stateWord[state] : undefined}>
              <span className="tab-mark">{state ? <Bead state={state} size={16} /> : <FileCode size={14} strokeWidth={1.9} aria-hidden />}</span>
              <span className="tab-title">{t.title}</span>
              <span className="tab-x" aria-hidden>
                <X size={12} strokeWidth={2.2} />
              </span>
            </button>
          );
        })}
        {scene === 'settings' && (
          <button type="button" role="tab" aria-selected className="tab">
            <span className="tab-title">Settings</span>
            <span className="tab-x" aria-hidden>
              <X size={12} strokeWidth={2.2} />
            </span>
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="New tab">
          <Plus size={15} strokeWidth={2} aria-hidden />
        </button>
      </div>
      {scene === 'session' && (
        <button type="button" className="icon-btn" aria-label={asideOpen ? 'Hide the side column' : 'Show the side column'} aria-pressed={asideOpen} onClick={onAside}>
          <PanelRight size={16} strokeWidth={1.9} aria-hidden />
        </button>
      )}
    </header>
  );
}

function Fold({ summary, seconds, calls }: { summary: string; seconds: number; calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fold" data-open={open}>
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronRight className="fold-caret" size={13} strokeWidth={2.2} aria-hidden />
        <span>{summary}</span>
        <span className="aside-note">{seconds}s</span>
      </button>
      <div className="fold-body" aria-hidden={!open} inert={!open}>
        <ul className="calls">
          {calls.map((c, i) => (
            <li key={i} style={{ ['--i' as string]: i }}>
              <span className="call-tool">{c.tool}</span>
              <code className="call-target">{c.target}</code>
              {c.detail && <span className="call-detail">{c.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="user">
          <p>{item.text}</p>
        </div>
      );
    case 'assistant':
      return (
        <div className="prose">
          {item.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    case 'thought':
      return (
        <p className="thought">
          <span>{item.summary}</span>
          <span className="aside-note">thought {item.seconds}s</span>
        </p>
      );
    case 'tools':
      return <Fold summary={item.summary} seconds={item.seconds} calls={item.calls} />;
    case 'edit': {
      const cut = item.file.lastIndexOf('/') + 1;
      return (
        <figure className="edit">
          <figcaption>
            <span className="path">
              <span className="dir">{item.file.slice(0, cut)}</span>
              {item.file.slice(cut)}
            </span>
            <span className="delta">
              <b className="add">+{item.added}</b>
              {item.removed > 0 && <b className="del">−{item.removed}</b>}
            </span>
          </figcaption>
          <pre>
            {item.lines.map((l, i) => (
              <span className="dl" data-sign={l.sign} key={i}>
                {l.text}
                {'\n'}
              </span>
            ))}
          </pre>
        </figure>
      );
    }
    case 'agents':
      return (
        <div className="agents" aria-label={`${item.names.join(' and ')} ${item.line}`}>
          <Waypoints size={14} strokeWidth={1.9} aria-hidden />
          {item.names.map((n) => (
            <span className="chip" key={n} title={item.line}>
              <Bead state="running" size={14} />
              {n}
            </span>
          ))}
        </div>
      );
    case 'running': {
      const m = Math.floor(item.seconds / 60);
      return (
        <figure className="run">
          <figcaption>
            <Bead state="running" size={16} />
            <code>{item.command}</code>
            <span className="run-time">
              {m > 0 ? `${m}m ` : ''}
              {item.seconds % 60}s
            </span>
          </figcaption>
          <pre>{item.tail.join('\n')}</pre>
        </figure>
      );
    }
  }
}

function Composer() {
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState('');
  const [queued, setQueued] = useState(true);
  const c = 2 * Math.PI * 6.5;
  return (
    <div className="composer-wrap">
      <div className="composer">
        {queued && (
          <div className="queued">
            <Clock size={13} strokeWidth={2} aria-label="Queued" />
            <span>{composer.queued}</span>
            <button type="button" className="queued-x" aria-label="Remove the queued message" onClick={() => setQueued(false)}>
              <X size={12} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
        )}
        <textarea rows={1} placeholder={composer.placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
        <div className="composer-bar">
          <button type="button" className="icon-btn" aria-label="Attach">
            <Plus size={16} strokeWidth={2} aria-hidden />
          </button>
          <div className="menu-anchor">
            <button type="button" className="pill" data-pop-anchor aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              {composer.model}
              <ChevronDown className="pill-caret" size={13} strokeWidth={2.2} aria-hidden />
            </button>
            <Pop open={menu} onClose={() => setMenu(false)} className="menu" label="Model and mode">
              {(
                [
                  ['Model', composer.model],
                  ['Effort', composer.effort],
                  ['Mode', composer.mode],
                ] as const
              ).map(([k, v], i) => (
                <button type="button" role="menuitem" className="menu-item" key={k} style={{ ['--i' as string]: i }} onClick={() => setMenu(false)}>
                  <span>{k}</span>
                  <span className="menu-value">{v}</span>
                  <ChevronRight size={13} strokeWidth={2.2} aria-hidden />
                </button>
              ))}
            </Pop>
          </div>
          <span className="grow" />
          <span className="context" title={`${Math.round(composer.context * 100)}% of the context window in use`}>
            <svg width="18" height="18" viewBox="0 0 18 18" role="img" aria-label={`Context ${Math.round(composer.context * 100)}% used`}>
              <circle cx="9" cy="9" r="6.5" fill="none" className="ring-track" strokeWidth="2.2" />
              <circle cx="9" cy="9" r="6.5" fill="none" className="ring-fill" strokeWidth="2.2" strokeLinecap="round" strokeDasharray={`${c * composer.context} ${c}`} transform="rotate(-90 9 9)" />
            </svg>
          </span>
          <button type="button" className="send" data-mode={text ? 'send' : 'stop'} aria-label={text ? 'Send' : 'Stop the turn'}>
            <ArrowUp className="send-arrow" size={16} strokeWidth={2.4} aria-hidden />
            <Square className="send-stop" size={11} strokeWidth={0} fill="currentColor" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

function AsideRow({ mark, title, line, tail, mono }: { mark: ReactNode; title: string; line?: string; tail?: ReactNode; mono?: boolean }) {
  return (
    <li className="a-row" data-reveal={!!line} tabIndex={line ? 0 : undefined}>
      <span className="slot">{mark}</span>
      <span className="text">
        <span className={mono ? 'title mono' : 'title'}>{title}</span>
        {line && (
          <span className="line">
            <span className="sentence">{line}</span>
          </span>
        )}
      </span>
      {tail}
    </li>
  );
}

function Aside() {
  return (
    <aside className="aside" aria-label="Session overview">
      <div className="a-head">
        <GitBranch size={14} strokeWidth={2} aria-hidden />
        <span className="a-branch">{overview.branch}</span>
        <span className="delta">
          <b className="add">+{overview.added}</b>
          <b className="del">−{overview.removed}</b>
        </span>
      </div>
      <ul className="a-list files">
        {overview.files.map((f) => {
          const cut = f.path.lastIndexOf('/') + 1;
          return (
            <li className="a-row" key={f.path}>
              <span className="path">
                <span className="dir">{f.path.slice(0, cut)}</span>
                {f.path.slice(cut)}
              </span>
              <span className="delta">
                <b className="add">+{f.added}</b>
                {f.removed > 0 && <b className="del">−{f.removed}</b>}
              </span>
            </li>
          );
        })}
      </ul>
      <h3>Agents</h3>
      <ul className="a-list">
        {overview.agents.map((a) => (
          <AsideRow key={a.name} mark={a.state === 'running' ? <Bead state="running" size={16} /> : <Check className="done" size={14} strokeWidth={2.4} aria-label="Done" />} title={a.name} line={a.line} />
        ))}
        {overview.background.map((b) => (
          <AsideRow key={b.label} mark={<Terminal size={14} strokeWidth={2} aria-hidden />} title={b.label} mono tail={<span className="a-tail">{b.line}</span>} />
        ))}
      </ul>
      <h3>Plan</h3>
      <ul className="a-list todos">
        {overview.todos.map((t) => (
          <li className="a-row" key={t.text} data-done={t.done} data-current={'current' in t && t.current ? true : undefined}>
            <span className="slot">
              {t.done ? (
                <span className="tick">
                  <Check size={10} strokeWidth={3.2} aria-label="Done" />
                </span>
              ) : 'current' in t && t.current ? (
                <Bead state="running" size={16} />
              ) : (
                <span className="todo-open" />
              )}
            </span>
            <span className="todo-text">{t.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function SessionScene({ asideOpen }: { asideOpen: boolean }) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // A running session is read from its latest line.
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  return (
    <div className="stage" data-aside={asideOpen}>
      <section className="thread" aria-label="Transcript">
        <div className="scroll" ref={scroll}>
          <div className="col">
            {transcript.map((item, i) => (
              <Item item={item} key={i} />
            ))}
          </div>
        </div>
        <Composer />
      </section>
      <div className="aside-clip" inert={!asideOpen}>
        <Aside />
      </div>
    </div>
  );
}
