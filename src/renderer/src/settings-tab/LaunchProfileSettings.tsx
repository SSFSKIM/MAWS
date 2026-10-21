// P4-A2 (settings version 17; P4 §4.2 "The per-session launch profile", the owner's ruling of 2026-10-21: one profile,
// chosen here, never when a session starts): Settings › Engine, the launch profile every session MAWS launches runs
// under (src/shared/engine/launch-profile.ts). Three rows beside the engine's other launch settings: the user's plugins,
// each with its switch (off keeps it out of MAWS's sessions), the output style (the user's or MAWS's own) and the hooks
// (the user's or none). Each change writes the whole profile through `settings.set` and reaches a session at its next
// launch. The plugins listed are the ones the user's settings turn on (the plugin CLI's user-scope records, read in the
// engine's config home), with any already switched off kept in the list so they can come back.
import { useState } from 'react';
import type { Settings } from '@shared/ipc/schema';
import type { LaunchProfile } from '@shared/engine/launch-profile';
import { useCommand } from '../ipc/query';
import { usePluginsRead } from '../widgets/plugins/read';
import { Segment, Setting, Switch, writeSettings } from './parts';
import { LAUNCH_PROFILE } from './copy';

const same = (a: LaunchProfile, b: LaunchProfile) => JSON.stringify(a) === JSON.stringify(b);

// The plugin ids the rows list: the user-scope plugins the settings turn on, then those the profile turns off, once each.
export function listedPlugins(plugins: readonly { id: string; scope: string; enabled: boolean }[], off: readonly string[]): string[] {
  const on = plugins.filter((p) => p.scope === 'user' && p.enabled).map((p) => p.id);
  return [...new Set([...on, ...off])].sort();
}

export function LaunchProfileSettings({ settings }: { settings: Settings }) {
  const profile = settings.engine.launchProfile;
  const [pending, setPending] = useState<LaunchProfile | null>(null);
  if (pending !== null && same(pending, profile)) setPending(null);
  // the store's matching profile, not the write's answer, enables the controls again (as McpServers does)
  const write = async (next: LaunchProfile) => {
    if (pending !== null || same(next, profile)) return;
    setPending(next);
    if (!(await writeSettings({ engine: { launchProfile: next } }))) setPending(null);
  };
  const busy = pending !== null;
  return (
    <>
      <Plugins profile={profile} disabled={busy} write={write} />
      <Setting label={LAUNCH_PROFILE.style} note={LAUNCH_PROFILE.styleNote}>
        <Segment
          label={LAUNCH_PROFILE.style}
          value={profile.outputStyle}
          options={[
            { value: 'user', label: LAUNCH_PROFILE.styleYours },
            { value: 'maws', label: LAUNCH_PROFILE.styleMaws },
          ]}
          onChange={(outputStyle) => void write({ ...profile, outputStyle })}
        />
      </Setting>
      <Setting label={LAUNCH_PROFILE.hooks} note={LAUNCH_PROFILE.hooksNote}>
        <Segment
          label={LAUNCH_PROFILE.hooks}
          value={profile.hooks}
          options={[
            { value: 'user', label: LAUNCH_PROFILE.hooksYours },
            { value: 'none', label: LAUNCH_PROFILE.hooksNone },
          ]}
          onChange={(hooks) => void write({ ...profile, hooks })}
        />
      </Setting>
    </>
  );
}

function Plugins({ profile, disabled, write }: { profile: LaunchProfile; disabled: boolean; write(next: LaunchProfile): Promise<void> }) {
  const state = useCommand('fs.state', undefined, { staleTime: Infinity });
  const listing = usePluginsRead('plugins.list', state.data?.configHome ?? null);
  const off = new Set(profile.plugins.off);
  const ids = listing.data ? listedPlugins(listing.data.plugins, profile.plugins.off) : [...off].sort();
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...off].filter((x) => x !== id) : [...off, id];
    void write({ ...profile, plugins: { off: [...new Set(next)].sort() } });
  };
  return (
    <Setting label={LAUNCH_PROFILE.plugins} note={LAUNCH_PROFILE.pluginsNote}>
      {ids.map((id) => (
        <span key={id} className="flex min-w-0 basis-full items-center gap-2">
          <Switch checked={!off.has(id)} onChange={(on) => toggle(id, on)} label={LAUNCH_PROFILE.pluginOn(id)} disabled={disabled} />
          <span className={`min-w-0 truncate font-mono text-ui-sm ${off.has(id) ? 'text-fg-muted' : 'text-fg'}`}>{id}</span>
        </span>
      ))}
      {ids.length === 0 && <span className="text-ui-sm text-fg-muted">{listing.state === 'ready' ? LAUNCH_PROFILE.pluginsNone : listing.state === 'error' ? listing.error : LAUNCH_PROFILE.pluginsReading}</span>}
      {ids.length > 0 && listing.error !== null && <span className="basis-full text-ui-sm text-warning">{listing.error}</span>}
    </Setting>
  );
}
