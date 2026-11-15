// "Make something new" (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4; Decision Log 13, amended by the UX wave's
// U10b, l6-artifacts-08: docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md, M8 and §D). Four cards, Document,
// Presentation, Dashboard and Design: the whole card asks Claude, starting a chat whose composer holds the opening words
// ("Make a <kind>: "), and "Blank" beside it makes `Untitled <kind>` and opens it in a main tab (a kind whose editor
// has not registered has no Blank). More, the row's last cell, holds the rest: Design system (Ask Claude, Blank), HTML
// page (Ask Claude) and Add a file… (the native picker, then `artifacts.create` with its path, the file in place).
// P3-F wave S (F5, the owner's change to Decision Log 13): from a Space a chat starts in the Space's linked folder, in
// that folder's project by the index's membership rule (New chat's Open folder, `session.projects.addFolder`), else in
// the focused project, and its words name the Space ("Make a <kind> in the Space “<name>”: "), which the agent's
// `artifact_create` takes as its `space`. So while the narrowed Space is not known (the Spaces list not read yet, or
// holding no such Space) a card, its Blank and More's entries that ask or make are disabled (H23); Add a file… is not.
// U10b: one design-system choice in the heading, the system a new artifact here would get ("<name> · default") and the
// library's others. It is the page's state (`MakeChoiceContext`, held by `Library`): it holds while the page is open,
// through the views, searches and scrolls that take this section away, and is not stored. A system chosen that is not the default is named in a card's words, which the agent's
// `artifact_create` takes as its `designSystem`, and passed by Blank as `designSystemId`.
import { preserveSubmenuPointer } from '@artifacts/ui/menu-pointer';
import { DropdownMenu } from 'radix-ui';
import { createContext, useContext, useId, useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { LibrarySpace } from '@shared/ipc/schema/library';
import { ChevronDownIcon, Icon } from '../app/IconButton';
import { useDocumentGoverningSystem } from '../artifacts/design-system/documents';
import { artifactEditorFor, useArtifactEditor } from '../artifacts/registry';
import { ipc } from '../ipc/client';
import { createSession, focusedProject, useSessionCreatorRegistered } from '../keymap/actions-runtime';
import { prefillComposer } from '../stores/composer';
import { useSettings } from '../stores/settings';
import { createArtifact, openArtifactTab } from './actions';
import { askClaudePrefill, KIND_BLURBS, KIND_LABELS, LIBRARY_PAGE as P, untitledTitle } from './copy';
import { toastFailure } from './dialogs';
import { ChevronRightIcon, KindIcon, MoreIcon } from './icons';
import { MENU, MENU_ITEM } from './LibraryHeader';
import { useLibraryList, useLibrarySpaces } from './store';

const CARD_KINDS = ['document', 'presentation', 'dashboard', 'design'] as const satisfies readonly ArtifactKind[];
const DEFAULT = 'default'; // the radio value of the default system (no system id is it)
// Radix places a submenu on the menu's right and flips it only on a collision. More ends the row, so its submenu opens
// on the menu's left (§D.2): a right-hand padding no submenu fits makes the right-hand placement a collision.
const OPEN_LEFT = { right: 100_000 };

/** The design system chosen on the page (its id; null: the default), held by the page so it outlives this section. */
export type MakeChoice = readonly [chosen: string | null, choose: (id: string | null) => void];
export const MakeChoiceContext = createContext<MakeChoice | null>(null);
/** The page's choice, owned by the Library page for its life. */
export const useMakeChoiceState = (): MakeChoice => useState<string | null>(null);

/** A design system as the choice shows it. */
interface ShownSystem {
  id: string;
  title: string;
}

const CheckIcon = () => (
  <Icon className="size-3.5">
    <path d="m3.5 8.5 3 3 6-7" />
  </Icon>
);

// Made, then opened in a tab when its kind has an editor to show it.
async function make(input: Parameters<typeof createArtifact>[0]): Promise<void> {
  const result = await createArtifact(input);
  if (!result.ok) return toastFailure(result.error.message);
  if (artifactEditorFor(result.value.kind)) openArtifactTab(result.value.id);
}

async function addFile(spaceId: string | null): Promise<void> {
  const picked = await ipc.invoke('layout.pickFiles', { kind: 'files', directory: null, multiple: false, pathsOnly: true });
  if (!picked.ok) return toastFailure(picked.error.message);
  const file = picked.value.files[0];
  if (!file) return; // cancelled
  await make({ kind: 'file', title: file.name, content: { path: file.path }, ...(spaceId !== null && { spaceId }) });
}

// A new chat, in the Space's linked folder when it has one, whose composer holds `words`.
async function askClaude(words: string, space: LibrarySpace | undefined): Promise<void> {
  let appSessionId: AppSessionId | null;
  if (space?.linkedDir !== undefined) {
    const added = await ipc.invoke('session.projects.addFolder', { directory: space.linkedDir }, { machine: ipc.localMachine }); // P5 O6 M4: a Space's folder is this machine's (O7)
    if (!added.ok) return toastFailure(added.error.message);
    appSessionId = await createSession(added.value.project.id, { location: added.value.location });
  } else {
    appSessionId = await createSession(focusedProject());
  }
  if (appSessionId !== null) prefillComposer(appSessionId, { text: words });
}

// The choice: null while the library's design systems or the owner's and the Spaces' defaults are still being read.
// The default is the system the chain gives a new artifact here (`useDocumentGoverningSystem`, the floor by its name);
// `bound` is the system chosen when it is not the default and the library still lists it, else null.
function useSystemChoice(spaceId: string | null) {
  const systems = useLibraryList({ kind: 'design_system' }).value?.rows;
  const defaultsRead = useSettings((s) => s.state !== null);
  const governing = useDocumentGoverningSystem(spaceId === null ? {} : { spaceId });
  const held = useContext(MakeChoiceContext);
  if (held === null) throw new Error('"Make something new" is drawn inside the Library page, which holds its choice');
  const [chosen, choose] = held;
  if (systems === undefined || !defaultsRead) return null;
  const defaultId = 'builtin' in governing ? null : governing.id;
  const defaultName = systems.find((system) => system.id === defaultId)?.title ?? P.floorSystem;
  const others: ShownSystem[] = systems
    .filter((system) => system.id !== defaultId)
    .map(({ id, title }) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id));
  const bound = others.find((system) => system.id === chosen) ?? null;
  return { defaultName, others, bound, choose };
}

