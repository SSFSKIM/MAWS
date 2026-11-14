// The session's content: the transcript and what the composer carries (Quiet's, quiet/Session.tsx, with the serif
// taken out), and the right pane's sections (Desktop's side card, desktop/Session.tsx, drawn plainly).
import { useState, type ReactNode } from 'react';
import { type BackdropHint, GlassMenu, GlassMenuContent, GlassMenuItem, GlassMenuSeparator, GlassMenuTrigger } from '@vitreajs/vitrea-react';
import { ArrowUp, Bot, Check, ChevronDown, ChevronRight, CornerDownRight, FileCode, Folder, GitBranch, PanelRight, Plus, Square, X } from 'lucide-react';
import { approval, composer, overview, transcript, type TranscriptItem } from '../../content/fixtures';
import { clock, cx, Fold, GBtn, Ring, split } from './parts';

export type Answer = null | 'approved' | 'denied';

/** The approval, wherever it is answered: the command, one sentence of why, two answers (Quiet's). */
export function Ask({ onAnswer }: { onAnswer: (a: Answer) => void }) {
  return (
    <div className="xo-ask">
      <div className="xo-ask-cmd">{approval.command}</div>
      <p className="xo-ask-why">{approval.why}</p>
      <div className="xo-ask-acts">
        <button className="xo-btn" data-on="glass" onClick={() => onAnswer('denied')}>
          Deny
        </button>
        <button className="xo-btn" data-kind="go" onClick={() => onAnswer('approved')}>
          Approve
        </button>
      </div>
    </div>
  );
}

/** One grey caption for a run of work: a pill under the pointer, with its chevron and its duration. It opens in place. */
function Folded({ caption, time, children }: { caption: string; time?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="xo-cap" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {caption}
        <ChevronRight className="xo-cap-chev" size={13} strokeWidth={2} />
        {time && <span className="xo-cap-time">{time}</span>}
      </button>
      <Fold open={open}>{children}</Fold>
    </div>
  );
}

/** A transcript card: a ring on the ground, with no fill and no lift (Quiet's). */
function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('xo-card', className)}>{children}</div>;
}

function Edit({ item }: { item: Extract<TranscriptItem, { kind: 'edit' }> }) {
  const [open, setOpen] = useState(true);
  const [dir, name] = split(item.file);
  return (
    <Card className="xo-edit">
      <button className="xo-edit-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <FileCode size={15} strokeWidth={1.75} />
        <span className="xo-edit-file">
          {name} <span className="xo-edit-dir">{dir.replace(/\/$/, '')}</span>
        </span>
        <span className="xo-stat">
          <span className="xo-add">+{item.added}</span>
          {item.removed > 0 && <span className="xo-del"> −{item.removed}</span>}
        </span>
      </button>
      <Fold open={open}>
        <pre className="xo-diff">
          {item.lines.map((l, i) => (
            <div key={i} className="xo-diff-line" data-sign={l.sign}>
              <i>{l.sign}</i>
              {l.text}
            </div>
          ))}
        </pre>
      </Fold>
    </Card>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="xo-user">
          <div className="xo-bubble">{item.text}</div>
        </div>
      );
    case 'assistant':
      return (
        <div className="xo-prose">
          {item.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      );
    case 'thought':
      return (
        <Folded caption={`Thought for ${clock(item.seconds)}`}>
          <p className="xo-thought">{item.summary}</p>
        </Folded>
      );
    case 'tools':
      return (
        <Folded caption={item.summary} time={clock(item.seconds)}>
          <Card className="xo-calls">
            {item.calls.map((c, i) => (
              <div key={i} className="xo-call">
                <span className="xo-call-verb">{c.tool}</span>
                <span className="xo-call-target">{c.target}</span>
                {c.detail && <span className="xo-call-detail">{c.detail}</span>}
              </div>
            ))}
          </Card>
        </Folded>
      );
    case 'edit':
      return <Edit item={item} />;
    case 'agents':
      return (
        <div>
          <span className="xo-cap">
            <Bot size={14} strokeWidth={1.75} />
            {item.names.join(' and ')} {item.line}
          </span>
        </div>
      );
    case 'running':
      return (
        <Card className="xo-live">
          <div className="xo-live-head">
            <i className="xo-dot" data-run="" />
            <span className="xo-live-cmd">{item.command}</span>
            <span className="xo-live-time">{clock(item.seconds)}</span>
          </div>
          <div className="xo-tail">
            {item.tail.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </Card>
      );
  }
}

/**
 * How much of a block's own box is inked, and the fill it paints: what a bar that floats over the transcript is
 * told about what is under it (the hint's inputs; Instrument's method, Open.tsx reads these).
 */
const cover: Record<TranscriptItem['kind'], [ink: number, fill: number]> = {
  user: [0.09, 1],
  assistant: [0.085, 0],
  edit: [0.07, 0],
  running: [0.06, 0],
  thought: [0.03, 0],
  tools: [0.03, 0],
  agents: [0.03, 0],
};

export function Transcript() {
  return (
    <div className="xo-column">
      {transcript.map((item, i) => (
        <div key={i} className={`xo-turn xo-turn-${item.kind}`} data-xo-c={cover[item.kind][0]} data-xo-f={cover[item.kind][1]}>
          <Item item={item} />
        </div>
      ))}
    </div>
  );
}

/**
 * What the composer carries (Quiet's): a queued message as a token above the field, attach, one model chip that
 * holds effort, mode, folder and branch, the context ring, and one button that stops while a turn runs and takes
 * the accent to send once there is text. It stands on glass here, so every control is a fill and the menu is a platter.
 */
export function ComposerBody({ running, placeholder, queued, fresh, hint }: { running: boolean; placeholder?: string; queued?: string; fresh?: boolean; hint: BackdropHint }) {
  const [text, setText] = useState('');
  const [held, setHeld] = useState(queued);
  const typed = text.trim().length > 0;
  const kind = typed ? 'go' : running ? 'stop' : 'idle';
  return (
    <>
      {queued !== undefined && (
        <Fold open={held !== undefined}>
          <div className="xo-queued" title="Sends when this turn ends">
            <CornerDownRight size={13} strokeWidth={1.75} />
            <span className="xo-fade">{queued}</span>
            <button type="button" className="xo-queued-x" aria-label="Remove the queued message" onClick={() => setHeld(undefined)}>
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        </Fold>
      )}
      <textarea className="xo-field" rows={1} placeholder={placeholder} aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="xo-tools">
        <GBtn label="Attach" tip="Attach" tipAt="above-start">
          <Plus size={17} strokeWidth={1.75} />
        </GBtn>
        <span className="xo-grow" />
        <GlassMenu groupProps={{ hint }}>
          <GlassMenuTrigger className="xo-chip" aria-label="Model, effort and mode">
            {composer.model}
            <ChevronDown size={13} strokeWidth={2} />
          </GlassMenuTrigger>
          <GlassMenuContent aria-label="Model, effort and mode" placement="top-end" gap={8} radius={16} thickness={8} className="xo-platter xo-menu">
            {(
              [
                ['Model', composer.model],
                ['Effort', composer.effort],
                ['Mode', composer.mode],
              ] as const
            ).map(([label, value]) => (
              <GlassMenuItem key={label} className="xo-item">
                <span>{label}</span>
                <span className="xo-item-value">{value}</span>
                <ChevronRight size={13} strokeWidth={2} />
              </GlassMenuItem>
            ))}
            <GlassMenuSeparator className="xo-sep" />
            <GlassMenuItem className="xo-item">
              <Folder size={15} strokeWidth={1.75} />
              <span>{composer.folder}</span>
            </GlassMenuItem>
            <GlassMenuItem className="xo-item">
              <GitBranch size={15} strokeWidth={1.75} />
              <span>{composer.branch}</span>
            </GlassMenuItem>
          </GlassMenuContent>
        </GlassMenu>
        {!fresh && (
          <GBtn label={`${Math.round(composer.context * 100)}% of the context window is in use`} tip={`${Math.round(composer.context * 100)}% of context used`} tipAt="above">
            <Ring value={composer.context} size={17} />
          </GBtn>
        )}
        <button type="submit" className="xo-send" data-kind={kind} aria-label={kind === 'stop' ? 'Stop' : 'Send'} disabled={kind === 'idle'}>
          {kind === 'stop' ? <Square key="stop" size={11} strokeWidth={0} fill="currentColor" /> : <ArrowUp key="go" size={17} strokeWidth={2.25} />}
        </button>
      </div>
    </>
  );
}

/** Under the new-chat composer: where the session will run (Quiet's). */
export function Where() {
  return (
    <div className="xo-where">
      <button className="xo-chip" data-on="ground">
        <Folder size={14} strokeWidth={1.75} />
        {composer.folder}
        <ChevronDown size={13} strokeWidth={2} />
      </button>
      <button className="xo-chip" data-on="ground">
        <GitBranch size={14} strokeWidth={1.75} />
        {composer.branch}
      </button>
    </div>
  );
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="xo-stat">
      <span className="xo-add">+{added}</span>
      {removed > 0 && <span className="xo-del"> −{removed}</span>}
    </span>
  );
}

