// The pane header (the P3-G execution document §D2.2, after Claude Desktop's frame-artifact header): one 40 px row with
// what the open tab is on the left (its icon, an editor's breadcrumb and title, its saved state and open-comment count)
// and what can be done with it on the right (an editor's actions, three then "More actions", and its Export menu), then
// the region's own controls. `EditorHeader` is the row; the panel draws it over the selected tab as `PanelHeader`, with
// Float, Maximize and Hide; a main tab whose body registers draws it with no region controls (`main/Pane.tsx`). A tool
// that registers nothing (X32) shows the strip's label, so today's tools read as they did.
import { DropdownMenu } from 'radix-ui';
import { Fragment, type ComponentType, type ReactNode } from 'react';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { FloatIcon, Icon, IconButton, MaximizeIcon, PanelIcon, RestoreIcon } from '../app/IconButton';
import { runAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { SAVED_COPY, useEditorHostRegistration, type EditorHostAction, type EditorHostExport, type EditorHostRegistration } from './editor-host';
import { isRestoredLog, useTabLabel } from './host';

export const HEADER_COPY = {
  overview: 'Session overview',
  comments: (n: number) => `${n} open comment${n === 1 ? '' : 's'}`,
  more: 'More actions',
  export: 'Export',
};

// Claude's narrow-layout rule, applied at every width: past three, an editor's actions go into "More actions".
const SHOWN_ACTIONS = 3;
const COMMENTS_ACTION = 'comments';

export interface EditorHeaderProps {
  icon?: ComponentType<{ className?: string }>;
  title: string; // the plain title, shown when nothing is registered
  suffix?: string | null; // a tool's setTitle suffix, with the plain title
  registration: EditorHostRegistration | null;
  controls?: ReactNode; // the region's own controls, which never collapse
}

export function EditorHeader({ icon: TabIcon, title, suffix = null, registration, controls }: EditorHeaderProps) {
  const unresolved = registration?.unresolved ?? 0;
  const actions = registration?.actions ?? [];
  // While the count shows, it is the comments action's button, so the action is not drawn twice.
  const comments = unresolved > 0 ? actions.find((a) => a.id === COMMENTS_ACTION) : undefined;
  const listed = comments ? actions.filter((a) => a !== comments) : actions;
  const exports = registration?.exports ?? [];
  const breadcrumb = registration?.breadcrumb ?? [];
  const shown = listed.slice(0, SHOWN_ACTIONS);
  const overflow = listed.slice(SHOWN_ACTIONS);
  const plain = suffix ? `${title} · ${suffix}` : title;
  const hasEditorControls = listed.length > 0 || exports.length > 0;

  return (
    <div data-editor-header className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      {/* Narrowing gives up the breadcrumb first (as one run, so its separators go with it), then the saved state, then
          the title: the breadcrumb and the saved state grow from nothing into the room the title leaves (the saved state
          first), up to their own width, so the title truncates only once both are gone. The count stays whole; what
          still does not fit is clipped here rather than drawn under the actions. Full height, so a focus ring shows. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch overflow-hidden">
        {TabIcon && <TabIcon className="size-3.5 shrink-0 text-fg-muted" />}
        {breadcrumb.length > 0 && (
          <span data-header-breadcrumb title={breadcrumb.join(' / ')} className="max-w-max min-w-0 flex-[1_1_0px] truncate text-ui text-fg-muted">
            {breadcrumb.map((segment, i) => (
              <Fragment key={i}>
                {segment}
                <span aria-hidden className={i < breadcrumb.length - 1 ? 'px-1' : 'pl-1'}>
                  /
                </span>
              </Fragment>
            ))}
          </span>
        )}
        <span data-header-title title={registration ? registration.title : plain} className="min-w-0 truncate text-ui text-fg">
          {registration ? registration.title : title}
          {!registration && suffix && <span className="text-fg-faint"> · {suffix}</span>}
        </span>
        {registration?.saved && (
          <span data-header-saved title={SAVED_COPY[registration.saved]} className="max-w-max min-w-0 flex-[1000_1_0px] truncate text-ui-sm text-fg-muted">
            {SAVED_COPY[registration.saved]}
          </span>
        )}
        {unresolved > 0 && <CommentCount count={unresolved} action={comments} />}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {shown.map((action) => (
          <ActionButton key={action.id} action={action} />
        ))}
        {overflow.length > 0 && <MoreMenu actions={overflow} />}
        {exports.length > 0 && <ExportMenu exports={exports} />}
        {hasEditorControls && controls && <span aria-hidden className="mx-1 h-4 w-px bg-border" />}
        {controls}
      </div>
    </div>
  );
}

// The panel's header over its selected tab (the summary when none): the tab's registration under its panel scope, else
// its strip label; then Float, Maximize / Restore and Hide.
export function PanelHeader({ tabs, activeTabId }: { tabs: readonly PanelTabRef[]; activeTabId: string | null }) {
  const tab = tabs.find((t) => t.id === activeTabId && !isRestoredLog(t.id)) ?? null;
  const controls = <RegionControls />;
  return tab ? <ToolHeader tab={tab} controls={controls} /> : <EditorHeader title={HEADER_COPY.overview} registration={null} controls={controls} />;
}

function ToolHeader({ tab, controls }: { tab: PanelTabRef; controls: ReactNode }) {
  const { tool, title, suffix } = useTabLabel(tab);
  const registration = useEditorHostRegistration({ surface: 'panel', tabId: tab.id });
  return <EditorHeader icon={tool?.icon} title={title} suffix={suffix} registration={registration} controls={controls} />;
}

function RegionControls() {
  const { maximized, floating } = useLayout((s) => s.regions.panel);
  return (
    <>
      <IconButton label={floating ? 'Dock session' : 'Float session over panel'} action="panel.float" pressed={floating} onClick={() => runAction('panel.float')}>
        <FloatIcon />
      </IconButton>
      <IconButton label={maximized ? 'Restore right panel' : 'Maximize right panel'} action="panel.maximize" pressed={maximized} onClick={() => runAction('panel.maximize')}>
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </IconButton>
      <IconButton label="Hide right panel" action="panel.toggle" onClick={() => runAction('panel.toggle')}>
        <PanelIcon />
      </IconButton>
    </>
  );
}

const GHOST =
  'inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent aria-pressed:bg-bg-active aria-pressed:text-fg';

// The open-comment count: the comments action's button when the editor registers one, else a label.
function CommentCount({ count, action }: { count: number; action: EditorHostAction | undefined }) {
  const label = HEADER_COPY.comments(count);
  const face = (
    <>
      <CommentIcon className="size-3.5" />
      {count}
    </>
  );
  if (!action) {
    return (
      <span title={label} className="inline-flex h-7 shrink-0 items-center gap-1 px-1.5 text-ui-sm text-fg-muted">
        <span className="sr-only">{label}</span>
        <span aria-hidden className="inline-flex items-center gap-1">
          {face}
        </span>
      </span>
    );
  }
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={action.pressed} disabled={action.disabled} onClick={() => action.onSelect()} className={GHOST}>
      {face}
    </button>
  );
}

function ActionButton({ action }: { action: EditorHostAction }) {
  const ActionIcon = action.icon;
  if (ActionIcon) {
    return (
      <IconButton label={action.label} pressed={action.pressed} disabled={action.disabled} onClick={() => action.onSelect()}>
        <ActionIcon className="size-4" />
      </IconButton>
    );
  }
  // An action with no icon is drawn by its label.
  return (
    <button type="button" aria-pressed={action.pressed} disabled={action.disabled} onClick={() => action.onSelect()} className={`${GHOST} px-2 text-ui`}>
      {action.label}
    </button>
  );
}

const MENU = 'z-50 min-w-44 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg';
const ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

function MoreMenu({ actions }: { actions: readonly EditorHostAction[] }) {
  return (
    <HeaderMenu label={HEADER_COPY.more} icon={<MoreIcon />}>
      {actions.map((action) =>
        action.pressed === undefined ? (
          <DropdownMenu.Item key={action.id} disabled={action.disabled} onSelect={() => action.onSelect()} className={ITEM}>
            {action.label}
          </DropdownMenu.Item>
        ) : (
          <DropdownMenu.CheckboxItem key={action.id} checked={action.pressed} disabled={action.disabled} onSelect={() => action.onSelect()} className={ITEM}>
            {action.label}
          </DropdownMenu.CheckboxItem>
        ),
      )}
    </HeaderMenu>
  );
}

function ExportMenu({ exports }: { exports: readonly EditorHostExport[] }) {
  return (
    <HeaderMenu label={HEADER_COPY.export} icon={<ExportIcon />}>
      {exports.map((entry) => (
        <DropdownMenu.Item key={entry.id} disabled={entry.disabled} onSelect={() => entry.onSelect()} className={ITEM}>
          {entry.label}
        </DropdownMenu.Item>
      ))}
    </HeaderMenu>
  );
}

function HeaderMenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={label}>{icon}</IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={MENU}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// The header's glyphs, drawn like the shell's 16 px stroke icons.
const CommentIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2.5 3.5h11v7.5H8L5 13.5V11H2.5z" />
  </Icon>
);
const ExportIcon = () => (
  <Icon>
    <path d="M5.5 6.5h-2v7h9v-7h-2M8 10V2.5M5.5 5 8 2.5 10.5 5" />
  </Icon>
);
const MoreIcon = () => (
  <Icon>
    <path d="M3.75 8h.01M8 8h.01M12.25 8h.01" className="[stroke-width:2.25]" />
  </Icon>
);
