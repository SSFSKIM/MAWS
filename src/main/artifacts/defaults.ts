// Main's relay of the design-system defaults to the engine host (docs/doperpowers/plans/2026-10-12-p3-a-store.md,
// Decision Log 22d and 31b): main owns the settings (slot 14, `artifacts: {defaultDesignSystem, spaceDesignSystems}`,
// P3-D's), the host resolves which system governs an artifact and persists the last values it was told in its store's
// `meta`, so a detached host with main absent still honours them. `artifacts.setDefaults` goes at every ready (each
// connection may be a host that was told something else, or nothing) and on every change of those settings while the
// host is ready. Settings without the slot (a build before P3-D's) push nothing at all, so a store's persisted defaults
// are never overwritten with empties by an older build; P3-D's slot lands into `defaultsOf` with no edit here.
import * as z from 'zod';
import type { CommandInput, CommandResult, HostState, Settings } from '@shared/ipc/schema';

export type ArtifactDefaults = CommandInput<'artifacts.setDefaults'>;

// Slot 14's shape as the ledger fixes it (X15, 2026-10-12).
const SlotSchema = z.object({ defaultDesignSystem: z.uuid().nullable(), spaceDesignSystems: z.record(z.uuid(), z.uuid()) });

// The defaults the settings carry, or null when they carry no slot 14 (or a malformed one, which is logged).
export function defaultsOf(settings: Settings): ArtifactDefaults | null {
  const slot = (settings as { artifacts?: unknown }).artifacts;
  if (slot === undefined) return null;
  const parsed = SlotSchema.safeParse(slot);
  if (!parsed.success) {
    console.warn('[artifacts] settings.artifacts is not the design-system defaults’ shape; not relayed', parsed.error.issues);
    return null;
  }
  return { owner: parsed.data.defaultDesignSystem, spaces: parsed.data.spaceDesignSystems };
}

export interface ArtifactDefaultsDeps {
  settings(): Settings;
  onSettingsChanged(listener: (settings: Settings) => void): () => void;
  hostState(): HostState; // the engine host's
  onHostState(listener: (state: HostState) => void): () => void;
  dispatch(input: ArtifactDefaults): Promise<CommandResult<'artifacts.setDefaults'>>;
}

export function startArtifactDefaults(deps: ArtifactDefaultsDeps): () => void {
  // What the host now serving was last sent (its JSON), one object per push so a failed push forgets only itself: the
  // next notification retries it, while a newer push that replaced it stands.
  let pushed: { key: string } | null = null;
  const push = () => {
    if (deps.hostState().state !== 'ready') return;
    const defaults = defaultsOf(deps.settings());
    if (defaults === null) return;
    const key = JSON.stringify(defaults);
    if (pushed?.key === key) return;
    const sent = { key };
    pushed = sent;
    const failed = (why: unknown) => {
      if (pushed === sent) pushed = null;
      console.warn('[artifacts] artifacts.setDefaults failed', why);
    };
    deps.dispatch(defaults).then((result) => {
      if (!result.ok) failed(result.error);
    }, failed);
  };
  const offs = [
    deps.onHostState((state) => {
      pushed = null; // every connection is told again at its ready
      if (state.state === 'ready') push();
    }),
    deps.onSettingsChanged(() => push()),
  ];
  push();
  return () => offs.forEach((off) => off());
}
