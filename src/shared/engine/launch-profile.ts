// P4-A2 M-P (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.2 "The per-session launch profile", X6's amendment;
// the owner's ruling of 2026-10-21: one profile, set in Settings › Engine, for every session MAWS launches): what MAWS
// sessions load of the user's own configuration. Settings version 17 holds it as `engine.launchProfile`; the user scope
// is the default, under which a launch is exactly what it was before the profile existed. Settings version 19 took its
// output style away (the owner's ruling of 2026-10-28): once P4-R7z withdrew MAWS's own contract, `maws` only selected
// the engine's default style, under which a session has no to-human lane, so every launch keeps the user's style.
//
// It reaches the engine through the launch's own settings surface and nothing else (D-1; never by editing the user's
// files): flag-level keys in `--settings`, whose precedence is user < project < local < flag < managed, while
// `--setting-sources` keeps `user` (the model, the effort, the permissions and the gateway env come from there):
// - plugins: each id in `off` is `enabledPlugins[id] = false`; every other plugin stays as the user's settings say;
// - hooks `none`: `disableAllHooks`, the engine's one switch (it has none per source), which also silences a command
//   hook in the flag JSON itself (spikes/protocol-probe/findings-p4-a2p-profile.txt).
// No effort field: the owner ruled effort out (P4 Decision Log 8).
import * as z from 'zod';

export const MAX_PROFILE_PLUGINS = 256;
// A plugin id as the engine keys `enabledPlugins`: `name@marketplace`, no whitespace (so no Object.prototype name).
export const PluginIdSchema = z.string().max(256).regex(/^[^\s@]+@[^\s@]+$/, 'a plugin id, name@marketplace');

export const LaunchProfileSchema = z.strictObject({
  plugins: z.strictObject({ off: z.array(PluginIdSchema).max(MAX_PROFILE_PLUGINS) }),
  hooks: z.enum(['user', 'none']),
});
export type LaunchProfile = z.infer<typeof LaunchProfileSchema>;

// The user scope: the user's plugins and hooks, as a terminal session has them (the default).
export const userScopeProfile = (): LaunchProfile => ({ plugins: { off: [] }, hooks: 'user' });

// The profile's keys for a launch's `--settings` JSON, in a fixed order; none for the user scope.
export function profileSettings(profile: LaunchProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const off = [...new Set(profile.plugins.off)].sort();
  if (off.length > 0) out.enabledPlugins = Object.fromEntries(off.map((id) => [id, false]));
  if (profile.hooks === 'none') out.disableAllHooks = true;
  return out;
}

export const isUserScope = (profile: LaunchProfile): boolean => Object.keys(profileSettings(profile)).length === 0;
