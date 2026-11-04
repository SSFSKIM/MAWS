// The remote setup's sheet (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Remote setup";
// remote-setup.ts for the reads and the act). For a project with no checkout on the chosen machine: which of its folders
// holds it, warned first that a private folder may raise a privacy prompt there, the other checkouts' paths listed first,
// then the machine's home a page at a time; the chosen folder's trust read there, its trust card shown when it isn't
// trusted (accepted, the spawn carries `trust: 'accepted'`), then the folder registered (Touch ID) and the New chat tab
// pointed at it. For a registered checkout the machine refused untrusted at Send: its trust card alone, then the Send
// again. Every step has a way back or out; a refusal is said in words and leaves the sheet where it was.
import { useEffect, useState } from 'react';
import type { FolderEntry } from '@shared/ipc/schema/machine';
import type { TrustState } from '@shared/sessions/trust';
import { closeDialog } from './dialogs';
import { useRemoteSpawn, type SpawnTarget } from './remote-spawn';
import { checkTrust, listFolders, registerFolder, SETUP_WORDS, type FolderPage, type SetupRequest } from './remote-setup';
import { Sheet } from './Sheet';
import { TrustCard } from './TrustCard';
import { PRIMARY, QUIET, SECONDARY } from './ui';

type FolderRequest = Extract<SetupRequest, { kind: 'folder' }>;
type Step =
  | { kind: 'browse' }
  | { kind: 'confirmOpen'; entry: FolderEntry }
  | { kind: 'busy'; words: string }
  | { kind: 'trust'; trust: TrustState };

const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
const ROW = 'flex h-7 w-full cursor-default items-center gap-2 rounded-sm px-2 text-left text-ui outline-accent hover:bg-bg-hover focus-visible:outline-2';

export function RemoteSetupSheet({ request }: { request: SetupRequest }) {
  return request.kind === 'folder' ? <FolderSetup request={request} /> : <TrustSetup request={request} />;
}