/**
 * The right pane's content: Desktop's side card (branch and totals at the head, files, agents, background, to do),
 * drawn plainly. The owner will take this column's content from the app as it is after the current wave; what is
 * judged here is the pane.
 */
export function SidePanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="xo-side-in">
      <div className="xo-side-head">
        <GitBranch size={14} strokeWidth={1.8} />
        <span className="xo-side-branch">{overview.branch}</span>
        <Counts added={overview.added} removed={overview.removed} />
        <GBtn label="Hide the side pane" className="xo-side-close" onClick={onClose}>
          <PanelRight size={17} strokeWidth={1.75} />
        </GBtn>
      </div>
      <div className="xo-side-scroll">
        <div className="xo-side-group">
          {overview.files.map((f) => {
            const [dir, name] = split(f.path);
            return (
              <button type="button" key={f.path} className="xo-side-row" title={f.path}>
                <span className="xo-side-name">{name}</span>
                <span className="xo-side-dir">{dir.replace(/\/$/, '')}</span>
                <Counts added={f.added} removed={f.removed} />
              </button>
            );
          })}
        </div>
        <div className="xo-side-group">
          <div className="xo-side-label">Agents</div>
          {overview.agents.map((a) => (
            <div key={a.name} className="xo-side-row" data-two>
              <span className="xo-side-mark">{a.state === 'running' ? <i className="xo-dot" data-run="" /> : <Check size={14} strokeWidth={2} />}</span>
              <span className="xo-side-text">
                <span className="xo-side-name">{a.name}</span>
                <span className="xo-side-line">{a.line}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="xo-side-group">
          <div className="xo-side-label">Background</div>
          {overview.background.map((b) => (
            <div key={b.label} className="xo-side-row">
              <span className="xo-side-mark">
                <i className="xo-dot" data-run="" />
              </span>
              <code className="xo-side-code">{b.label}</code>
              <span className="xo-side-aside">{b.line}</span>
            </div>
          ))}
        </div>
        <div className="xo-side-group">
          <div className="xo-side-label">To do</div>
          {overview.todos.map((t) => (
            <div key={t.text} className="xo-todo" data-done={t.done || undefined} data-now={('current' in t && t.current) || undefined}>
              <span className="xo-todo-mark">{t.done && <Check size={10} strokeWidth={3} />}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
