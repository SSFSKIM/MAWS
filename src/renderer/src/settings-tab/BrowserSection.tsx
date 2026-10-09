// E4a (Task 3.4): Settings › Browser (E4a execution document, Design §9 and §16; settings version 11, Decision Log 49),
// each row writing its one field of `settings.browser`:
//
// - Profile: Default (MAWS's own partition) first, then the imported Chrome profiles `browser.profiles.list` names (E4b
//   writes them); a saved profile the list no longer has stays listed, marked once the list has answered (its directory
//   until then), so the select shows what is saved
//   (main then browses with the default and says so, Design §9). It applies to tabs opened afterwards.
// - Search engine: the address field's search template, written on Enter or blur only when it is an http(s) address
//   with %s (the schema refuses anything else; a refusal is said in words and the field goes back).
// - Links that open a new window: a new tab of the session, or the system browser (Decision Log 11).
import type { Settings } from '@shared/ipc/schema';
import { isSearchUrlTemplate } from '@shared/browser/url';
import { SETTINGS_DEFAULTS_V12 } from '@shared/settings/defaults';
import { useCommand } from '../ipc/query';
import { toast } from '../stores/notices';
import { BROWSER } from './copy';
import { INPUT, Segment, Setting, TEXT_ACTION, useCommittedDraft, writeSettings } from './parts';
// E4b start
import { BrowserImport } from './BrowserImport';
// E4b end

const DEFAULT_PROFILE = ''; // the select's value for `profile: null`
const DEFAULT_SEARCH = SETTINGS_DEFAULTS_V12.browser.searchUrl;
const LINK_TARGETS = (['in-app', 'external'] as const).map((value) => ({ value, label: BROWSER.linkTargets[value] }));

export function BrowserSection({ settings }: { settings: Settings }) {
  const { profile, searchUrl, linkTarget } = settings.browser;
  return (
    <>
      <Setting label={BROWSER.profile} note={BROWSER.profileNote}>
        <ProfileSelect profile={profile} />
      </Setting>
      <Setting label={BROWSER.search} note={BROWSER.searchNote}>
        <SearchField searchUrl={searchUrl} />
      </Setting>
      <Setting label={BROWSER.links} note={linkTarget === 'in-app' ? BROWSER.linksNote : undefined}>
        <Segment label={BROWSER.links} value={linkTarget} options={LINK_TARGETS} onChange={(next) => void writeSettings({ browser: { linkTarget: next } })} />
      </Setting>
      {/* E4b start: the imported Chrome profiles, their extension toggles and removal */}
      <BrowserImport />
      {/* E4b end */}
    </>
  );
}

function ProfileSelect({ profile }: { profile: string | null }) {
  const listed = useCommand('browser.profiles.list', undefined).data?.profiles; // undefined until main answers
  const profiles = [...(listed ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const unlisted = profile !== null && !profiles.some(({ profileDir }) => profileDir === profile); // its directory as label
  return (
    <select
      aria-label={BROWSER.profile}
      value={profile ?? DEFAULT_PROFILE}
      onChange={(event) => void writeSettings({ browser: { profile: event.target.value === DEFAULT_PROFILE ? null : event.target.value } })}
      className={`${INPUT} max-w-[260px]`}
    >
      <option value={DEFAULT_PROFILE}>{BROWSER.defaultProfile}</option>
      {profiles.map(({ profileDir, name }) => (
        <option key={profileDir} value={profileDir}>
          {name}
        </option>
      ))}
      {unlisted && <option value={profile}>{listed === undefined ? profile : BROWSER.missingProfile(profile)}</option>}
    </select>
  );
}

function SearchField({ searchUrl }: { searchUrl: string }) {
  const [, field] = useCommittedDraft(searchUrl, async (next) => {
    if (next === null || !isSearchUrlTemplate(next)) {
      toast({ level: 'warning', text: BROWSER.searchInvalid, actions: [], dismissible: true });
      return false;
    }
    return writeSettings({ browser: { searchUrl: next } });
  });
  return (
    <>
      <input aria-label={BROWSER.search} spellCheck={false} autoComplete="off" {...field} className={`${INPUT} max-w-[420px] font-mono`} />
      {searchUrl !== DEFAULT_SEARCH && (
        <button type="button" className={TEXT_ACTION} onClick={() => void writeSettings({ browser: { searchUrl: DEFAULT_SEARCH } })}>
          {BROWSER.useDefault}
        </button>
      )}
    </>
  );
}
