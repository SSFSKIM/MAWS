// The plan body (C7 execution document, Request card): the plan through C6's `Markdown` (static), bounded with Show
// more; Implement (Enter), Keep planning (Esc: opens and focuses the feedback box, whose Enter or ⌘Enter sends), and
// Clear context and implement behind one confirmation, since it resets the conversation. P5 O9 M6: each outcome the
// session's port can't carry (a terminal session's "clear and implement": /clear runs in the terminal) is drawn disabled
// in place with its reason, and no key answers it.
// UX wave U1a §F (A12; l4-approvals-11): Implement names the mode the session will be in afterwards, the one it had
// before Plan, which a plain allow restores; and where a mode can be chosen (a session MAWS runs on this Mac whose engine
// host has this build's wire, and whose port carries a named mode) a menu on it lists the other modes an approval may
// name, each sending its mode. Where none can be chosen on this Mac the button reads "Implement", today's card; on a
// session another machine runs it names the mode that machine's status gives, with no menu.
import { DropdownMenu } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import type { PermissionMode } from '@shared/graph/enums';
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import { hostAppliesPlanMode, PLAN_NEXT_MODES } from '@shared/sessions/plan-next-mode';
import { Markdown } from '../../transcript';
import { TranscriptActionsProvider } from '../../transcript/view/context';
import { openFile } from '../../tools/code/open-file';
import { ipc } from '../../ipc/client';
import { MODE_OPTIONS } from '../../statusline/mode-menu';
import { useHosts } from '../../stores/hosts';
import { useSessions } from '../../stores/sessions';
import { toAnswer } from '../answers';
import { CardButton, CardTextarea, Controls, Muted } from '../controls';
import { carried, gated, type VariantProps } from './types';

const MENU = 'z-50 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg';
const MENU_ITEM = 'cursor-default rounded-sm px-2.5 py-1 outline-none data-[disabled]:text-fg-faint data-[highlighted]:bg-bg-hover';
// The modes a menu may list, in the mode menu's order
const NEXT_MODES = MODE_OPTIONS.map((option) => option.mode).filter((mode) => PLAN_NEXT_MODES.includes(mode));

const implementLabel = (mode: PermissionMode | null) => (mode === null ? 'Implement' : `Implement · ${PERMISSION_MODE_LABELS[mode]}`);

/**
 * The mode Implement names (null: "Implement") and the modes its menu lists. `here`: the session runs on this Mac;
 * `applies`: this Mac's engine host applies a named mode (`hostAppliesPlanMode`); `carries`: the session's port carries an
 * answer naming that mode.
 */
export function planChoices({ prePlanMode, here, applies, carries }: { prePlanMode: PermissionMode | null; here: boolean; applies: boolean; carries: (mode: PermissionMode) => boolean }): {
  button: PermissionMode | null;
  menu: PermissionMode[];
} {
  const menu = here && applies ? NEXT_MODES.filter((mode) => mode !== prePlanMode && carries(mode)) : [];
  return { button: prePlanMode !== null && (!here || menu.length > 0) ? prePlanMode : null, menu };
}

const onThisMac = (appSessionId: AppSessionId) => !isAddress(appSessionId) || machineOf(appSessionId) === ipc.localMachine;

export function PlanBody({ item, request, busy, submit, bindKeys, capability = carried }: VariantProps<'plan.requested'>) {
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null); // null: the feedback box is closed
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const prePlanMode = useSessions((s) => s.engine.get(item.appSessionId)?.prePlanMode ?? null);
  const applies = useHosts((s) => hostAppliesPlanMode(s.supervisor)); // the gate the port reads again: a change draws the card again
  const implementIn = (mode: PermissionMode) => toAnswer({ kind: 'plan', outcome: 'implement', mode });
  const choices = planChoices({ prePlanMode, here: onThisMac(item.appSessionId), applies, carries: (mode) => capability(implementIn(mode)).available });
  const implementGate = gated(capability(toAnswer({ kind: 'plan', outcome: 'implement' })));
  const feedbackGate = gated(capability(toAnswer({ kind: 'plan', outcome: 'keep_planning', feedback: feedback ?? '' })));
  const clearGate = gated(capability(toAnswer({ kind: 'plan', outcome: 'clear_and_implement' })));
  const implement = () => !implementGate.disabled && submit(toAnswer({ kind: 'plan', outcome: 'implement' }), implementLabel(choices.button));
  // An entry pressed after the gate turned (its menu drawn under the gate) sends nothing: the gate and the port are read
  // at the press, and the card is drawn again from the store without the menu.
  const implementInMode = (mode: PermissionMode) =>
    hostAppliesPlanMode(useHosts.getState().supervisor) && capability(implementIn(mode)).available && submit(implementIn(mode), implementLabel(mode));
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
        <span className="flex">
          <CardButton tone="primary" disabled={busy || implementGate.disabled} title={implementGate.title} onClick={implement} className={choices.menu.length === 0 ? '' : 'rounded-r-none'}>
            {implementLabel(choices.button)}
          </CardButton>
          {choices.menu.length > 0 && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <CardButton tone="primary" disabled={busy} aria-label="More implement options" className="rounded-l-none border-l-bg px-1.5">
                  ▾
                </CardButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
                  {choices.menu.map((mode) => (
                    <DropdownMenu.Item key={mode} onSelect={() => implementInMode(mode)} className={MENU_ITEM}>
                      {implementLabel(mode)}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </span>
      </Controls>
    </div>
  );
}
