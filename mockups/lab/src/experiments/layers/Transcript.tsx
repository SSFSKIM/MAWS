// The transcript, as the suggested set of the Choices board left it (DESIGN.md section 17). Prose is read on the
// field. The person's own message is a wash of the ink, not glass. Thinking has no line of its own: it is the first
// row of the run it led to. An edit is a caption on the field and a sheet of glass holding code and nothing else.
// What is running is one capsule that opens into its output. Agents that were started are chips with their own
// state. Glass therefore means one thing here: something the agent made that can be opened.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronRight, Sparkle } from 'lucide-react';
import { approval, moreTranscripts, overview, plan, sessionTranscripts, transcript, type Session, type TranscriptItem } from '../../content/fixtures';
import { useGlassUnder, useKick } from './glass';
import { Kept, Steps, useNeeds, waitOf } from './needs';
import { clock, cx, Fold, split } from './parts';
import { Tokens } from './syntax';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

/** A transcript block that stands on glass (or on the veil, or on an opaque card, as the Blocks knob says). */
export function Block({ className, radius = 18, clip, on = true, children, style }: { className?: string; radius?: number; clip?: HTMLElement | null; on?: boolean; children: ReactNode; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useGlassUnder(ref, { radius, clip, on });
  return (
    <div ref={ref} className={cx('xl-block', className)} style={style}>
      {children}
    </div>
  );
}

/** One grey caption that opens in place: its chevron and its duration wait for the pointer. */
function Folded({ caption, time, startOpen, file, after, children }: { caption: ReactNode; time?: string; startOpen?: boolean; file?: boolean; after?: ReactNode; children: (clip: HTMLElement | null, shown: boolean) => ReactNode }) {
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
        className={cx('xl-cap', file && 'xl-cap-file')}
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
      {after}
      <Fold open={open} clipRef={setClip}>
        {children(clip, shown)}
      </Fold>
    </div>
  );
}

