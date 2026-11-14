// What a session waits on, and how it is answered. Three kinds wait for the person: an approval, a question, a plan.
// One rule covers them: a session's own composer answers what it waits on (Composer.tsx), and the card that opens
// from the waiting capsule or from the session's row in the pane answers the same thing from elsewhere (`Remote`
// here). Both write to one place, so an answer given in either is the answer. Once given, the transcript keeps a
// record of it where the person's own messages stand (`Kept` here).
import { createContext, useContext, useState } from 'react';
import { Check, X } from 'lucide-react';
import { approval, plan, projects, question, type Question, type Session, type SessionState } from '../../content/fixtures';
import { Fold } from './parts';

export type Reply =
  | { kind: 'approved' }
  | { kind: 'denied' }
  /** Words of the person's own: a plan sent back, an approval refused with what to do instead, a question answered freely. */
  | { kind: 'said'; text: string }
  /** A question answered by its options: what was chosen, per question. */
  | { kind: 'chose'; picked: number[][] };

export interface Needs {
  replies: Record<string, Reply | undefined>;
  reply: (id: string, r: Reply) => void;
  /** The question's answer while it is being made, shared by the composer and the card. */
  draft: number[][];
  toggle: (q: number, o: number) => void;
  /** Open a session: its tab, its transcript. */
  open: (id: string) => void;
  /** What opens a file a session changed as a tab beside it; undefined for a file the lab holds no body of. */
  file: (path: string, session: string) => (() => void) | undefined;
}

export const NeedsCtx = createContext<Needs | null>(null);
export const useNeeds = () => useContext(NeedsCtx)!;

const all = projects.flatMap((p) => p.sessions);
/** What a session waited on before it was answered: its state in the fixtures. */
export const waitOf = (id: string): SessionState | undefined => all.find((s) => s.id === id)?.state;
export const emptyDraft = (): number[][] => question.questions.map(() => []);
export const nextDraft = (draft: number[][], q: number, o: number): number[][] =>
  draft.map((list, i) => (i !== q ? list : question.questions[q]!.multi ? (list.includes(o) ? list.filter((x) => x !== o) : [...list, o].sort()) : list.includes(o) ? [] : [o]));

/** The session as it stands once answered: back at work, or at rest after a plain refusal. */
export function after(s: Session, r: Reply | undefined): Session {
  if (!r) return s;
  if (r.kind === 'denied') return { ...s, state: 'idle', age: 'now' };
  // What it is doing now, for the places that say so in a line: the command it was allowed, the plan's first step,
  // the person's own words when they gave some, and the choices they made otherwise.
  const line =
    r.kind === 'said'
      ? r.text
      : r.kind === 'chose'
        ? question.questions.flatMap((q, i) => r.picked[i]!.map((o) => q.options[o]!.label)).join(', ')
        : s.state === 'approval'
          ? approval.command
          : s.state === 'plan'
            ? plan.steps[0]!
            : s.line;
  return { ...s, state: 'running', age: 'now', line };
}

// ---- pieces shared by the composer and the card -----------------------------------------------------------------------

/**
 * A question's options as chips: labels only, the sentence behind each one a hover away. A chosen chip takes a ring
 * of the ink and keeps its width, so a row never re-wraps under the pointer; squarer chips are "any of these",
 * round ones "one of these".
 */
