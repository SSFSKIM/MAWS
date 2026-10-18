// What a dashboard's tool answers add to B's (P3-E2 M2; ledger X25): the datasets footer of `artifact_read`, read from
// the doc the read shows (the live replica, or a retained version's), so a version's read lists the data it had.
import { listDatasets } from '@artifacts/dashboard/datasets';
import type { Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { DashboardDatasetSummary } from '@shared/maws/dashboard-tools';
import type { CommentAuthor } from '@shared/maws/document-tools';

export function datasetFooter(doc: Doc, author: (actor: Actor) => CommentAuthor): DashboardDatasetSummary[] {
  return listDatasets(doc).map(({ id, descriptor }) => ({
    id,
    title: descriptor.title,
    file: descriptor.source.kind === 'file' ? descriptor.source.name : `${descriptor.source.server} · ${descriptor.source.tool}`,
    columns: descriptor.columns,
    rows: descriptor.rows,
    ...(descriptor.rowKey !== undefined && { rowKey: descriptor.rowKey }),
    // E3: a query never fetched has no update to name, and says so
    ...(descriptor.updated ? { updated: { at: new Date(descriptor.updated.at).toISOString(), ...author(descriptor.updated.by) } } : { notFetched: true as const }),
    ...(descriptor.state.status !== 'ok' && { state: { status: descriptor.state.status, ...(descriptor.state.message !== undefined && { message: descriptor.state.message }) } }),
  }));
}
