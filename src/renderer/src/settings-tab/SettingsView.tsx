// The Settings tab (C11 execution document, Interfaces "Settings tab"; mockup 06 vignette 04; D-20: Codex's settings
// framework, research/codex-shell-ux.md §6): one screen, a section index at the left whose active entry follows the
// scroll position, and sections of `label · value · note` rows over settings v3 (E9: Voice, settings v9). Every row writes one field
// through `settings.set` and re-renders from `settings.changed`; MAWS's settings live in its own folder, never in
// ~/.claude.
// U11a M9 (l8-settings-06; the execution document's Interfaces §G, consumed by M10 and U7): the sections in one table,
// everyday preferences first under "App", then "Sessions & engine" (Engine split into Sessions, Engine and Supervisor),
// then Org with no heading of its own and the Customize link; the body in the same order, opening at its first section.
// The index's list scrolls by itself and its footer stays. The stored tab keeps build F's ten sections (UC-14): every one
// of them is a section here, and `supervisor`, reached by the index and the search only, is never stored.
// U11a M10: "Search settings" at the index's top (SettingsSearch.tsx); a chosen result scrolls the body, opens the More it
// was found behind, gives the row the keyboard and marks it. ⌘F focuses the field while Settings holds the keyboard
// (UC-6's focus first: a region keeps a key it handles), so it needs no row in the action table.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { Settings } from '@shared/ipc/schema';
import { SessionsSection } from './SessionsSection';
import { AppearanceSection } from './AppearanceSection';
import { INDEX, SECTIONS } from './copy';
import { DrawnRows, DrawnRowsContext } from './drawn';
import { EngineSection } from './EngineSection';
import { GatewaySection } from './GatewaySection';
import { KeymapSection } from './KeymapSection';
import { NotificationsSection } from './NotificationsSection';
import { Section, sectionHeadingId, useSettingsValue } from './parts';
import { SupervisorSection } from './SupervisorSection';
import { VoiceSection } from './VoiceSection'; // E9
import { BrowserSection } from './BrowserSection'; // E4a
import { ArtifactsSection } from './ArtifactsSection'; // P3-D
import { OrgSection } from './org/OrgSection'; // P5 O8 M1; M4a: the Org page, split by group
import { UsageSection } from './UsageSection'; // UX wave U7b (O-47): the usage panel, after Gateway
import { openCustomize } from '../customize/open';
import type { SettingsResult } from './search';
import { landingOf, MARK, RowMark, scrollTopToLand, SettingsSearch } from './SettingsSearch';

export const SETTINGS_SECTIONS = ['appearance', 'notifications', 'keyboard', 'voice', 'browser', 'artifacts', 'sessions', 'gateway', 'usage', 'engine', 'supervisor', 'org'] as const; // UX wave U7b: 'usage'
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
type Group = 'app' | 'sessions';
// the index's and the body's order
export const SECTION_TABLE: readonly { group: Group | null; section: SettingsSection }[] = [
  { group: 'app', section: 'appearance' },
  { group: 'app', section: 'notifications' },
  { group: 'app', section: 'keyboard' },
  { group: 'app', section: 'voice' },
  { group: 'app', section: 'browser' },
  { group: 'app', section: 'artifacts' },
  { group: 'sessions', section: 'sessions' },
  { group: 'sessions', section: 'gateway' },
  { group: 'sessions', section: 'usage' }, // UX wave U7b (O-47)
  { group: 'sessions', section: 'engine' },
  { group: 'sessions', section: 'supervisor' },
  { group: null, section: 'org' },
];
const ORDER = SECTION_TABLE.map(({ section }) => section);
// The groups in the table's order, each with its sections; the sections of no group stand under the index's rule.
const GROUPS = SECTION_TABLE.reduce<{ group: Group; sections: SettingsSection[] }[]>((runs, { group, section }) => {
  if (group === null) return runs;
  if (runs.at(-1)?.group === group) runs.at(-1)!.sections.push(section);
  else runs.push({ group, sections: [section] });
  return runs;
}, []);
const UNGROUPED = SECTION_TABLE.filter(({ group }) => group === null).map(({ section }) => section);

