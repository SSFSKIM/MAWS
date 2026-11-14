// The session: Instrument's tab capsule, Quiet's transcript with its blocks standing on glass, the glass composer,
// Quiet's waiting capsule and approval, and the side column as separate modules.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { GlassGroup, GlassSurface } from '@vitreajs/vitrea-react';
import {
  ArrowUp, Bot, Check, ChevronDown, ChevronRight, Circle, CircleCheck, CornerDownRight, FileCode, Folder, GitBranch, LoaderCircle, Plus, SlidersHorizontal, Square, Terminal, X,
} from 'lucide-react';
import { approval, composer, overview, projects, tabs, transcript, type Session, type TranscriptItem } from '../../content/fixtures';
import type { SceneId } from '../../lab/types';
import { PLANE, THICKNESS, useGlassUnder, useKick } from './glass';
import type { Answer } from './Layers';
import { clock, cx, Fold, GBtn, Pop, Ring, split, StateGlyph, stateWord } from './parts';

// ---- Tabs: Instrument's capsule, with the marks the sidebar uses -------------------------------------------------

export function Tabs({ settings, live, go }: { settings: boolean; live: (s: Session) => Session; go: (scene: SceneId) => void }) {
  const all = projects.flatMap((p) => p.sessions);
  const list = settings ? [...tabs, { id: 'settings', title: 'Settings', kind: 'settings' as const }] : tabs;
  const [current, setCurrent] = useState(settings ? 'settings' : tabs.find((t) => 'active' in t && t.active)?.id ?? tabs[0]!.id);
  return (
    <>
      {list.map((tab) => {
        const session = all.find((s) => s.id === tab.id);
        const state = session ? live(session).state : undefined;
        return (
          <div key={tab.id} className="xl-tab" data-current={tab.id === current}>
            <button
              type="button"
              className="xl-tab-main"
              aria-current={tab.id === current ? 'page' : undefined}
              title={state ? stateWord[state] || undefined : undefined}
              onClick={() => {
                setCurrent(tab.id);
                if (settings && tab.id !== 'settings') go('session');
              }}
            >
              <span className="xl-tab-mark">
                {tab.kind === 'file' ? <FileCode size={14} strokeWidth={1.75} /> : tab.kind === 'settings' ? <SlidersHorizontal size={14} strokeWidth={1.75} /> : state ? <StateGlyph state={state} size={14} /> : null}
              </span>
              <span className="xl-tab-title">{tab.title}</span>
            </button>
            <button type="button" className="xl-tab-x" aria-label={`Close ${tab.title}`} tabIndex={-1}>
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        );
      })}
      <GBtn label="New tab" tip="New tab">
        <Plus size={16} strokeWidth={1.75} />
      </GBtn>
    </>
  );
}

// ---- The approval, Quiet's way ---------------------------------------------------------------------------------

/** The approval, wherever it is answered: the command, one sentence of why, two answers. */
export function Ask({ onAnswer }: { onAnswer: (a: Answer) => void }) {
  return (
    <div className="xl-ask">
      <div className="xl-ask-cmd">{approval.command}</div>
      <p className="xl-ask-why">{approval.why}</p>
      <div className="xl-ask-acts">
        <button type="button" className="xl-btn" onClick={() => onAnswer('denied')}>
          Deny
        </button>
        <button type="button" className="xl-btn" data-kind="go" onClick={() => onAnswer('approved')}>
          Approve
        </button>
      </div>
    </div>
  );
}

/**
 * What waits for you, as the glyphs the sidebar uses: no count, no word. It is the page's one tinted piece of glass.
 * It opens the list, with the approval answerable in place.
 */
