// What is read and what is written. The transcript and the composer's contents are Quiet's
// (`../quiet/Session.tsx`); the assistant's serif is gone (the owner rejected it), so prose is the interface face at
// reading size. The composer's body is the same, but it no longer floats on the page: the host that holds it is a
// piece of glass on the field below the sheet (Sheet.tsx).
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Bot, Check, ChevronDown, ChevronRight, Circle, CircleCheck, CornerDownRight, FileCode, Folder, GitBranch, LoaderCircle, Plus, Square, Terminal, X } from 'lucide-react';
import { approval, composer, overview, transcript, type TranscriptItem } from '../../content/fixtures';
import { Ring } from './glyphs';
import { Fold, Pop } from './overlay';

export type Answer = null | 'approved' | 'denied';

const clock = (sec: number) => (sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`);
const split = (path: string) => {
  const i = path.lastIndexOf('/');
  return [path.slice(0, i + 1), path.slice(i + 1)] as const;
};

/** The approval, wherever it is answered: the command, one sentence of why, two answers. */
export function Ask({ onAnswer }: { onAnswer: (a: Answer) => void }) {
  return (
    <div className="xs-ask">
      <div className="xs-ask-cmd">{approval.command}</div>
      <p className="xs-ask-why">{approval.why}</p>
      <div className="xs-ask-acts">
        <button className="xs-btn" onClick={() => onAnswer('denied')}>
          Deny
        </button>
        <button className="xs-btn" data-kind="go" onClick={() => onAnswer('approved')}>
          Approve
        </button>
      </div>
    </div>
  );
}

/** One grey caption for a run of work. It opens in place. */
function Folded({ caption, time, children, startOpen = false }: { caption: string; time?: string; children: ReactNode; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <button className="xs-cap" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {caption}
        <ChevronRight className="xs-cap-chev" size={13} strokeWidth={2} />
        {time && <span className="xs-cap-time">{time}</span>}
      </button>
      <Fold open={open}>{children}</Fold>
    </div>
  );
}

function Edit({ item }: { item: Extract<TranscriptItem, { kind: 'edit' }> }) {
  const [open, setOpen] = useState(true);
  const [dir, name] = split(item.file);
  return (
    <div className="xs-ringed xs-edit">
      <button className="xs-edit-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <FileCode size={15} strokeWidth={1.75} />
        <span className="xs-edit-file">
          {name} <span className="xs-edit-dir">{dir.replace(/\/$/, '')}</span>
        </span>
        <span className="xs-stat">
          <span className="xs-add">+{item.added}</span>
          {item.removed > 0 && <span className="xs-del"> −{item.removed}</span>}
        </span>
      </button>
      <Fold open={open}>
        <pre className="xs-diff">
          {item.lines.map((l, i) => (
            <div key={i} className="xs-diff-line" data-sign={l.sign}>
              <i>{l.sign}</i>
              {l.text}
            </div>
          ))}
        </pre>
      </Fold>
    </div>
  );
}

function Item({ item, open }: { item: TranscriptItem; open: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="xs-user">
          <div className="xs-bubble">{item.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="xs-prose">
          {item.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    case 'thought':
      return (
        <Folded caption={`Thought for ${clock(item.seconds)}`}>
          <p className="xs-thought">{item.summary}</p>
        </Folded>
      );
    case 'tools':
      return (
        <Folded caption={item.summary} time={clock(item.seconds)} startOpen={open}>
          <div className="xs-ringed xs-calls">
            {item.calls.map((c, i) => (
              <div key={i} className="xs-call">
                <span className="xs-call-verb">{c.tool}</span>
                <span className="xs-call-target">{c.target}</span>
                {c.detail && <span className="xs-call-detail">{c.detail}</span>}
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
          <span className="xs-cap">
            <Bot size={14} strokeWidth={1.75} />
            {item.names.join(' and ')} {item.line}
          </span>
        </div>
      );
    case 'running':
      return (
        <div className="xs-ringed xs-live">
          <div className="xs-live-head">
            <i className="xs-dot" data-run="" />
            <span className="xs-live-cmd">{item.command}</span>
            <span className="xs-live-time">{clock(item.seconds)}</span>
          </div>
          <div className="xs-tail">
            {item.tail.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      );
  }
}

/** The transcript, read on the sheet. `x=tools` in the address opens the last tool run, `x=top` rests at the start. */
export function Transcript({ flags }: { flags: string[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  // A running session rests at its newest line.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || flags.includes('top')) return;
    const toEnd = () => {
      el.scrollTop = el.scrollHeight;
    };
    toEnd();
    const t = [window.setTimeout(toEnd, 80), window.setTimeout(toEnd, 500)];
    return () => t.forEach((id) => window.clearTimeout(id));
  }, [flags]);
  const lastTools = transcript.map((i) => i.kind).lastIndexOf('tools');
  return (
    <div className="xs-scroll" ref={scroll}>
      <div className="xs-column">
        {transcript.map((item, i) => (
          <Item key={i} item={item} open={flags.includes('tools') && i === lastTools} />
        ))}
      </div>
    </div>
  );
}

/** The composer's contents. While a turn runs, its button stops; once you type, it turns orange and sends. */
export function ComposerBody({ fresh }: { fresh: boolean }) {
  const [text, setText] = useState('');
  const [held, setHeld] = useState(true);
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const typed = text.trim().length > 0;
  const kind = typed ? 'go' : fresh ? 'idle' : 'stop';
  return (
    <>
      <Fold open={held && !fresh}>
        <div className="xs-queued" title="Sends when this turn ends">
          <CornerDownRight size={13} strokeWidth={1.75} />
          <span className="xs-fade">{composer.queued}</span>
          <button type="button" className="xs-queued-x" aria-label="Remove the queued message" onClick={() => setHeld(false)}>
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      </Fold>
      <textarea
        className="xs-field"
        rows={1}
        placeholder={fresh ? undefined : composer.placeholder}
        aria-label="Message"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="xs-tools">
        <button type="button" className="xs-icon" aria-label="Attach" data-tip="Attach" data-tip-at="above-start">
          <Plus size={17} strokeWidth={1.75} />
        </button>
        {/* On a new chat the place a session will run in rides in the composer: it is the one object on the field. */}
        <Fold open={fresh} className="xs-where">
          <button type="button" className="xs-chip" tabIndex={fresh ? 0 : -1}>
            <Folder size={14} strokeWidth={1.75} />
            {composer.folder}
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          <button type="button" className="xs-chip" tabIndex={fresh ? 0 : -1}>
            <GitBranch size={14} strokeWidth={1.75} />
            {composer.branch}
          </button>
        </Fold>
        <span className="xs-grow" />
        <button type="button" ref={setEl} className="xs-chip" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {composer.model}
          <ChevronDown size={13} strokeWidth={2} />
        </button>
        {!fresh && (
          <button
            type="button"
            className="xs-icon"
            aria-label={`${Math.round(composer.context * 100)}% of the context window is in use`}
            data-tip={`${Math.round(composer.context * 100)}% of context used`}
            data-tip-at="above"
          >
            <Ring value={composer.context} size={17} />
          </button>
        )}
        <button type="submit" className="xs-send" data-kind={kind} aria-label={kind === 'stop' ? 'Stop' : 'Send'} disabled={kind === 'idle'}>
          {kind === 'stop' ? <Square key="stop" size={11} strokeWidth={0} fill="currentColor" /> : <ArrowUp key="go" size={17} strokeWidth={2.25} />}
        </button>
      </div>
      <Pop open={open} anchor={el} place="above-end" onClose={close}>
        {(
          [
            ['Model', composer.model],
            ['Effort', composer.effort],
            ['Mode', composer.mode],
          ] as const
        ).map(([label, value]) => (
          <button key={label} className="xs-item" onClick={close}>
            <span>{label}</span>
            <span className="xs-item-value">{value}</span>
            <ChevronRight size={13} strokeWidth={2} />
          </button>
        ))}
        {!fresh && (
          <>
            <div className="xs-sep" />
            <div className="xs-item">
              <Folder size={15} strokeWidth={1.75} />
              <span>{composer.folder}</span>
            </div>
            <div className="xs-item">
              <GitBranch size={15} strokeWidth={1.75} />
              <span>{composer.branch}</span>
            </div>
          </>
        )}
      </Pop>
    </>
  );
}

/**
 * The right pane's content: the fixture's four lists, drawn as plainly as Quiet drew them. The owner said not to
 * spend effort here (the app's own side column will be used); what is judged is the pane.
 */
export function AsideBody() {
  return (
    <div className="xs-aside-in">
      <section className="xs-block">
        <div className="xs-block-head">Tasks</div>
        {overview.todos.map((todo) => {
          const current = 'current' in todo && todo.current;
          return (
            <div key={todo.text} className="xs-line" data-top="">
              {todo.done ? <CircleCheck size={15} strokeWidth={1.75} /> : current ? <LoaderCircle className="xs-spin" size={15} strokeWidth={2} /> : <Circle size={15} strokeWidth={1.75} style={{ opacity: 0.6 }} />}
              <span className={`xs-line-text ${todo.done ? 'xs-done' : current ? 'xs-current' : ''}`}>{todo.text}</span>
            </div>
          );
        })}
      </section>

      <section className="xs-block">
        <div className="xs-block-head">
          Changes
          <span className="xs-stat">
            <span className="xs-add">+{overview.added}</span> <span className="xs-del">−{overview.removed}</span>
          </span>
        </div>
        <div className="xs-line">
          <GitBranch size={14} strokeWidth={1.75} />
          <span className="xs-line-text xs-mono">{overview.branch}</span>
        </div>
        {overview.files.map((f) => {
          const [dir, name] = split(f.path);
          return (
            <div key={f.path} className="xs-line">
              <span className="xs-line-text xs-fade">
                {name} <span className="xs-done">{dir.replace(/\/$/, '')}</span>
              </span>
              <span className="xs-stat">
                <span className="xs-add">+{f.added}</span>
                {f.removed > 0 && <span className="xs-del"> −{f.removed}</span>}
              </span>
            </div>
          );
        })}
      </section>

      <section className="xs-block">
        <div className="xs-block-head">Agents</div>
        {overview.agents.map((a) => (
          <div key={a.name} className="xs-line" data-top="">
            {a.state === 'running' ? (
              <span style={{ display: 'grid', placeItems: 'center', width: 15, height: 18 }}>
                <i className="xs-dot" data-run="" />
              </span>
            ) : (
              <Check size={15} strokeWidth={1.75} />
            )}
            <span className="xs-line-text">
              <span className={a.state === 'done' ? 'xs-done' : undefined}>{a.name}</span>
              {a.state === 'running' && <span className="xs-line-sub">{a.line}</span>}
            </span>
          </div>
        ))}
      </section>

      <section className="xs-block">
        <div className="xs-block-head">Background</div>
        {overview.background.map((b) => (
          <div key={b.label} className="xs-line">
            <Terminal size={14} strokeWidth={1.75} />
            <span className="xs-line-text xs-mono">{b.label}</span>
            <span className="xs-stat">{b.line}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
