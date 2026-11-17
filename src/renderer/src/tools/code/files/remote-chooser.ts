// The chooser for a session on another machine, its model (UX wave U6f, §E). Not built yet.
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import type { OutsideEntry } from '@shared/ipc/schema/files';
import type { MachineRef } from '@shared/machine/ref';

export type ChooserState =
  | { at: 'reading'; path: string | null }
  | { at: 'listed'; path: string; parent: string | null; home: string; entries: OutsideEntry[]; cursor: string | null; selected: string | null }
  | { at: 'asking'; folder: OutsideEntry }
  | { at: 'failed'; path: string | null; words: string }
  | { at: 'choosing'; path: string };

export interface RemoteChooser {
  state(): ChooserState;
  subscribe(listener: () => void): () => void;
  enter(entry: OutsideEntry): void;
  up(): void;
  go(path: string): void;
  more(): void;
  select(path: string): void;
  confirm(): void;
  back(): void;
  choose(): Promise<string | null>;
  retry(): void;
  cancel(): void;
}

export type ListInput = { appSessionId: AppSessionId; path?: string; open?: true; cursor?: string };
export type ChooseInput = { appSessionId: AppSessionId; path: string; open?: true };
export interface ChooserDeps {
  list(input: ListInput): Promise<CommandResult<'files.listOutside'>>;
  choose(input: ChooseInput): Promise<CommandResult<'files.chooseOutside'>>;
  machine(): string;
  startAt: string | null;
}

export function createRemoteChooser(appSessionId: AppSessionId, deps: ChooserDeps): RemoteChooser {
  void appSessionId;
  void deps;
  const state: ChooserState = { at: 'reading', path: null };
  return {
    state: () => state, subscribe: () => () => {}, enter: () => {}, up: () => {}, go: () => {}, more: () => {}, select: () => {},
    confirm: () => {}, back: () => {}, choose: () => Promise.resolve(null), retry: () => {}, cancel: () => {},
  };
}

export function startOf(machine: MachineRef): string | null {
  void machine;
  return null;
}

export function forgetStarts(): void {}

export function parentOf(state: ChooserState): string | null {
  void state;
  return null;
}

export function chooserCalls(): Pick<ChooserDeps, 'list' | 'choose'> {
  return { list: () => Promise.reject(new Error('not built')), choose: () => Promise.reject(new Error('not built')) };
}
