// The Direct model choice's body and its dialog (C11 execution document, Interfaces "Gateway": `pickDirectModel`, the
// sheet the switch embeds). The catalogue's Claude group, `default` preselected, each row with its display name and the
// `Cannot hold auto mode` caption where it applies; the answer carries the effort the chosen entry admits.
import { useQuery } from '@tanstack/react-query';
import { AlertDialog } from 'radix-ui';
import { useState } from 'react';
import { EffortSchema, type Effort } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../stores/sessions';
import { presentModels, type ModelRow } from '../widgets/model';
import { directCatalogue } from './c10-seam';
import { DIRECT_MODEL } from './copy';
import { directChoice, preselected, useDirectModelPick } from './direct-model';
import type { SwitchAnswer } from './switch-route';

// The session's Claude-group models (null while the catalogue is read, or while `enabled` is false: nothing is asked).
export function useClaudeModels(appSessionId: AppSessionId, enabled = true): readonly ModelRow[] | null {
  const read = useQuery({ queryKey: ['maws', 'gateway.directCatalogue', appSessionId], queryFn: () => directCatalogue(appSessionId), staleTime: 60_000, enabled });
  if (!read.data) return read.isError ? [] : null;
  const claude = new Set(presentModels(read.data).claude.map((m) => m.value));
  return read.data.filter((m) => claude.has(m.value));
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
  const models = useClaudeModels(appSessionId, enabled);
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

export const DIALOG = {
  overlay: 'fixed inset-0 z-40 bg-bg opacity-60',
  content: 'fixed top-[20%] left-1/2 z-50 flex w-[min(440px,90vw)] -translate-x-1/2 flex-col gap-3 rounded-lg border border-border-strong bg-bg-overlay p-4 text-ui text-fg',
  cancel: 'rounded-sm border border-border px-2 py-0.5 text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2',
  action: 'rounded-sm bg-accent px-2 py-0.5 text-bg outline-accent hover:opacity-90 focus-visible:outline-2 disabled:opacity-50',
};

// `pickDirectModel`'s dialog, rendered by the gateway's dialog host while a pick is open.
export function DirectModelDialog() {
  const picking = useDirectModelPick((s) => s.picking);
  if (!picking) return null;
  return <PickDialog key={picking.appSessionId} appSessionId={picking.appSessionId} resolve={picking.resolve} />;
}

function PickDialog({ appSessionId, resolve }: { appSessionId: AppSessionId; resolve(choice: { model: string; effort: Effort | null } | null): void }) {
  const { models, row, answer, pick } = useDirectChoice(appSessionId, null, true);
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && resolve(null)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={DIALOG.overlay} />
        <AlertDialog.Content className={DIALOG.content}>
          <AlertDialog.Title className="m-0 text-ui font-semibold">{DIRECT_MODEL.title}</AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-fg-muted">{DIRECT_MODEL.why}</AlertDialog.Description>
          <DirectModelList models={models} chosen={row?.value ?? null} pick={pick} />
          <div className="flex justify-end gap-2">
            <AlertDialog.Cancel className={DIALOG.cancel}>{DIRECT_MODEL.cancel}</AlertDialog.Cancel>
            <AlertDialog.Action className={DIALOG.action} disabled={answer === null} onClick={() => answer?.model && resolve({ model: answer.model, effort: answer.effort })}>
              {DIRECT_MODEL.choose}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
