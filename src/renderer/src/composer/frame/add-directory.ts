// The "+" menu's Add directory… (C7 execution document, "Composer frame"; W10, C9: the owner's "fold '+dir' on '+'", so
// the toolbar's `+ dir` chip is gone): main's directory picker, then the binding's set with the directories so far plus
// the picked one. A started session applies it through flag settings and re-reads the rules; an unstarted one patches
// its intent. The location popover lists the directories once started, the project row's chip and menu before.
import { useState } from 'react';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { toast } from '../../stores/notices';
import { STARTING_SESSION } from '../../sessions/acquire'; // P2-A
import type { ChipBinding, ChipPhase } from './bindings';

export const ADD_DIRECTORY = 'Add directory…';

// P2-A (2026-10-09; the execution document §5.6, acceptance 5): on a session with no ready process the choice starts it
// first; `phase` says so after the picker returns ("Starting…" beside the "+"), then while the directory is applied.
export type AddDirectoryPhase = 'idle' | 'choosing' | ChipPhase;
export const ADDING_DIRECTORY = 'Adding the directory…';

export function useAddDirectory(directories: ChipBinding<string[]>, cwd: string, client: MawsBridge = ipc): { add(): Promise<void>; disabled: string | null; phase: AddDirectoryPhase } {
  const [phase, setPhase] = useState<AddDirectoryPhase>('idle');
  const disabled = directories.disabled ?? (phase === 'choosing' ? 'Choosing a directory…' : phase === 'starting' ? STARTING_SESSION : phase === 'applying' ? ADDING_DIRECTORY : null);
  const add = async () => {
    if (disabled !== null) return;
    setPhase('choosing');
    try {
      const picked = await client.invoke('layout.pickFiles', { kind: 'directory', directory: cwd === '' ? null : cwd, multiple: false });
      if (!picked.ok) return void toast({ level: 'warning', text: picked.error.message, actions: [], dismissible: true });
      const dir = picked.value.files[0]?.path;
      if (!dir || directories.value.includes(dir)) return;
      setPhase('applying');
      const result = await directories.set([...directories.value, dir], setPhase);
      if (!result.ok) toast({ level: 'warning', text: result.error, actions: [], dismissible: true });
    } finally {
      setPhase('idle');
    }
  };
  return { add, disabled, phase };
}
