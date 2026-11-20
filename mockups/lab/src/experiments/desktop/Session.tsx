// The session in depth: tabs, transcript, composer and the side card. All of it is opaque.
import { ArrowUp, ChevronRight, FileCode, GitBranch, Plus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { approval, composer, overview, tabs, transcript, type SessionState, type TranscriptItem } from '../../content/fixtures';
import s from './desktop.module.css';
import { needsYou, StateMark } from './Pane';
import { CheckGlyph, clock, MenuItem, Popover, Ring, Spinner, useMenu } from './ui';

// ---- Tabs and the waiting approval ------------------------------------------------------------------------------

function Tabs({ resolved }: { resolved: boolean }) {
  return (
    <div className={s.tabs} role="tablist" aria-label="Open tabs">
      {tabs.map((t) => {
        const state: SessionState | undefined = 'state' in t ? (resolved && t.state === 'approval' ? 'running' : t.state) : undefined;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={'active' in t && t.active} className={s.tab} data-file={t.kind === 'file' || undefined} data-needs={(state && needsYou(state)) || undefined}>
            <span className={s.tabMark}>{state ? <StateMark state={state} /> : <FileCode size={13} strokeWidth={1.7} />}</span>
            <span className={s.tabTitle}>{t.title}</span>
            <span className={s.tabClose} aria-hidden="true">
              <X size={11} strokeWidth={2} />
            </span>
          </button>
        );
      })}
      <button type="button" className={s.iconButton} aria-label="New tab">
        <Plus size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
}

function Approval({ outcome, onOutcome }: { outcome: 'waiting' | 'approved' | 'denied'; onOutcome: (o: 'approved' | 'denied') => void }) {
  const menu = useMenu();
  return (
    <>
      <button
        type="button"
        className={s.waiting}
        data-gone={outcome !== 'waiting' || undefined}
        aria-haspopup="dialog"
        aria-expanded={menu.id === 'approval'}
        tabIndex={outcome === 'waiting' ? 0 : -1}
        onClick={(e) => menu.toggle('approval', e.currentTarget)}
      >
        <span className={s.dotNeeds} />
        <span className={s.waitingTitle}>{approval.title}</span>
      </button>
      <Popover id="approval" place="below-end" width={348} label={approval.title} role="dialog">
        <div className={s.ask}>
          <div className={s.askFrom}>
            <span>{approval.session}</span>
            <span>{approval.waited}</span>
          </div>
          <div className={s.askTitle}>{approval.title}</div>
          <code className={s.askCommand}>{approval.command}</code>
          <p className={s.askWhy}>{approval.why}</p>
          <div className={s.askActions}>
            <button
              type="button"
              className={s.button}
              onClick={() => {
                menu.close();
                onOutcome('denied');
              }}
            >
              Deny
            </button>
            <button
              type="button"
              className={s.button}
              data-primary
              onClick={() => {
                menu.close();
                onOutcome('approved');
              }}
            >
              Approve
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}

// ---- Transcript -------------------------------------------------------------------------------------------------

function Fold({ summary, seconds, children }: { summary: string; seconds: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.item}>
      <button type="button" className={s.quiet} data-fold aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{summary}</span>
        <ChevronRight size={12} strokeWidth={2} className={s.quietChevron} />
        <span className={s.quietAside}>{clock(seconds)}</span>
      </button>
      <div className={s.fold} data-open={open || undefined}>
        <div className={s.foldInner}>{children}</div>
      </div>
    </div>
  );
}

function Running({ item }: { item: Extract<TranscriptItem, { kind: 'running' }> }) {
  const [seconds, setSeconds] = useState(item.seconds);
  useEffect(() => {
    const t = window.setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className={s.block} data-live>
      <div className={s.blockHead}>
        <Spinner size={13} />
        <code className={s.blockTitle}>{item.command}</code>
        <span className={s.blockAside}>{clock(seconds)}</span>
      </div>
      <div className={s.tail}>
        {item.tail.map((line) => {
          const done = line.startsWith('✓');
          return (
            <div key={line} className={s.tailLine} data-now={!done || undefined}>
              <span className={s.tailMark}>{done ? <CheckGlyph size={11} /> : <span className={s.pulse} />}</span>
              {line.slice(2)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className={s.item} data-kind="user">
          <div className={s.bubble}>{item.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className={s.item} data-kind="assistant">
          {item.paragraphs.map((p) => (
            <p key={p} className={s.prose}>
              {p}
            </p>
          ))}
        </div>
      );
    case 'thought':
      return (
        <div className={s.item}>
          <div className={s.quiet} title={`Thought for ${clock(item.seconds)}`}>
            <span>{item.summary}</span>
            <span className={s.quietAside}>{clock(item.seconds)}</span>
          </div>
        </div>
      );
    case 'tools':
      return (
        <Fold summary={item.summary} seconds={item.seconds}>
          <div className={s.calls}>
            {item.calls.map((c) => (
              <div key={c.tool + c.target} className={s.call}>
                <span className={s.callTool}>{c.tool}</span>
                <code className={s.callTarget}>{c.target}</code>
                {c.detail && <span className={s.callDetail}>{c.detail}</span>}
              </div>
            ))}
          </div>
        </Fold>
      );
    case 'edit': {
      const cut = item.file.lastIndexOf('/');
      return (
        <div className={s.item}>
          <div className={s.block}>
            <div className={s.blockHead}>
              <span className={s.blockTitle} data-plain>
                {item.file.slice(cut + 1)}
              </span>
              <span className={s.blockPath}>{item.file.slice(0, cut)}</span>
              <span className={s.blockAside}>
                <Counts added={item.added} removed={item.removed} />
              </span>
            </div>
            <pre className={s.diff}>
              {item.lines.map((l, i) => (
                <div key={i} className={s.diffLine} data-sign={l.sign}>
                  <span className={s.diffSign}>{l.sign}</span>
                  {l.text}
                </div>
              ))}
            </pre>
          </div>
        </div>
      );
    }
    case 'agents':
      return (
        <div className={s.item}>
          <div className={s.quiet} data-agents>
            {item.names.map((n) => (
              <span key={n} className={s.agentChip}>
                <Spinner size={12} />
                {n}
              </span>
            ))}
            <span>{item.line}</span>
          </div>
        </div>
      );
    case 'running':
      return (
        <div className={s.item}>
          <Running item={item} />
        </div>
      );
  }
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className={s.counts}>
      {added > 0 && <span data-sign="+">+{added}</span>}
      {removed > 0 && <span data-sign="-">−{removed}</span>}
    </span>
  );
}

function Transcript() {
  const ref = useRef<HTMLDivElement>(null);
  // A live session rests at its newest line.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  return (
    <div ref={ref} className={s.scroll} data-edge="both">
      <div className={s.column}>
        {transcript.map((item, i) => (
          <Item key={i} item={item} />
        ))}
      </div>
    </div>
  );
}

// ---- Composer ---------------------------------------------------------------------------------------------------

export function Composer({ running, queued }: { running: boolean; queued?: string }) {
  const menu = useMenu();
  const [text, setText] = useState('');
  const [queue, setQueue] = useState(queued);
  const send = text.trim().length > 0 || !running;
  return (
    <div className={s.composer}>
      <div className={s.queued} data-open={queue ? true : undefined}>
        <div className={s.foldInner}>
          <div className={s.queuedRow}>
            <span className={s.queuedLabel}>Queued</span>
            <span className={s.queuedText}>{queue ?? queued}</span>
            <button type="button" className={s.iconButton} data-small aria-label="Remove the queued message" onClick={() => setQueue(undefined)}>
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
      <textarea className={s.input} rows={1} placeholder={composer.placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
      <div className={s.composerBar}>
        <button type="button" className={s.iconButton} aria-label="Attach">
          <Plus size={16} strokeWidth={1.8} />
        </button>
        <button type="button" className={s.chip} aria-haspopup="menu" aria-expanded={menu.id === 'model'} onClick={(e) => menu.toggle('model', e.currentTarget)}>
          {composer.model}
          <span className={s.chipQuiet}>{composer.effort}</span>
        </button>
        <span className={s.composerSpace} />
        {running && (
          <span className={s.context} title={`${Math.round(composer.context * 100)}% of the context window is in use`}>
            <Ring size={16} stroke={2.2} value={composer.context} />
          </span>
        )}
        <button type="button" className={s.send} data-stop={!send || undefined} aria-label={send ? (running ? 'Queue this message' : 'Send') : 'Stop'}>
          {send ? <ArrowUp size={16} strokeWidth={2.2} /> : <span className={s.stopSquare} />}
        </button>
      </div>
      <Popover id="model" place="above-start" width={220} label="Model, effort and mode">
        <MenuItem trailing={composer.model}>Model</MenuItem>
        <MenuItem trailing={composer.effort}>Effort</MenuItem>
        <MenuItem trailing={composer.mode}>Mode</MenuItem>
      </Popover>
    </div>
  );
}

// ---- Side card --------------------------------------------------------------------------------------------------

function Side() {
  return (
    <aside className={s.side} aria-label="Session overview">
      <div className={s.sideHead}>
        <GitBranch size={14} strokeWidth={1.8} />
        <span className={s.sideBranch}>{overview.branch}</span>
        <Counts added={overview.added} removed={overview.removed} />
      </div>
      <div className={s.sideScroll}>
        <div className={s.sideGroup}>
          {overview.files.map((f) => {
            const cut = f.path.lastIndexOf('/');
            return (
              <button type="button" key={f.path} className={s.sideRow} title={f.path}>
                <span className={s.sideName}>{f.path.slice(cut + 1)}</span>
                <span className={s.sideDir}>{f.path.slice(0, cut)}</span>
                <Counts added={f.added} removed={f.removed} />
              </button>
            );
          })}
        </div>
        <div className={s.sideGroup}>
          <div className={s.heading}>Agents</div>
          {overview.agents.map((a) => (
            <div key={a.name} className={s.sideRow} data-two>
              <span className={s.sideMark} data-done={a.state === 'done' || undefined}>
                {a.state === 'running' ? <Spinner size={13} /> : <CheckGlyph size={11} />}
              </span>
              <span className={s.sideText}>
                <span className={s.sideName}>{a.name}</span>
                <span className={s.sideLine}>{a.line}</span>
              </span>
            </div>
          ))}
        </div>
        <div className={s.sideGroup}>
          <div className={s.heading}>Background</div>
          {overview.background.map((b) => (
            <div key={b.label} className={s.sideRow}>
              <span className={s.sideMark}>
                <Spinner size={13} />
              </span>
              <code className={s.sideCode}>{b.label}</code>
              <span className={s.sideAside}>{b.line}</span>
            </div>
          ))}
        </div>
        <div className={s.sideGroup}>
          <div className={s.heading}>To do</div>
          {overview.todos.map((t) => (
            <div key={t.text} className={s.todo} data-done={t.done || undefined} data-now={('current' in t && t.current) || undefined}>
              <span className={s.todoMark}>{t.done && <CheckGlyph size={10} />}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function SessionScene({ outcome, onOutcome }: { outcome: 'waiting' | 'approved' | 'denied'; onOutcome: (o: 'approved' | 'denied') => void }) {
  return (
    <div className={s.session}>
      <div className={s.center}>
        <div className={s.band}>
          <Tabs resolved={outcome === 'approved'} />
          <Approval outcome={outcome} onOutcome={onOutcome} />
        </div>
        <Transcript />
        <div className={s.dock}>
          <Composer running queued={composer.queued} />
        </div>
      </div>
      <Side />
    </div>
  );
}

export function HomeScene() {
  return (
    <div className={s.session} data-home>
      <div className={s.center}>
        <div className={s.band} />
        <div className={s.home}>
          <div className={s.homeWhere}>
            <span className={s.homeFolder}>{composer.folder}</span>
            <span className={s.homeBranch}>
              <GitBranch size={12} strokeWidth={1.8} />
              {composer.branch}
            </span>
          </div>
          <Composer running={false} />
        </div>
      </div>
    </div>
  );
}