/** A run of tool calls. The thought that led to it, if there was one, is its first row. */
function Run({ item, thought, startOpen }: { item: Of<'tools'>; thought?: Of<'thought'>; startOpen?: boolean }) {
  return (
    <Folded caption={item.summary} time={clock(item.seconds)} startOpen={startOpen}>
      {(clip, shown) => (
        <div className="xl-calls-wrap">
          <Block className="xl-calls" clip={clip} on={shown}>
            {thought && (
              <div className="xl-call" data-thought="">
                <span className="xl-call-verb">
                  <Sparkle size={13} strokeWidth={1.75} />
                </span>
                <span className="xl-call-said">{thought.summary}</span>
                <span className="xl-call-detail">{clock(thought.seconds)}</span>
              </div>
            )}
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
}

/** An edit: its file is a caption on the field, and the glass holds the code. A run of changed lines is one bar. */
function Code({ item, session }: { item: Of<'edit'>; session: string }) {
  const [dir, name] = split(item.file);
  // The passage opens as its whole file, in a tab beside this session.
  const open = useNeeds().file(item.file, session);
  return (
    <Folded
      startOpen
      file
      after={
        open && (
          <button type="button" className="xl-cap-go" aria-label={`Open ${name} in a tab`} data-tip="Open" onClick={open}>
            <ArrowUpRight size={15} strokeWidth={1.9} />
          </button>
        )
      }
      caption={
        <>
          <span className="xl-cap-name">{name}</span>
          {dir.replace(/\/$/, '')}
          <span className="xl-stat">
            <span className="xl-add">+{item.added}</span>
            {item.removed > 0 && <span className="xl-del"> −{item.removed}</span>}
          </span>
        </>
      }
    >
      {(clip, shown) => (
        <div className="xl-calls-wrap xl-code-wrap">
          <Block className="xl-code" clip={clip} on={shown}>
            <pre className="xl-diff">
              {item.lines.map((l, i) => {
                const prev = item.lines[i - 1]?.sign;
                const next = item.lines[i + 1]?.sign;
                return (
                  <div key={i} className="xl-diff-line" data-sign={l.sign} data-first={prev !== l.sign || undefined} data-last={next !== l.sign || undefined}>
                    <i />
                    <span>
                      <Tokens text={l.text} />
                    </span>
                  </div>
                );
              })}
            </pre>
          </Block>
        </div>
      )}
    </Folded>
  );
}

/** What is running: one capsule, as wide as its row, that opens into its output between two measured widths. */
function Capsule({ command, from, tail }: { command: string; from: number; tail?: string[] }) {
  const [open, setOpen] = useState(false);
  const [sec, setSec] = useState(from);
  const kick = useKick();
  const head = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<{ row: number; card: number } | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setSec((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  useLayoutEffect(() => {
    const natural = (el: HTMLElement | null) => {
      if (!el) return 0;
      const was = el.style.width;
      el.style.width = 'max-content';
      const v = Math.ceil(el.getBoundingClientRect().width);
      el.style.width = was;
      return v;
    };
    const read = () => {
      const row = natural(head.current);
      setW({ row, card: Math.max(row, natural(body.current)) });
    };
    read();
    void document.fonts?.ready.then(read);
  }, [command]);
  const can = !!tail && tail.length > 0;
  return (
    <Block className="xl-live xl-run" style={w ? { width: open ? w.card : w.row } : undefined}>
      <button
        type="button"
        ref={head}
        className="xl-live-head"
        aria-expanded={can ? open : undefined}
        disabled={!can}
        onClick={() => {
          setOpen((v) => !v);
          kick(520);
        }}
      >
        <i className="xl-dot" data-run="" />
        <span className="xl-live-cmd">{command}</span>
        <span className="xl-live-time">{clock(sec)}</span>
      </button>
      {can && (
        <Fold open={open}>
          <div className="xl-tail" ref={body}>
            {tail!.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </Fold>
      )}
    </Block>
  );
}

function Item({ item, thought, open, session }: { item: TranscriptItem; thought?: Of<'thought'>; open: boolean; session: string }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="xl-user">
          <div className="xl-said">{item.text}</div>
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
      // A thought that led to no run keeps one line: what it was, and how long under the pointer.
      return (
        <div className="xl-folded">
          <span className="xl-cap xl-cap-lone" tabIndex={0}>
            {item.summary}
            <span className="xl-cap-time">{clock(item.seconds)}</span>
          </span>
        </div>
      );
    case 'tools':
      return <Run item={item} thought={thought} startOpen={open} />;
    case 'edit':
      return <Code item={item} session={session} />;
    case 'agents':
      return (
        <div className="xl-folded xl-agents">
          {item.names.map((name) => {
            const agent = overview.agents.find((a) => a.name === name);
            return (
              <span key={name} className="xl-agent" tabIndex={0}>
                <i className="xl-dot" data-run={agent?.state === 'done' ? undefined : ''} />
                {name}
                {agent && <span className="xl-agent-line">{agent.line}</span>}
              </span>
            );
          })}
        </div>
      );
    case 'running':
      return <Capsule command={item.command} from={item.seconds} tail={item.tail} />;
  }
}

/** A plan is the agent's own prose: a heading line, its paragraphs, its steps, on the field like any answer. */
function Plan() {
  return (
    <div className="xl-prose xl-plan">
      <p className="xl-plan-title">{plan.title}</p>
      {plan.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <Steps />
    </div>
  );
}

export const itemsOf = (id: string): TranscriptItem[] => (id === 's1' ? transcript : sessionTranscripts[id] ?? moreTranscripts[id] ?? []);

export function Transcript({ session, open }: { session: Session; open: boolean }) {
  const { replies } = useNeeds();
  const items = itemsOf(session.id);
  const wait = waitOf(session.id);
  const reply = replies[session.id];
  let firstRun = true;
  return (
    <div className="xl-items" key={session.id}>
      {items.map((item, i) => {
        // Thinking has no line of its own when a run follows it.
        if (item.kind === 'thought' && items[i + 1]?.kind === 'tools') return null;
        const before = items[i - 1];
        const startOpen = item.kind === 'tools' && firstRun && open;
        if (item.kind === 'tools') firstRun = false;
        return <Item key={i} item={item} thought={before?.kind === 'thought' ? before : undefined} open={startOpen} session={session.id} />;
      })}
      {wait === 'plan' && <Plan />}
      {/* What the transcript keeps of an answer; an approved command then runs, as any command does. */}
      <Kept id={session.id} />
      {wait === 'approval' && reply?.kind === 'approved' && <Capsule command={approval.command} from={0} />}
    </div>
  );
}
