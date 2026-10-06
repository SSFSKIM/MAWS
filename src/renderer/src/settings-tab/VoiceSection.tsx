// The Voice section (E9 execution document, Design §9; M4): the hold that dictates as the keymap has it (unbound by
// default, the toolbar's microphone being the primary control; edited in Keyboard, where every binding is), the
// recognition language (`voice.locale`, settings version 9; null follows the system's), and what main's non-prompting
// probe (`voice.status`) reports for that language: the helper, the two macOS permissions with the pane that grants
// each, and whether the language has an on-device model, without which dictation is refused (recognition never leaves
// this Mac).
import type { Settings } from '@shared/ipc/schema';
import type { PermissionState, VoicePrivacyPane, VoiceStatus } from '@shared/ipc/schema/voice';
import { effectiveChord } from '@shared/keymap/actions';
import { formatChord } from '@shared/keymap/chord';
import { ipc } from '../ipc/client';
import { useCommand } from '../ipc/query';
import { homeAbbreviated } from '../tools/session-info/model';
import { KEYBOARD, VOICE } from './copy';
import { Chip, INPUT, Setting, TEXT_ACTION, writeSettings } from './parts';

// main caches a probe for 10 s per locale; reading it no more often keeps the section and the toolbar in step
const STATUS_STALE_MS = 10_000;
const SYSTEM = ''; // the select's value for `locale: null`

const names = new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' });
function languageName(locale: string): string {
  try {
    return names.of(locale) ?? locale;
  } catch {
    return locale; // not a tag Intl can read
  }
}

export function VoiceSection({ settings, showKeyboard }: { settings: Settings; showKeyboard(): void }) {
  const chosen = settings.voice.locale;
  const probe = useCommand('voice.status', { locale: chosen }, { staleTime: STATUS_STALE_MS });
  const status = probe.data ?? null;
  const chord = effectiveChord('composer.dictate', settings.keymap);
  return (
    <>
      <Setting label={VOICE.shortcut} note={VOICE.shortcutNote}>
        <kbd className={`rounded-sm border px-1.5 py-0.5 font-ui text-ui-sm whitespace-nowrap ${chord === null ? 'border-border text-fg-muted' : 'border-border-strong bg-bg text-fg'}`}>
          {chord === null ? KEYBOARD.unbound : formatChord(chord)}
        </kbd>
        <button type="button" className={TEXT_ACTION} onClick={showKeyboard}>
          {VOICE.changeInKeyboard}
        </button>
      </Setting>
      <Setting label={VOICE.language} note={VOICE.languageNote}>
        <LanguageSelect chosen={chosen} status={status} />
      </Setting>
      <Setting label={VOICE.helper} note={status?.helper.state === 'missing' && import.meta.env.DEV ? VOICE.helperBuild : undefined}>
        <HelperState status={status} error={probe.isError ? probe.error.message : null} />
      </Setting>
      <Permission label={VOICE.microphone} pane="microphone" status={status} />
      <Permission label={VOICE.speech} pane="speech" status={status} />
      <Setting label={VOICE.recognition}>
        <span className={status?.supportsOnDevice === false ? 'text-warning' : status?.supportsOnDevice ? '' : 'text-fg-muted'}>
          {status === null ? VOICE.reading : status.supportsOnDevice === null ? VOICE.permissionUnknown : status.supportsOnDevice ? VOICE.onDevice : VOICE.noOnDevice}
        </span>
      </Setting>
    </>
  );
}

// System first (named by the identifier the probe reports), then Apple's locales by their English names; a saved
// language the probe does not list (the helper missing, or Apple dropped it) stays listed so the select shows it. The
// probed language without an on-device model is marked; the probe answers for that one language only.
function LanguageSelect({ chosen, status }: { chosen: string | null; status: VoiceStatus | null }) {
  const unavailable = status?.supportsOnDevice === false;
  const mark = (label: string, locale: string | null) => (unavailable && locale === chosen ? `${label} · ${VOICE.noOnDeviceMark}` : label);
  const locales = [...(status?.locales ?? [])];
  if (chosen !== null && !locales.includes(chosen)) locales.push(chosen);
  const options = locales.map((locale) => ({ locale, name: languageName(locale) })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return (
    <select
      aria-label={VOICE.language}
      value={chosen ?? SYSTEM}
      onChange={(e) => void writeSettings({ voice: { locale: e.target.value === SYSTEM ? null : e.target.value } })}
      className={`${INPUT} max-w-[260px]`}
    >
      <option value={SYSTEM}>{mark(VOICE.system(status?.systemLocale ?? null), null)}</option>
      {options.map(({ locale, name }) => (
        <option key={locale} value={locale}>
          {mark(name, locale)}
        </option>
      ))}
    </select>
  );
}

function HelperState({ status, error }: { status: VoiceStatus | null; error: string | null }) {
  if (status === null) return <span className={error === null ? 'text-fg-muted' : 'text-warning'}>{error ?? VOICE.reading}</span>;
  const { helper } = status;
  return (
    <>
      <span className={`min-w-0 truncate ${helper.state === 'ready' ? '' : 'text-warning'}`} title={helper.path}>
        {helper.state === 'failed' ? VOICE.helperFailed(helper.message) : helper.state === 'ready' ? VOICE.helperFound : VOICE.helperMissing}{' '}
        <span className="font-mono">{homeAbbreviated(helper.path)}</span>
      </span>
      {status.backend === 'scripted' && <Chip>{VOICE.scripted}</Chip>}
    </>
  );
}

const OFF: readonly PermissionState[] = ['denied', 'restricted'];

function Permission({ label, pane, status }: { label: string; pane: VoicePrivacyPane; status: VoiceStatus | null }) {
  const state = status?.permission?.[pane] ?? null;
  const off = state !== null && OFF.includes(state);
  const open = () =>
    void ipc.invoke('voice.openPrivacySettings', { pane }).then((result) => {
      if (!result.ok) console.warn('[settings] voice.openPrivacySettings failed', result.error);
    });
  return (
    <Setting label={label}>
      <span className={off ? 'text-warning' : state === 'authorized' ? '' : 'text-fg-muted'}>{status === null ? VOICE.reading : state === null ? VOICE.permissionUnknown : VOICE.permission[state]}</span>
      {off && (
        <button type="button" className={TEXT_ACTION} onClick={open}>
          {VOICE.openSystemSettings}
        </button>
      )}
    </Setting>
  );
}