function SystemChoice({ choice }: { choice: ReturnType<typeof useSystemChoice> }) {
  const shown = choice === null ? P.system : choice.bound ? choice.bound.title : P.systemDefault(choice.defaultName);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild disabled={choice === null}>
        <button
          type="button"
          aria-label={choice === null ? undefined : P.systemOf(shown)}
          className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent data-[state=open]:bg-bg-active"
        >
          <span className="max-w-60 truncate">{shown}</span>
          <ChevronDownIcon />
        </button>
      </DropdownMenu.Trigger>
      {choice !== null && (
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className={MENU}>
            <DropdownMenu.RadioGroup value={choice.bound?.id ?? DEFAULT} onValueChange={(next) => choice.choose(next === DEFAULT ? null : next)}>
              {[{ id: DEFAULT, title: P.systemDefault(choice.defaultName) }, ...choice.others].map((system) => (
                <DropdownMenu.RadioItem key={system.id} value={system.id} className={MENU_ITEM}>
                  <span aria-hidden className="flex w-3.5 shrink-0 text-accent">
                    <DropdownMenu.ItemIndicator>
                      <CheckIcon />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  <span className="max-w-60 truncate">{system.title}</span>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      )}
    </DropdownMenu.Root>
  );
}

// A card is one button that asks Claude; Blank is a second button beside it, at its upper right, never inside it. The
// press awaits the chat's creation (and the linked folder's project first): the card is disabled meanwhile, so a
// second press starts no second chat.
function KindCard(props: { kind: (typeof CARD_KINDS)[number]; spaceId: string | null; space: LibrarySpace | undefined; spaceKnown: boolean; system: ShownSystem | null }) {
  const { kind, spaceId, space, spaceKnown, system } = props;
  const editor = useArtifactEditor(kind);
  const creator = useSessionCreatorRegistered();
  const [starting, setStarting] = useState(false);
  const ids = useId();
  const label = KIND_LABELS[kind];
  const start = async () => {
    setStarting(true);
    try {
      await askClaude(askClaudePrefill(kind, space?.name, system?.title), space);
    } finally {
      setStarting(false);
    }
  };
  return (
    <div role="group" aria-label={label} data-make-kind={kind} className="relative min-w-0">
      <button
        type="button"
        disabled={!spaceKnown || !creator || starting}
        onClick={() => void start()}
        aria-labelledby={`${ids}-name`}
        aria-describedby={`${ids}-line`}
        className="group/card flex h-full w-full min-w-0 flex-col items-start gap-1 rounded-md border border-border bg-bg-raised p-3 text-left outline-accent hover:border-border-strong hover:bg-bg-hover focus-visible:outline-2 disabled:cursor-default disabled:hover:border-border disabled:hover:bg-bg-raised"
      >
        <span aria-hidden className="flex h-6 items-center text-fg-muted group-disabled/card:text-fg-faint">
          <KindIcon kind={kind} />
        </span>
        <span id={`${ids}-name`} className="text-ui font-medium text-fg group-disabled/card:text-fg-faint">
          {label}
        </span>
        <span id={`${ids}-line`} className="text-ui-sm text-fg-muted group-disabled/card:text-fg-faint">
          {KIND_BLURBS[kind]}
        </span>
      </button>
      {editor && (
        <button
          type="button"
          disabled={!spaceKnown}
          aria-label={P.blankOf(kind)}
          onClick={() => void make({ kind, title: untitledTitle(kind), ...(spaceId !== null && { spaceId }), ...(system && { designSystemId: system.id }) })}
          className="absolute top-3 right-2 inline-flex h-6 items-center rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-active hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent"
        >
          {P.blank}
        </button>
      )}
    </div>
  );
}

// More: Design system (Ask Claude, Blank), HTML page (Ask Claude) and Add a file…, opened under it and aligned to its
// right edge, Design system's entries on the menu's left.
function More({ spaceId, space, spaceKnown }: { spaceId: string | null; space: LibrarySpace | undefined; spaceKnown: boolean }) {
  const canAsk = useSessionCreatorRegistered() && spaceKnown;
  const systemEditor = useArtifactEditor('design_system');
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-border bg-bg-raised px-5 text-ui-sm text-fg-muted outline-accent hover:border-border-strong hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active"
        >
          <MoreIcon />
          {P.more}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger onPointerLeave={preserveSubmenuPointer} className={`${MENU_ITEM} data-[state=open]:bg-bg-hover`}>
              <KindIcon kind="design_system" className="size-3.5 text-fg-muted" />
              <span className="flex-1">{KIND_LABELS.design_system}</span>
              <ChevronRightIcon className="size-3.5 text-fg-faint" />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent sideOffset={4} collisionPadding={OPEN_LEFT} className={MENU}>
                <DropdownMenu.Item disabled={!canAsk} className={MENU_ITEM} onSelect={() => void askClaude(askClaudePrefill('design_system', space?.name), space)}>
                  {P.askClaude}
                </DropdownMenu.Item>
                {systemEditor && (
                  <DropdownMenu.Item
                    disabled={!spaceKnown}
                    className={MENU_ITEM}
                    onSelect={() => void make({ kind: 'design_system', title: untitledTitle('design_system'), ...(spaceId !== null && { spaceId }) })}
                  >
                    {P.blank}
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Item disabled={!canAsk} className={MENU_ITEM} onSelect={() => void askClaude(askClaudePrefill('html', space?.name), space)}>
            <KindIcon kind="html" className="size-3.5 text-fg-muted" />
            {KIND_LABELS.html}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => void addFile(spaceId)}>
            <KindIcon kind="file" className="size-3.5 text-fg-muted" />
            {P.addFile}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MakeSomethingNew({ spaceId }: { spaceId: string | null }) {
  const spaces = useLibrarySpaces().value;
  const space = spaceId === null ? undefined : spaces?.find((s) => s.id === spaceId);
  const spaceKnown = spaceId === null || space !== undefined;
  const choice = useSystemChoice(spaceId);
  return (
    <section aria-labelledby="library-make" className="flex flex-col gap-2 pb-4">
      <div className="flex min-w-0 items-center gap-2 px-2 text-ui-sm text-fg-muted">
        <h2 id="library-make" className="m-0 shrink-0 font-semibold">
          {P.makeNew}
        </h2>
        <span className="min-w-0 truncate">· {spaceId === null ? 'General' : (space?.name ?? 'Loading Space…')}</span>
        <SystemChoice choice={choice} />
      </div>
      <div className="flex items-stretch gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
          {CARD_KINDS.map((kind) => (
            <KindCard key={kind} kind={kind} spaceId={spaceId} space={space} spaceKnown={spaceKnown} system={choice?.bound ?? null} />
          ))}
        </div>
        <More spaceId={spaceId} space={space} spaceKnown={spaceKnown} />
      </div>
    </section>
  );
}
