// The "+" menu's Add directory… (C7 execution document, "Composer frame"; W10, C9: the owner's "fold '+dir' on '+'", so
// the toolbar's `+ dir` chip is gone): main's directory picker, then the binding's set with the directories so far plus
// the picked one. A started session applies it through flag settings and re-reads the rules; an unstarted one patches
// its intent. The location popover lists the directories once started, the project row's chip and menu before.
import { useState } from 'react';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { toast } from '../../stores/notices';
import type { ChipBinding } from './bindings';

export const ADD_DIRECTORY = 'Add directory…';

export function useAddDirectory(directories: ChipBinding<string[]>, cwd: string, client: MawsBridge = ipc): { add(): Promise<void>; disabled: string | null } {
  const [busy, setBusy] = useState(false);
  const disabled = directories.disabled ?? (busy ? 'Choosing a directory…' : null);
  const add = async () => {
    if (disabled !== null) return;
    setBusy(true);
    try {
      const picked = await client.invoke('layout.pickFiles', { kind: 'directory', directory: cwd === '' ? null : cwd, multiple: false });
      if (!picked.ok) return void toast({ level: 'warning', text: picked.error.message, actions: [], dismissible: true });
      const dir = picked.value.files[0]?.path;
      if (!dir || directories.value.includes(dir)) return;
      const result = await directories.set([...directories.value, dir]);
      if (!result.ok) toast({ level: 'warning', text: result.error, actions: [], dismissible: true });
    } finally {
      setBusy(false);
    }
  };
  return { add, disabled };
}
