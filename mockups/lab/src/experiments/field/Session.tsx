import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, ChevronDown, ChevronRight, FileCode, Folder, GitBranch, PanelLeft, PanelRight, Plus, Settings, Square, SquarePen, X } from 'lucide-react';
import { composer, overview, tabs, transcript, type SessionState, type ToolCall, type TranscriptItem } from '../../content/fixtures';
import type { SceneId } from '../../lab/types';
import { Chevron, Fold, Mark, Pie, seconds } from './bits';

// ---- The bar: sidebar toggle, tabs, side-column toggle ---------------------------------------------------------------

export function Bar({ scene, approved, paneOpen, togglePane, sideOpen, toggleSide }: {
  scene: SceneId; approved: boolean; paneOpen: boolean; togglePane: () => void; sideOpen: boolean; toggleSide: () => void;
}) {
  const extra = scene === 'settings' ? { title: 'Settings', Icon: Settings } : scene === 'home' ? { title: 'New chat', Icon: SquarePen } : null;
  return (
    <header className="xf-bar">
      <button type="button" className="xf-icon-btn" aria-label={paneOpen ? 'Hide the sidebar' : 'Show the sidebar'} aria-expanded={paneOpen} onClick={togglePane}>
        <PanelLeft size={16} strokeWidth={1.75} />
      </button>
      <div className="xf-tabs" role="tablist" aria-label="Open tabs">
        {extra && (
          <div className="xf-tab" role="tab" aria-selected="true" tabIndex={0}>
            <extra.Icon size={14} strokeWidth={1.75} aria-hidden="true" />
            <span className="xf-tab-title">{extra.title}</span>
          </div>
        )}
        {tabs.map((t) => {
          const state: SessionState | undefined = t.state === 'approval' && approved ? 'running' : t.state;
          const selected = !extra && !!t.active;
          return (
            <div key={t.id} className="xf-tab" role="tab" aria-selected={selected} tabIndex={0}>
              {t.kind === 'file' ? <FileCode size={14} strokeWidth={1.75} aria-hidden="true" /> : <Mark state={state} />}
              <span className="xf-tab-title">{t.title}</span>
              <button type="button" className="xf-tab-x" aria-label={`Close ${t.title}`} tabIndex={-1}>
                <X size={12} strokeWidth={2.2} />
              </button>
            </div>
          );
        })}
        <button type="button" className="xf-icon-btn" aria-label="New tab">
          <Plus size={16} strokeWidth={1.75} />
        </button>
      </div>
      {scene === 'session' && (
        <button type="button" className="xf-icon-btn" aria-label={sideOpen ? 'Hide the side column' : 'Show the side column'} aria-expanded={sideOpen} onClick={toggleSide}>
          <PanelRight size={16} strokeWidth={1.75} />
        </button>
      )}
    </header>
  );
}

// ---- Transcript ------------------------------------------------------------------------------------------------------

