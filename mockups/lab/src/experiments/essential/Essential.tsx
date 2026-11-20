import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  File,
  LayoutGrid,
  PanelLeft,
  PanelRight,
  Pin,
  Plus,
  Settings as Gear,
  Shapes,
  SlidersHorizontal,
  Square,
  SquarePen,
  X,
} from 'lucide-react';
import type { ExperimentProps, SceneId } from '../../lab/types';
import {
  approval,
  composer,
  destinations,
  overview,
  pinned,
  projects,
  settingsNav,
  settingsSections,
  tabs,
  transcript,
  usage,
  type Project,
  type Session,
  type SessionState,
  type Setting,
  type TranscriptItem,
} from '../../content/fixtures';
import { Dial, Lights, Mark, Member, Segmented, Select, Switch, useDismiss, type MarkKind } from './parts';
import './essential.css';

// The ground is the only value a knob changes; every other colour is the ink at an alpha of it, or mixed with it.
const LIGHT: Record<string, string> = { white: '#ffffff', paper: '#faf9f5' };
const DARK: Record<string, string> = { '191919': '#191919', '1f1f1f': '#1f1f1f', '000000': '#000000', '191c19': '#191c19' };

type Words = 'none' | 'needs' | 'all';
type StateOf = (s: Session) => SessionState;

const waits = (s: SessionState) => s === 'approval' || s === 'question' || s === 'plan';
const markOf = (s: SessionState): MarkKind => (waits(s) ? 'turn' : s === 'running' ? 'run' : s === 'unread' ? 'dot' : 'none');
/** The state in words, for assistive technology only: on screen the mark says it. */
const stateWord: Record<SessionState, string | undefined> = {
  running: 'Working',
  approval: 'Waiting for your approval',
  question: 'Waiting for your answer',
  plan: 'Waiting for your review',
  unread: 'Finished, not seen yet',
  idle: undefined,
};
const everySession: Session[] = [...pinned, ...projects.flatMap((p) => p.sessions)];
const sessionById = new Map(everySession.map((s) => [s.id, s]));

const dur = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);
const delta = (added: number, removed: number) => [added ? `+${added}` : '', removed ? `−${removed}` : ''].filter(Boolean).join(' ');

/** Move between this experiment's scenes by rewriting the lab's route, so the gear, Back and New chat are real. */
function go(scene: SceneId) {
  const [path = '', query] = window.location.hash.replace(/^#\/?/, '').split('?');
  const exp = path.split('/')[0];
  window.location.hash = `#/${exp}/${scene}${query ? `?${query}` : ''}`;
}

function Path({ p }: { p: string }) {
  const cut = p.lastIndexOf('/') + 1;
  return (
    <span className="path mono">
      <span className="dir">{p.slice(0, cut)}</span>
      <span>{p.slice(cut)}</span>
    </span>
  );
}

// ---- The card beside a row --------------------------------------------------------------------------------------
// What a row does not print at rest lives here: one card, placed beside whichever row or tab is pointed at.

interface CardAt {
  s: Session;
  x: number;
  y: number;
  at: 'right' | 'below';
}

function useCard(root: RefObject<HTMLDivElement | null>) {
  const [open, setOpen] = useState<CardAt | null>(null);
  const [held, setHeld] = useState(false);
  const last = useRef<CardAt | null>(null);
  const timer = useRef(0);
  if (open) last.current = open;

  const place = (s: Session, el: HTMLElement, at: CardAt['at']): CardAt => {
    const r = el.getBoundingClientRect();
    const b = root.current!.getBoundingClientRect();
    if (at === 'below') return { s, at, x: Math.min(r.left - b.left, b.width - 336), y: r.bottom - b.top + 8 };
    return { s, at, x: r.right - b.left + 12, y: Math.min(r.top - b.top - 8, b.height - 264) };
  };
  const enter = (s: Session, el: HTMLElement, at: CardAt['at']) => {
    window.clearTimeout(timer.current);
    if (held) return;
    timer.current = window.setTimeout(() => setOpen(place(s, el, at)), open ? 80 : 380);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    if (held) return;
    timer.current = window.setTimeout(() => setOpen(null), 160);
  };
  const stay = () => window.clearTimeout(timer.current);
  const toggle = (s: Session, el: HTMLElement, at: CardAt['at']) => {
    window.clearTimeout(timer.current);
    if (held && open?.s.id === s.id) {
      setOpen(null);
      setHeld(false);
    } else {
      setOpen(place(s, el, at));
      setHeld(true);
    }
  };
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(null);
    setHeld(false);
  }, []);
  return { open: open !== null, held, shown: open ?? last.current, enter, leave, stay, toggle, close };
}
type Card = ReturnType<typeof useCard>;

