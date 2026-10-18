// B's document exporters handed the governing design system (the P3 spec's Decision Log 61, part 2; B's D12 and the
// ledger's X28): each run first asks the engine host which system governs the export (`designSystems.governing`: a
// version's pin, else the live artifact's through the host's chain), reads that system's state (`artifacts.state` live,
// `artifacts.versionState` at the pin's seq; none for the bundled floor), and hands the exporter D's export helpers bound
// to it as the context's `system`. So a Word file's theme and an HTML or PDF file's literals are the system the editor
// draws. A system that holds no system yet (a seeding cut short) exports in the floor, as the editor draws it with no
// style. Main never opens the store; the reads run inside the exporter's run, under the export's budget.
// F (L182): a document's HTML and PDF pages also declare the governing system's bundled faces, as D's `systemFaces`
// filter admits them from its `document.css` (the faces a scope declares), under their authored names, each source the
// face's bytes inlined from the system's assets at its revision (`systemFacesCss`, the faces a deck's and a dashboard's
// pages declare), handed to B's page as its extra CSS (`viewCss`), so the file draws the face the editor does and loads
// nothing from outside itself. Markdown and Word read no face.
import { DOCUMENT_CSS_PATH } from '@artifacts/design-system/canon';
import { officeThemeXml } from '@artifacts/design-system/office';
import { resolveDsVars } from '@artifacts/design-system/resolve-vars';
import type { TokenSet } from '@artifacts/design-system/tokens';
import { builtinView, snapshotOfDoc } from '@artifacts/design-system/view';
import type { DesignSystemExport } from '@artifacts/document/export/design-system';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { DocumentExporter } from '../artifacts/export-document';
import type { HostDispatch } from '../ipc/router';
import { systemFacesCss, type DeckSystem } from '../presentations/export';

/** An engine-host command as main sends it. */
export type HostCall = <N extends CommandName>(name: N, input: CommandInput<N>) => Promise<CommandResult<N>>;

/** Main's `hosts.dispatch` narrowed to the engine host, typed per command (as A's `startArtifacts` narrows it). */
export const engineHostCall =
  (dispatch: HostDispatch): HostCall =>
  <N extends CommandName>(name: N, input: CommandInput<N>) =>
    dispatch('engine-host', name, input) as Promise<CommandResult<N>>;

async function required<N extends CommandName>(call: HostCall, name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
  const result = await call(name, input);
  if (!result.ok) throw new Error(`${name} failed: ${result.error.message}`);
  return result.value;
}

const bound = ({ name, tokens }: { name: string; tokens: TokenSet }): DesignSystemExport<TokenSet> => ({ name, tokens, resolveDsVars, officeThemeXml });

const floor = (): DeckSystem => ({ ...bound(builtinView()), id: null, documentCss: undefined });

/** The system governing an artifact's export (its version's, when one is named), with what its faces are read from. */
async function governingSystem(call: HostCall, at: { artifactId: string; versionId?: number }): Promise<DeckSystem> {
  const { system } = await required(call, 'designSystems.governing', { artifactId: at.artifactId, ...(at.versionId !== undefined && { versionId: at.versionId }) });
  if ('builtin' in system) return floor();
  const { bytes } = system.versionSeq === undefined ? await required(call, 'artifacts.state', { artifactId: system.id }) : await required(call, 'artifacts.versionState', { artifactId: system.id, seq: system.versionSeq });
  const doc = newDoc();
  try {
    applyV2(doc, bytes);
    const snapshot = snapshotOfDoc(doc);
    if (!snapshot) return floor();
    return { ...bound(snapshot), id: system.id, ...(system.versionSeq !== undefined && { revision: system.versionSeq }), documentCss: snapshot.files[DOCUMENT_CSS_PATH] };
  } finally {
    doc.destroy();
  }
}

/** D's export helpers bound to the system governing an artifact's export (its version's, when one is named). */
export async function governingSystemExport(call: HostCall, at: { artifactId: string; versionId?: number }): Promise<DesignSystemExport<TokenSet>> {
  const { name, tokens } = await governingSystem(call, at);
  return bound({ name, tokens });
}

/**
 * `exporter`, each run handed the governing system as `context.system`, and a document's HTML or PDF page its bundled
 * faces before any CSS of the run's own; its kind and format unchanged.
 */
export function governDocumentExporter<E extends DocumentExporter>(exporter: E, call: HostCall): E {
  const paged = exporter.kind === 'document' && (exporter.format === 'html' || exporter.format === 'pdf');
  return {
    ...exporter,
    run: async (request, context) => {
      const governing = await governingSystem(call, request);
      const system = bound({ name: governing.name, tokens: governing.tokens });
      const faces = paged ? await systemFacesCss(governing, { call }) : '';
      return exporter.run(request, { ...context, system, ...(faces !== '' && { viewCss: `${faces}${context.viewCss ?? ''}` }) });
    },
  };
}
