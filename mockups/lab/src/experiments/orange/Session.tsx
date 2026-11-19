import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CornerDownRight,
  FileCode,
  Folder,
  GitBranch,
  LoaderCircle,
  Plus,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { approval, composer, overview, transcript, type TranscriptItem } from '../../content/fixtures';
import { Ring } from './glyphs';
import { Fold, Pop } from './overlay';
import type { Answer } from './Orange';
import s from './orange.module.css';

const clock = (sec: number) => (sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`);
const split = (path: string) => {
  const i = path.lastIndexOf('/');
  return [path.slice(0, i + 1), path.slice(i + 1)] as const;
};

/** The approval, wherever it is answered: the command, one sentence of why, two answers. */
export function Ask({ onAnswer }: { onAnswer: (a: Answer) => void }) {
  return (
    <div className={s.ask}>
      <div className={s.askCmd}>{approval.command}</div>
      <p className={s.askWhy}>{approval.why}</p>
      <div className={s.askActs}>
        <button className={s.btn} onClick={() => onAnswer('denied')}>
          Deny
        </button>
        <button className={s.btn} data-kind="go" onClick={() => onAnswer('approved')}>
          Approve
        </button>
      </div>
    </div>
  );
}

/** One grey caption for a run of work. It opens in place. */
function Folded({ caption, time, startOpen, children }: { caption: string; time?: string; startOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(startOpen ?? false);
  return (
    <div>
      <button className={s.cap} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {caption}
        <ChevronRight className={s.capChev} size={13} strokeWidth={2} />
        {time && <span className={s.capTime}>{time}</span>}
      </button>
      <Fold open={open}>{children}</Fold>
    </div>
  );
}

function Edit({ item }: { item: Extract<TranscriptItem, { kind: 'edit' }> }) {
  const [open, setOpen] = useState(true);
  const [dir, name] = split(item.file);
  return (
    <div className={`${s.ring} ${s.edit}`}>
      <button className={s.editHead} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <FileCode size={15} strokeWidth={1.75} />
        <span className={s.editFile}>
          {name} <span className={s.editDir}>{dir.replace(/\/$/, '')}</span>
        </span>
        <span className={s.stat}>
          <span className={s.add}>+{item.added}</span>
          {item.removed > 0 && <span className={s.del}> −{item.removed}</span>}
        </span>
      </button>
      <Fold open={open}>
        <pre className={s.diff}>
          {item.lines.map((l, i) => (
            <div key={i} className={s.diffLine} data-sign={l.sign}>
              <i>{l.sign}</i>
              {l.text}
            </div>
          ))}
        </pre>
      </Fold>
    </div>
  );
}

function Item({ item, startOpen }: { item: TranscriptItem; startOpen?: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className={s.user}>
          <div className={s.bubble}>{item.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className={s.prose}>
          {item.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    case 'thought':
      return (
        <Folded caption={`Thought for ${clock(item.seconds)}`}>
          <p className={s.thought}>{item.summary}</p>
        </Folded>
      );
    case 'tools':
      return (
        <Folded caption={item.summary} time={clock(item.seconds)} startOpen={startOpen}>
          <div className={`${s.ring} ${s.calls}`}>
            {item.calls.map((c, i) => (
              <div key={i} className={s.call}>
                <span className={s.callVerb}>{c.tool}</span>
                <span className={s.callTarget}>{c.target}</span>
                {c.detail && <span className={s.callDetail}>{c.detail}</span>}
              </div>
            ))}
          </div>
        </Folded>
      );
    case 'edit':
      return <Edit item={item} />;
    case 'agents':
      return (
        <div>
          <span className={s.cap}>
            <Bot size={14} strokeWidth={1.75} />
            {item.names.join(' and ')} {item.line}
          </span>
        </div>
      );
    case 'running':
      return (
        <div className={`${s.ring} ${s.live}`}>
          <div className={s.liveHead}>
            <i className={s.dot} data-run="" />
            <span className={s.liveCmd}>{item.command}</span>
            <span className={s.liveTime}>{clock(item.seconds)}</span>
          </div>
          <div className={s.tail}>
            {item.tail.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      );
  }
}

/** The composer: a sheet of glass on the ground. While a turn runs its button stops; once you type, it turns solid and sends. */
function Composer({ running, placeholder, queued, fresh }: { running: boolean; placeholder?: string; queued?: string; fresh?: boolean }) {
  const [text, setText] = useState('');
  const [held, setHeld] = useState(queued);
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const typed = text.trim().length > 0;
  const kind = typed ? 'go' : running ? 'stop' : 'idle';
  return (
    <>
      <div className={`${s.composer} ${s.glass}`} data-o-surface="Composer">
        {queued !== undefined && (
          <Fold open={held !== undefined}>
            <div className={s.queued} title="Sends when this turn ends">
              <CornerDownRight size={13} strokeWidth={1.75} />
              <span className={s.fade}>{queued}</span>
              <button className={s.queuedX} aria-label="Remove the queued message" onClick={() => setHeld(undefined)}>
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          </Fold>
        )}
        <textarea
          className={s.field}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className={s.tools}>
          <button className={s.icon} aria-label="Attach" data-tip="Attach" data-tip-at="above-start">
            <Plus size={17} strokeWidth={1.75} />
          </button>
          <span className={s.grow} />
          <button ref={setEl} className={s.chip} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {composer.model}
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          {!fresh && (
            <button
              className={s.icon}
              aria-label={`${Math.round(composer.context * 100)}% of the context window is in use`}
              data-tip={`${Math.round(composer.context * 100)}% of context used`}
              data-tip-at="above"
            >
              <Ring value={composer.context} size={17} />
            </button>
          )}
          <button
            className={s.send}
            data-kind={kind}
            aria-label={kind === 'go' ? 'Send' : kind === 'stop' ? 'Stop' : 'Send'}
            disabled={kind === 'idle'}
          >
            {kind === 'stop' ? (
              <Square key="stop" size={11} strokeWidth={0} fill="currentColor" />
            ) : (
              <ArrowUp key="go" size={17} strokeWidth={2.25} />
            )}
          </button>
        </div>
      </div>
      <Pop open={open} anchor={el} place="above-end" onClose={close}>
        {(
          [
            ['Model', composer.model],
            ['Effort', composer.effort],
            ['Mode', composer.mode],
          ] as const
        ).map(([label, value]) => (
          <button key={label} className={s.item} onClick={close}>
            <span>{label}</span>
            <span className={s.itemValue}>{value}</span>
            <ChevronRight size={13} strokeWidth={2} />
          </button>
        ))}
        <div className={s.sep} />
        <div className={s.item}>
          <Folder size={15} strokeWidth={1.75} />
          <span>{composer.folder}</span>
        </div>
        <div className={s.item}>
          <GitBranch size={15} strokeWidth={1.75} />
          <span>{composer.branch}</span>
        </div>
      </Pop>
    </>
  );
}

export function SessionScene({ flags }: { flags: string[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  // A running session rests at its newest line.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = flags.includes('top') ? 0 : el.scrollHeight;
  }, [flags]);
  const firstTools = transcript.findIndex((x) => x.kind === 'tools');
  return (
    <div className={s.scene}>
      <section className={`${s.read} ${s.glass}`} data-o-surface="Transcript" aria-label="Transcript">
        <div className={s.scroll} ref={scroll} data-o-scroll="">
          <div className={s.column}>
            {transcript.map((item, i) => (
              <Item key={i} item={item} startOpen={flags.includes('tools') && i === firstTools} />
            ))}
          </div>
        </div>
      </section>
      <div className={s.dock}>
        <Composer running placeholder={composer.placeholder} queued={composer.queued} />
      </div>
    </div>
  );
}

export function Home() {
  return (
    <div className={s.scene}>
      <div className={s.home}>
        <div className={s.homeIn}>
          <p className={s.ask2}>What needs doing?</p>
          <Composer running={false} fresh />
          <div className={s.where}>
            <button className={s.chip}>
              <Folder size={14} strokeWidth={1.75} />
              {composer.folder}
              <ChevronDown size={13} strokeWidth={2} />
            </button>
            <button className={s.chip}>
              <GitBranch size={14} strokeWidth={1.75} />
              {composer.branch}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The side column: one more pane of glass. Its content is plain on purpose; the container is what is judged. */
export function Aside({ open }: { open: boolean }) {
  return (
    <aside className={`${s.aside} ${s.glass}`} data-open={open} data-o-surface="Details" aria-label="Session details" inert={!open}>
      <div className={s.asideInner}>
        <section className={s.block}>
          <div className={s.blockHead}>Tasks</div>
          {overview.todos.map((todo) => (
            <div key={todo.text} className={s.line} data-top="">
              {todo.done ? (
                <CircleCheck size={15} strokeWidth={1.75} />
              ) : 'current' in todo && todo.current ? (
                <LoaderCircle className={s.spin} size={15} strokeWidth={2} />
              ) : (
                <Circle size={15} strokeWidth={1.75} style={{ opacity: 0.85 }} />
              )}
              <span className={`${s.lineText} ${todo.done ? s.done : 'current' in todo && todo.current ? s.current : ''}`}>{todo.text}</span>
            </div>
          ))}
        </section>

        <section className={s.block}>
          <div className={s.blockHead}>
            Changes
            <span className={s.stat}>
              <span className={s.add}>+{overview.added}</span> <span className={s.del}>−{overview.removed}</span>
            </span>
          </div>
          <div className={s.line}>
            <GitBranch size={14} strokeWidth={1.75} />
            <span className={`${s.lineText} ${s.mono}`}>{overview.branch}</span>
          </div>
          {overview.files.map((f) => {
            const [dir, name] = split(f.path);
            return (
              <div key={f.path} className={s.line}>
                <span className={`${s.lineText} ${s.fade}`}>
                  {name} <span className={s.done}>{dir.replace(/\/$/, '')}</span>
                </span>
                <span className={s.stat}>
                  <span className={s.add}>+{f.added}</span>
                  {f.removed > 0 && <span className={s.del}> −{f.removed}</span>}
                </span>
              </div>
            );
          })}
        </section>

        <section className={s.block}>
          <div className={s.blockHead}>Agents</div>
          {overview.agents.map((a) => (
            <div key={a.name} className={s.line} data-top="">
              {a.state === 'running' ? (
                <span style={{ display: 'grid', placeItems: 'center', width: 15, height: 16 }}>
                  <i className={s.dot} data-run="" />
                </span>
              ) : (
                <Check size={15} strokeWidth={1.75} />
              )}
              <span className={s.lineText}>
                <span className={a.state === 'done' ? s.done : undefined}>{a.name}</span>
                {a.state === 'running' && <span className={s.lineSub}>{a.line}</span>}
              </span>
            </div>
          ))}
        </section>

        <section className={s.block}>
          <div className={s.blockHead}>Background</div>
          {overview.background.map((b) => (
            <div key={b.label} className={s.line}>
              <Terminal size={14} strokeWidth={1.75} />
              <span className={`${s.lineText} ${s.mono}`}>{b.label}</span>
              <span className={s.stat}>{b.line}</span>
            </div>
          ))}
        </section>
      </div>
    </aside>
  );
}