function CardView({ card, stateOf, onAnswer }: { card: Card; stateOf: StateOf; onAnswer: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { held, close } = card;
  useEffect(() => {
    if (!held) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest('[data-card]')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [held, close]);

  const at = card.shown;
  const s = at?.s;
  const request = s && s.title === approval.session && stateOf(s) === 'approval';
  return (
    <div
      ref={ref}
      className="pop card"
      data-open={card.open}
      data-at={at?.at}
      style={at ? { left: at.x, top: at.y } : undefined}
      onMouseEnter={card.stay}
      onMouseLeave={card.leave}
      role={request ? 'dialog' : 'tooltip'}
      aria-label={s?.title}
    >
      {/* The row or tab the card sits beside already prints the title, so the card does not repeat it. */}
      {s && request && (
        <>
          <div className="card-title">{approval.title}</div>
          <pre className="cmd mono">{approval.command}</pre>
          <p className="dim">{approval.why}</p>
          <div className="card-acts">
            <span className="grow dim">{at?.at === 'below' && approval.waited}</span>
            <button type="button" className="btn ring" onClick={onAnswer}>
              Deny
            </button>
            <button type="button" className="btn accent" onClick={onAnswer}>
              Approve
            </button>
          </div>
        </>
      )}
      {s && !request && (
        <>
          <p>{stateOf(s) === s.state ? s.line : stateWord[stateOf(s)]}</p>
          {/* A row prints its own age when pointed at; a tab does not, so only the card under a tab carries it. */}
          {(s.branch || s.machine || at?.at === 'below') && (
            <p className="dim meta">
              {s.branch && <span className="mono">{s.branch}</span>}
              {s.machine && <span>{s.machine}</span>}
              {at?.at === 'below' && <span>{s.age}</span>}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---- Sidebar ----------------------------------------------------------------------------------------------------

const destinationIcon = { compose: SquarePen, grid: LayoutGrid, shapes: Shapes, sliders: SlidersHorizontal } as const;

function SessionRow({ s, stateOf, selected, words, card }: { s: Session; stateOf: StateOf; selected: boolean; words: Words; card: Card }) {
  const state = stateOf(s);
  const two = words === 'all' || (words === 'needs' && waits(state));
  return (
    <button
      type="button"
      className="row"
      data-card
      data-selected={selected}
      data-foryou={waits(state) || state === 'unread'}
      data-two={two}
      onMouseEnter={(e) => card.enter(s, e.currentTarget, 'right')}
      onMouseLeave={card.leave}
      onClick={(e) => card.toggle(s, e.currentTarget, 'right')}
    >
      <span className="slot">
        {s.pinned && state === 'idle' ? <Pin size={12} strokeWidth={1.5} className="faint" aria-label="Pinned" /> : <Mark kind={markOf(state)} label={stateWord[state]} />}
      </span>
      <span className="text">
        <span className="head">
          <span className="title">{s.title}</span>
          <span className="trail">{s.age}</span>
        </span>
        {two && <span className="line">{state === s.state ? s.line : stateWord[state]}</span>}
      </span>
    </button>
  );
}

function ProjectGroup({ p, stateOf, scene, words, card }: { p: Project; stateOf: StateOf; scene: SceneId; words: Words; card: Card }) {
  const [open, setOpen] = useState(p.open);
  const waiting = !open && p.sessions.some((s) => waits(stateOf(s)));
  return (
    <div className="group" data-open={open}>
      <button type="button" className="proj" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="grow">{p.name}</span>
        {waiting ? <Mark kind="turn" label="A session here waits for you" /> : <ChevronRight size={14} strokeWidth={1.5} className="chev" />}
      </button>
      <div className="fold">
        <div>
          {p.sessions.map((s) => (
            <SessionRow key={s.id} s={s} stateOf={stateOf} selected={scene === 'session' && s.id === 's1'} words={words} card={card} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Sidebar({ scene, words, stateOf, card }: { scene: SceneId; words: Words; stateOf: StateOf; card: Card }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <nav className="list" aria-label="Sessions">
        <div className="group">
          {destinations.map((d) => {
            const Icon = destinationIcon[d.icon];
            return (
              <button type="button" className="row" key={d.id} data-selected={scene === 'home' && d.id === 'new'} onClick={d.id === 'new' ? () => go('home') : undefined}>
                <span className="slot">
                  <Icon size={16} strokeWidth={1.5} />
                </span>
                <span className="text">
                  <span className="head">
                    <span className="title">{d.label}</span>
                    {'shortcut' in d && <span className="trail">{d.shortcut}</span>}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="group">
          {pinned.map((s) => (
            <SessionRow key={s.id} s={s} stateOf={stateOf} selected={false} words={words} card={card} />
          ))}
        </div>
        {projects.map((p) => (
          <ProjectGroup key={p.id} p={p} stateOf={stateOf} scene={scene} words={words} card={card} />
        ))}
      </nav>
      <div className="foot">
        <button
          type="button"
          className="icon"
          data-tip={`${pct(usage.fiveHour)} of five hours\n${pct(usage.week)} of the week\nResets in ${usage.resetsIn}`}
          data-tip-at="above-start"
          aria-label={`Usage: ${pct(usage.fiveHour)} of five hours, ${pct(usage.week)} of the week, resets in ${usage.resetsIn}`}
        >
          <Dial inner={usage.fiveHour} outer={usage.week} />
        </button>
        <span className="grow" />
        <button type="button" className="icon" aria-label="Settings" onClick={() => go('settings')}>
          <Gear size={16} strokeWidth={1.5} />
        </button>
      </div>
    </>
  );
}

function SettingsNav({ current, onPick }: { current: string; onPick: (title: string) => void }) {
  return (
    <nav className="list" aria-label="Settings">
      <div className="group">
        <button type="button" className="row back" onClick={() => go('session')}>
          <span className="slot">
            <ArrowLeft size={16} strokeWidth={1.5} />
          </span>
          <span className="text">
            <span className="title">Settings</span>
          </span>
        </button>
      </div>
      <div className="group">
        {settingsNav.map((n) => (
          <button type="button" className="row plain" key={n} data-selected={n === current} aria-current={n === current} onClick={() => onPick(n)}>
            <span className="text">
              <span className="title">{n}</span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ---- Tabs -------------------------------------------------------------------------------------------------------

function Tabs({ scene, stateOf, card }: { scene: SceneId; stateOf: StateOf; card: Card }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => {
        const s = sessionById.get(t.id);
        const active = scene === 'session' && 'active' in t && t.active === true;
        const state = s ? stateOf(s) : undefined;
        const peek = s && !active ? s : undefined;
        return (
          <button
            type="button"
            role="tab"
            key={t.id}
            className="tab"
            aria-selected={active}
            data-card={peek ? '' : undefined}
            onMouseEnter={peek ? (e) => card.enter(peek, e.currentTarget, 'below') : undefined}
            onMouseLeave={peek ? card.leave : undefined}
            onClick={peek ? (e) => card.toggle(peek, e.currentTarget, 'below') : undefined}
          >
            <span className="slot">
              <span className="at-rest">{state ? <Mark kind={markOf(state)} label={stateWord[state]} /> : <File size={14} strokeWidth={1.5} className="faint" />}</span>
              <X size={14} strokeWidth={1.5} className="close" />
            </span>
            <span className="title">{t.title}</span>
          </button>
        );
      })}
      {scene === 'home' && (
        <button type="button" role="tab" className="tab" aria-selected>
          <span className="title">{destinations[0].label}</span>
        </button>
      )}
      <button type="button" className="icon" aria-label="New tab" onClick={() => go('home')}>
        <Plus size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}

// ---- Transcript -------------------------------------------------------------------------------------------------

function Fold({ item }: { item: Extract<TranscriptItem, { kind: 'tools' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="work toolrun" data-open={open}>
      <button type="button" className="toolrun-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {item.summary}
        <ChevronRight size={14} strokeWidth={1.5} className="chev" />
        <span className="secs">{dur(item.seconds)}</span>
      </button>
      <div className="toolrun-body">
        <div>
          <div className="calls">
            {item.calls.map((c, i) => (
              <div className="call" key={i}>
                <span>{c.tool}</span>
                <span className="mono target">{c.target}</span>
                <span>{c.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return <div className="user">{item.text}</div>;
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
        <div className="work">
          {item.summary}
          <span className="secs">{dur(item.seconds)}</span>
        </div>
      );
    case 'tools':
      return <Fold item={item} />;
    case 'edit':
      return (
        <div className="edit">
          <div className="work">
            <Path p={item.file} />
            <span className="delta">{delta(item.added, item.removed)}</span>
          </div>
          <div className="code mono">
            {item.lines.map((l, i) => (
              <div className="ln" key={i}>
                <span className="sign">{l.sign === '-' ? '−' : l.sign}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case 'agents':
      return (
        <div className="work">
          <span className="ink">{item.names.join(' and ')}</span> {item.line}
        </div>
      );
    case 'running':
      return (
        <div className="code mono live">
          <div className="live-head">
            <Mark kind="run" label="Working" />
            <span className="grow ink">{item.command}</span>
            <span className="dim">{dur(item.seconds)}</span>
          </div>
          {item.tail.map((t) => (
            <div className="tail" key={t}>
              {t}
            </div>
          ))}
        </div>
      );
  }
}

function Transcript() {
  const ref = useRef<HTMLDivElement>(null);
  // A session that is working is read from its latest line.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  return (
    <div className="scroll" ref={ref}>
      <div className="col thread">
        {transcript.map((item, i) => (
          <Item key={i} item={item} />
        ))}
      </div>
    </div>
  );
}

// ---- Composer ---------------------------------------------------------------------------------------------------

function Composer({ home = false }: { home?: boolean }) {
  const [text, setText] = useState('');
  const [queued, setQueued] = useState<string | null>(home ? null : composer.queued);
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [folder, setFolder] = useState(composer.folder);
  const menuRef = useDismiss(menu, () => setMenu(false));
  const pickerRef = useDismiss(picker, () => setPicker(false));
  const send = () => {
    if (!text.trim()) return;
    if (!home) setQueued(text.trim());
    setText('');
  };
  return (
    <div className="col dock">
      {queued && (
        // Hollow means not yet: a queued message is an outline until the agent takes it, then it is a solid bubble.
        <div className="queued">
          <span>{queued}</span>
          <button type="button" aria-label="Remove the queued message" onClick={() => setQueued(null)}>
            <X size={12} strokeWidth={1.75} />
          </button>
        </div>
      )}
      <div className="composer">
        <textarea
          rows={1}
          aria-label="Message"
          placeholder={home ? undefined : composer.placeholder}
          value={text}
          autoFocus={home}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="tools">
          {home && (
            <div className="anchor" ref={pickerRef}>
              <button type="button" className="btn quiet" aria-haspopup="listbox" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>
                {folder}
                <ChevronDown size={14} strokeWidth={1.5} />
              </button>
              <div className="pop menu above" role="listbox" data-open={picker}>
                {projects.map((p) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={p.name === folder}
                    className="item"
                    key={p.id}
                    onClick={() => {
                      setFolder(p.name);
                      setPicker(false);
                    }}
                  >
                    <span className="grow">{p.name}</span>
                    {p.name === folder && <Mark kind="done" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="anchor" ref={menuRef}>
            <button type="button" className="btn quiet" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
              {composer.model}
              <ChevronDown size={14} strokeWidth={1.5} />
            </button>
            <div className="pop menu above wide" role="menu" data-open={menu}>
              {(
                [
                  ['Model', composer.model],
                  ['Effort', composer.effort],
                  ['Mode', composer.mode],
                ] as const
              ).map(([k, v]) => (
                <button type="button" role="menuitem" className="item" key={k}>
                  <span className="grow dim">{k}</span>
                  <span>{v}</span>
                  <ChevronRight size={14} strokeWidth={1.5} className="faint" />
                </button>
              ))}
              {!home && (
                <>
                  <div className="item still">
                    <span className="grow dim">Context</span>
                    <span>{Math.round(composer.context * 100)}%</span>
                    <Mark kind="level" value={composer.context} />
                  </div>
                  <hr />
                  <div className="item still">
                    <span className="grow dim">{composer.folder}</span>
                    <span className="mono dim">{composer.branch}</span>
                  </div>
                </>
              )}
            </div>
          </div>
          <span className="grow" />
          {text.trim() || home ? (
            <button type="button" className="send" aria-label="Send" disabled={!text.trim()} onClick={send}>
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          ) : (
            <button type="button" className="send stop" aria-label="Stop">
              <Square size={10} strokeWidth={0} fill="currentColor" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Side column ------------------------------------------------------------------------------------------------

function Aside({ words }: { words: Words }) {
  return (
    <div className="aside-in">
      <section>
        <h3>Tasks</h3>
        {overview.todos.map((t) => (
          <div className="trow" key={t.text} data-done={t.done}>
            <Mark kind={t.done ? 'done' : 'current' in t && t.current ? 'run' : 'ring'} label={t.done ? 'Done' : 'current' in t && t.current ? 'Working' : 'Not started'} />
            <span>{t.text}</span>
          </div>
        ))}
      </section>
      <section>
        <h3>Activity</h3>
        {overview.agents.map((a) => (
          <div className="trow" key={a.name} data-done={a.state === 'done'} data-tip={words === 'all' ? undefined : a.line} data-tip-at="above-start" tabIndex={0}>
            <Mark kind={a.state === 'running' ? 'run' : 'done'} label={a.state === 'running' ? 'Working' : 'Done'} />
            <span>
              {a.name}
              {words === 'all' && <span className="sub">{a.line}</span>}
            </span>
          </div>
        ))}
        {overview.background.map((b) => (
          <div className="trow" key={b.label} data-tip={words === 'all' ? undefined : b.line} data-tip-at="above-start" tabIndex={0}>
            <Mark kind="run" label="Working" />
            <span>
              <span className="mono">{b.label}</span>
              {words === 'all' && <span className="sub">{b.line}</span>}
            </span>
          </div>
        ))}
      </section>
      <section>
        <h3>
          <span className="grow">Changes</span>
          <span className="delta">{delta(overview.added, overview.removed)}</span>
        </h3>
        <div className="frow">
          <span className="mono dim">{overview.branch}</span>
        </div>
        {overview.files.map((f) => (
          <div className="frow" key={f.path}>
            <Path p={f.path} />
            <span className="delta">{delta(f.added, f.removed)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

// ---- Settings ---------------------------------------------------------------------------------------------------

function SwitchCtl({ label, on }: { label: string; on: boolean }) {
  const [v, setV] = useState(on);
  return <Switch on={v} onChange={setV} label={label} />;
}
function SegCtl({ label, options, value }: { label: string; options: string[]; value: string }) {
  const [v, setV] = useState(value);
  return <Segmented options={options} value={v} onChange={setV} label={label} />;
}
function SelectCtl({ label, options, value }: { label: string; options: string[]; value: string }) {
  const [v, setV] = useState(value);
  return <Select options={options} value={v} onChange={setV} label={label} />;
}
function MembersCtl({ items }: { items: { label: string; on: boolean }[] }) {
  const [on, setOn] = useState(() => items.map((i) => i.on));
  return (
    <div className="members">
      {items.map((it, i) => (
        <Member key={it.label} on={on[i]!} onChange={(v) => setOn((prev) => prev.map((p, j) => (j === i ? v : p)))}>
          {it.label}
        </Member>
      ))}
    </div>
  );
}

function Control({ s }: { s: Setting }) {
  const c = s.control;
  switch (c.type) {
    case 'switch':
      return <SwitchCtl label={s.label} on={c.on} />;
    case 'segmented':
      return <SegCtl label={s.label} options={c.options} value={c.value} />;
    case 'select':
      return <SelectCtl label={s.label} options={c.options} value={c.value} />;
    case 'text':
      return <input className={c.mono ? 'field mono' : 'field'} type="text" aria-label={s.label} defaultValue={c.value} placeholder={c.placeholder} spellCheck={false} />;
    case 'path':
      return (
        <>
          <span className="mono dim value" title={c.value}>
            {c.value}
          </span>
          {c.badge && <span className="badge">{c.badge}</span>}
          {c.action && (
            <button type="button" className="btn quiet">
              {c.action}
            </button>
          )}
        </>
      );
    case 'button':
      return (
        <button type="button" className="btn ring">
          {c.label}
        </button>
      );
    case 'checks':
    case 'switches':
      return <MembersCtl items={c.items} />;
  }
}

function SettingsPage({ pageRef, onSection }: { pageRef: RefObject<HTMLDivElement | null>; onSection: (title: string) => void }) {
  const onScroll = () => {
    const page = pageRef.current;
    if (!page) return;
    let current = settingsSections[0]!.title;
    for (const sec of settingsSections) {
      const el = page.querySelector<HTMLElement>(`[data-sec="${sec.id}"]`);
      if (el && el.offsetTop - page.scrollTop < 120) current = sec.title;
    }
    onSection(current);
  };
  return (
    <div className="page" ref={pageRef} onScroll={onScroll}>
      {settingsSections.map((sec) => (
        <section className="sec" key={sec.id} data-sec={sec.id} aria-label={sec.title}>
          <h2>{sec.title}</h2>
          {sec.settings.map((s) => (
            <div className="set" key={s.label}>
              {/* A button names itself, so its row prints no label. */}
              <div className="label">{s.control.type === 'button' ? '' : s.label}</div>
              <div className="control">
                <Control s={s} />
              </div>
              {s.help && <p className="note">{s.help}</p>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ---- The window -------------------------------------------------------------------------------------------------

export default function Essential({ scene, scheme, knobs }: ExperimentProps) {
  const ground = scheme === 'dark' ? (DARK[knobs.dark ?? ''] ?? DARK['191919']) : (LIGHT[knobs.light ?? ''] ?? LIGHT.white);
  const words = (['none', 'needs', 'all'].includes(knobs.words ?? '') ? knobs.words : 'needs') as Words;
  const [side, setSide] = useState(true);
  const [aside, setAside] = useState(true);
  const [answered, setAnswered] = useState(false);
  const [section, setSection] = useState(settingsSections[0]!.title);
  const root = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const card = useCard(root);

  const stateOf: StateOf = (s) => (answered && s.title === approval.session ? 'running' : s.state);
  const waiting = everySession.filter((s) => waits(stateOf(s))).length;
  const pick = (title: string) => {
    const sec = settingsSections.find((x) => x.title === title);
    const el = sec && page.current?.querySelector<HTMLElement>(`[data-sec="${sec.id}"]`);
    if (el && page.current) page.current.scrollTo({ top: el.offsetTop, behavior: 'smooth' });
  };

  return (
    <div
      ref={root}
      className="x-essential"
      data-scheme={scheme}
      data-scene={scene}
      data-words={words}
      data-corners={knobs.corners === 'tight' ? 'tight' : 'round'}
      data-side={side}
      data-aside={aside && scene === 'session'}
      style={{ '--ground': ground } as CSSProperties}
    >
      <aside className="side" aria-hidden={!side}>
        <div className="side-in">
          {scene === 'settings' ? <SettingsNav current={section} onPick={pick} /> : <Sidebar scene={scene} words={words} stateOf={stateOf} card={card} />}
        </div>
      </aside>

      <main className="main">
        <header className="bar">
          {scene !== 'settings' && <Tabs scene={scene} stateOf={stateOf} card={card} />}
          <span className="grow" />
          {scene === 'session' && (
            <button type="button" className="icon" aria-label={aside ? 'Hide the side column' : 'Show the side column'} aria-pressed={aside} onClick={() => setAside((v) => !v)}>
              <PanelRight size={16} strokeWidth={1.5} />
            </button>
          )}
        </header>
        {scene === 'session' && (
          <>
            <Transcript />
            <Composer />
          </>
        )}
        {scene === 'home' && (
          <div className="home">
            <Composer home />
          </div>
        )}
        {scene === 'settings' && <SettingsPage pageRef={page} onSection={setSection} />}
      </main>

      <aside className="aside" aria-hidden={!(aside && scene === 'session')}>
        {scene === 'session' && <Aside words={words} />}
      </aside>

      <Lights />
      <button type="button" className="icon side-toggle" aria-label={side ? 'Hide the sidebar' : 'Show the sidebar'} aria-pressed={side} onClick={() => setSide((v) => !v)}>
        <PanelLeft size={16} strokeWidth={1.5} />
        {!side && waiting > 0 && <Mark kind="turn" label={`${waiting} sessions wait for you`} />}
      </button>

      <CardView
        card={card}
        stateOf={stateOf}
        onAnswer={() => {
          setAnswered(true);
          card.close();
        }}
      />
    </div>
  );
}
