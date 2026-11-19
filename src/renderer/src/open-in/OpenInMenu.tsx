// "Open in" (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md, decision 4): a submenu in the
// title bar's Session actions and in a sidebar row's session menu, handing the session's working folder to an app, and a
// menu button in a file's bar, handing it the file at the line shown. Its rows are the apps main found on this Mac,
// editors, then terminals, then Finder, with a separator between groups. For a session on another machine the item is
// drawn disabled, its label saying where the folder is (these menus draw a reason only as a tooltip otherwise).
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { useEffect } from 'react';
import { preserveSubmenuPointer } from '@artifacts/ui/menu-pointer';
import type { AppSessionId } from '@shared/graph/ids';
import type { OpenInApp, OpenInAppId } from '@shared/ipc/schema/layout';
import { openInGroups, refreshOpenInApps, useOpenInApps } from './apps';
import { OPEN_IN_COPY } from './copy';
import { openIn, useOtherMachine } from './open';

const ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';
const CONTENT = 'z-50 min-w-40 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg';
const SEPARATOR = 'my-1 h-px bg-border';

type Kit = typeof DropdownMenu | typeof ContextMenu;

// The rows, asked of main again as they are drawn (main keeps its answer for a minute). UX wave U11's skill actions:
// `only`, the rows a caller offers (a skill's file goes to no terminal), and `choose`, what a row does.
function Rows({ kit, choose, only }: { kit: Kit; choose(app: OpenInAppId): void; only?(app: OpenInApp): boolean }) {
  const all = useOpenInApps((s) => s.apps);
  useEffect(() => void refreshOpenInApps(), []);
  if (all === null) return <kit.Item disabled className={ITEM}>{OPEN_IN_COPY.looking}</kit.Item>;
  const apps = only === undefined ? all : all.filter(only);
  return openInGroups(apps).map((group, i) => (
    <kit.Group key={group[0]!.id}>
      {i > 0 && <kit.Separator className={SEPARATOR} />}
      {group.map((app) => (
        <kit.Item key={app.id} data-open-in={app.id} onSelect={() => choose(app.id)} className={ITEM}>
          {app.name}
        </kit.Item>
      ))}
    </kit.Group>
  ));
}

/** The submenu of a session's menu: its working folder, to an app. `menu`: the kind of menu it stands in. */
export function OpenInSubmenu({ appSessionId, menu }: { appSessionId: AppSessionId; menu: 'dropdown' | 'context' }) {
  const kit: Kit = menu === 'dropdown' ? DropdownMenu : ContextMenu;
  const elsewhere = useOtherMachine(appSessionId);
  if (elsewhere !== null) {
    return <kit.Item disabled data-open-in-elsewhere className={ITEM}>{OPEN_IN_COPY.elsewhere(elsewhere)}</kit.Item>;
  }
  return (
    <kit.Sub>
      <kit.SubTrigger data-open-in-trigger onPointerLeave={preserveSubmenuPointer} className={ITEM}>
        {OPEN_IN_COPY.label}
      </kit.SubTrigger>
      <kit.Portal>
        <kit.SubContent className={CONTENT}>
          <Rows kit={kit} choose={(app) => void openIn(appSessionId, app)} />
        </kit.SubContent>
      </kit.Portal>
    </kit.Sub>
  );
}

const BUTTON = 'rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg disabled:text-fg-faint disabled:hover:bg-transparent';

/** A file's bar: the file, at the line `line` reads when a row is chosen, to an app. */
export function OpenInButton({ appSessionId, path, line }: { appSessionId: AppSessionId; path: string; line: () => number | null }) {
  const elsewhere = useOtherMachine(appSessionId);
  if (elsewhere !== null) {
    return <button type="button" disabled data-open-in-elsewhere className={BUTTON}>{OPEN_IN_COPY.elsewhere(elsewhere)}</button>;
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" data-open-in-trigger className={BUTTON}>
          {OPEN_IN_COPY.label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={CONTENT}>
          <Rows kit={DropdownMenu} choose={(app) => void openIn(appSessionId, app, { path, line: line() })} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** UX wave U11's skill actions (docs/doperpowers/ledgers/2026-11-18-ux-wave-U11-skill-actions.md, decision 1): the same
 * menu button for a file no session holds, whose hand-off is its caller's own (`choose`), over the rows `only` keeps. */
export function OpenInChooser({ choose, only }: { choose(app: OpenInAppId): void; only?(app: OpenInApp): boolean }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" data-open-in-trigger className={BUTTON}>
          {OPEN_IN_COPY.label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={CONTENT}>
          <Rows kit={DropdownMenu} choose={choose} only={only} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