export function Waiting({ waiting, onAnswer, open: openAtOnce, alone }: { waiting: Session[]; onAnswer: (a: Answer) => void; open?: boolean; alone?: boolean }) {
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (openAtOnce && el) setOpen(true);
  }, [openAtOnce, el]);
  return (
    <>
      <GlassSurface asChild capsule thickness={THICKNESS} tint="#fd780f" interactive>
        <button
          type="button"
          ref={setEl}
          className="xl-host xl-waiting"
          data-alone={alone}
          data-glass-role="control"
          aria-expanded={open}
          aria-label={`${waiting.length} sessions are waiting for you`}
          data-tip="Waiting for you"
          data-tip-at="end"
          onClick={() => setOpen((v) => !v)}
        >
          {waiting.map((s) => (
            <StateGlyph key={s.id} state={s.state} size={14} />
          ))}
        </button>
      </GlassSurface>
      <Pop open={open} anchor={el} place="below-end" onClose={close} className="xl-wait-list" label="Waiting for you">
        {waiting.map((s) => (
          <div key={s.id} className="xl-wait-item" data-open={s.state === 'approval'}>
            <div className="xl-wait-head">
              <StateGlyph state={s.state} />
              <div className="xl-wait-text">
                <div className="xl-card-title">{s.title}</div>
                <div className="xl-card-line">{s.state === 'approval' ? approval.title : s.line}</div>
              </div>
              <span className="xl-wait-age">{s.age}</span>
            </div>
            {s.state === 'approval' && <Ask onAnswer={onAnswer} />}
          </div>
        ))}
      </Pop>
    </>
  );
}

// ---- The transcript ----------------------------------------------------------------------------------------------

/** A transcript block that stands on glass (or on the veil, or on an opaque card, as the Blocks knob says). */
function Block({ className, radius = 18, clip, on = true, children }: { className?: string; radius?: number; clip?: HTMLElement | null; on?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGlassUnder(ref, { radius, clip, on });
  return (
    <div ref={ref} className={cx('xl-block', className)}>
      {children}
    </div>
  );
}

/** One grey caption for a run of work: Quiet's pill, with its chevron and duration under the pointer. It opens in place. */
function Folded({ caption, time, startOpen, children }: { caption: string; time?: string; startOpen?: boolean; children: (clip: HTMLElement | null, shown: boolean) => ReactNode }) {
  const [open, setOpen] = useState(!!startOpen);
  // The card's glass exists while it is open and for the length of its closing.
  const [shown, setShown] = useState(!!startOpen);
  const [clip, setClip] = useState<HTMLDivElement | null>(null);
  const kick = useKick();
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const t = window.setTimeout(() => setShown(false), 320);
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <div className="xl-folded">
      <button
        type="button"
        className="xl-cap"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          kick(520);
        }}
      >
        {caption}
        <ChevronRight className="xl-cap-chev" size={13} strokeWidth={2} />
        {time && <span className="xl-cap-time">{time}</span>}
      </button>
      <Fold open={open} clipRef={setClip}>
        {children(clip, shown)}
      </Fold>
    </div>
  );
}

function Edit({ item }: { item: Extract<TranscriptItem, { kind: 'edit' }> }) {
  const [open, setOpen] = useState(true);
  const kick = useKick();
  const [dir, name] = split(item.file);
  return (
    <Block className="xl-edit">
      <button
        type="button"
        className="xl-edit-head"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          kick(520);
        }}
      >
        <FileCode size={15} strokeWidth={1.75} />
        <span className="xl-edit-file">
          {name} <span className="xl-edit-dir">{dir.replace(/\/$/, '')}</span>
        </span>
        <span className="xl-stat">
          <span className="xl-add">+{item.added}</span>
          {item.removed > 0 && <span className="xl-del"> −{item.removed}</span>}
        </span>
      </button>
      <Fold open={open}>
        <pre className="xl-diff">
          {item.lines.map((l, i) => (
            <div key={i} className="xl-diff-line" data-sign={l.sign}>
              <i>{l.sign}</i>
              {l.text}
            </div>
          ))}
        </pre>
      </Fold>
    </Block>
  );
}

