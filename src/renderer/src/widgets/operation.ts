// A widget's operation (C11 execution document, Interfaces "Operations"; C3's control channel): Reload, Reconnect and
// Toggle answer an `OperationReceipt { opId }` and complete on `session.operation`, once, and once more with
// `late: true` when a timed-out request answers after all. The hook listens before it asks, so a completion that
// arrives ahead of the receipt is not lost, follows only its own `opId`, and only while the widget is mounted: a widget
// closed mid-operation shows nothing later (the effect is visible in the next read). A rejected invoke is the transport
// branch, apart from every outcome.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationCommand, OperationEvent } from '@shared/engine/operations';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { OPERATION } from './copy';
import { transportWords } from './read';

// An outcome in words: the value summarised, or the error's message and code.
export const outcomeWords = (outcome: OperationEvent['outcome'], summarise: (value: unknown) => string): string =>
  outcome.ok ? summarise(outcome.value) : OPERATION.failed(outcome.error.message, outcome.error.code);

export type OperationState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'settled'; outcome: OperationEvent['outcome']; late: boolean } // late: a late completion corrected the first
  | { phase: 'unsent'; error: string }; // the invoke itself was refused: nothing was asked of the engine

export interface Operation<C extends OperationCommand> {
  state: OperationState;
  // Starts the operation; answers its first completion (or null when the invoke was refused or the widget closed).
  run(input: Omit<CommandInput<C>, 'appSessionId'>): Promise<OperationEvent['outcome'] | null>;
}

export function useOperation<C extends OperationCommand>(appSessionId: AppSessionId, command: C, onLate?: (outcome: OperationEvent['outcome']) => void): Operation<C> {
  const [state, setState] = useState<OperationState>({ phase: 'idle' });
  const mine = useRef<string | null>(null); // the opId this widget waits on
  const early = useRef(new Map<string, OperationEvent>()); // completions that arrived before their receipt
  const waiting = useRef<((outcome: OperationEvent['outcome'] | null) => void) | null>(null);
  const late = useRef(onLate);
  useEffect(() => {
    late.current = onLate;
  });

  const settle = useCallback((event: OperationEvent) => {
    if (event.late) {
      setState({ phase: 'settled', outcome: event.outcome, late: true });
      late.current?.(event.outcome);
      return;
    }
    setState({ phase: 'settled', outcome: event.outcome, late: false });
    waiting.current?.(event.outcome);
    waiting.current = null;
  }, []);

  useEffect(() => {
    const off = ipc.on('session.operation', (event) => {
      if (event.appSessionId !== appSessionId || event.command !== command) return;
      if (event.opId === mine.current) settle(event);
      else if (mine.current === null && waiting.current !== null) early.current.set(event.opId, event); // asked, receipt not back yet
    });
    return () => {
      off();
      mine.current = null;
      waiting.current?.(null);
      waiting.current = null;
    };
  }, [appSessionId, command, settle]);

  const run = useCallback(
    async (input: Omit<CommandInput<C>, 'appSessionId'>) => {
      setState({ phase: 'working' });
      mine.current = null;
      early.current.clear();
      const completed = new Promise<OperationEvent['outcome'] | null>((resolve) => (waiting.current = resolve));
      const result = await ipc.invoke(command, { ...input, appSessionId } as CommandInput<C>);
      if (!result.ok) {
        waiting.current = null;
        setState({ phase: 'unsent', error: transportWords(result.error) });
        return null;
      }
      const { opId } = result.value as { opId: string };
      mine.current = opId;
      const arrived = early.current.get(opId);
      early.current.clear();
      if (arrived) settle(arrived);
      return completed;
    },
    [appSessionId, command, settle],
  );

  return { state, run };
}

// What an operation's line says: nothing before it runs, `Working…`, the outcome, or the correction a late one made.
export function operationLine(state: OperationState, summarise: (value: unknown) => string): string | null {
  switch (state.phase) {
    case 'idle':
      return null;
    case 'working':
      return OPERATION.working;
    case 'unsent':
      return state.error;
    case 'settled':
      return state.late && state.outcome.ok ? OPERATION.appliedAfterAll : outcomeWords(state.outcome, summarise);
  }
}
