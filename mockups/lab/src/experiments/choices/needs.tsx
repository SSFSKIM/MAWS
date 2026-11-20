// The two waiting states that were never drawn: a session that asked a question, and a session whose plan waits to
// be approved. Each is a "needs you" state, like the approval the owner already chose (a capsule at the top right
// whose list answers it in place, and a card from the waiting row), so where each is answered is part of the
// variant: in that list's card, in the transcript, or in the composer. A is what Layers implies today: the
// session's one line in the list, with nothing to answer.
import { useState, type ReactNode } from 'react';
import { ArrowUp, Check, Plus } from 'lucide-react';
import { composer, plan, projects, question, type Question, type SessionState } from '../../content/fixtures';
import { cx, Fold, StateGlyph } from '../layers/parts';
import { Block, useBoard, Variant } from './board';

const sessions = projects.flatMap((p) => p.sessions);
const asking = sessions.find((s) => s.state === 'question')!;
const planning = sessions.find((s) => s.state === 'plan')!;

/** The list the waiting capsule opens, standing in the page: Layers' own platter and its own item. */
function Card({ state, title, line, age, label, children }: { state: SessionState; title: string; line?: string; age: string; label: string; children?: ReactNode }) {
  return (
    <div className="xl-pop xl-wait-list xc-platter" role="group" aria-label={label}>
      <div className="xl-wait-item" data-open={children ? 'true' : undefined}>
        <div className="xl-wait-head">
          <StateGlyph state={state} />
          <div className="xl-wait-text">
            <div className="xl-card-title">{title}</div>
            {line && <div className="xl-card-line">{line}</div>}
          </div>
          <span className="xl-wait-age">{age}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** What is said once an answer has gone: one mark and one word, where the buttons were. */
function Done({ word }: { word: string }) {
  return (
    <span className="xc-done">
      <Check size={14} strokeWidth={2.25} />
      {word}
    </span>
  );
}

// ---- a question -------------------------------------------------------------------------------------------------------

/** What a person has chosen so far, across the questions; a single-choice question keeps one. */
function useAnswers() {
  const [picked, setPicked] = useState<number[][]>(() => question.questions.map(() => []));
  const [other, setOther] = useState('');
  const [sent, setSent] = useState(false);
  const toggle = (q: number, o: number) =>
    setPicked((prev) => prev.map((list, i) => (i !== q ? list : question.questions[q]!.multi ? (list.includes(o) ? list.filter((x) => x !== o) : [...list, o]) : list.includes(o) ? [] : [o])));
  const ready = other.trim().length > 0 || picked.some((l) => l.length > 0);
  return { picked, toggle, other, setOther, sent, setSent, ready };
}

/** Labels only: the sentence behind each waits for the pointer. "Any of these" has squarer chips, "one of these" round ones. */
function Chips({ q, at, picked, toggle, shown }: { q: Question; at: number; picked: number[]; toggle: (q: number, o: number) => void; shown?: boolean }) {
  return (
    <div className="xl-pills" role={q.multi ? 'group' : 'radiogroup'} aria-label={q.ask}>
      {q.options.map((o, i) => (
        <button key={o.label} type="button" className="xl-pill xc-chip" data-multi={q.multi || undefined} aria-pressed={picked.includes(i)} data-tip={o.description} data-tip-at="above-start" data-shown={(shown && i === 0) || undefined} onClick={() => toggle(at, i)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** B: answered where the approval is answered, from the capsule's list, without opening the session. */
function QuestionCard() {
  const { open } = useBoard();
  const a = useAnswers();
  return (
    <Card state="question" title={asking.title} age={asking.age} label="Waiting for you">
      <div className="xc-q-form" inert={a.sent}>
        {question.questions.map((q, i) => (
          <div className="xc-q" key={q.ask}>
            <div className="xc-q-ask">{q.ask}</div>
            <Chips q={q} at={i} picked={a.picked[i]!} toggle={a.toggle} shown={open && i === 0} />
          </div>
        ))}
        <input className="xl-input xc-q-other" placeholder="Something else" aria-label="Answer in your own words" value={a.other} onChange={(e) => a.setOther(e.target.value)} />
      </div>
      <div className="xl-ask-acts">
        {a.sent ? (
          <Done word="Sent" />
        ) : (
          <button type="button" className="xl-btn" data-kind="go" disabled={!a.ready} onClick={() => a.setSent(true)}>
            Send
          </button>
        )}
      </div>
    </Card>
  );
}

/** D: the whole form, every sentence in sight, as the last thing in the transcript. */
function QuestionForm() {
  const a = useAnswers();
  return (
    <Block className="xc-q-sheet">
      <div className="xc-q-form" inert={a.sent}>
        {question.questions.map((q, i) => (
          <div className="xc-q" key={q.ask} role={q.multi ? 'group' : 'radiogroup'} aria-label={q.ask}>
            <div className="xc-q-ask">{q.ask}</div>
            {q.options.map((o, j) => (
              <button key={o.label} type="button" className="xc-opt" role={q.multi ? 'checkbox' : 'radio'} aria-checked={a.picked[i]!.includes(j)} onClick={() => a.toggle(i, j)}>
                <i className="xc-opt-mark" data-multi={q.multi || undefined}>
                  <Check size={11} strokeWidth={3} />
                </i>
                <span className="xc-opt-text">
                  {o.label}
                  <small>{o.description}</small>
                </span>
              </button>
            ))}
          </div>
        ))}
        <input className="xl-input xc-q-other" placeholder="Something else" aria-label="Answer in your own words" value={a.other} onChange={(e) => a.setOther(e.target.value)} />
      </div>
      <div className="xl-ask-acts">
        {a.sent ? (
          <Done word="Sent" />
        ) : (
          <button type="button" className="xl-btn" data-kind="go" disabled={!a.ready} onClick={() => a.setSent(true)}>
            Send
          </button>
        )}
      </div>
    </Block>
  );
}

/** C: the composer is where a person answers anything, so it asks: one question at a time, and typing is the other answer. */
function QuestionComposer() {
  const { open } = useBoard();
  const a = useAnswers();
  const [step, setStep] = useState(0);
  const q = question.questions[step]!;
  const last = step === question.questions.length - 1;
  const ready = a.other.trim().length > 0 || a.picked[step]!.length > 0;
  const send = () => {
    if (!ready) return;
    if (last || a.other.trim().length > 0) a.setSent(true);
    else setStep(step + 1);
  };
  return (
    <Block className="xc-composer" radius={26}>
      <Fold open={!a.sent}>
        <div className="xc-q-bar">
          <span className="xc-q-ask">{q.ask}</span>
          <span className="xc-q-dots" role="group" aria-label={`Question ${step + 1} of ${question.questions.length}`}>
            {question.questions.map((x, i) => (
              <button key={x.ask} type="button" aria-label={`Question ${i + 1}`} aria-current={i === step || undefined} onClick={() => setStep(i)} />
            ))}
          </span>
        </div>
        <div className="xc-q-chips" key={step}>
          <Chips q={q} at={step} picked={a.picked[step]!} toggle={a.toggle} shown={open} />
        </div>
      </Fold>
      <textarea className="xl-field" rows={1} placeholder={a.sent ? composer.placeholder : 'Or say it in your own words'} aria-label="Message" value={a.other} onChange={(e) => a.setOther(e.target.value)} />
      <div className="xl-tools">
        <span className="xl-gbtn" aria-hidden>
          <Plus size={17} strokeWidth={1.75} />
        </span>
        <span className="xl-grow" />
        {a.sent ? (
          <Done word="Sent" />
        ) : (
          <button type="button" className="xl-send" data-kind={ready ? 'go' : 'idle'} aria-label={last ? 'Send the answer' : 'Next question'} disabled={!ready} onClick={send}>
            <ArrowUp size={17} strokeWidth={2.25} />
          </button>
        )}
      </div>
    </Block>
  );
}

export function QuestionPage() {
  const { open } = useBoard();
  return (
    <>
      <Variant n={0}>
        <Card state="question" title={asking.title} line={asking.line} age={asking.age} label="Waiting for you" />
      </Variant>
      <Variant n={1}>
        <QuestionCard key={String(open)} />
      </Variant>
      <Variant n={2}>
        <QuestionComposer key={String(open)} />
      </Variant>
      <Variant n={3}>
        <QuestionForm key={String(open)} />
      </Variant>
    </>
  );
}

// ---- a plan -------------------------------------------------------------------------------------------------------------

function Steps({ className }: { className?: string }) {
  return (
    <ol className={cx('xc-steps', className)}>
      {plan.steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

type Verdict = null | 'approved' | 'returned';

/** Approve, or send back: sending back opens one field for the reason, in place. */
function Verdicts({ start }: { start: boolean }) {
  const [back, setBack] = useState(start);
  // The field for the reason exists from the first time it is asked for.
  const [asked, setAsked] = useState(start);
  const [text, setText] = useState(start ? plan.comment : '');
  const [verdict, setVerdict] = useState<Verdict>(null);
  if (verdict) return <div className="xl-ask-acts">{<Done word={verdict === 'approved' ? 'Approved' : 'Sent back'} />}</div>;
  return (
    <>
      <Fold open={back}>
        {asked && <input className="xl-input xc-q-other xc-plan-why" placeholder="What should change?" aria-label="What should change" value={text} onChange={(e) => setText(e.target.value)} />}
      </Fold>
      <div className="xl-ask-acts">
        {back ? (
          <>
            <button type="button" className="xl-btn" onClick={() => setBack(false)}>
              Cancel
            </button>
            <button type="button" className="xl-btn" data-kind="go" disabled={text.trim().length === 0} onClick={() => setVerdict('returned')}>
              Send back
            </button>
          </>
        ) : (
          <>
            <button type="button" className="xl-btn" onClick={() => (setAsked(true), setBack(true))}>
              Send back
            </button>
            <button type="button" className="xl-btn" data-kind="go" onClick={() => setVerdict('approved')}>
              Approve
            </button>
          </>
        )}
      </div>
    </>
  );
}

/** C: the plan is the agent's own prose, on the field like any answer; the composer holds the decision. */
function PlanComposer({ start }: { start: boolean }) {
  const [text, setText] = useState(start ? plan.comment : '');
  const [verdict, setVerdict] = useState<Verdict>(null);
  const typed = text.trim().length > 0;
  return (
    <>
      <div className="xl-prose xc-plan-prose">
        <p className="xc-plan-title">{plan.title}</p>
        {plan.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <Steps />
      </div>
      <Block className="xc-composer xc-plan-composer" radius={26}>
        <textarea className="xl-field" rows={1} placeholder={verdict ? composer.placeholder : 'Say what to change'} aria-label="Message" value={verdict ? '' : text} onChange={(e) => setText(e.target.value)} />
        <div className="xl-tools">
          <span className="xl-gbtn" aria-hidden>
            <Plus size={17} strokeWidth={1.75} />
          </span>
          <span className="xl-grow" />
          {verdict ? (
            <Done word={verdict === 'approved' ? 'Approved' : 'Sent back'} />
          ) : (
            <button type="button" className="xl-btn xc-plan-go" data-kind="go" onClick={() => setVerdict(typed ? 'returned' : 'approved')}>
              {typed ? 'Send back' : 'Approve'}
            </button>
          )}
        </div>
      </Block>
    </>
  );
}

export function PlanPage() {
  const { open } = useBoard();
  return (
    <>
      <Variant n={0}>
        <Card state="plan" title={planning.title} line={planning.line} age={planning.age} label="Waiting for you" />
      </Variant>
      <Variant n={1}>
        <Card state="plan" title={planning.title} age={planning.age} label="Waiting for you">
          <Steps className="xc-steps-card" />
          <Verdicts start={open} key={String(open)} />
        </Card>
      </Variant>
      <Variant n={2}>
        <PlanComposer start={open} key={String(open)} />
      </Variant>
      <Variant n={3}>
        <Block className="xc-plan-sheet">
          <div className="xc-plan-title">{plan.title}</div>
          {plan.paragraphs.map((p) => (
            <p key={p} className="xc-plan-p">
              {p}
            </p>
          ))}
          <Steps />
          <Verdicts start={open} key={String(open)} />
        </Block>
      </Variant>
    </>
  );
}
