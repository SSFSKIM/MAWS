// The X12 mirror (the P3-A document's Decision Log 4): until P3-L's cutover, an agent's write of an `html` or `file`
// artifact also writes the X12 deliverable record under the same UUID, so the Deliverables panel, `maws-deliverable:`,
// `artifact_screenshot` and P2's comment card keep their behaviour. The store is authoritative: the mirror is written
// after the store's commit, and a mirror that fails is logged and fails nothing. A record lives under the session that
// created the artifact (P2-E1: a side thread's publish of its parent's page writes the parent's record), and each
// version's copy is the store's own content file, copied as X12's `v<n>.html`. Every write runs in the record owner's
// write chain and is deduplicated there (a record already written, a version a call already appended, by its tool-use
// id), so two mirrors of one call racing (an overlapping retry) write it once.
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import type { DeliverableWriter } from '../deliverables/store';
import { messageOf } from './artifact-context';

export interface MirrorDeps {
  deliverables: DeliverableWriter;
  log?: (line: string) => void;
  now?: () => Date;
}

export class X12Mirror {
  constructor(private readonly deps: MirrorDeps) {}

  // A new `html` artifact: its record with version 1. Answers the version, or null when nothing was written.
  async page(artifact: { id: string; title: string; handle?: string }, owner: AppSessionId, content: { path: string; sourcePath?: string }, toolUseId: ToolUseId | null): Promise<number | null> {
    return this.attempt(artifact.id, () => this.deps.deliverables.exclusive(owner, async () => {
      if (await this.deps.deliverables.get(owner, artifact.id)) return 1;
      const at = this.at();
      const copy = await this.deps.deliverables.copyVersion(owner, artifact.id, 1, content.path);
      const used = toolUseId !== null ? { toolUseId } : {};
      await this.deps.deliverables.write({
        id: artifact.id, appSessionId: owner, kind: 'artifact', artifactId: artifact.handle ?? artifact.id, title: artifact.title, path: copy.path,
        versions: [{ path: copy.path, at, ...used, ...(content.sourcePath !== undefined && { sourcePath: content.sourcePath }) }], ...used, createdAt: at, updatedAt: at,
      });
      return 1;
    }));
  }

  // An `html` artifact's next version, on its creator's record (none: nothing to mirror). Answers the version.
  async pageVersion(artifactId: string, owner: AppSessionId, title: string, contentPath: string, toolUseId: ToolUseId | null): Promise<number | null> {
    return this.attempt(artifactId, () =>
      this.deps.deliverables.exclusive(owner, async () => {
        const record = await this.deps.deliverables.get(owner, artifactId);
        if (record === null) return null;
        const appended = toolUseId === null ? -1 : record.versions.findIndex((v) => v.toolUseId === toolUseId);
        if (appended !== -1) return appended + 1; // this call's version, already appended by a mirror of it that ran first
        const version = record.versions.length + 1;
        const at = this.at();
        const copy = await this.deps.deliverables.copyVersion(owner, artifactId, version, contentPath);
        await this.deps.deliverables.update({ ...record, path: copy.path, title, updatedAt: at, versions: [...record.versions, { path: copy.path, at, ...(toolUseId !== null && { toolUseId }) }] });
        return version;
      }),
    );
  }

  // Delivered files (`send_file`, or a `file` artifact's create): one record each, the file in place.
  async files(artifacts: { id: string; path: string; title: string }[], owner: AppSessionId, caption: string | undefined, toolUseId: ToolUseId | null): Promise<void> {
    const createdAt = this.at();
    for (const artifact of artifacts) {
      await this.attempt(artifact.id, () => this.deps.deliverables.exclusive(owner, async () => {
        if (await this.deps.deliverables.get(owner, artifact.id)) return null;
        const record: DeliverableRecord = {
          id: artifact.id, appSessionId: owner, kind: 'file', path: artifact.path, title: artifact.title, ...(caption !== undefined && { caption }),
          versions: [{ path: artifact.path, at: createdAt }], ...(toolUseId !== null && { toolUseId }), createdAt,
        };
        await this.deps.deliverables.write(record);
        return null;
      }));
    }
  }

  // The version a call wrote on the record (a replayed call's answer), or null.
  async versionOf(artifactId: string, owner: AppSessionId, toolUseId: ToolUseId | null): Promise<number | null> {
    if (toolUseId === null) return null;
    const record = await this.deps.deliverables.get(owner, artifactId).catch(() => null);
    const index = record?.versions.findIndex((version) => version.toolUseId === toolUseId) ?? -1;
    return index === -1 ? null : index + 1;
  }

  private at(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  private async attempt<T>(artifactId: string, write: () => Promise<T>): Promise<T | null> {
    try {
      return await write();
    } catch (error) {
      this.deps.log?.(`the X12 record of artifact ${artifactId} was not written: ${messageOf(error)}`);
      return null;
    }
  }
}
