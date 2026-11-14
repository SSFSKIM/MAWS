// Customize's page and its view's section (UX wave U7b; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// Interfaces §F, "While customize/CustomizeView.tsx still takes a section"): until U11c the view takes a section, so the
// page's `show` is read as one (`all` as Plugins, `connectors` as `mcp`), and an opener's section is written as a `show`.
// No opener writes `all`.
import type { Destination } from '@shared/ipc/schema/layout';
import type { CustomizeSection } from '../customize/open';

export type CustomizeShow = Extract<Destination, { kind: 'customize' }>['show'];

export const SECTION_OF_SHOW: Readonly<Record<CustomizeShow, CustomizeSection>> = { all: 'plugins', plugins: 'plugins', skills: 'skills', connectors: 'mcp' };
export const SHOW_OF_SECTION: Readonly<Record<CustomizeSection, CustomizeShow>> = { plugins: 'plugins', skills: 'skills', mcp: 'connectors' };