// The trust of a registered checkout: read at once, its card, and the Send asked again once it is accepted.
function TrustSetup({ request }: { request: Extract<SetupRequest, { kind: 'trust' }> }) {
  const { target } = request;
  const [trust, setTrust] = useState<TrustState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void checkTrust(target.machine, target.name, target.checkout).then((read) => {
      if (!live) return;
      if (read.ok) setTrust(read.trust);
      else setError(read.words);
    });
    return () => {
      live = false;
    };
  }, [target]);
  const accept = () => {
    useRemoteSpawn.getState().choose(request.tab, { ...target, trust: 'accepted' });
    closeDialog();
    request.then?.();
  };
  return (
    <Sheet title={SETUP_WORDS.trustTitle(target.name)} width="w-[min(480px,90vw)]">
      {trust !== null ? (
        <TrustCard trust={trust} busy={false} acceptLabel={SETUP_WORDS.trustAndStart} onAccept={accept} onDecline={closeDialog} />
      ) : (
        <div className="flex flex-col gap-3">
          {error === null ? <p className="m-0 text-fg-muted">{SETUP_WORDS.checking(target.name)}</p> : <Alert words={error} />}
          <div className="flex justify-end">
            <button type="button" className={SECONDARY} onClick={closeDialog}>
              {SETUP_WORDS.close}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function FolderSetup({ request }: { request: FolderRequest }) {
  const { machine, name, home } = request;
  const [path, setPath] = useState<string | null>(null); // the folder shown; null: the home
  const [page, setPage] = useState<FolderPage | null>(request.first);
  const [opened, setOpened] = useState<readonly string[]>([]); // the private folders the person opened
  const [step, setStep] = useState<Step>({ kind: 'browse' });
  const [error, setError] = useState<string | null>(null);
  const label = (at: string) => (home !== null && within(at, home) ? `~${at.slice(home.length)}` : at);

  const show = async (next: string | null, open = opened, cursor?: string) => {
    setError(null);
    const inside = next !== null && open.some((root) => within(next, root));
    const read = await listFolders(machine, name, { path: next, ...(inside && { open: true }), ...(cursor !== undefined && { cursor }) });
    if (!read.ok) return setError(read.words);
    setPath(next);
    setPage((before) => (cursor !== undefined && before !== null ? { entries: [...before.entries, ...read.page.entries], cursor: read.page.cursor } : read.page));
  };
  const enter = (entry: FolderEntry) => {
    if (entry.protected && !opened.some((root) => within(entry.path, root))) setStep({ kind: 'confirmOpen', entry });
    else void show(entry.path);
  };
  const openPrivate = (entry: FolderEntry) => {
    const now = [...opened, entry.path];
    setOpened(now);
    setStep({ kind: 'browse' });
    void show(entry.path, now);
  };
  const up = () => {
    if (path === null) return;
    const parent = parentOf(path);
    void show(home !== null && within(parent, home) && parent !== home ? parent : null);
  };

  // the chosen folder: its trust read there, its card when it isn't trusted, then registered
  const use = async (directory: string) => {
    setError(null);
    setStep({ kind: 'busy', words: SETUP_WORDS.checking(name) });
    const read = await checkTrust(machine, name, directory);
    if (!read.ok) return fail(read.words);
    if (read.trust.trusted) return register(directory, false);
    setStep({ kind: 'trust', trust: read.trust });
  };
  const register = async (directory: string, accepted: boolean) => {
    setStep({ kind: 'busy', words: SETUP_WORDS.registering(name) });
    const added = await registerFolder(machine, name, directory);
    if (!added.ok) return fail(added.words);
    const target: SpawnTarget = { machine, name, checkout: added.checkout, key: request.key, ...(accepted && { trust: 'accepted' as const }) };
    useRemoteSpawn.getState().choose(request.tab, target);
    closeDialog();
  };
  const fail = (words: string) => {
    setError(words);
    setStep({ kind: 'browse' });
  };

  if (step.kind === 'trust') {
    const directory = path!;
    return (
      <Sheet title={SETUP_WORDS.trustTitle(name)} width="w-[min(480px,90vw)]">
        <TrustCard trust={step.trust} busy={false} acceptLabel={SETUP_WORDS.trust} onAccept={() => void register(directory, true)} onDecline={() => setStep({ kind: 'browse' })} />
      </Sheet>
    );
  }
  return (
    <Sheet title={SETUP_WORDS.title(name)} width="w-[min(480px,90vw)]">
      <div className="flex flex-col gap-3">
        <p className="m-0 text-ui-sm text-fg-muted">{SETUP_WORDS.privacy(name)}</p>
        {step.kind === 'confirmOpen' ? (
          <>
            <p className="m-0">{SETUP_WORDS.openPrivate(label(step.entry.path), name)}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={SECONDARY} onClick={() => setStep({ kind: 'browse' })}>
                {SETUP_WORDS.back}
              </button>
              <button type="button" className={PRIMARY} onClick={() => openPrivate(step.entry)}>
                {SETUP_WORDS.open}
              </button>
            </div>
          </>
        ) : (
          <>
            {request.suggestions.length > 0 && (
              <div role="group" aria-label={SETUP_WORDS.suggestions} className="flex flex-col gap-1">
                <p className="m-0 text-ui-sm text-fg-muted">{SETUP_WORDS.suggestions}</p>
                {request.suggestions.map((suggestion) => (
                  <button key={suggestion} type="button" className={`${ROW} font-mono text-ui-sm`} onClick={() => void show(suggestion)}>
                    {label(suggestion)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-ui-sm">{path === null ? SETUP_WORDS.home : label(path)}</span>
              {path !== null && (
                <button type="button" className={QUIET} onClick={up}>
                  {SETUP_WORDS.up}
                </button>
              )}
            </div>
            <ul aria-label={`Folders on ${name}`} className="m-0 flex max-h-[min(280px,40vh)] list-none flex-col overflow-y-auto rounded-sm border border-border p-1">
              {page === null ? (
                <li className="px-2 py-1 text-ui-sm text-fg-muted">{SETUP_WORDS.loading}</li>
              ) : page.entries.length === 0 ? (
                <li className="px-2 py-1 text-ui-sm text-fg-muted">{SETUP_WORDS.empty}</li>
              ) : (
                page.entries.map((entry) => (
                  <li key={entry.path}>
                    <button type="button" className={ROW} disabled={step.kind === 'busy'} onClick={() => enter(entry)}>
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
            {step.kind === 'busy' && (
              <p role="status" className="m-0 text-ui-sm text-fg-muted">
                {step.words}
              </p>
            )}
            {error !== null && <Alert words={error} />}
            <div className="flex items-center justify-end gap-2">
              <button type="button" className={SECONDARY} onClick={closeDialog}>
                Cancel
              </button>
              <button
                type="button"
                className={PRIMARY}
                disabled={path === null || step.kind === 'busy'}
                title={path === null ? SETUP_WORDS.useHint : undefined}
                onClick={() => path !== null && void use(path)}
              >
                {SETUP_WORDS.use}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Alert({ words }: { words: string }) {
  return (
    <p role="alert" className="m-0 text-ui-sm text-danger">
      {words}
    </p>
  );
}
