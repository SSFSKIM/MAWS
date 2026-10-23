// A dashboard's files in a linked Space's directory (P3-E2 M5; parent §2 "Exports", E's Decision Log 32; L's mirror,
// src/artifacts/library/mirror.ts): `<slug>.md` in B's lossless dialect (the chart blocks as `:::chart`, their dataset
// ids in the fence bodies, so an agent inspects and rebinds them), `<slug>/datasets.json` naming each bound dataset's
// snapshot file (relative to it), format and provenance, and every bound snapshot under `<slug>/data/` as a copy of its
// immutable asset, read only when the mirror lacks it. A snapshot's file name is a function of the snapshot alone: its
// asset's registered name (sanitised by L's `mirrorSegment`, bounded in UTF-8 bytes), the full SHA-256 of its ref and
// its descriptor's format, so a replacement takes a new name (no stale copy kept under an old one), case and NFC
// variants of a name stay apart, and one ref bound as both CSV and TSV is two files. A held legacy dashboard mirrors a
// diagnostic naming its files, never an empty document or a guessed conversion. Portable: runs in the host.
import { digest } from 'lib0/hash/sha256';
import { exportMarkdown } from '../document/export/markdown';
import { exportSource } from '../document/export/source';
import { mirrorSegment, mirrorSlug, type MirrorCopy, type MirrorWriter } from '../library/mirror';
import { listDatasets, snapshotOf, type DatasetFormat } from './datasets';
import { legacyDashboardFiles, legacyDashboardReason } from './legacy';
import { DATASET_STATES } from './states';

const BASE_BYTES = 120; // of the sanitised name; with the digest and the extension, under 200 bytes in all

/** The mirror's name of one snapshot: `<name>-<sha256 of the ref>.<format>`. */
export function snapshotFileName(assetName: string, ref: string, format: DatasetFormat): string {
  const dot = assetName.lastIndexOf('.');
  const stem = dot > assetName.lastIndexOf('/') ? assetName.slice(0, dot) : assetName;
  const encoder = new TextEncoder();
  let base = '';
  for (const char of mirrorSegment(stem)) {
    if (encoder.encode(base + char).length > BASE_BYTES) break;
    base += char;
  }
  base = base.replace(/[.-]+$/, '');
  const hex = [...digest(encoder.encode(ref))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${base || 'data'}-${hex}.${format}`;
}

export const dashboardMirrorWriter: MirrorWriter = ({ artifact, doc, assets = [], readAsset }) => {
  if (!doc) return { files: {} };
  const slug = mirrorSlug(artifact);
  const held = legacyDashboardFiles(doc);
  if (held) return { files: { [`${slug}.md`]: `This dashboard is held and is not mirrored as content: ${legacyDashboardReason(held)}.\n` } };

  const files: Record<string, string | MirrorCopy> = { [`${slug}.md`]: exportMarkdown(exportSource(doc, artifact.title), { mode: 'mirror' }) };
  const datasets: Record<string, unknown> = {};
  for (const { id, descriptor } of listDatasets(doc)) {
    const snapshot = snapshotOf(descriptor); // E3: null for a query never fetched, which has no file to copy
    const ref = snapshot?.ref ?? null;
    const format = snapshot?.format ?? 'json';
    const asset = ref === null ? undefined : assets.find((each) => each.ref === ref);
    const file = asset && readAsset ? `data/${snapshotFileName(asset.name, asset.ref, format)}` : null;
    if (file) files[`${slug}/${file}`] = { read: () => readAsset!(asset!.ref) };
    const { source, updated } = descriptor;
    const updatedAt = updated ? new Date(updated.at).toISOString() : null;
    datasets[id] = {
      title: descriptor.title,
      ...(descriptor.description !== undefined && { description: descriptor.description }),
      file,
      ...(file === null && snapshot !== null && { problem: DATASET_STATES.unreadable(id) }),
      ...(snapshot === null && { notFetched: true }), // E3
      format,
      rows: descriptor.rows,
      columns: descriptor.columns,
      ...(descriptor.rowKey !== undefined && { rowKey: descriptor.rowKey }),
      snapshot:
        source.kind === 'file'
          ? { ref, source: source.name, sha256: source.sha256, size: source.size, updated: updatedAt }
          : { ref, source: `${source.server} · ${source.tool}`, fetched: source.snapshot ? new Date(source.snapshot.at).toISOString() : null, ...(updatedAt !== null && { updated: updatedAt }) },
      ...(descriptor.state.status !== 'ok' && { state: { status: descriptor.state.status, ...(descriptor.state.message !== undefined && { message: descriptor.state.message }) } }),
    };
  }
  files[`${slug}/datasets.json`] = `${JSON.stringify({ dashboard: artifact.title, markdown: `../${slug}.md`, datasets }, null, 2)}\n`;
  return { files };
};
