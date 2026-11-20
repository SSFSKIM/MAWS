import type { AppSessionId } from '@shared/graph/ids';
import { useTranscriptStore } from '../../stores/transcript';
import type { Row } from '../model/rows';
import { useTranscriptContext } from '../view/context';

export function useTranscriptSurface(row: Pick<Row, 'turnId'>) {
  const { storeKey, variant } = useTranscriptContext();
  const state = useTranscriptStore((s) => s.entries[storeKey]?.state);
  return { appSessionId: variant === 'session' && storeKey ? storeKey as AppSessionId : null, storeKey, state, turn: row.turnId === null ? undefined : state?.turns.get(row.turnId) };
}

// P2-E1 (M2); UX wave U2b (panel finding 1): the session whose surface a row that draws the owner channel asks (assistant
// text, a message tool's message): none in a transcript mounted with `presentation: 'local'`, the comment card's, which
// draws that channel through MAWS whatever the attachment.
export function useOwnerChannelSurface(): AppSessionId | null {
  const { storeKey, variant, presentation } = useTranscriptContext();
  return variant === 'session' && storeKey && presentation !== 'local' ? storeKey as AppSessionId : null;
}
