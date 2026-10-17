// The model ids the pickers offer: a spawn's Model and a session's. The hub carries no list of what a machine's engine
// runs (DX6's `model` and `spawn` take any id); the contract names an id in two places only. A transcript's response
// rows carry the id each answer came from (DX8: the model comes from the transcript), so every transcript the tab reads
// notes its latest one here, per project, newest first, for the tab's life. And the family aliases (DX5's `model`) are
// what a spawn's engine resolves at launch; a live session takes one only where its environment maps it, so a
// session's picker offers ids.
import { create } from 'zustand';

export const FAMILY_ALIASES: readonly string[] = ['opus', 'fable', 'sonnet', 'haiku'];

export const useSeenModels = create<Record<string, readonly string[]>>()(() => ({}));

/** A transcript of `project` answered from `model`: it leads the project's list from now on. */
export function noteModel(project: string, model: string): void {
  useSeenModels.setState((s) => {
    const seen = s[project] ?? [];
    return seen[0] === model ? s : { [project]: [model, ...seen.filter((m) => m !== model)] };
  });
}

const EMPTY: readonly string[] = [];

/** The ids this tab has seen the project's sessions answer from, newest first. */
export const useProjectModels = (project: string): readonly string[] => useSeenModels((s) => s[project] ?? EMPTY);
