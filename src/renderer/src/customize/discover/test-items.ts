// Discover's unit tests' catalog items: one plugin from the official marketplace, each field overridable.
import { CatalogItemSchema, type CatalogItem } from '@shared/ipc/schema/catalog';

export function item(over: Partial<CatalogItem> = {}): CatalogItem {
  return CatalogItemSchema.parse({
    id: 'https://github.com/anthropics/claude-plugins-official#plugins/frontend-design',
    kind: 'plugin',
    name: 'frontend-design',
    installName: null,
    description: 'Create distinctive, production-grade frontend interfaces.',
    publisher: 'Anthropic',
    ownership: 'anthropic',
    reviewTier: null,
    scanBlocked: null,
    categories: ['code'],
    iconUrl: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    installs: null,
    rank: null,
    components: { skills: ['frontend-design'], mcpServers: [], hooks: false, commands: 0, agents: 0, cli: false },
    runsOnYourComputer: false,
    install: { kind: 'plugin', marketplaceSource: 'anthropics/claude-plugins-official', marketplaceName: 'claude-plugins-official', pluginName: 'frontend-design', ref: null, present: false },
    alsoListedBy: [],
    sources: ['seed:claude-plugins-official'],
    installed: 'no',
    ...over,
  });
}