function Calls({ calls }: { calls: ToolCall[] }) {
  return (
    <ul className="xf-calls">
      {calls.map((c, i) => (
        <li key={i}>
          <span className="xf-call-tool">{c.tool}</span>
          <code className="xf-call-target">{c.target}</code>
          {c.detail && <span className="xf-call-detail">{c.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

function ToolRun({ item, initial = false }: { item: Extract<TranscriptItem, { kind: 'tools' }>; initial?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="xf-quiet-block">
      <button type="button" className="xf-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{item.summary}</span>
        <Chevron open={open} />
        <span className="xf-quiet-meta">{seconds(item.seconds)}</span>
      </button>
      <Fold open={open}>
        <Calls calls={item.calls} />
      </Fold>
    </div>
  );
}

function Item({ item }: { item: TranscriptItem }): ReactNode {
  switch (item.kind) {
    case 'user':
      return <div className="xf-user"><p>{item.text}</p></div>;
    case 'assistant':
      return <div className="xf-prose">{item.paragraphs.map((p) => <p key={p}>{p}</p>)}</div>;
    case 'thought':
      return (
        <div className="xf-quiet xf-quiet-static">
          <span>{item.summary}</span>
          <span className="xf-quiet-meta">thought for {seconds(item.seconds)}</span>
        </div>
      );
    case 'tools':
      return <ToolRun item={item} />;
    case 'edit':
      return (
        <figure className="xf-edit">
          <figcaption>
            <code>{item.file}</code>
            <span className="xf-add">+{item.added}</span>
            {item.removed > 0 && <span className="xf-del">−{item.removed}</span>}
          </figcaption>
          <pre>
            {item.lines.map((l, i) => (
              <span key={i} className="xf-diff" data-sign={l.sign}><i>{l.sign}</i>{l.text}{'\n'}</span>
            ))}
          </pre>
        </figure>
      );
    case 'agents':
      return (
        <div className="xf-quiet xf-quiet-static xf-agents">
          {item.names.map((n) => <span key={n} className="xf-pill"><Mark state="running" />{n}</span>)}
          <span>{item.line}</span>
        </div>
      );
    case 'running':
      return (
        <div className="xf-run" role="status">
          <div className="xf-run-head">
            <Mark state="running" />
            <code>{item.command}</code>
            <span className="xf-run-time">{seconds(item.seconds)}</span>
          </div>
          <pre>{item.tail.join('\n')}</pre>
        </div>
      );
  }
}

function Composer({ centered = false }: { centered?: boolean }) {
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [queued, setQueued] = useState(!centered);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [menu]);
  const busy = !centered && text.trim() === '';
  return (
    <div className="xf-composer-wrap">
      {queued && (
        <div className="xf-queued">
          <span className="xf-queued-tag">Queued</span>
          <span className="xf-queued-text">{composer.queued}</span>
          <button type="button" className="xf-tab-x" aria-label="Remove the queued message" onClick={() => setQueued(false)}><X size={12} strokeWidth={2.2} /></button>
        </div>
      )}
      <div className="xf-composer">
        <textarea rows={centered ? 3 : 1} placeholder={composer.placeholder} aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="xf-composer-row">
          <button type="button" className="xf-icon-btn" aria-label="Attach"><Plus size={16} strokeWidth={1.75} /></button>
          <div className="xf-model" ref={wrap}>
            <button type="button" className="xf-ghost" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              {composer.model}
              <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
            </button>
            <div className="xf-pop" role="menu" data-open={menu} inert={!menu}>
              {([['Model', composer.model], ['Effort', composer.effort], ['Mode', composer.mode]] as const).map(([k, v]) => (
                <button key={k} type="button" role="menuitem" className="xf-pop-item" onClick={() => setMenu(false)}>
                  <span>{k}</span><span className="xf-pop-value">{v}</span><ChevronRight size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          {centered && <span className="xf-ghost xf-ghost-static"><Folder size={13} strokeWidth={1.9} aria-hidden="true" />{composer.folder}</span>}
          <span className="xf-composer-space" />
          {!centered && (
            <span className="xf-context" tabIndex={0} aria-label={`${Math.round(composer.context * 100)}% of the context window used`}>
              <span className="xf-context-text">{Math.round(composer.context * 100)}% of context</span>
              <Pie share={composer.context} />
            </span>
          )}
          <button type="button" className="xf-send" data-busy={busy} aria-label={busy ? 'Stop' : 'Send'}>
            {busy ? <Square size={11} strokeWidth={0} fill="currentColor" /> : <ArrowUp size={16} strokeWidth={2.4} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Side() {
  return (
    <div className="xf-side-in">
      <section>
        <h3>Plan</h3>
        <ul className="xf-todos">
          {overview.todos.map((t) => (
            <li key={t.text} data-done={t.done} data-current={!!t.current}>
              <Mark state={t.done ? 'done' : t.current ? 'running' : 'idle'} />
              <span>{t.text}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Agents</h3>
        <ul className="xf-agent-list">
          {overview.agents.map((a) => (
            <li key={a.name}>
              <Mark state={a.state === 'running' ? 'running' : 'done'} />
              <span className="xf-two"><span>{a.name}</span><small>{a.line}</small></span>
            </li>
          ))}
          {overview.background.map((b) => (
            <li key={b.label}>
              <Mark state="running" />
              <span className="xf-two"><code>{b.label}</code><small>{b.line}</small></span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>
          Changes
          <span className="xf-h-meta"><span className="xf-add">+{overview.added}</span> <span className="xf-del">−{overview.removed}</span></span>
        </h3>
        <div className="xf-branch"><GitBranch size={13} strokeWidth={1.9} aria-hidden="true" /><code>{overview.branch}</code></div>
        <ul className="xf-files">
          {overview.files.map((f) => {
            const cut = f.path.lastIndexOf('/') + 1;
            return (
              <li key={f.path}>
                <button type="button" className="xf-file">
                  <code><span>{f.path.slice(0, cut)}</span>{f.path.slice(cut)}</code>
                  <span className="xf-add">+{f.added}</span>
                  {f.removed > 0 && <span className="xf-del">−{f.removed}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export function SessionBody({ sideOpen }: { sideOpen: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  // A live session opens on its latest moment.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  return (
    <div className="xf-body" data-side={sideOpen}>
      <div className="xf-thread">
        <div className="xf-scroller" ref={scroller}>
          <div className="xf-measure">
            {transcript.map((item, i) => <Item key={i} item={item} />)}
          </div>
        </div>
        <div className="xf-dock"><Composer /></div>
      </div>
      <aside className="xf-side" aria-label="Session overview" inert={!sideOpen}>
        <Side />
      </aside>
    </div>
  );
}

export function HomeBody() {
  return (
    <div className="xf-home">
      <h1>What’s next for {composer.folder}?</h1>
      <Composer centered />
    </div>
  );
}
