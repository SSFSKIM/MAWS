import type { AppSessionId } from '@shared/graph/ids';
import { useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../model/rows';
import { useTranscriptContext } from '../view/context';

export function useTranscriptSurface(row: Pick<Row, 'turnId'>) {
  const { storeKey, variant } = useTranscriptContext();
  const state = useTranscriptStore((s) => s.entries[storeKey]?.state);
  return { appSessionId: variant === 'session' && storeKey ? storeKey as AppSessionId : null, storeKey, state, turn: row.turnId === null ? undefined : state?.turns.get(row.turnId) };
}
