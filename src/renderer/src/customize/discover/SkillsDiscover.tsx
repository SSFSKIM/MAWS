// Customize › Skills › Discover (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Discover, per
// tab"): the plugins whose skills are known, one card per plugin with its skills named; + installs the plugin that
// carries them through the same install sheet and operations as Plugins (the CLI in the page's directory, or the
// engine's configuration directory for the user configuration).
// `SkillsManage` owns the management state and draws the sheet. Customize keeps it mounted across Skills' two views and
// across its sections (as the Plugins library keeps its own), so an add-then-install asked here finishes, and its line
// is still on the card, whichever view the person moved to while it ran.
import { useCallback, type ReactNode } from 'react';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { useSessions } from '../../stores/sessions';
import { ManageProvider, useManageState } from '../../widgets/plugins/manage';
import { usePluginsEnv } from '../../widgets/plugins/read';
import { resolutionOf } from '../../widgets/PluginsWidget';
import { DiscoverPane } from './DiscoverPane';

export function SkillsManage({ cwd, children }: { cwd: string | null; children?: ReactNode }) {
  const env = usePluginsEnv();
  const { reread } = env;
  const readySessions = useSessions((s) => [...s.engine.values()].filter((status) => status.process === 'ready').length);
  const resolveEngine = useCallback(async () => resolutionOf(await reread()), [reread]);
  const directory = cwd ?? env.data?.configHome ?? '';
  const { manage, sheet } = useManageState({ cwd: directory, readySessions, keep: `customize:skills:${cwd ?? 'user'}` }, null, resolveEngine); // the page's own: they outlive its views
  return (
    <ManageProvider value={manage}>
      {children}
      {sheet}
    </ManageProvider>
  );
}

/** Skills' Discover view; inside `SkillsManage`. */
export function SkillsDiscover({ cwd, onOpenInstalled }: { cwd: string | null; onOpenInstalled(item: CatalogItem): void }) {
  return <DiscoverPane tab="skills" cwd={cwd} onOpenInstalled={onOpenInstalled} />;
}
