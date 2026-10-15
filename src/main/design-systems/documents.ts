// B's document exporters handed the governing design system (the P3 spec's Decision Log 61, part 2; B's D12 and the
// ledger's X28): each run first asks the engine host which system governs the export (`designSystems.governing`: a
// version's pin, else the live artifact's through the host's chain), reads that system's state (`artifacts.state` live,
// `artifacts.versionState` at the pin's seq; none for the bundled floor), and hands the exporter D's export helpers bound
// to it as the context's `system`. So a Word file's theme and an HTML or PDF file's literals are the system the editor
// draws. A system that holds no system yet (a seeding cut short) exports in the floor, as the editor draws it with no
// style. Main never opens the store; the reads run inside the exporter's run, under the export's budget.
import { officeThemeXml } from '@artifacts/design-system/office';
import { resolveDsVars } from '@artifacts/design-system/resolve-vars';
import type { TokenSet } from '@artifacts/design-system/tokens';
import { builtinView, snapshotOfDoc } from '@artifacts/design-system/view';
import type { DesignSystemExport } from '@artifacts/document/export/design-system';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { DocumentExporter } from '../artifacts/export-document';
import type { HostDispatch } from '../ipc/router';

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

/** D's export helpers bound to the system governing an artifact's export (its version's, when one is named). */
export async function governingSystemExport(call: HostCall, at: { artifactId: string; versionId?: number }): Promise<DesignSystemExport<TokenSet>> {
  const { system } = await required(call, 'designSystems.governing', { artifactId: at.artifactId, ...(at.versionId !== undefined && { versionId: at.versionId }) });
  if ('builtin' in system) return bound(builtinView());
  const { bytes } = system.versionSeq === undefined ? await required(call, 'artifacts.state', { artifactId: system.id }) : await required(call, 'artifacts.versionState', { artifactId: system.id, seq: system.versionSeq });
  const doc = newDoc();
  try {
    applyV2(doc, bytes);
    return bound(snapshotOfDoc(doc) ?? builtinView());
  } finally {
    doc.destroy();
  }
}

/** `exporter`, each run handed the governing system as `context.system`; its kind and format unchanged. */
export function governDocumentExporter<E extends DocumentExporter>(exporter: E, call: HostCall): E {
  return { ...exporter, run: async (request, context) => exporter.run(request, { ...context, system: await governingSystemExport(call, request) }) };
}
