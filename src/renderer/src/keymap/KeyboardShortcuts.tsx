// Read-only shortcut reference generated from the same effective table as Settings › Keyboard and the application menu.
import { Dialog } from 'radix-ui';
import { useRef, useState } from 'react';
import { create } from 'zustand';
import { useDialogFocus } from '../app/dialog-focus';
import { keymapGroups } from '../settings-tab/keymap';
import { useSettings } from '../stores/settings';

const useShortcuts = create<{ open: boolean }>(() => ({ open: false }));
export const toggleKeyboardShortcuts = () => useShortcuts.setState((s) => ({ open: !s.open }));

export function KeyboardShortcuts() {
  const open = useShortcuts((s) => s.open);
  const focus = useDialogFocus();
  const search = useRef<HTMLInputElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={(open) => useShortcuts.setState({ open })}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60" />
        <Dialog.Content
          {...focus}
          onOpenAutoFocus={(event) => { focus.onOpenAutoFocus(); event.preventDefault(); search.current?.focus(); }}
          className="fixed top-[10%] left-1/2 z-50 flex max-h-[80vh] w-[min(600px,90vw)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border-strong bg-bg-overlay text-fg shadow-float"
        >
          <header className="flex items-center gap-3 px-4 pt-4 pb-2">
            <Dialog.Title className="flex-1 text-ui font-semibold">Keyboard shortcuts</Dialog.Title>
            <Dialog.Close className="rounded-sm px-2 py-1 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2" aria-label="Close keyboard shortcuts">Close</Dialog.Close>
          </header>
          <Dialog.Description className="px-4 pb-3 text-ui-sm text-fg-muted">Your current bindings. Change them in Settings → Keyboard.</Dialog.Description>
          <ShortcutList searchRef={search} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ShortcutList({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState('');
  const overrides = useSettings((s) => s.state?.settings.keymap);
  const q = query.trim().toLowerCase();
  const groups = keymapGroups(overrides ?? {}).map((group) => ({
    ...group,
    rows: group.rows.filter((row) => [row.title, row.id, row.chord ?? '', row.display].some((text) => text.toLowerCase().includes(q))),
  })).filter((group) => group.rows.length > 0);
  return <>
    <input
      ref={searchRef}
      type="search"
      aria-label="Search keyboard shortcuts"
      placeholder="Search actions or shortcuts"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      className="mx-4 mb-2 rounded-sm border border-border-strong bg-bg px-2.5 py-2 text-ui text-fg outline-accent placeholder:text-fg-faint focus-visible:outline-2"
    />
    <div className="min-h-0 overflow-y-auto px-4 pb-4">
      {groups.map((group) => <table key={group.label} aria-label={group.label} className="w-full border-collapse text-ui-sm">
        <caption className="pt-3 pb-1 text-left font-semibold text-fg-muted">{group.label}</caption>
        <tbody>{group.rows.map((row) => <tr key={row.id} className="border-b border-border">
          <th scope="row" className="py-2 pr-3 text-left font-normal">{row.title}</th>
          <td className="py-2 text-right whitespace-nowrap text-fg-muted"><kbd className="font-sans">{row.display}</kbd></td>
        </tr>)}</tbody>
      </table>)}
      {groups.length === 0 && <p role="status" className="py-6 text-ui text-fg-muted">No shortcuts match your search.</p>}
    </div>
  </>;
}
