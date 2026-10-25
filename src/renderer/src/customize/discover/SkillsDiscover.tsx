// Customize › Skills › Discover (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Discover, per
// tab"): the plugins whose skills are known, one card per plugin with its skills named; + installs the plugin that
// carries them through the same install sheet and operations as Plugins (the CLI in the page's directory, or the
// engine's configuration directory for the user configuration). Its own management state: the sheet drawn beside it.
import { useCallback, type ReactNode } from 'react';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { useSessions } from '../../stores/sessions';
import { ManageProvider, useManageState } from '../../widgets/plugins/manage';
import { usePluginsEnv } from '../../widgets/plugins/read';
import { resolutionOf } from '../../widgets/PluginsWidget';
import { DiscoverPane } from './DiscoverPane';

export function SkillsDiscover({ cwd, onOpenInstalled, children }: { cwd: string | null; onOpenInstalled(item: CatalogItem): void; children?: ReactNode }) {
  const env = usePluginsEnv();
  const { reread } = env;
  const readySessions = useSessions((s) => [...s.engine.values()].filter((status) => status.process === 'ready').length);
  const resolveEngine = useCallback(async () => resolutionOf(await reread()), [reread]);
  const directory = cwd ?? env.data?.configHome ?? '';
  const { manage, sheet } = useManageState({ cwd: directory, readySessions }, null, resolveEngine);
  return (
    <ManageProvider value={manage}>
      {children}
      <DiscoverPane tab="skills" cwd={cwd} onOpenInstalled={onOpenInstalled} />
      {sheet}
    </ManageProvider>
  );
}
