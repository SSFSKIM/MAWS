// The Direct model choice's body and its dialog (C11 execution document, Interfaces "Gateway": `pickDirectModel`, the
// sheet the switch embeds). The catalogue's Claude group (C10's `engine.models`, answered before any process), `default`
// preselected, each row with its display name and the `Cannot hold auto mode` caption where it applies; the answer
// carries the effort the chosen entry admits.
import { useState } from 'react';
import { EffortSchema, type Effort } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import type { ModelCatalogueEntry } from '@shared/sessions/models';
import { DEFAULT_ROW, listName } from '../composer/frame/model-label';
import { useCommand } from '../ipc/query';
import { useSetup } from '../sessions/store';
import { settingsDirectoryOf } from '../sessions/useSetupIntent';
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
  ...(typeof entry.resolvedModel === 'string' && { resolvedModel: entry.resolvedModel }), // W3: what `default` runs
  ...(entry.supportsAutoMode !== undefined && { supportsAutoMode: entry.supportsAutoMode }),
  ...(entry.supportsFastMode !== undefined && { supportsFastMode: entry.supportsFastMode }),
  supportedEffortLevels: effortsOf({ supportedEffortLevels: entry.supportedEffortLevels }),
});

// The catalogue's Claude-group models (null while it is read, or while `enabled` is false: nothing is asked), from the
// direct route's cache: the host keys its catalogue by route, and a route left unnamed answers the latest one updated.
// With the session's directory, whose settings may set a model environment of its own (debt wave 5).
export function useClaudeModels(enabled = true, cwd: string | null = null): readonly ModelRow[] | null {
  const read = useCommand('engine.models', cwd === null ? { refresh: false, gateway: 'direct' } : { refresh: false, gateway: 'direct', cwd }, { staleTime: 60_000, enabled });
  if (!read.data) return read.isError ? [] : null;
  const all = read.data.models.map(rowOfEntry);
  const rows = all.map((m) => (m.value === DEFAULT_ROW ? { ...m, displayName: listName(m, all) } : m)); // W3: `default` named by the model it runs
  const claude = new Set(presentModels(rows).claude.map((m) => m.value));
  return rows.filter((m) => claude.has(m.value));
}

// The effort the session runs at, or will start at, for the chosen entry's admitted levels: the status's, else the
// record's, else (an unstarted session, which has neither) its setup intent's.
export function useCurrentEffort(appSessionId: AppSessionId): Effort | null {
  const live = useSessions((s) => s.engine.get(appSessionId)?.effort ?? s.records.get(appSessionId)?.effort ?? null);
  const intended = useSetup((s) => s.intents.get(appSessionId)?.effort ?? null);
  const parsed = EffortSchema.safeParse(live ?? intended);
  return parsed.success ? parsed.data : null;
}

// The directory the session runs in, or will start in: the status's, else the record's, else its setup intent's.
export function useSessionDirectory(appSessionId: AppSessionId): string | null {
  const known = useSessions((s) => s.engine.get(appSessionId)?.cwd || s.records.get(appSessionId)?.directory || null);
  const intended = useSetup((s) => {
    const intent = s.intents.get(appSessionId);
    return intent?.location ? settingsDirectoryOf(intent.location) : null;
  });
  return known ?? intended;
}

// The chosen row: the human's pick, else (with `preselect`) `default` once the catalogue is read. The switch sheet asks
// for an explicit pick, since the restart changes the session's model; `pickDirectModel`'s dialog, whose one act is the
// choice, preselects.
export function useDirectChoice(appSessionId: AppSessionId, initial: string | null, preselect: boolean, enabled = true) {
  const models = useClaudeModels(enabled, useSessionDirectory(appSessionId));
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
          <span className="flex items-baseline gap-1.5">
            {entry.displayName}
            {entry.value === DEFAULT_ROW && <span className="rounded-sm bg-bg-active px-1 text-ui-sm text-fg-muted">{DIRECT_MODEL.defaultBadge}</span>}
          </span>
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
