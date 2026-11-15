// A governing system's export helpers for the Export menu's tests (UX wave U10b, §B.5): the bundled house system with
// its page (`dev.maws.page`) set to `size`, bound to D's own resolver as main's export binds a system
// (src/render/design-systems/documents.ts), so a test reads a document's page as the export does.
import { PAGE_KEY } from '@artifacts/design-system/extensions';
import { officeThemeXml } from '@artifacts/design-system/office';
import { resolveDsVars } from '@artifacts/design-system/resolve-vars';
import type { TokenSet } from '@artifacts/design-system/tokens';
import { builtinView } from '@artifacts/design-system/view';
import type { DesignSystemExport, PageSize } from '@artifacts/document/export/design-system';

export function pageSystem(size: PageSize): DesignSystemExport<TokenSet> {
  const { name, tokens } = builtinView();
  const root = tokens.groups.get('') ?? {};
  const page = (root.$extensions?.[PAGE_KEY] ?? {}) as Record<string, unknown>;
  const groups = new Map(tokens.groups).set('', { ...root, $extensions: { ...root.$extensions, [PAGE_KEY]: { ...page, size } } });
  return { name, tokens: { tokens: tokens.tokens, groups }, resolveDsVars, officeThemeXml };
}
export const LETTER_SYSTEM = pageSystem('letter');
export const A4_SYSTEM = pageSystem('a4');
