// The design system's exporter in A's export registry (D12 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md;
// Decision Log 28): `design_system` as `claude`, the format the agent's `artifact_export` and the page's "Export for
// Claude" ask for. It reads the system's state as the export took it and the assets its files name, and writes Claude's
// design-system files (`claudeExportFiles`) as one zip where the request says. Wired by one fenced line in main.
import { claudeExportAssetRefs, claudeExportFiles } from '@artifacts/design-system/export';
import { applyV2, newDoc } from '@artifacts/yjs';
import type { Exporter, ExporterRegistry } from '../artifacts';
import { zipFiles } from './zip';

const claudeExporter: Exporter = {
  kind: 'design_system',
  format: 'claude',
  run: async (request, context) => {
    const doc = newDoc();
    try {
      applyV2(doc, await context.state());
      const assets: Record<string, Uint8Array> = {};
      for (const ref of claudeExportAssetRefs(doc)) {
        const found = await context.readAsset(ref);
        if (found) assets[ref] = found.bytes;
      }
      await context.writeFile(request.path, zipFiles(claudeExportFiles(doc, assets)));
    } finally {
      doc.destroy();
    }
  },
};

/** Registers the design system's exporters; the answer withdraws them. */
export function registerDesignSystemExporters(registry: Pick<ExporterRegistry, 'register'>): () => void {
  return registry.register(claudeExporter);
}
