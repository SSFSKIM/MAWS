// Customize › Discover, Show: Skills (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Discover,
// per tab"): the plugins whose skills are known, one card per plugin with its skills named; + installs the plugin that
// carries them through the same install sheet and operations as Plugins (the CLI in the page's directory, or the
// engine's configuration directory for the user configuration).
// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §D): the management state and the sheet are
// the page's one place's (customize/place.tsx), so an add-then-install asked here finishes, and its line is still on the
// card, whichever view and Show value the person moved to while it ran.
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { DiscoverPane } from './DiscoverPane';

/** Skills' Discover view; inside the page's `Manage`. */
export function SkillsDiscover({ cwd, onOpenInstalled, onDetail, toList }: { cwd: string | null; onOpenInstalled(item: CatalogItem): void; onDetail?(open: boolean): void; toList?: number }) {
  return <DiscoverPane tab="skills" cwd={cwd} onOpenInstalled={onOpenInstalled} onDetail={onDetail} toList={toList} />;
}
