import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FilePen, GitBranch, PanelRight, Sparkles, Square, Users } from 'lucide-react';
import { GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuTrigger } from '@vitreajs/vitrea-react';
import { composer, overview, transcript, type TranscriptItem } from '../../content/fixtures';
import { ENV, Glass, StateMark, useShell } from './shell';
import { TopBar } from './TopBar';

function clock(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function ToolRun({ item, startOpen }: { item: Extract<TranscriptItem, { kind: 'tools' }>; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div className="x-windows-run" data-open={open}>
      <button className="x-windows-run-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronRight className="x-windows-chev" size={14} strokeWidth={2.6} />
        <span>{item.summary}</span>
        <em className="x-windows-num">{clock(item.seconds)}</em>
      </button>
      <div className="x-windows-fold" data-open={open}>
        <div>
          <ul className="x-windows-calls">
            {item.calls.map((c, i) => (
              <li key={i} className="x-windows-call x-windows-mono">
                <b>{c.tool}</b>
                <span className="x-windows-clip">{c.target}</span>
                {c.detail && <span>{c.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Item({ item, firstTools }: { item: TranscriptItem; firstTools: boolean }) {
  const shell = useShell();
  switch (item.kind) {
    case 'user':
      return <p className="x-windows-user">{item.text}</p>;
    case 'assistant':
      return (
        <div className="x-windows-prose">
          {item.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    case 'thought':
      return (
        <div className="x-windows-quiet">
          <Sparkles size={14} strokeWidth={2.2} />
          <span>{item.summary}</span>
          <em className="x-windows-num">{clock(item.seconds)}</em>
        </div>
      );
    case 'tools':
      return <ToolRun item={item} startOpen={firstTools && shell.flag('tools')} />;
    case 'edit':
      return (
        <figure className="x-windows-edit">
          <figcaption className="x-windows-edit-head">
            <FilePen size={14} strokeWidth={2.2} />
            <span className="x-windows-mono" style={{ fontWeight: 600 }}>
              {item.file}
            </span>
            <span className="x-windows-delta x-windows-num">
              {item.added > 0 && <span className="x-windows-add">+{item.added}</span>}
              {item.removed > 0 && <span className="x-windows-del">−{item.removed}</span>}
            </span>
          </figcaption>
          <div className="x-windows-diff x-windows-mono">
            {item.lines.map((l, i) => (
              <div key={i}>
                <i className={l.sign === '+' ? 'x-windows-add' : l.sign === '-' ? 'x-windows-del' : undefined}>{l.sign}</i>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </figure>
      );
    case 'agents':
      return (
        <div className="x-windows-agents">
          <Users size={14} strokeWidth={2.2} />
          {item.names.map((n) => (
            <span key={n} className="x-windows-chip">
              <StateMark state="running" />
              {n}
            </span>
          ))}
          <span>{item.line}</span>
        </div>
      );
    case 'running':
      return (
        <div className="x-windows-live" role="status">
          <div className="x-windows-live-head">
            <StateMark state="running" />
            <span className="x-windows-mono" style={{ fontWeight: 600 }}>
              {item.command}
            </span>
            <span className="x-windows-num">{clock(item.seconds)}</span>
          </div>
          <ol className="x-windows-mono">
            {item.tail.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </div>
      );
  }
}

function Transcript() {
  const shell = useShell();
  const scroller = useRef<HTMLDivElement>(null);
  // A session opens at its latest turn; `x=top` shows the start, for the scrolled reading.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = shell.flag('top') ? 0 : el.scrollHeight;
  }, [shell]);
  const firstTools = transcript.findIndex((t) => t.kind === 'tools');
  return (
    <Glass id="x-windows-session" role="window" label="Rate limiter rewrite" className="x-windows-session" radius={28}>
      <div className="x-windows-plate" aria-hidden="true" />
      <div className="x-windows-body">
        <div className="x-windows-scroll" ref={scroller} tabIndex={0}>
          <div className="x-windows-thread">
            {transcript.map((item, i) => (
              <Item key={i} item={item} firstTools={i === firstTools} />
            ))}
          </div>
        </div>
      </div>
    </Glass>
  );
}

/** The composer's facts, folded into one pill: only the model shows at rest, the rest opens from it. */
function ComposerMenu() {
  const shell = useShell();
  const rows: [string, string][] = [
    ['Model', composer.model],
    ['Effort', composer.effort],
    ['Mode', composer.mode],
    ['Folder', composer.folder],
    ['Branch', composer.branch],
  ];
  const [open, setOpen] = useState(false);
  const auto = shell.flag('menu');
  useEffect(() => {
    if (!auto) return;
    const t = window.setTimeout(() => setOpen(true), 500);
    return () => window.clearTimeout(t);
  }, [auto]);
  return (
    <GlassMenu open={open} onOpenChange={setOpen} presentation="attached" groupProps={{ id: 'x-windows-menu', backdrop: ENV }}>
      <GlassMenuTrigger surface="fill" className="x-windows-pill">
        {composer.model}
        <ChevronDown size={13} strokeWidth={2.6} />
      </GlassMenuTrigger>
      <GlassMenuContent placement="top-start" gap={12} radius={22} aria-label="Session options" className="x-windows-menu x-windows-ink">
        {rows.map(([k, v]) => (
          <GlassMenuItem key={k} textValue={k}>
            <span className="x-windows-menu-row">
              <span>{k}</span>
              <span className={`x-windows-menu-end ${k === 'Branch' ? 'x-windows-mono' : ''}`}>{v}</span>
            </span>
          </GlassMenuItem>
        ))}
      </GlassMenuContent>
    </GlassMenu>
  );
}

function ContextRing({ value }: { value: number }) {
  const c = 2 * Math.PI * 6.5;
  return (
    <span className="x-windows-context" aria-label={`${Math.round(value * 100)}% of the context window used`}>
      <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true">
        <circle cx="8.5" cy="8.5" r="6.5" />
        <circle cx="8.5" cy="8.5" r="6.5" strokeDasharray={c} strokeDashoffset={c * (1 - value)} transform="rotate(-90 8.5 8.5)" />
      </svg>
      <span className="x-windows-num">{Math.round(value * 100)}% context</span>
    </span>
  );
}

function Composer() {
  return (
    <Glass id="x-windows-composer" role="ornament" label="Composer" className="x-windows-composer" radius={28} plane="overlay">
      <div className="x-windows-composer-body">
        <div className="x-windows-queued-row">
          <span className="x-windows-queued">
            <span className="x-windows-queued-mark">Queued</span>
            <span className="x-windows-clip">{composer.queued}</span>
          </span>
        </div>
        <textarea className="x-windows-input" placeholder={composer.placeholder} rows={1} aria-label="Message" />
        <div className="x-windows-composer-row">
          <ComposerMenu />
          <span className="x-windows-spacer" />
          <ContextRing value={composer.context} />
          <button className="x-windows-send" data-kind="ink" aria-label="Stop the turn">
            <Square size={12} strokeWidth={0} fill="currentColor" />
          </button>
        </div>
      </div>
    </Glass>
  );
}

function SideColumn() {
  const shell = useShell();
  const o = overview;
  return (
    <Glass id="x-windows-side" role="window" label="Overview" className="x-windows-side" radius={28}>
      <div className="x-windows-body">
        <div className="x-windows-scroll">
          <div className="x-windows-side-pad">
            <div className="x-windows-side-head">
              <GitBranch size={15} strokeWidth={2.2} />
              <span className="x-windows-mono">{o.branch}</span>
              <button className="x-windows-round" aria-label="Hide the side column" onClick={() => shell.setSide(false)}>
                <PanelRight size={16} strokeWidth={2.2} />
              </button>
            </div>

            <section className="x-windows-sec" aria-label="Changed files">
              <h3 className="x-windows-kicker x-windows-kicker-split">
                <span>Changes</span>
                <span className="x-windows-delta x-windows-num">
                  <span className="x-windows-add">+{o.added}</span>
                  <span className="x-windows-del">−{o.removed}</span>
                </span>
              </h3>
              {o.files.map((f) => {
                const cut = f.path.lastIndexOf('/') + 1;
                return (
                  <button key={f.path} className="x-windows-file">
                    <span className="x-windows-mono x-windows-clip">
                      <span className="x-windows-dir">{f.path.slice(0, cut)}</span>
                      {f.path.slice(cut)}
                    </span>
                    <span className="x-windows-delta x-windows-num">
                      <span className="x-windows-add">+{f.added}</span>
                      {f.removed > 0 && <span className="x-windows-del">−{f.removed}</span>}
                    </span>
                  </button>
                );
              })}
            </section>

            <section className="x-windows-sec" aria-label="To do">
              <h3 className="x-windows-kicker">To do</h3>
              {o.todos.map((t) => (
                <div key={t.text} className="x-windows-todo" data-done={t.done} data-current={'current' in t && t.current}>
                  <span className="x-windows-tick">{t.done && <Check size={11} strokeWidth={3.6} />}</span>
                  <span>{t.text}</span>
                </div>
              ))}
            </section>

            <section className="x-windows-sec" aria-label="Agents">
              <h3 className="x-windows-kicker">Agents</h3>
              {o.agents.map((a) => (
                <div key={a.name} className="x-windows-agent">
                  {a.state === 'running' ? (
                    <StateMark state="running" />
                  ) : (
                    <span className="x-windows-tick" data-done="true">
                      <Check size={11} strokeWidth={3.6} />
                    </span>
                  )}
                  <div>
                    <span>{a.name}</span>
                    <small>{a.line}</small>
                  </div>
                </div>
              ))}
            </section>

            <section className="x-windows-sec" aria-label="Background">
              <h3 className="x-windows-kicker">Background</h3>
              {o.background.map((b) => (
                <div key={b.label} className="x-windows-agent">
                  <StateMark state="running" />
                  <div>
                    <span className="x-windows-mono" style={{ fontWeight: 600 }}>
                      {b.label}
                    </span>
                    <small className="x-windows-num">{b.line}</small>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </div>
      </div>
    </Glass>
  );
}

export function Session() {
  return (
    <>
      <TopBar mode="session" />
      <Transcript />
      <SideColumn />
      <Composer />
    </>
  );
}
