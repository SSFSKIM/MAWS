// E2 (M4): what an HTML deliverable's frame logged (Design §8), the shown version's messages in the store's ring buffer,
// drawn by the chip P3-L (M5b) moved beside the artifact store's viewers (`../artifacts/viewers/ConsoleChip`). Shared
// with the transcript's artifact row (M5), so it reads the store by its key alone.
import type { AppSessionId } from '@shared/graph/ids';
import { ConsoleEntriesChip } from '../artifacts/viewers/ConsoleChip';
import { consoleKey, useDeliverables, type ConsoleEntry } from './store';

const NONE: ConsoleEntry[] = [];

export function ConsoleChip({ appSessionId, deliverableId, version }: { appSessionId: AppSessionId; deliverableId: string; version: number }) {
  const entries = useDeliverables((s) => s.console.get(consoleKey(appSessionId, deliverableId, version)) ?? NONE);
  return <ConsoleEntriesChip entries={entries} />;
}
