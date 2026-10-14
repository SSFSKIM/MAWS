// The Settings tab (C11 execution document, Interfaces "Settings tab"; mockup 06 vignette 04; D-20: Codex's settings
// framework, research/codex-shell-ux.md §6): one screen, a section index at the left whose active entry follows the
// scroll position, and six sections of `label · value · note` rows over settings v3 (E9: Voice, settings v9). Every row writes one field
// through `settings.set` and re-renders from `settings.changed`; MAWS's settings live in its own folder, never in
// ~/.claude.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TabRef } from '@shared/ipc/schema/layout';
import { AppearanceSection } from './AppearanceSection';
import { INDEX, KEYBOARD, SECTIONS } from './copy';
import { EngineSection } from './EngineSection';
import { GatewaySection } from './GatewaySection';
import { KeymapSection } from './KeymapSection';
import { NotificationsSection } from './NotificationsSection';
import { useSettingsValue } from './parts';
import { VoiceSection } from './VoiceSection'; // E9
import { BrowserSection } from './BrowserSection'; // E4a
import { ArtifactsSection } from './ArtifactsSection'; // P3-D

export type SettingsSection = NonNullable<Extract<TabRef, { kind: 'settings' }>['section']>;
const ORDER: SettingsSection[] = ['engine', 'gateway', 'keyboard', 'voice', 'appearance', 'notifications', 'browser', 'artifacts']; // E9: Voice after Keyboard; E4a: Browser; P3-D: Artifacts last
const HINTS: Partial<Record<SettingsSection, string>> = { keyboard: KEYBOARD.hint }; // W9 (H4): no charter labels in the UI
const headingId = (section: SettingsSection) => `settings-${section}`;

export function SettingsView({ section }: { section: SettingsSection | null }) {
  const settings = useSettingsValue();
  const body = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<SettingsSection>(section ?? 'engine');
  const [opened, setOpened] = useState(section);
  if (opened !== section) {
    setOpened(section);
    if (section) setActive(section);
  }

  const scrollTo = (target: SettingsSection) => body.current?.querySelector(`[aria-labelledby="${headingId(target)}"]`)?.scrollIntoView?.({ block: 'start' });
  const show = (target: SettingsSection) => {
    setActive(target);
    scrollTo(target);
    body.current?.querySelector<HTMLElement>(`#${headingId(target)}`)?.focus({ preventScroll: true });
  };
  // Opened or re-opened at a section (settings.open's argument): scroll to it once its rows exist.
  const ready = settings !== null;
  useEffect(() => {
    if (section && ready) scrollTo(section);
  }, [section, ready]);

  // Codex's selected-section highlighting: the last section whose top has scrolled to the body's top.
  const onScroll = () => {
    const root = body.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    let current: SettingsSection = ORDER[0]!;
    for (const s of ORDER) {
      const el = root.querySelector(`[aria-labelledby="${headingId(s)}"]`);
      if (el && el.getBoundingClientRect().top - top <= 24) current = s;
    }
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) current = ORDER.at(-1)!; // the last is short
    setActive(current);
  };

  // W9 (H1): the view is the `settings` query container and never scrolls sideways. Narrower than 32rem (a pane of a
  // 50/50 split at the default window is about 300px) the index becomes a top row of section links, its title and
  // footer set aside, and every row stacks (parts.tsx `Setting`, KeymapSection's rows); wider, nothing changes.
  return (
    <div className="@container/settings h-full min-h-0 bg-bg text-ui text-fg">
      <div className="grid h-full min-h-0 grid-cols-[148px_minmax(0,1fr)] @max-lg/settings:grid-cols-1 @max-lg/settings:grid-rows-[auto_minmax(0,1fr)]">
        <nav
          aria-label="Settings sections"
          className="flex flex-col border-r border-border bg-bg-raised px-2 py-3.5 @max-lg/settings:flex-row @max-lg/settings:flex-wrap @max-lg/settings:gap-0.5 @max-lg/settings:border-r-0 @max-lg/settings:border-b @max-lg/settings:py-1.5"
        >
          <div className="px-2 pb-2.5 text-ui font-semibold @max-lg/settings:hidden">{INDEX.title}</div>
          {ORDER.map((s) => (
            <button
              key={s}
              type="button"
              aria-current={active === s ? 'true' : undefined}
              onClick={() => show(s)}
              className={`rounded-sm px-2 py-1.5 text-left text-ui-sm outline-accent focus-visible:outline-2 ${active === s ? 'bg-bg-active text-fg' : 'text-fg-muted hover:bg-bg-hover'}`}
            >
              {SECTIONS[s]}
            </button>
          ))}
          <p className="m-0 px-2 pt-3.5 text-ui-sm leading-normal text-fg-muted @max-lg/settings:hidden">{INDEX.footer}</p>
        </nav>
        <div ref={body} onScroll={onScroll} data-settings-body className="min-h-0 overflow-x-hidden overflow-y-auto px-5 pt-2 pb-3 @max-lg/settings:px-3">
          {settings === null ? (
            <p className="text-ui-sm text-fg-muted">{INDEX.reading}</p>
          ) : (
            <div className="max-w-[760px]">
              <Section id="engine">
                <EngineSection settings={settings} />
              </Section>
              <Section id="gateway">
                <GatewaySection settings={settings} />
              </Section>
              <Section id="keyboard">
                <KeymapSection keymap={settings.keymap} />
              </Section>
              <Section id="voice">
                <VoiceSection settings={settings} showKeyboard={() => show('keyboard')} />
              </Section>
              <Section id="appearance">
                <AppearanceSection settings={settings} />
              </Section>
              <Section id="notifications">
                <NotificationsSection settings={settings} />
              </Section>
              {/* E4a */}
              <Section id="browser">
                <BrowserSection settings={settings} />
              </Section>
              {/* P3-D: the design-system defaults (settings 14) */}
              <Section id="artifacts">
                <ArtifactsSection artifacts={settings.artifacts} />
              </Section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ id, children }: { id: SettingsSection; children: ReactNode }) {
  return (
    <section aria-labelledby={headingId(id)} className="border-t border-border pt-3 pb-2.5 first:border-t-0">
      <h3 id={headingId(id)} aria-label={SECTIONS[id]} tabIndex={-1} className="m-0 mb-1 flex items-baseline gap-2.5 text-ui font-semibold outline-accent focus-visible:outline-2">
        <span>{SECTIONS[id]}</span>
        {HINTS[id] && <span className="text-ui-sm font-normal text-fg-muted">{HINTS[id]}</span>}
      </h3>
      {children}
    </section>
  );
}
