// The words an install asked from Discover adds to the plugins confirm sheet and its operation line
// (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Adding"). Shared: the sheet and the line
// (widgets/plugins) and Discover's own copy (customize/discover/copy.ts) both read them, so widgets never import from
// customize.
export const CATALOG_INSTALL = {
  contentsUnknown: 'Contents shown after install',
  alsoListedBy: (names: readonly string[]) => `Also listed by ${names.join(', ')}`,
  installsFrom: (plugin: string, marketplace: string) => `Installs ${plugin} from ${marketplace}`,
  addsAndInstalls: (marketplace: string, scope: string, plugin: string) => `Adds the marketplace ${marketplace} (${scope}) and installs ${plugin}`,
  skillPlugin: (plugin: string, marketplace: string, skills: readonly string[]) => `Installs the plugin ${plugin} from ${marketplace}, with ${skills.length} skill${skills.length === 1 ? '' : 's'}: ${skills.join(', ')}`,
  comesWith: (parts: readonly string[]) => `Comes with: ${parts.join(' · ')}`,
  staysAdded: (marketplace: string) => `The marketplace ${marketplace} stays added.`,
  removeMarketplace: 'Remove marketplace',
} as const;
