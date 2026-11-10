// A folder on one machine, typed or chosen (the project registry's Add project and Locate…; docs/doperpowers/plans/
// 2026-11-10-project-registry.md, Interfaces §J; design §6: "a folder (browsed with `machine.folders.list`, or typed)").
// On this Mac, Choose… is the native chooser (`layout.pickFiles`), as Add project's has always been. On another machine,
// Browse… lists its folders a page at a time from its home (`machine.folders.list`, the owners' read), as the remote
// setup's sheet does (RemoteSetupSheet.tsx, its words): a private folder macOS protects is never read inside until the
// person opens it, since opening one may raise a privacy prompt on that machine.
import { useEffect, useState } from 'react';
import type { FolderEntry } from '@shared/ipc/schema/machine';
import type { MachineRef } from '@shared/machine/ref';
import { ipc } from '../ipc/client';
import { listFolders, SETUP_WORDS, type FolderPage } from '../sessions/remote-setup';
import { FIELD, PRIMARY, QUIET, SECONDARY } from '../sessions/ui';
import { REGISTRY } from './registry-copy';

const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
const ROW = 'flex h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 text-left text-ui outline-accent hover:bg-bg-hover focus-visible:outline-2';

export function FolderField({ machine, name, local, value, onChange, disabled = false }: { machine: MachineRef; name: string; local: boolean; value: string; onChange(path: string): void; disabled?: boolean }) {
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async () => {
    setError(null);
    const picked = await ipc.invoke('layout.pickFiles', { kind: 'directory', directory: value.trim() === '' ? null : value.trim(), multiple: false });
    if (!picked.ok) return setError(picked.error.message);
    const path = picked.value.files[0]?.path;
    if (path !== undefined) onChange(path);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1">
        <span className="text-ui-sm text-fg-muted">{REGISTRY.folder}</span>
        <span className="flex items-center gap-2">
          <input
            type="text"
            spellCheck={false}
            className={`${FIELD} min-w-0 flex-1 font-mono`}
            placeholder={REGISTRY.folderPlaceholder}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          <button type="button" className={SECONDARY} disabled={disabled} onClick={() => (local ? void choose() : setBrowsing((open) => !open))} aria-expanded={local ? undefined : browsing}>
            {local ? REGISTRY.choose : REGISTRY.browse}
          </button>
        </span>
      </label>
      {!local && browsing && (
        <FolderBrowser
          machine={machine}
          name={name}
          onUse={(path) => {
            onChange(path);
            setBrowsing(false);
          }}
        />
      )}
      {error !== null && (
        <p role="alert" className="m-0 text-ui-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// Another machine's folders from its home, a page at a time; Use this folder takes the one shown.
function FolderBrowser({ machine, name, onUse }: { machine: MachineRef; name: string; onUse(path: string): void }) {
  const [path, setPath] = useState<string | null>(null); // the folder shown; null: the home
  const [home, setHome] = useState<string | null>(null);
  const [page, setPage] = useState<FolderPage | null>(null);
  const [opened, setOpened] = useState<readonly string[]>([]); // the private folders the person opened
  const [confirming, setConfirming] = useState<FolderEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = (at: string) => (home !== null && within(at, home) ? `~${at.slice(home.length)}` : at);

  const show = async (next: string | null, open = opened, cursor?: string) => {
    setError(null);
    const inside = next !== null && open.some((root) => within(next, root));
    const read = await listFolders(machine, name, { path: next, ...(inside && { open: true }), ...(cursor !== undefined && { cursor }) });
    if (!read.ok) return setError(read.words);
    if (next === null && read.page.entries.length > 0) setHome(parentOf(read.page.entries[0].path) || null);
    setPath(next);
    setPage((before) => (cursor !== undefined && before !== null ? { entries: [...before.entries, ...read.page.entries], cursor: read.page.cursor } : read.page));
  };
  // the home's first page, read as the browser opens
  useEffect(() => {
    let live = true;
    void listFolders(machine, name, { path: null }).then((read) => {
      if (!live) return;
      if (!read.ok) return setError(read.words);
      if (read.page.entries.length > 0) setHome(parentOf(read.page.entries[0].path) || null);
      setPage(read.page);
    });
    return () => {
      live = false;
    };
  }, [machine, name]);
  const enter = (entry: FolderEntry) => {
    if (entry.protected && !opened.some((root) => within(entry.path, root))) setConfirming(entry);
    else void show(entry.path);
  };
  const up = () => {
    if (path === null) return;
    const parent = parentOf(path);
    void show(home !== null && within(parent, home) && parent !== home ? parent : null);
  };

  if (confirming !== null) {
    return (
      <div className="flex flex-col gap-2 rounded-sm border border-border p-2">
        <p className="m-0">{SETUP_WORDS.openPrivate(label(confirming.path), name)}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={() => setConfirming(null)}>
            {SETUP_WORDS.back}
          </button>
          <button
            type="button"
            className={PRIMARY}
            onClick={() => {
              const now = [...opened, confirming.path];
              setOpened(now);
              setConfirming(null);
              void show(confirming.path, now);
            }}
          >
            {SETUP_WORDS.open}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border p-2">
      <p className="m-0 text-ui-sm text-fg-muted">{SETUP_WORDS.privacy(name)}</p>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-ui-sm">{path === null ? SETUP_WORDS.home : label(path)}</span>
        {path !== null && (
          <button type="button" className={QUIET} onClick={up}>
            {SETUP_WORDS.up}
          </button>
        )}
      </div>
      <ul aria-label={`Folders on ${name}`} className="m-0 flex max-h-[min(220px,32vh)] list-none flex-col overflow-y-auto p-0">
        {page === null ? (
          <li className="px-2 py-1 text-ui-sm text-fg-muted">{SETUP_WORDS.loading}</li>
        ) : page.entries.length === 0 ? (
          <li className="px-2 py-1 text-ui-sm text-fg-muted">{SETUP_WORDS.empty}</li>
        ) : (
          page.entries.map((entry) => (
            <li key={entry.path}>
              <button type="button" className={ROW} onClick={() => enter(entry)}>
                <span className="min-w-0 truncate">{entry.name}</span>
                {entry.protected && <span className="ml-auto shrink-0 text-ui-sm text-fg-muted">{SETUP_WORDS.private}</span>}
              </button>
            </li>
          ))
        )}
      </ul>
      {page?.cursor != null && (
        <button type="button" className={`${QUIET} self-start`} onClick={() => void show(path, opened, page.cursor!)}>
          {SETUP_WORDS.more}
        </button>
      )}
      {error !== null && (
        <p role="alert" className="m-0 text-ui-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button type="button" className={SECONDARY} disabled={path === null} title={path === null ? SETUP_WORDS.useHint : undefined} onClick={() => path !== null && onUse(path)}>
          {SETUP_WORDS.use}
        </button>
      </div>
    </div>
  );
}
