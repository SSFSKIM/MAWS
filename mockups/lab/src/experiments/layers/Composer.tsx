// The composer, as the suggested set of the Choices board left it (DESIGN.md section 17). At rest it is a field and
// a round button: the model's chip is there while the pointer or the caret is, the context mark stays in the menu
// until the window is nearly full, and a message that waits for its turn stands above the composer, where it will
// be sent from. Send and stop are two things, so a turn can always be stopped.
//
// It is also where a session is answered. What a session waits on rides in its composer: an approval's command and
// two answers, a question's options one question at a time, a plan's decision. Typing is always the other answer.
import { useCallback, useState, type KeyboardEvent } from 'react';
import { ArrowUp, ChevronDown, ChevronRight, Folder, GitBranch, Plus, Square, X } from 'lucide-react';
import { approval, composer, projects, question, type Session } from '../../content/fixtures';
import { Chips, useNeeds } from './needs';
import { GBtn, isYours, Pop, Ring } from './parts';

/** The share of the context window from which its mark comes back to the composer by itself. */
const NEAR_FULL = 0.8;
const pct = `${Math.round(composer.context * 100)}%`;

export function Composer({ session, fresh }: { session?: Session; fresh?: boolean }) {
  const { reply, draft } = useNeeds();
  const [text, setText] = useState('');
  const [held, setHeld] = useState(true);
  const [step, setStep] = useState(0);
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const said = text.trim();
  const typed = said.length > 0;
  const wait = session && isYours(session.state) ? session.state : null;
  const running = session?.state === 'running';
  // The queued message of the fixtures belongs to the session that is on screen at first.
  const queued = session?.id === 's1' && running && held;
  const project = session ? projects.find((p) => p.sessions.some((s) => s.id === session.id)) : undefined;
  const id = session?.id ?? '';

  const q = question.questions[Math.min(step, question.questions.length - 1)]!;
  const last = step >= question.questions.length - 1;
  const chosen = wait === 'question' && draft[step]!.length > 0;

  // The composer's one primary act, whatever it is at the moment; Return does the same.
  const act = () => {
    if (wait === 'question') {
      if (typed) reply(id, { kind: 'said', text: said });
      else if (chosen && last) reply(id, { kind: 'chose', picked: draft });
      else if (chosen) setStep(step + 1);
      else return;
    } else if (wait === 'plan') reply(id, typed ? { kind: 'said', text: said } : { kind: 'approved' });
    else if (wait === 'approval') {
      if (!typed) return;
      reply(id, { kind: 'said', text: said });
    } else if (!typed) return;
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    // An empty Return never approves anything: a decision is a press.
    if (typed || (wait === 'question' && chosen)) act();
  };

  const placeholder = fresh
    ? undefined
    : wait === 'approval'
      ? 'Or say what to do instead'
      : wait === 'question'
        ? 'Or say it in your own words'
        : wait === 'plan'
          ? 'Say what to change'
          : composer.placeholder;

  return (
    <>
      {queued && (
        <div className="xl-waits" title="Sends when this turn ends">
          <span className="xl-fade">{composer.queued}</span>
          <button type="button" className="xl-queued-x" aria-label="Remove the queued message" onClick={() => setHeld(false)}>
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      )}

      {wait === 'approval' && (
        <div className="xl-strip">
          <div className="xl-ask-cmd">{approval.command}</div>
          <p className="xl-ask-why">{approval.why}</p>
        </div>
      )}
      {wait === 'question' && (
        <div className="xl-strip" data-kind="question">
          <div className="xl-q-bar">
            <span className="xl-q-ask">{q.ask}</span>
            <span className="xl-q-dots" role="group" aria-label={`Question ${step + 1} of ${question.questions.length}`}>
              {question.questions.map((x, i) => (
                <button key={x.ask} type="button" aria-label={`Question ${i + 1}`} aria-current={i === step || undefined} onClick={() => setStep(i)} />
              ))}
            </span>
          </div>
          <div className="xl-q-chips" key={step}>
            <Chips q={q} at={step} />
          </div>
        </div>
      )}

      <textarea className="xl-field" rows={1} placeholder={placeholder} aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} />
      <div className="xl-tools">
        <GBtn label="Attach" tip="Attach" data-tip-at="above-start">
          <Plus size={17} strokeWidth={1.75} />
        </GBtn>
        <span className="xl-grow" />
        <button type="button" ref={setEl} className="xl-chip" data-approach="" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {composer.model}
          <ChevronDown size={13} strokeWidth={2} />
        </button>
        {!fresh && composer.context >= NEAR_FULL && (
          <GBtn label={`${pct} of the context window is in use`} tip={`${pct} of context used`} data-tip-at="above">
            <Ring value={composer.context} size={17} />
          </GBtn>
        )}

        {wait === 'approval' && !typed ? (
          <>
            <button type="button" className="xl-btn xl-act" onClick={() => reply(id, { kind: 'denied' })}>
              Deny
            </button>
            <button type="button" className="xl-btn xl-act" data-kind="go" onClick={() => reply(id, { kind: 'approved' })}>
              Approve
            </button>
          </>
        ) : wait === 'plan' ? (
          <button type="button" className="xl-btn xl-act" data-kind="go" onClick={act}>
            {typed ? 'Send back' : 'Approve'}
          </button>
        ) : (
          <>
            {running && (
              <button type="button" className="xl-gbtn xl-stop" aria-label="Stop" data-tip="Stop" data-tip-at="above">
                <Square size={11} strokeWidth={0} fill="currentColor" />
              </button>
            )}
            <button
              type="button"
              className="xl-send"
              data-kind={typed || chosen ? 'go' : 'idle'}
              aria-label={wait === 'question' && !typed && !last ? 'Next question' : 'Send'}
              disabled={!(typed || chosen)}
              onClick={act}
            >
              <ArrowUp size={17} strokeWidth={2.25} />
            </button>
          </>
        )}
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
        {!fresh && composer.context < NEAR_FULL && (
          <div className="xl-item">
            <span>Context</span>
            <span className="xl-item-value">{pct}</span>
            <Ring value={composer.context} size={15} />
          </div>
        )}
        <div className="xl-sep" />
        <div className="xl-item">
          <Folder size={15} strokeWidth={1.75} />
          <span>{project?.name ?? composer.folder}</span>
        </div>
        {(session ? session.branch : composer.branch) && (
          <div className="xl-item">
            <GitBranch size={15} strokeWidth={1.75} />
            <span>{session ? session.branch : composer.branch}</span>
          </div>
        )}
      </Pop>
    </>
  );
}