function Item({ item, open }: { item: TranscriptItem; open: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="xl-user">
          <Block className="xl-bubble" radius={22}>
            {item.text}
          </Block>
        </div>
      );
    case 'assistant':
      return (
        <div className="xl-prose">
          {item.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    case 'thought':
      return (
        <Folded caption={`Thought for ${clock(item.seconds)}`}>{() => <p className="xl-thought">{item.summary}</p>}</Folded>
      );
    case 'tools':
      return (
        <Folded caption={item.summary} time={clock(item.seconds)} startOpen={open}>
          {(clip, shown) => (
            <div className="xl-calls-wrap">
              <Block className="xl-calls" clip={clip} on={shown}>
                {item.calls.map((c, i) => (
                  <div key={i} className="xl-call">
                    <span className="xl-call-verb">{c.tool}</span>
                    <span className="xl-call-target">{c.target}</span>
                    {c.detail && <span className="xl-call-detail">{c.detail}</span>}
                  </div>
                ))}
              </Block>
            </div>
          )}
        </Folded>
      );
    case 'edit':
      return <Edit item={item} />;
    case 'agents':
      return (
        <div className="xl-folded">
          <span className="xl-cap">
            <Bot size={14} strokeWidth={1.75} />
            {item.names.join(' and ')} {item.line}
          </span>
        </div>
      );
    case 'running':
      return (
        <Block className="xl-live">
          <div className="xl-live-head">
            <i className="xl-dot" data-run="" />
            <span className="xl-live-cmd">{item.command}</span>
            <span className="xl-live-time">{clock(item.seconds)}</span>
          </div>
          <div className="xl-tail">
            {item.tail.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </Block>
      );
  }
}

export function Transcript({ open }: { open: boolean }) {
  return (
    <div className="xl-items">
      {transcript.map((item, i) => (
        <Item key={i} item={item} open={open && i === 2} />
      ))}
    </div>
  );
}

// ---- The composer: Quiet's content on glass ----------------------------------------------------------------------

export function Composer({ running, queued, fresh }: { running: boolean; queued?: boolean; fresh?: boolean }) {
  const [text, setText] = useState('');
  const [held, setHeld] = useState(!!queued);
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const typed = text.trim().length > 0;
  const kind = typed ? 'go' : running ? 'stop' : 'idle';
  return (
    <>
      {queued && (
        <Fold open={held}>
          <div className="xl-queued" title="Sends when this turn ends">
            <CornerDownRight size={13} strokeWidth={1.75} />
            <span className="xl-fade">{composer.queued}</span>
            <button type="button" className="xl-queued-x" aria-label="Remove the queued message" onClick={() => setHeld(false)}>
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        </Fold>
      )}
      <textarea className="xl-field" rows={1} placeholder={fresh ? undefined : composer.placeholder} aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="xl-tools">
        <GBtn label="Attach" tip="Attach" data-tip-at="above-start">
          <Plus size={17} strokeWidth={1.75} />
        </GBtn>
        <span className="xl-grow" />
        <button type="button" ref={setEl} className="xl-chip" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {composer.model}
          <ChevronDown size={13} strokeWidth={2} />
        </button>
        {!fresh && (
          <GBtn label={`${Math.round(composer.context * 100)}% of the context window is in use`} tip={`${Math.round(composer.context * 100)}% of context used`} data-tip-at="above">
            <Ring value={composer.context} size={17} />
          </GBtn>
        )}
        <button type="submit" className="xl-send" data-kind={kind} aria-label={kind === 'stop' ? 'Stop' : 'Send'} disabled={kind === 'idle'}>
          {kind === 'stop' ? <Square key="stop" size={11} strokeWidth={0} fill="currentColor" /> : <ArrowUp key="go" size={17} strokeWidth={2.25} />}
        </button>
      </div>
      <Pop open={open} anchor={el} place="above-end" onClose={close} label="Model and mode">
        {(
          [
            ['Model', composer.model],
            ['Effort', composer.effort],
            ['Mode', composer.mode],
          ] as const
        ).map(([label, value]) => (
          <button type="button" key={label} className="xl-item" onClick={close}>
            <span>{label}</span>
            <span className="xl-item-value">{value}</span>
            <ChevronRight size={13} strokeWidth={2} />
          </button>
        ))}
        <div className="xl-sep" />
        <div className="xl-item">
          <Folder size={15} strokeWidth={1.75} />
          <span>{composer.folder}</span>
        </div>
        <div className="xl-item">
          <GitBranch size={15} strokeWidth={1.75} />
          <span>{composer.branch}</span>
        </div>
      </Pop>
    </>
  );
}

// ---- New chat: Quiet's layout, the composer as glass ---------------------------------------------------------------

export function Home() {
  return (
    <div className="xl-home">
      <div className="xl-home-in">
        <p className="xl-home-ask">What needs doing?</p>
        <div className="xl-home-slot" />
        <div className="xl-where">
          <button type="button" className="xl-chip">
            <Folder size={14} strokeWidth={1.75} />
            {composer.folder}
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button type="button" className="xl-chip">
            <GitBranch size={14} strokeWidth={1.75} />
            {composer.branch}
          </button>
        </div>
      </div>
      <GlassGroup id="xl-composer" backdrop={PLANE}>
        <GlassSurface asChild radius={26} thickness={THICKNESS} foreground="vibrant">
          <form className="xl-host xl-composer" data-home="" aria-label="Message" data-glass-role="control" onSubmit={(e) => e.preventDefault()}>
            <Composer running={false} fresh />
          </form>
        </GlassSurface>
      </GlassGroup>
    </div>
  );
}

// ---- The side column: one module per section ---------------------------------------------------------------------

/** How long the side column's modules are given to leave before the main space takes their room, and the reverse. */
export const SIDE_ROOM_MS = 320;

function Module({ title, meta, index, open, children }: { title: string; meta?: ReactNode; index: number; open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const kick = useKick();
  // Modules arrive one after another once the main space has made room, and leave one after another before it
  // takes the room back; the glass materialises and dematerialises with its content.
  const [want, setWant] = useState(open);
  // Its glass is registered only while it stands there, so nothing invisible is in the way of the tabs or composer.
  const [kept, setKept] = useState(open);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timers = open
      ? [window.setTimeout(() => setKept(true), SIDE_ROOM_MS - 20), window.setTimeout(() => (setWant(true), kick(700)), SIDE_ROOM_MS + index * 55)]
      : [window.setTimeout(() => (setWant(false), kick(700)), index * 30), window.setTimeout(() => setKept(false), SIDE_ROOM_MS)];
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [open, index, kick]);
  useGlassUnder(ref, { radius: 20, want, on: kept });
  return (
    <section ref={ref} className="xl-module" data-shown={want} aria-label={title}>
      <h3 className="xl-module-head">
        {title}
        {meta}
      </h3>
      {children}
    </section>
  );
}

/** The side column leaves a window too narrow for it; its glass leaves with it. */
function useRoomForSide() {
  const [wide, setWide] = useState(() => window.matchMedia('(width >= 1180px)').matches);
  useEffect(() => {
    const q = window.matchMedia('(width >= 1180px)');
    const on = () => setWide(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return wide;
}

export function Modules({ open: asked }: { open: boolean }) {
  const open = useRoomForSide() && asked;
  return (
    <aside className="xl-side" aria-label="Session details" inert={!open} data-open={open}>
      <Module
        index={0}
        open={open}
        title="Changes"
        meta={
          <span className="xl-stat">
            <span className="xl-add">+{overview.added}</span> <span className="xl-del">−{overview.removed}</span>
          </span>
        }
      >
        <div className="xl-line">
          <GitBranch size={14} strokeWidth={1.75} />
          <span className="xl-line-text xl-mono">{overview.branch}</span>
        </div>
        {overview.files.map((f) => {
          const [dir, name] = split(f.path);
          return (
            <div key={f.path} className="xl-line">
              <span className="xl-line-text xl-fade">
                {name} <span className="xl-quiet">{dir.replace(/\/$/, '')}</span>
              </span>
              <span className="xl-stat">
                <span className="xl-add">+{f.added}</span>
                {f.removed > 0 && <span className="xl-del"> −{f.removed}</span>}
              </span>
            </div>
          );
        })}
      </Module>

      <Module index={1} open={open} title="Agents">
        {overview.agents.map((a) => (
          <div key={a.name} className="xl-line" data-top="">
            {a.state === 'running' ? (
              <span className="xl-line-mark">
                <i className="xl-dot" data-run="" />
              </span>
            ) : (
              <Check size={15} strokeWidth={1.75} />
            )}
            <span className="xl-line-text">
              <span className={a.state === 'done' ? 'xl-quiet' : undefined}>{a.name}</span>
              {a.state === 'running' && <span className="xl-line-sub">{a.line}</span>}
            </span>
          </div>
        ))}
      </Module>

      <Module index={2} open={open} title="To do">
        {overview.todos.map((todo) => {
          const current = 'current' in todo && todo.current;
          return (
            <div key={todo.text} className="xl-line" data-top="">
              {todo.done ? <CircleCheck size={15} strokeWidth={1.75} /> : current ? <LoaderCircle className="xl-spin" size={15} strokeWidth={2} /> : <Circle size={15} strokeWidth={1.75} />}
              <span className={cx('xl-line-text', todo.done && 'xl-quiet', current && 'xl-current')}>{todo.text}</span>
            </div>
          );
        })}
      </Module>

      <Module index={3} open={open} title="Background">
        {overview.background.map((b) => (
          <div key={b.label} className="xl-line">
            <Terminal size={14} strokeWidth={1.75} />
            <span className="xl-line-text xl-mono">{b.label}</span>
            <span className="xl-stat">{b.line}</span>
          </div>
        ))}
      </Module>
    </aside>
  );
}
