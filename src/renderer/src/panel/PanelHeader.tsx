// The pane header (the P3-G execution document §D2.2, after Claude Desktop's frame-artifact header): one 40 px row with
// what the open tab is on the left (its icon, an editor's breadcrumb and title, its saved state and open-comment count)
// and what can be done with it on the right (an editor's actions, three then "More actions", and its Export menu; under a
// 360 px header all of them in "More actions", so the title keeps the room), then the region's own controls.
// `EditorHeader` is the row; the panel draws it over the selected tab as `PanelHeader`, with Float, Maximize and Hide; a main tab whose body registers draws it with no region controls (`main/Pane.tsx`). A tool
// that registers nothing (X32) shows the strip's label, so today's tools read as they did.
import { DropdownMenu } from 'radix-ui';
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react';
import type { PanelTabRef } from '@shared/ipc/schema/layout';
import { FloatIcon, Icon, IconButton, MaximizeIcon, PanelIcon, PenIcon, RestoreIcon } from '../app/IconButton';
import { runAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { MARKUP_COPY, startMarkup, useMarkup } from '../markup/session'; // P3-G
import { useMarkupSurface } from '../markup/surface'; // P3-G
import { SAVED_COPY, useEditorHeaderFocus, useEditorHostRegistration, type EditorHostAction, type EditorHostExport, type EditorHostRegistration, type EditorHostScope } from './editor-host';
import { isRestoredLog, shownSession, useTabLabel } from './host';

export const HEADER_COPY = {
  overview: 'Session overview',
  comments: (n: number) => `${n} open comment${n === 1 ? '' : 's'}`,
  more: 'More actions',
  export: 'Export',
};

// Claude's narrow-layout rule, applied at every width: past three, an editor's actions go into "More actions".
const SHOWN_ACTIONS = 3;
// Under this header width every action and export folds into "More actions" (the controller's ruling on M3): at a 280 px
// panel three actions and Export had left the title no room at all.
export const NARROW_HEADER_PX = 360;
const COMMENTS_ACTION = 'comments';

export interface EditorHeaderProps {
  icon?: ComponentType<{ className?: string }>;
  title: string; // the plain title, shown when nothing is registered
  suffix?: string | null; // a tool's setTitle suffix, with the plain title
  registration: EditorHostRegistration | null;
  controls?: ReactNode; // the region's own controls, which never collapse
  markup?: ReactNode; // P3-G (§D2.2, §D4.4): Mark up, after the actions and before Export, when the tab has a surface
  scope?: EditorHostScope | null; // P3-L (M6b fix wave 1): the tab it is over, for `focusEditorHostAction`
}

export function EditorHeader({ icon: TabIcon, title, suffix = null, registration, controls, markup, scope = null }: EditorHeaderProps) {
  const row = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(row);
  const unresolved = registration?.unresolved ?? 0;
  const actions = registration?.actions ?? [];
  // While the count shows, it is the comments action's button, so the action is not drawn twice.
  const comments = unresolved > 0 ? actions.find((a) => a.id === COMMENTS_ACTION) : undefined;
  const listed = comments ? actions.filter((a) => a !== comments) : actions;
  const exports = registration?.exports ?? [];
  const breadcrumb = registration?.breadcrumb ?? [];
  const shown = narrow ? [] : listed.slice(0, SHOWN_ACTIONS);
  const overflow = narrow ? listed : listed.slice(SHOWN_ACTIONS);
  const folded = narrow ? exports : [];
  const plain = suffix ? `${title} · ${suffix}` : title;
  const hasEditorControls = listed.length > 0 || exports.length > 0 || Boolean(markup);
  // P3-L (M6b fix wave 1): focus back to an action's control, "More actions" when it is folded there
  useEditorHeaderFocus(scope, (actionId) => {
    const root = row.current;
    if (!root) return false;
    const control = shown.some((a) => a.id === actionId)
      ? [...root.querySelectorAll<HTMLElement>('[data-editor-action]')].find((button) => button.getAttribute('data-editor-action') === actionId)
      : overflow.some((a) => a.id === actionId)
        ? root.querySelector<HTMLElement>('[data-editor-more]')
        : null;
    if (!(control instanceof HTMLButtonElement) || control.disabled) return false;
    control.focus({ preventScroll: true });
    return true;
  });

  return (
    <div ref={row} data-editor-header className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
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
        {(overflow.length > 0 || folded.length > 0) && <MoreMenu actions={overflow} exports={folded} />}
        {markup}
        {!narrow && exports.length > 0 && <ExportMenu exports={exports} />}
        {hasEditorControls && controls && <span aria-hidden className="mx-1 h-4 w-px bg-border" />}
        {controls}
      </div>
    </div>
  );
}

// Whether the row is narrower than NARROW_HEADER_PX, followed through its resizes; a row not laid out (0 px) is not.
function useNarrow(ref: RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.offsetWidth;
      setNarrow(width > 0 && width < NARROW_HEADER_PX);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
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
  const scope = useMemo(() => ({ surface: 'panel', tabId: tab.id }) as const, [tab.id]);
  const registration = useEditorHostRegistration(scope);
  const surface = useMarkupSurface(scope);
  return <EditorHeader icon={tool?.icon} title={title} suffix={suffix} registration={registration} controls={controls} markup={surface && <MarkupButton scope={scope} />} scope={scope} />;
}

// P3-G (§D4.4): Mark up over the tab's surface, pressed while a session draws over it; disabled with no shown session
// (nothing to attach the picture to).
function MarkupButton({ scope }: { scope: EditorHostScope }) {
  const shown = useLayout((s) => shownSession(s.main));
  const active = useMarkup((s) => s.session?.scope.surface === scope.surface && s.session.scope.tabId === scope.tabId);
  return (
    <IconButton label={shown === null ? MARKUP_COPY.noSession : MARKUP_COPY.markUp} action="markup.start" pressed={active} disabled={shown === null} onClick={() => void startMarkup(scope)}>
      <PenIcon />
    </IconButton>
  );
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
      <IconButton label={action.label} pressed={action.pressed} disabled={action.disabled} onClick={() => action.onSelect()} data-editor-action={action.id}>
        <ActionIcon className="size-4" />
      </IconButton>
    );
  }
  // An action with no icon is drawn by its label.
  return (
    <button type="button" aria-pressed={action.pressed} disabled={action.disabled} onClick={() => action.onSelect()} data-editor-action={action.id} className={`${GHOST} px-2 text-ui`}>
      {action.label}
    </button>
  );
}