export function Chips({ q, at, tip = 'above-start' }: { q: Question; at: number; tip?: string }) {
  const { draft, toggle } = useNeeds();
  return (
    <div className="xl-opts" role={q.multi ? 'group' : 'radiogroup'} aria-label={q.ask}>
      {q.options.map((o, i) => (
        <button key={o.label} type="button" className="xl-opt" data-multi={q.multi || undefined} aria-pressed={draft[at]!.includes(i)} data-tip={o.description} data-tip-at={tip} onClick={() => toggle(at, i)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Steps({ className }: { className?: string }) {
  return (
    <ol className={className ? `xl-steps ${className}` : 'xl-steps'}>
      {plan.steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

// ---- the card: the same answer from elsewhere ------------------------------------------------------------------------

function AskRemote({ id }: { id: string }) {
  const { reply } = useNeeds();
  return (
    <div className="xl-ask">
      <div className="xl-ask-cmd">{approval.command}</div>
      <p className="xl-ask-why">{approval.why}</p>
      <div className="xl-ask-acts">
        <button type="button" className="xl-btn" onClick={() => reply(id, { kind: 'denied' })}>
          Deny
        </button>
        <button type="button" className="xl-btn" data-kind="go" onClick={() => reply(id, { kind: 'approved' })}>
          Approve
        </button>
      </div>
    </div>
  );
}

function QuestionRemote({ id }: { id: string }) {
  const { reply, draft } = useNeeds();
  const [other, setOther] = useState('');
  const said = other.trim();
  const ready = said.length > 0 || draft.some((l) => l.length > 0);
  return (
    <div className="xl-ask xl-ask-q">
      {question.questions.map((q, i) => (
        <div className="xl-q" key={q.ask}>
          <div className="xl-q-ask">{q.ask}</div>
          <Chips q={q} at={i} />
        </div>
      ))}
      <input className="xl-input xl-q-other" placeholder="Something else" aria-label="Answer in your own words" value={other} onChange={(e) => setOther(e.target.value)} />
      <div className="xl-ask-acts">
        <button type="button" className="xl-btn" data-kind="go" disabled={!ready} onClick={() => reply(id, said ? { kind: 'said', text: said } : { kind: 'chose', picked: draft })}>
          Send
        </button>
      </div>
    </div>
  );
}

function PlanRemote({ id }: { id: string }) {
  const { reply } = useNeeds();
  const [back, setBack] = useState(false);
  // The field for the reason exists from the first time it is asked for.
  const [asked, setAsked] = useState(false);
  const [text, setText] = useState('');
  return (
    <div className="xl-ask">
      <Steps className="xl-steps-card" />
      <Fold open={back}>{asked && <input className="xl-input xl-q-other" placeholder="What should change?" aria-label="What should change" value={text} onChange={(e) => setText(e.target.value)} />}</Fold>
      <div className="xl-ask-acts">
        {back ? (
          <>
            <button type="button" className="xl-btn" onClick={() => setBack(false)}>
              Cancel
            </button>
            <button type="button" className="xl-btn" data-kind="go" disabled={text.trim().length === 0} onClick={() => reply(id, { kind: 'said', text: text.trim() })}>
              Send back
            </button>
          </>
        ) : (
          <>
            <button type="button" className="xl-btn" onClick={() => (setAsked(true), setBack(true))}>
              Send back
            </button>
            <button type="button" className="xl-btn" data-kind="go" onClick={() => reply(id, { kind: 'approved' })}>
              Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** What a waiting session's card holds under its head: the answer, for whichever kind it waits on. */
export function Remote({ session }: { session: Session }) {
  if (session.state === 'approval') return <AskRemote id={session.id} />;
  if (session.state === 'question') return <QuestionRemote id={session.id} />;
  if (session.state === 'plan') return <PlanRemote id={session.id} />;
  return null;
}

// ---- what the transcript keeps once it is answered -------------------------------------------------------------------

/**
 * The record of an answer, where the person's own messages stand. Words they wrote are a message like any other.
 * Choices they made are a message too, each under the question it answers, since the question lived in the
 * composer and would otherwise be gone. A decision with no words (approved, denied) is not a message: it is one
 * mark and one word on the person's side of the column.
 */
export function Kept({ id }: { id: string }) {
  const r = useNeeds().replies[id];
  if (!r) return null;
  if (r.kind === 'said')
    return (
      <div className="xl-user">
        <div className="xl-said">{r.text}</div>
      </div>
    );
  if (r.kind === 'chose')
    return (
      <div className="xl-user">
        <div className="xl-said xl-answer">
          {question.questions.map((q, i) =>
            r.picked[i]!.length === 0 ? null : (
              <div key={q.ask} className="xl-answer-pair">
                <div className="xl-answer-q">{q.ask}</div>
                <div>{r.picked[i]!.map((o) => q.options[o]!.label).join(', ')}</div>
              </div>
            ),
          )}
        </div>
      </div>
    );
  return (
    <div className="xl-user">
      <span className="xl-verdict">
        {r.kind === 'approved' ? <Check size={14} strokeWidth={2.25} /> : <X size={14} strokeWidth={2.25} />}
        {r.kind === 'approved' ? 'Approved' : 'Denied'}
      </span>
    </div>
  );
}
