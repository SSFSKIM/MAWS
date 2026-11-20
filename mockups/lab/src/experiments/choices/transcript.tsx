// The transcript's smaller parts: the person's own message, the thinking line, the diff, the running command and the
// line that says agents started. Variant A of each is Layers' own markup on Layers' own classes.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Bot, ChevronRight, FileCode, Sparkle } from 'lucide-react';
import { overview, transcript, type TranscriptItem } from '../../content/fixtures';
import { clock, cx, Fold, split } from '../layers/parts';
import { Block, Menu, useBoard, useClock, useDismiss, useOpen, Variant } from './board';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;
const all = <K extends TranscriptItem['kind']>(kind: K) => transcript.filter((t): t is Of<K> => t.kind === kind);
const users = all('user');
const answers = all('assistant');
const thought = all('thought')[0]!;
const runs = all('tools');
const edit = all('edit')[0]!;
const live = all('running')[0]!;
const started = all('agents')[0]!;

/** Layers' grey caption that opens in place. `follow` false keeps it out of the page's Opened switch. */
function Folded({ caption, time, follow = true, mono, children }: { caption: ReactNode; time?: string; follow?: boolean; mono?: boolean; children: (clip: HTMLElement | null, shown: boolean) => ReactNode }) {
  const [open, toggle] = useOpen(follow);
  // A card's glass exists while it is open and for the length of its closing.
  const [shown, setShown] = useState(open);
  const [clip, setClip] = useState<HTMLDivElement | null>(null);
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
      <button type="button" className={cx('xl-cap', mono && 'xc-cap-mono')} aria-expanded={open} onClick={toggle}>
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

function Calls({ run, clip, shown, first }: { run: Of<'tools'>; clip: HTMLElement | null; shown: boolean; first?: ReactNode }) {
  return (
    <div className="xl-calls-wrap">
      <Block className="xl-calls" clip={clip} on={shown}>
        {first}
        {run.calls.map((c, i) => (
          <div key={i} className="xl-call">
            <span className="xl-call-verb">{c.tool}</span>
            <span className="xl-call-target">{c.target}</span>
            {c.detail && <span className="xl-call-detail">{c.detail}</span>}
          </div>
        ))}
      </Block>
    </div>
  );
}

// ---- the person's own message ---------------------------------------------------------------------------------------

type MessageKind = 'glass' | 'tint' | 'heading';
const MESSAGE: MessageKind[] = ['glass', 'tint', 'heading'];

function Message({ kind, text }: { kind: MessageKind; text: string }) {
  if (kind === 'heading') return <p className="xc-ask">{text}</p>;
  return (
    <div className="xl-user">
      {kind === 'glass' ? (
        <Block className="xl-bubble" radius={22}>
          {text}
        </Block>
      ) : (
        <div className="xl-bubble xc-tint">{text}</div>
      )}
    </div>
  );
}

export function MessagePage() {
  return (
    <>
      {MESSAGE.map((kind, n) => (
        <Variant n={n} key={kind}>
          <Message kind={kind} text={users[0]!.text} />
          <div className="xl-prose">
            <p>{answers[0]!.paragraphs[1]}</p>
          </div>
          <Message kind={kind} text={users[1]!.text} />
        </Variant>
      ))}
    </>
  );
}

// ---- thinking ------------------------------------------------------------------------------------------------------

/** A run of tool calls under its caption; `first` is a row put before its calls. */
function Run({ run, first, follow = false }: { run: Of<'tools'>; first?: ReactNode; follow?: boolean }) {
  return (
    <Folded caption={run.summary} time={clock(run.seconds)} follow={follow}>
      {(clip, shown) => <Calls run={run} clip={clip} shown={shown} first={first} />}
    </Folded>
  );
}

/** The thinking line and the run it led to, in each of the three ways. */
function Thought({ n, follow = true }: { n: number; follow?: boolean }) {
  const { open } = useBoard();
  const run = runs[0]!;
  if (n === 0)
    return (
      <>
        <Folded caption={`Thought for ${clock(thought.seconds)}`} follow={follow}>
          {() => <p className="xl-thought">{thought.summary}</p>}
        </Folded>
        <Run run={run} />
      </>
    );
  if (n === 1)
    return (
      <>
        <div className="xl-folded">
          <span className="xl-cap xc-cap-said" data-open={follow && open} tabIndex={0}>
            {thought.summary}
            <span className="xl-cap-time">{clock(thought.seconds)}</span>
          </span>
        </div>
        <Run run={run} />
      </>
    );
  return (
    <Run
      run={run}
      follow={follow}
      first={
        <div className="xl-call xc-call-thought">
          <span className="xl-call-verb">
            <Sparkle size={13} strokeWidth={1.75} />
          </span>
          <span className="xc-call-said">{thought.summary}</span>
          <span className="xl-call-detail">{clock(thought.seconds)}</span>
        </div>
      }
    />
  );
}

export function ThoughtPage() {
  return (
    <>
      {[0, 1, 2].map((n) => (
        <Variant n={n} key={n}>
          <Thought n={n} />
        </Variant>
      ))}
    </>
  );
}

// ---- the diff --------------------------------------------------------------------------------------------------------

function Stat() {
  return (
    <span className="xl-stat">
      <span className="xl-add">+{edit.added}</span>
      {edit.removed > 0 && <span className="xl-del"> −{edit.removed}</span>}
    </span>
  );
}

function Lines({ signs = true }: { signs?: boolean }) {
  return (
    <pre className={cx('xl-diff', !signs && 'xc-diff-bars')}>
      {edit.lines.map((l, i) => (
        <div key={i} className="xl-diff-line" data-sign={l.sign}>
          <i>{signs ? l.sign : ''}</i>
          {l.text}
        </div>
      ))}
    </pre>
  );
}

function CardDiff() {
  const [open, setOpen] = useState(true);
  const [dir, name] = split(edit.file);
  return (
    <Block className="xl-edit">
      <button type="button" className="xl-edit-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <FileCode size={15} strokeWidth={1.75} />
        <span className="xl-edit-file">
          {name} <span className="xl-edit-dir">{dir.replace(/\/$/, '')}</span>
        </span>
        <Stat />
      </button>
      <Fold open={open}>
        <Lines />
      </Fold>
    </Block>
  );
}

function Diff({ n, follow = true }: { n: number; follow?: boolean }) {
  const [dir, name] = split(edit.file);
  if (n === 0) return <CardDiff />;
  if (n === 1)
    return (
      <Folded
        follow={follow}
        caption={
          <>
            <span className="xc-cap-name">{name}</span>
            <Stat />
          </>
        }
      >
        {(clip, shown) => (
          <div className="xl-calls-wrap">
            <Block className="xl-edit xc-edit-bare" clip={clip} on={shown}>
              <Lines />
            </Block>
          </div>
        )}
      </Folded>
    );
  return (
    <>
      <div className="xl-folded">
        <span className="xl-cap">
          <span className="xc-cap-name">{name}</span>
          {dir.replace(/\/$/, '')}
          <Stat />
        </span>
      </div>
      <Block className="xl-edit xc-edit-bare xc-edit-code">
        <Lines signs={false} />
      </Block>
    </>
  );
}

export function DiffPage() {
  return (
    <>
      {[0, 1, 2].map((n) => (
        <Variant n={n} key={n}>
          <div className="xl-prose">
            <p>{answers[0]!.paragraphs[1]}</p>
          </div>
          <Diff n={n} />
        </Variant>
      ))}
    </>
  );
}

// ---- the running command ---------------------------------------------------------------------------------------------

function Tail({ innerRef }: { innerRef?: Ref<HTMLDivElement> }) {
  return (
    <div className="xl-tail" ref={innerRef}>
      {live.tail.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

/** A capsule as wide as its one row; it opens into the card, travelling between two measured widths. */
function CapsuleRun({ time, follow }: { time: string; follow: boolean }) {
  const [open, toggle] = useOpen(follow);
  const head = useRef<HTMLButtonElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<{ row: number; card: number } | null>(null);
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
      setW({ row, card: Math.max(row, natural(tail.current)) });
    };
    read();
    void document.fonts?.ready.then(read);
  }, []);
  return (
    <Block className="xl-live xc-run" data-open={open} style={w ? { width: open ? w.card : w.row } : undefined}>
      <button type="button" ref={head} className="xl-live-head" aria-expanded={open} onClick={toggle}>
        <i className="xl-dot" data-run="" />
        <span className="xl-live-cmd">{live.command}</span>
        <span className="xl-live-time">{time}</span>
      </button>
      <Fold open={open}>
        <Tail innerRef={tail} />
      </Fold>
    </Block>
  );
}

function Command({ n, follow = true }: { n: number; follow?: boolean }) {
  const time = clock(useClock(live.seconds));
  if (n === 0)
    return (
      <Block className="xl-live">
        <div className="xl-live-head">
          <i className="xl-dot" data-run="" />
          <span className="xl-live-cmd">{live.command}</span>
          <span className="xl-live-time">{time}</span>
        </div>
        <Tail />
      </Block>
    );
  if (n === 1)
    return (
      <Folded
        mono
        follow={follow}
        time={time}
        caption={
          <>
            <i className="xl-dot" data-run="" />
            {live.command}
          </>
        }
      >
        {(clip, shown) => (
          <div className="xl-calls-wrap">
            <Block className="xl-live xc-live-bare" clip={clip} on={shown}>
              <Tail />
            </Block>
          </div>
        )}
      </Folded>
    );
  return <CapsuleRun time={time} follow={follow} />;
}

export function CommandPage() {
  return (
    <>
      {[0, 1, 2].map((n) => (
        <Variant n={n} key={n}>
          <div className="xl-prose">
            <p>{answers[1]!.paragraphs[0]}</p>
          </div>
          <Command n={n} />
        </Variant>
      ))}
    </>
  );
}

// ---- agents started ---------------------------------------------------------------------------------------------------

function AgentCount({ follow }: { follow: boolean }) {
  const [open, toggle, close] = useOpen(follow);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useDismiss(el, open, close);
  return (
    <div className="xl-folded">
      <span className="xc-anchor" ref={setEl}>
        <button type="button" className="xl-cap" aria-expanded={open} onClick={toggle} aria-label={`${started.names.length} agents ${started.line}`}>
          <Bot size={14} strokeWidth={1.75} />
          {started.names.length}
          <i className="xl-dot" data-run="" />
        </button>
        <Menu open={open} place="below-start" label="Agents" className="xc-agent-list">
          {started.names.map((name) => (
            <div key={name} className="xl-item xc-agent-row">
              <i className="xl-dot" data-run="" />
              <span>
                {name}
                <small>{overview.agents.find((a) => a.name === name)?.line}</small>
              </span>
            </div>
          ))}
        </Menu>
      </span>
    </div>
  );
}

function Agents({ n, follow = true }: { n: number; follow?: boolean }) {
  const { open } = useBoard();
  if (n === 0)
    return (
      <div className="xl-folded">
        <span className="xl-cap">
          <Bot size={14} strokeWidth={1.75} />
          {started.names.join(' and ')} {started.line}
        </span>
      </div>
    );
  if (n === 1)
    return (
      <div className="xl-folded xc-agents">
        {started.names.map((name) => (
          <span key={name} className="xc-agent" data-open={follow && open} tabIndex={0}>
            <i className="xl-dot" data-run="" />
            {name}
            <span className="xc-agent-line">{overview.agents.find((a) => a.name === name)?.line}</span>
          </span>
        ))}
      </div>
    );
  return <AgentCount follow={follow} />;
}

export function AgentsPage() {
  return (
    <>
      {[0, 1, 2].map((n) => (
        <Variant n={n} key={n}>
          <Agents n={n} />
          <div className="xl-prose">
            <p>{answers[1]!.paragraphs[0]}</p>
          </div>
        </Variant>
      ))}
    </>
  );
}

// The pieces the Together page sets in the session's own order.
export { Agents, Command, Diff, Message, MESSAGE, Run, Thought, answers, runs, users };