// fills its host; null opens at the table's first section
export function SettingsView({ section, request }: { section: SettingsSection | null; request?: object }) {
  const settings = useSettingsValue();
  const body = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [drawn] = useState(() => new DrawnRows());
  const [mark] = useState(() => new RowMark());
  useEffect(() => () => mark.clear(), [mark]);
  const [active, setActive] = useState<SettingsSection>(section ?? ORDER[0]!);
  // UX wave U7b: the dialog's `request` is new at each explicit request, which lands on its section again
  const asked = request ?? section;
  const [opened, setOpened] = useState(asked);
  if (opened !== asked) {
    setOpened(asked);
    if (section) setActive(section);
  }

  const scrollTo = (target: SettingsSection) => body.current?.querySelector(`[aria-labelledby="${sectionHeadingId(target)}"]`)?.scrollIntoView?.({ block: 'start' });
  const show = (target: SettingsSection) => {
    setActive(target);
    scrollTo(target);
    body.current?.querySelector<HTMLElement>(`#${sectionHeadingId(target)}`)?.focus({ preventScroll: true });
  };
  // Opened or re-opened at a section (settings.open's argument): scroll to it once its rows exist.
  const ready = settings !== null;
  useEffect(() => {
    if (section && ready) scrollTo(section);
  }, [section, request, ready]);

  // Codex's selected-section highlighting: the last section whose top has scrolled to the body's top.
  const onScroll = () => {
    const root = body.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    let current: SettingsSection = ORDER[0]!;
    for (const s of ORDER) {
      const el = root.querySelector(`[aria-labelledby="${sectionHeadingId(s)}"]`);
      if (el && el.getBoundingClientRect().top - top <= 24) current = s;
    }
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = ORDER.at(-1)!; // the last is short
    setActive(current);
  };

  // A chosen result: its row's section heading at the body's top (or the row in the middle), its More open when the
  // words were found there, the row itself holding the keyboard, and the mark. The query stays in the field.
  const choose = (result: SettingsResult) => {
    if (result.target === 'customize') return openCustomize();
    const root = body.current;
    const landing = root === null ? null : landingOf(root, result.target);
    if (root === null || landing === null) return;
    const more = result.openMore ? landing.querySelector<HTMLElement>('[data-settings-more][aria-expanded="false"]') : null;
    if (more !== null) flushSync(() => more.click()); // drawn before the row is measured
    const section = landing.closest<HTMLElement>('section[aria-labelledby]');
    const landed = ORDER.find((s) => section?.getAttribute('aria-labelledby') === sectionHeadingId(s));
    if (section !== null && landed !== undefined) {
      const origin = root.getBoundingClientRect().top - root.scrollTop;
      const box = landing.getBoundingClientRect();
      root.scrollTop = scrollTopToLand({ sectionTop: section.getBoundingClientRect().top - origin, rowTop: box.top - origin, rowHeight: box.height, viewHeight: root.clientHeight });
      setActive(landed);
    }
    landing.focus({ preventScroll: true });
    mark.mark(landing);
  };
  // ⌘F, not ⇧⌘F (Files) nor any other chord on F, from the view itself: a sheet opened from Settings is portaled out of
  // it and keeps its keys, though React bubbles them here
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.code !== 'KeyF' || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || field.current === null) return;
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    field.current.focus();
    field.current.select();
  };

  const entry = (s: SettingsSection) => (
    <button
      key={s}
      type="button"
      aria-current={active === s ? 'true' : undefined}
      onClick={() => show(s)}
      className={`shrink-0 rounded-sm px-2 py-1.5 text-left text-ui-sm outline-accent focus-visible:outline-2 ${active === s ? 'bg-bg-active text-fg' : 'text-fg-muted hover:bg-bg-hover'}`}
    >
      {SECTIONS[s]}
    </button>
  );

  // W9 (H1): the view is the `settings` query container and never scrolls sideways. Narrower than 32rem (a pane of a
  // 50/50 split at the default window is about 300px) the index becomes a top row of section links, its title, group
  // headings and footer set aside. U11a M9: the rows stack by the body's own column (parts.tsx `Setting`, KeymapSection's
  // rows), the `settings-body` container, so a view between 32rem and the body's 760 px stacks them while its index stays
  // a column.
  return (
    <DrawnRowsContext.Provider value={drawn}>
      <div onKeyDown={onKeyDown} className="@container/settings h-full min-h-0 bg-bg text-ui text-fg">
        <div className="grid h-full min-h-0 grid-cols-[148px_minmax(0,1fr)] @max-lg/settings:grid-cols-1 @max-lg/settings:grid-rows-[auto_minmax(0,1fr)]">
          <nav
            aria-label="Settings sections"
            className="flex min-h-0 flex-col border-r border-border bg-bg-raised px-2 py-3.5 @max-lg/settings:border-r-0 @max-lg/settings:border-b @max-lg/settings:py-1.5"
          >
            <div className="shrink-0 px-2 pb-2.5 text-ui font-semibold @max-lg/settings:hidden">{INDEX.title}</div>
            <SettingsSearch keymap={settings?.keymap ?? null} field={field} onChoose={choose}>
              {GROUPS.map(({ group, sections }, i) => (
                <div key={group} className="flex flex-col @max-lg/settings:contents">
                  <div data-settings-group className={`px-2 pb-1 text-ui-sm font-semibold whitespace-nowrap text-fg-muted @max-lg/settings:hidden ${i === 0 ? '' : 'pt-3'}`}>
                    {INDEX.groups[group]}
                  </div>
                  {sections.map(entry)}
                </div>
              ))}
              <div className="mt-2 flex flex-col border-t border-border pt-2 @max-lg/settings:contents">
                {UNGROUPED.map(entry)}
                <button type="button" onClick={() => openCustomize()} className="shrink-0 rounded-sm px-2 py-1.5 text-left text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover focus-visible:outline-2">
                  {INDEX.customize} <span aria-hidden>›</span>
                </button>
              </div>
            </SettingsSearch>
            <p className="m-0 shrink-0 px-2 pt-3.5 text-ui-sm leading-normal text-fg-muted @max-lg/settings:hidden">{INDEX.footer}</p>
          </nav>
          <div ref={body} onScroll={onScroll} data-settings-body className="min-h-0 overflow-x-hidden overflow-y-auto px-5 pt-2 pb-3 @max-lg/settings:px-3">
            {settings === null ? (
              <p className="text-ui-sm text-fg-muted">{INDEX.reading}</p>
            ) : (
              <div data-settings-column className={`@container/settings-body max-w-[760px] ${MARK}`}>
                {SECTION_TABLE.map(({ section: s }) => (
                  <Section key={s} id={s}>
                    <SectionBody section={s} settings={settings} showKeyboard={() => show('keyboard')} />
                  </Section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DrawnRowsContext.Provider>
  );
}

function SectionBody({ section, settings, showKeyboard }: { section: SettingsSection; settings: Settings; showKeyboard(): void }): ReactNode {
  switch (section) {
    case 'appearance':
      return <AppearanceSection settings={settings} />;
    case 'notifications':
      return <NotificationsSection settings={settings} />;
    case 'keyboard':
      return <KeymapSection keymap={settings.keymap} />;
    case 'voice':
      return <VoiceSection settings={settings} showKeyboard={showKeyboard} />;
    case 'browser':
      return <BrowserSection settings={settings} />; // E4a
    case 'artifacts':
      return <ArtifactsSection artifacts={settings.artifacts} />; // P3-D: the design-system defaults (settings 14)
    case 'sessions':
      return <SessionsSection settings={settings} />;
    case 'gateway':
      return <GatewaySection settings={settings} />;
    case 'usage':
      return <UsageSection />; // UX wave U7b (O-47): the usage panel, which the title bar's ring links to
    case 'engine':
      return <EngineSection settings={settings} />;
    case 'supervisor':
      return <SupervisorSection settings={settings} />;
    case 'org':
      return <OrgSection />; // P5 O8 M1: the sign-in to the org, over org.* rather than settings
  }
}
