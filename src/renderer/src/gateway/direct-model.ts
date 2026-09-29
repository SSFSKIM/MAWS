// The Direct model choice (C11 execution document, Interfaces "Gateway": `pickDirectModel`; the switch's `requiresModel`).
// The direct route cannot serve a relay alias (`claude/astra` and its siblings exist only in ClaudeUsage's catalogue), so
// a Direct switch or a Direct fallback on a gateway model first takes a model from the catalogue's Claude group, and the
// effort that model admits. The choice is the switch sheet's (embedded) and `pickDirectModel`'s (alone, for C10's relay
// card; Ask of C10 (7)).
import { create } from 'zustand';
import { EffortSchema, type Effort } from '@shared/engine/launch-spec';
import type { AppSessionId } from '@shared/graph/ids';
import { effortsOf, type ModelRow } from '../widgets/model';
import type { SwitchAnswer } from './switch-route';

const EFFORTS = EffortSchema.options; // low → max

// The launch's model and effort for a chosen entry: the effort is passed only when the entry does not admit the current
// one, as the highest level it admits at or below it (none below: its lowest).
export function directChoice(entry: ModelRow, currentEffort: Effort | null): SwitchAnswer {
  const admitted = effortsOf(entry);
  let effort: Effort | null = null;
  if (currentEffort !== null && !admitted.includes(currentEffort)) {
    const below = admitted.filter((e) => EFFORTS.indexOf(e) <= EFFORTS.indexOf(currentEffort));
    effort = below.at(-1) ?? admitted[0] ?? null;
  }
  return { model: entry.value, displayName: entry.displayName, effort };
}

// The row preselected: `default` when the Claude group has it, else its first.
export const preselected = (claude: readonly ModelRow[]): ModelRow | null => claude.find((m) => m.value === 'default') ?? claude[0] ?? null;

// ---- pickDirectModel: the choice alone, as a dialog the gateway's dialog host renders ----------------------------------

interface Picking {
  appSessionId: AppSessionId;
  resolve(choice: { model: string; effort: Effort | null } | null): void;
}
export const useDirectModelPick = create<{ picking: Picking | null }>()(() => ({ picking: null }));

// The Direct-compatible model for a session, or null when the human cancels (C10's RelayCard awaits it before its
// `Run direct` on a gateway model). A second call while one is open cancels the first.
export function pickDirectModel(appSessionId: AppSessionId): Promise<{ model: string; effort: Effort | null } | null> {
  useDirectModelPick.getState().picking?.resolve(null);
  return new Promise((resolve) => {
    const picking: Picking = {
      appSessionId,
      resolve: (choice) => {
        if (useDirectModelPick.getState().picking === picking) useDirectModelPick.setState({ picking: null });
        resolve(choice);
      },
    };
    useDirectModelPick.setState({ picking });
  });
}
