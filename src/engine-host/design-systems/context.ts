// What `artifact_create` attaches when it makes a document, a deck or a design (D9 and D10 of
// docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; Decision Log 4: A's `registerDesignSystemContext`): the
// governing system named, its values as the `--ds-*` properties a consumer reads, and its law, `DESIGN.md`, whole. The
// law is attached as written and never generated (Decision Log 22 of the parent; §4.3's "attached on create without
// asking"); a system without one (a Claude import) says so.
import { tokenProperties } from '@artifacts/design-system/css';
import { readSystem } from '@artifacts/design-system/model';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Artifact } from '@shared/artifacts/entity';
import type { DocumentService } from '../documents/service';

export const CONTEXT_COPY = {
  lead: (name: string, id: string) =>
    `The design system "${name}" (artifact ${id}) governs this artifact. Style it with the system's --ds-* custom properties and .ds-type-<role> classes, never with literal values, and check what you build against the hard don'ts in its law. artifact_read reads the whole system, its canon included.`,
  tokens: 'Its values (the document medium):',
  law: 'Its law, DESIGN.md:',
  noLaw: 'It has no law yet (no DESIGN.md): follow its values, and do not write a law for it unless the owner asks.',
} as const;

/** The context for one system, from its committed state (the live doc's when loaded). */
export function designSystemContext(service: DocumentService, system: Artifact): string {
  const doc = newDoc();
  try {
    applyV2(doc, service.readState(system.id).state);
    const { meta, tokens, law } = readSystem(doc);
    const parts = [CONTEXT_COPY.lead(meta?.name ?? system.title, system.id)];
    let values: Map<string, string> | null = null;
    try {
      values = tokenProperties(tokens, 'document');
    } catch {
      values = null; // a system mid-edit whose tokens do not resolve: its law still goes
    }
    if (values && values.size > 0) parts.push(`${CONTEXT_COPY.tokens}\n${[...values].map(([name, value]) => `${name}: ${value};`).join('\n')}`);
    parts.push(law.trim() ? `${CONTEXT_COPY.law}\n\n${law}` : CONTEXT_COPY.noLaw);
    return parts.join('\n\n');
  } finally {
    doc.destroy();
  }
}
