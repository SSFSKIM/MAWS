// The editor's mode decoration (C7 execution document, "`!` and `#`"): in bash mode a `Bash` chip and, while the command
// is still empty, the hint of where it runs; in memory mode a `Memory` chip naming the target, whose menu lists the
// memory dialog's files (read when the menu opens) and remembers the choice per session.
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../ipc/client';
import { memoryTargetOf, setMemoryTarget, useComposerStore } from '../../stores/composer';
import { BASH_HINT } from './bash';
import { memoryTargetLabel, memoryTargetOptions, sameTarget, type MemoryFile } from './memory';

const CHIP = 'inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-ui-sm';

function MemoryChip({ appSessionId }: { appSessionId: AppSessionId }) {
  const target = useComposerStore((s) => memoryTargetOf(s, appSessionId));
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const load = async () => {
    const result = await ipc.invoke('session.getMemoryDialog', { appSessionId });
    if (result.ok) setFiles(result.value.files);
  };
  return (
    <DropdownMenu.Root modal={false} onOpenChange={(open) => open && void load()}>
      <DropdownMenu.Trigger className={`${CHIP} bg-accent-soft text-fg outline-accent focus-visible:outline-2`}>
        Memory · {memoryTargetLabel(target, files)}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className="z-50 min-w-56 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
          <DropdownMenu.Label className="px-2 py-1 text-ui-sm text-fg-muted"># appends to</DropdownMenu.Label>
          {files.length === 0 ? <div className="px-2 py-1 text-ui-sm text-fg-faint">Reading the memory files…</div> : null}
          {memoryTargetOptions(files).map((option) => (
            <DropdownMenu.Item
              key={`${option.target.kind}:${option.target.path ?? ''}`}
              onSelect={() => setMemoryTarget(appSessionId, option.target)}
              className="flex cursor-default flex-col rounded-sm px-2 py-1 outline-none select-none data-highlighted:bg-bg-hover"
            >
              <span>
                {sameTarget(option.target, target) ? '● ' : ''}
                {option.label}
              </span>
              <span className="text-ui-sm text-fg-faint">{option.detail}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ModeChrome({ appSessionId, mode, empty }: { appSessionId: AppSessionId; mode: 'send' | 'bash' | 'memory'; empty: boolean }) {
  if (mode === 'send') return null;
  return (
    <div className="flex min-w-0 items-center gap-2 px-1 pb-1">
      {mode === 'bash' ? (
        <>
          <span className={`${CHIP} bg-bg-active font-mono text-fg`}>Bash</span>
          {empty ? <span className="truncate text-ui-sm text-fg-faint">{BASH_HINT}</span> : null}
        </>
      ) : (
        <MemoryChip appSessionId={appSessionId} />
      )}
    </div>
  );
}