const MENU = 'z-50 min-w-44 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg';
const ITEM = 'flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

// The overflow: the actions past the inline ones, and under a narrow header every action and the exports (under their
// own heading). A pressed action is a checkbox item with its check drawn; while any is, every item keeps the check's
// room so the labels align.
function MoreMenu({ actions, exports }: { actions: readonly EditorHostAction[]; exports: readonly EditorHostExport[] }) {
  const checks = actions.some((action) => action.pressed !== undefined);
  return (
    <HeaderMenu label={HEADER_COPY.more} icon={<MoreIcon />} more>
      {actions.map((action) =>
        action.pressed === undefined ? (
          <DropdownMenu.Item key={action.id} disabled={action.disabled} onSelect={() => action.onSelect()} className={ITEM}>
            {checks && <span aria-hidden className="size-3.5 shrink-0" />}
            {action.label}
          </DropdownMenu.Item>
        ) : (
          <DropdownMenu.CheckboxItem key={action.id} checked={action.pressed} disabled={action.disabled} onSelect={() => action.onSelect()} className={ITEM}>
            <span data-menu-check className="inline-flex size-3.5 shrink-0 items-center justify-center text-accent">
              <DropdownMenu.ItemIndicator>
                <CheckIcon />
              </DropdownMenu.ItemIndicator>
            </span>
            {action.label}
          </DropdownMenu.CheckboxItem>
        ),
      )}
      {exports.length > 0 && (
        <DropdownMenu.Group>
          {actions.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
          <DropdownMenu.Label className="px-2 py-1 text-ui-sm text-fg-muted">{HEADER_COPY.export}</DropdownMenu.Label>
          {exports.map((entry) => (
            <DropdownMenu.Item key={entry.id} disabled={entry.disabled} onSelect={() => entry.onSelect()} className={ITEM}>
              {entry.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Group>
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

function HeaderMenu({ label, icon, children, more = false }: { label: string; icon: ReactNode; children: ReactNode; more?: boolean }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={label} data-editor-more={more ? '' : undefined}>
          {icon}
        </IconButton>
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
const CheckIcon = () => (
  <Icon className="size-3.5">
    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
  </Icon>
);
const MoreIcon = () => (
  <Icon>
    <path d="M3.75 8h.01M8 8h.01M12.25 8h.01" className="[stroke-width:2.25]" />
  </Icon>
);
