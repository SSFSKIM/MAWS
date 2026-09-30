// The Appearance section (C11 execution document, Interfaces "Settings tab" Appearance; ruled 2026-09-29): C1's theme,
// and the monospace font the terminal and code blocks draw in (`appearance.monoFont`, the root `--font-mono` override).
// The rest of typography stays C6's tokens.
import type { Settings, ThemeSetting } from '@shared/ipc/schema';
import { APPEARANCE } from './copy';
import { monoFontStack } from './mono-font';
import { INPUT, Segment, Setting, useCommittedDraft, writeSettings } from './parts';

const THEMES = (['light', 'dark', 'system'] as const satisfies readonly ThemeSetting[]).map((value) => ({ value, label: APPEARANCE.themes[value] }));

export function AppearanceSection({ settings }: { settings: Settings }) {
  const [draft, field] = useCommittedDraft(settings.appearance.monoFont, (next) => writeSettings({ appearance: { monoFont: next } }));
  return (
    <>
      <Setting label={APPEARANCE.theme}>
        <Segment label={APPEARANCE.theme} value={settings.theme} options={THEMES} onChange={(theme) => void writeSettings({ theme })} />
        <span className="text-ui-sm text-fg-muted">{APPEARANCE.themeHint}</span>
      </Setting>
      <Setting label={APPEARANCE.monoFont} note={APPEARANCE.monoFontNote}>
        <input aria-label={APPEARANCE.monoFont} placeholder={APPEARANCE.monoFontPlaceholder} maxLength={200} spellCheck={false} {...field} className={`${INPUT} max-w-[260px]`} />
        {/* The preview draws in the family being typed, falling back through the token stack as the terminal does. */}
        <span data-testid="mono-preview" aria-hidden className="text-code whitespace-pre text-fg" style={{ fontFamily: monoFontStack(draft) ?? 'var(--font-mono)' }}>
          {APPEARANCE.preview}
        </span>
      </Setting>
    </>
  );
}
