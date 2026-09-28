// Shared setup for the row component tests: real rows from the model (events through the store), rendered inside a
// transcript context with spy actions. Not a test file itself.
import type { SessionEvent } from '@shared/graph/events';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { useTranscriptStore } from '../../../stores/transcript';
import type { Row } from '../../model/rows';
import type { TranscriptSource } from '../../source/types';
import { Disclosures, NO_ACTIONS, TranscriptProvider, type RewindInterface, type TranscriptActions } from '../context';
import { RowView } from './Row';

let keys = 0;

// A store key hydrated with `events`, and a push for later batches.
export async function storeWith(events: SessionEvent[]) {
  const key = `test-${++keys}`;
  let listener: ((batch: SessionEvent[]) => void) | null = null;
  const source: TranscriptSource = {
    subscribe(l) {
      listener = l;
      return () => (listener = null);
    },
    snapshot: () => Promise.resolve(events),
  };
  await useTranscriptStore.getState().attach(key, source);
  return {
    key,
    rows: () => useTranscriptStore.getState().rows(key),
    push: (batch: SessionEvent[]) => listener?.(batch),
  };
}

export function spyActions(): TranscriptActions {
  return {
    openSubagent: vi.fn(), openFullLog: vi.fn(), reviewChanges: vi.fn(), openFile: vi.fn(), openExternal: vi.fn(), editAndResubmit: vi.fn(),
    loadSpill: NO_ACTIONS.loadSpill,
  };
}

export function renderRow(row: Row, options: { storeKey?: string; actions?: TranscriptActions; rewind?: RewindInterface } = {}) {
  const actions = options.actions ?? spyActions();
  const value = { storeKey: options.storeKey ?? '', variant: 'session' as const, actions, rewind: options.rewind ?? null, renderRequest: null, disclosures: new Disclosures(), idPrefix: 't' };
  const view = render(
    <TranscriptProvider value={value}>
      <RowView row={row} />
    </TranscriptProvider>,
  );
  return {
    ...view,
    actions,
    rerenderRow: (next: Row) =>
      view.rerender(
        <TranscriptProvider value={value}>
          <RowView row={next} />
        </TranscriptProvider>,
      ),
  };
}

export const rowOf = <K extends Row['kind']>(rows: Row[], kind: K) => rows.find((row) => row.kind === kind) as Extract<Row, { kind: K }>;
