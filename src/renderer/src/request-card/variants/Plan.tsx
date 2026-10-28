// The plan body (C7 execution document, Request card): the plan through C6's `Markdown` (static), bounded with Show
// more; Implement (Enter), Keep planning (Esc: opens and focuses the feedback box, whose Enter or ⌘Enter sends), and
// Clear context and implement behind one confirmation, since it resets the conversation. P5 O9 M6: each outcome the
// session's port can't carry (a terminal session's "clear and implement": /clear runs in the terminal) is drawn disabled
// in place with its reason, and no key answers it.
import { useEffect, useRef, useState } from 'react';
import { Markdown } from '../../transcript';
import { TranscriptActionsProvider } from '../../transcript/view/context';
import { openFile } from '../../tools/code/open-file';
import { toAnswer } from '../answers';
import { CardButton, CardTextarea, Controls, Muted } from '../controls';
import { gated, type VariantProps } from './types';

export function PlanBody({ item, request, busy, submit, bindKeys, capability }: VariantProps<'plan.requested'>) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null); // null: the feedback box is closed
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const implementGate = gated(capability(toAnswer({ kind: 'plan', outcome: 'implement' })));
  const feedbackGate = gated(capability(toAnswer({ kind: 'plan', outcome: 'keep_planning', feedback: feedback ?? '' })));
  const clearGate = gated(capability(toAnswer({ kind: 'plan', outcome: 'clear_and_implement' })));
  const implement = () => !implementGate.disabled && submit(toAnswer({ kind: 'plan', outcome: 'implement' }), 'Implement');
  const keepPlanning = () => {
    if (feedback === null) setFeedback('');
    else box.current?.querySelector('textarea')?.focus();
  };
  const sendFeedback = () => !feedbackGate.disabled && submit(toAnswer({ kind: 'plan', outcome: 'keep_planning', feedback: feedback ?? '' }), 'Keep planning');
  const clearAndImplement = () => !clearGate.disabled && submit(toAnswer({ kind: 'plan', outcome: 'clear_and_implement' }), 'Clear context and implement');

  useEffect(() => bindKeys({ accept: implementGate.disabled ? null : implement, decline: feedbackGate.disabled ? null : keepPlanning }));

  return (
    <div className="flex flex-col gap-3">
      <div className={`overflow-hidden rounded-sm border border-border bg-bg px-3 py-2 ${expanded ? '' : 'max-h-80'}`}>
        <TranscriptActionsProvider actions={{ openFile: (path, line) => openFile(item.appSessionId, path, line) }}>
          <Markdown markdown={request.plan} live={false} />
        </TranscriptActionsProvider>
      </div>
      <button type="button" onClick={() => setExpanded((e) => !e)} className="self-start text-ui-sm text-fg-muted underline outline-accent focus-visible:outline-2">
        {expanded ? 'Show less' : 'Show more'}
      </button>
      {feedback !== null && (
        <div ref={box} className="flex flex-col gap-1.5">
          <CardTextarea label="What should change in the plan" value={feedback} onChange={setFeedback} onSubmit={sendFeedback} submitOnEnter autoFocus disabled={busy} />
          <Controls>
            <CardButton disabled={busy || feedbackGate.disabled} title={feedbackGate.title} onClick={sendFeedback}>
              Send feedback
            </CardButton>
          </Controls>
        </div>
      )}
      {confirming && (
        <div role="alert" className="flex flex-col gap-2 rounded-sm border border-warning px-3 py-2">
          <Muted>This resets the conversation and starts a fresh turn seeded with the plan</Muted>
          <Controls>
            <CardButton disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </CardButton>
            <CardButton tone="primary" disabled={busy || clearGate.disabled} title={clearGate.title} onClick={clearAndImplement}>
              Clear and implement
            </CardButton>
          </Controls>
        </div>
      )}
      <Controls>
        <CardButton disabled={busy || confirming || clearGate.disabled} title={clearGate.title} onClick={() => setConfirming(true)} className="mr-auto">
          Clear context and implement
        </CardButton>
        {feedback === null && (
          <CardButton disabled={busy || feedbackGate.disabled} title={feedbackGate.title} onClick={keepPlanning}>
            Keep planning
          </CardButton>
        )}
        <CardButton tone="primary" disabled={busy || implementGate.disabled} title={implementGate.title} onClick={implement}>
          Implement
        </CardButton>
      </Controls>
    </div>
  );
}
