// The "+" menu (C7 execution document, "Mentions, palette and the "+" menu"): files and folders or photos through main's
// picker (images and PDFs attach as bytes, anything else is mentioned by path), the slash palette at `/`, and the
// Connectors and Plugins widgets (`/mcp`, `/plugins`), disabled with the palette's Not available here where a host
// registers no widgets. The toolbar that holds it is the Composer's (M4); the menu drives the editor through its handle.
import { DropdownMenu } from 'radix-ui';
import type { RefObject } from 'react';
import { ipc } from '../../ipc/client';
import type { EditorHandle } from '../editor/controller';
import { UNAVAILABLE_HINT } from '../mentions/items';
import { useRegisteredWidgets, type WidgetCommandName } from '../mentions/widgets';
import { toast } from '../../stores/notices';

const ITEM = 'flex cursor-default flex-col rounded-sm px-2 py-1 outline-none select-none data-highlighted:bg-bg-hover data-disabled:text-fg-faint';

export function PlusMenu({ cwd, editor }: { cwd: string; editor: RefObject<EditorHandle | null> }) {
  const widgets = useRegisteredWidgets();
  const pick = async (kind: 'files' | 'photos') => {
    const result = await ipc.invoke('layout.pickFiles', { kind, directory: cwd === '' ? null : cwd, multiple: true });
    if (!result.ok) return void toast({ level: 'warning', text: result.error.message, actions: [], dismissible: true });
    await editor.current?.attachPicked(result.value.files);
  };
  const widgetItem = (label: string, name: WidgetCommandName) => (
    <DropdownMenu.Item disabled={!widgets.has(name)} onSelect={() => editor.current?.openWidget(name)} className={ITEM}>
      <span>{label}</span>
      {widgets.has(name) ? null : <span className="text-ui-sm">{UNAVAILABLE_HINT}</span>}
    </DropdownMenu.Item>
  );
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger aria-label="Add files, photos or commands" className="inline-flex size-7 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2">
        +
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className="z-50 min-w-56 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg">
          <DropdownMenu.Item onSelect={() => void pick('files')} className={ITEM}>
            Files and folders…
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => void pick('photos')} className={ITEM}>
            Photos…
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => editor.current?.openSlash()} className={ITEM}>
            Slash commands
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {widgetItem('Connectors', 'mcp')}
          {widgetItem('Plugins', 'plugins')}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
