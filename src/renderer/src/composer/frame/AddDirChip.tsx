// The toolbar's `+ dir` (C7 execution document, "Composer frame"; W2: in the toolbar, no chip row): main's directory picker, then the binding's set
// with the directories so far plus the picked one (a live session applies it through flag settings and re-reads the
// rules; an unstarted one patches its intent). The location popover lists the directories.
import { useState } from 'react';
import type { MawsBridge } from '@shared/ipc/schema';
import { ipc } from '../../ipc/client';
import { toast } from '../../stores/notices';
import type { ChipBinding } from './bindings';
import { CHIP } from './chip-style';

export function AddDirChip({ directories, cwd, client = ipc }: { directories: ChipBinding<string[]>; cwd: string; client?: MawsBridge }) {
  const [busy, setBusy] = useState(false);
  const add = async () => {
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
  const count = directories.value.length;
  return (
    <button type="button" aria-label="Add a directory" title={directories.disabled ?? (count > 0 ? directories.value.join('\n') : 'Give this session another directory')} disabled={busy || directories.disabled !== null} onClick={() => void add()} className={CHIP}>
      + dir{count > 0 ? ` · ${count}` : ''}
    </button>
  );
}
