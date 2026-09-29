// The Direct model choice's body and its dialog (C11 execution document, Interfaces "Gateway": `pickDirectModel`, the
// sheet the switch embeds). The catalogue's Claude group (C10's `engine.models`, answered before any process), `default`
// preselected, each row with its display name and the `Cannot hold auto mode` caption where it applies; the answer
// carries the effort the chosen entry admits.
import { useState } from 'react';
import { EffortSchema, type Effort } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { ModelCatalogueEntry } from '@shared/sessions/models';
import { useCommand } from '../ipc/query';
import { useSessions } from '../stores/sessions';
import { effortsOf, presentModels, type ModelRow } from '../widgets/model';
import { DIRECT_MODEL } from './copy';
import { directChoice, preselected, useDirectModelPick } from './direct-model';
import { GatewaySheet } from './GatewaySheet';
import type { SwitchAnswer } from './switch-route';

// A catalogue entry as a model row: C10's entries are loose, so the capability keys are read as C3 types them, and the
// untyped `supportedEffortLevels` is parsed (absent: the whole vocabulary).
const rowOfEntry = (entry: ModelCatalogueEntry): ModelRow => ({
  value: entry.value,
  displayName: entry.displayName,
  ...(entry.supportsAutoMode !== undefined && { supportsAutoMode: entry.supportsAutoMode }),
  ...(entry.supportsFastMode !== undefined && { supportsFastMode: entry.supportsFastMode }),
  supportedEffortLevels: effortsOf({ supportedEffortLevels: entry.supportedEffortLevels }),
});

// The catalogue's Claude-group models (null while it is read, or while `enabled` is false: nothing is asked), from the
// direct route's cache: the host keys its catalogue by route, and a route left unnamed answers the latest one updated.
export function useClaudeModels(enabled = true): readonly ModelRow[] | null {
  const read = useCommand('engine.models', { refresh: false, gateway: 'direct' }, { staleTime: 60_000, enabled });
  if (!read.data) return read.isError ? [] : null;
  const rows = read.data.models.map(rowOfEntry);
  const claude = new Set(presentModels(rows).claude.map((m) => m.value));
  return rows.filter((m) => claude.has(m.value));
}

// The effort the session runs at now (the status's, else the record's), for the chosen entry's admitted levels.
export function useCurrentEffort(appSessionId: AppSessionId): Effort | null {
  return useSessions((s) => {
    const parsed = EffortSchema.safeParse(s.engine.get(appSessionId)?.effort ?? s.records.get(appSessionId)?.effort ?? null);
    return parsed.success ? parsed.data : null;
  });
}

// The chosen row: the human's pick, else (with `preselect`) `default` once the catalogue is read. The switch sheet asks
// for an explicit pick, since the restart changes the session's model; `pickDirectModel`'s dialog, whose one act is the
// choice, preselects.
export function useDirectChoice(appSessionId: AppSessionId, initial: string | null, preselect: boolean, enabled = true) {
  const models = useClaudeModels(enabled);
  const effort = useCurrentEffort(appSessionId);
  const [picked, pick] = useState<string | null>(initial);
  const row = models === null ? null : (models.find((m) => m.value === picked) ?? (preselect ? preselected(models) : null));
  const answer: SwitchAnswer | null = row ? directChoice(row, effort) : null;
  return { models, row, answer, pick };
}

export function DirectModelList({ models, chosen, pick }: { models: readonly ModelRow[] | null; chosen: string | null; pick(value: string): void }) {
  if (models === null) return <p className="m-0 text-ui-sm text-fg-muted">{DIRECT_MODEL.loading}</p>;
  if (models.length === 0) return <p className="m-0 text-ui-sm text-fg-muted">{DIRECT_MODEL.none}</p>;
  const views = presentModels(models).claude;
  return (
    <div role="radiogroup" aria-label={DIRECT_MODEL.list} className="flex max-h-56 flex-col overflow-auto">
      {views.map((entry) => (
        <button
          key={entry.value}
          type="button"
          role="radio"
          aria-checked={entry.value === chosen}
          onClick={() => pick(entry.value)}
          className="flex w-full flex-col items-start rounded-sm px-2 py-1 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 aria-checked:bg-bg-active"
        >
          <span>{entry.displayName}</span>
          {entry.cannotHoldAuto && <span className="text-ui-sm text-fg-faint">{DIRECT_MODEL.cannotHoldAuto}</span>}
        </button>
      ))}
    </div>
  );
}

// `pickDirectModel`'s dialog, rendered by the gateway's dialog host while a pick is open.
export function DirectModelDialog() {
  const picking = useDirectModelPick((s) => s.picking);
  if (!picking) return null;
  return <PickDialog key={picking.appSessionId} appSessionId={picking.appSessionId} resolve={picking.resolve} />;
}

function PickDialog({ appSessionId, resolve }: { appSessionId: AppSessionId; resolve(choice: { model: string; effort: Effort | null } | null): void }) {
  const { models, row, answer, pick } = useDirectChoice(appSessionId, null, true);
  return (
    <GatewaySheet
      title={DIRECT_MODEL.title}
      onClose={() => resolve(null)}
      canSubmit={answer?.model != null}
      onSubmit={() => answer?.model && resolve({ model: answer.model, effort: answer.effort })}
      submitLabel={DIRECT_MODEL.choose}
      cancelLabel={DIRECT_MODEL.cancel}
    >
      <p className="m-0 text-fg-muted">{DIRECT_MODEL.why}</p>
      <DirectModelList models={models} chosen={row?.value ?? null} pick={pick} />
    </GatewaySheet>
  );
}
