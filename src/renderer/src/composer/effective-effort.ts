// The effort a live session runs at (W3; charter §5.4 as amended 2026-10-01). Neither the initialize response nor
// system/init carries it, and C3's status holds only the effort MAWS requested (null unless set); `get_settings`
// answers `applied.effort`, the model's default included (pass2/dialogs.jsonl seq 58: "high" for Sonnet with nothing
// configured; reads.jsonl seq 60: null for Haiku). It is a control read, so it is asked once when the session's process
// is ready and again only when what decides it moves (the launch, the requested or resolved model, the requested
// effort), never per mount: the answer is kept per session for every composer and the model selector.
import { useEffect } from 'react';
import { create } from 'zustand';
import * as z from 'zod';
import { EffortSchema, type Effort } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../ipc/client';
import { useSessions } from '../stores/sessions';

interface Known {
  basis: string;
  effort: Effort | null | undefined; // undefined: the answer named none (a replayed engine answers an unrecorded read empty)
}

export const useEffectiveEfforts = create<{ known: ReadonlyMap<AppSessionId, Known> }>()(() => ({ known: new Map() }));
const asked = new Map<AppSessionId, string>(); // the basis a read is in flight for

export function resetEffectiveEfforts(): void {
  asked.clear();
  useEffectiveEfforts.setState({ known: new Map() });
}

// What the effort depends on, for a ready process; null otherwise (nothing is asked of a process that cannot answer).
export const effortBasis = (status: EngineSessionStatus | null): string | null =>
  status?.process === 'ready' ? [status.launchId, status.model.requested ?? '', status.model.resolved ?? '', status.effort ?? ''].join('|') : null;

const AnswerSchema = z.looseObject({ applied: z.looseObject({ effort: EffortSchema.nullable().optional() }).nullable().optional() });

async function read(client: MawsBridge, appSessionId: AppSessionId, basis: string): Promise<void> {
  asked.set(appSessionId, basis);
  const result = await client.invoke('session.getSettings', { appSessionId });
  if (asked.get(appSessionId) === basis) asked.delete(appSessionId);
  if (!result.ok) return; // nothing kept: a later move of the basis asks again
  const answer = AnswerSchema.safeParse(result.value);
  const effort = answer.success ? answer.data.applied?.effort : undefined;
  useEffectiveEfforts.setState((s) => ({ known: new Map(s.known).set(appSessionId, { basis, effort }) }));
}

// The composer's side: asks when the basis moved, and answers the effort for the current basis (undefined while unknown).
export function useEffectiveEffort(appSessionId: AppSessionId, status: EngineSessionStatus | null, client: MawsBridge = ipc): Effort | null | undefined {
  const basis = effortBasis(status);
  const known = useEffectiveEfforts((s) => s.known.get(appSessionId));
  useEffect(() => {
    if (basis === null || known?.basis === basis || asked.get(appSessionId) === basis) return;
    void read(client, appSessionId, basis);
  }, [appSessionId, basis, known, client]);
  return known !== undefined && known.basis === basis ? known.effort : undefined;
}

// What a reader shows without asking (the model selector): the effort the engine runs at when known, else the one
// requested (status, then record).
export function useShownEffort(appSessionId: AppSessionId): Effort | null {
  const status = useSessions((s) => s.engine.get(appSessionId) ?? null);
  const record = useSessions((s) => s.records.get(appSessionId) ?? null);
  const basis = effortBasis(status);
  const known = useEffectiveEfforts((s) => s.known.get(appSessionId));
  const effective = known !== undefined && known.basis === basis ? known.effort : undefined;
  const requested = status ? status.effort : (EffortSchema.safeParse(record?.effort).data ?? null);
  return effective !== undefined ? effective : requested;
}
