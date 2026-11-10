// The stored statements and the project acts (docs/doperpowers/plans/2026-11-10-project-registry.md, M8, Interfaces §F
// and §G; its design §2, §3, §8). A stored statement is the machine's own record that a folder is in a project: a minted
// id, or a link beside it. It is made only by an act and only while the registry seam says statements are possible
// (§H; `NO_REGISTRY` says no, so with it the machine behaves as before), and it counts only on an enrolled machine.
//
// - The rule (`deriveProject`) reads statements through `ProjectStore.statementAt`, which checks the anchor at every lookup.
// - A row is minted only at a declaring moment (§F.4): an explicit add (a), a first MAWS use (b), and when statements
//   become possible (c), and only when the rule at its folder gives the machine's own project; the broadest folders only
//   by an explicit add of that very folder. At (c) every declared row is evaluated before any is minted.
// - After a statement change the changed row is derived again before the act answers, the rows beneath it through the
//   refresh queue after; the act answers after the endpoint's restatement to sminos (`published`).
// - A refusal is `invalid_input`, its message starting `<code>: ` (PROJECT_REFUSALS).
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import type { ProjectId } from '@shared/graph/ids';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { ProjectRecord, ProjectRefusal } from '@shared/ipc/schema/session';
import type { GitFiles } from '@shared/machine/git-reads';
import type { Enrollment } from '@shared/machine/identity';
import type { OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import type { ProjectsSource, RegistrySeam } from '@shared/machine/registry';
import type { Location } from '@shared/sessions/intent';
import { addFolder } from './add-folder';
import { readAnchor } from './anchor';
import { deriveProject, folderSmnsId, ORG_GIT_TIMEOUT_MS, type OrgDerivation } from './org-project';
import { isBroadFolder, locate, type OrgRow, type ProjectStore } from './projects';

export type DeriveRule = typeof deriveProject;

/** What the rule is computed with: this machine, its enrollment as it is now, and the derivation itself. */
export interface StatementsContext {
  machine: MachineRef;
  enrollment: () => Enrollment | null;
  derive?: DeriveRule;
  home?: string; // the broadest folders' measure (§F.4); this process's home when absent
}

/** What the acts need of the index around them: the refresh queue's derivation of rows, and its slots. */
export interface StatementsQueue {
  rederive(rows: readonly OrgRow[]): void;
  slot<T>(work: () => Promise<T>): Promise<T>;
}

/** What a declaration's answer gains while statements are possible (§G's `addFolder`). */
export type Decided = { by?: OrgDerivation['by']; at?: string | null; restated?: boolean };

function refuse(code: ProjectRefusal, words: string): never {
  throw new HostCommandError(ipcError('invalid_input', `${code}: ${words}`));
}

const canonicalFolder = (directory: string): string | null => {
  try {
    const real = realpathSync.native(directory);
    return statSync(real).isDirectory() ? real.normalize('NFC') : null;
  } catch {
    return null;
  }
};

export class Statements {
  private context: StatementsContext | null = null;
  private evaluating = false;
  private offStatements: (() => void) | null = null;

  constructor(
    private readonly projects: ProjectStore,
    private readonly registry: RegistrySeam,
    private readonly queue: StatementsQueue,
  ) {}

  /** The rule's lookup, which `deriveProject` asks only on an enrolled machine. */
  readonly lookup = (path: string) => this.projects.statementAt(path);

  /** Starts the statements' life on this machine: the first MAWS use's minting and the seam's turns. */
  bind(context: StatementsContext): void {
    this.context = context;
    this.projects.onUsed((id) => void this.used(id).catch((error) => console.error('[index] minting a first-used project failed:', error instanceof Error ? error.message : error)));
    this.offStatements?.();
    this.offStatements = this.registry.onStatements(() => void this.statementsChanged().catch((error) => console.error('[index] minting at the statements’ turn failed:', error instanceof Error ? error.message : error)));
  }

  unbind(): void {
    this.offStatements?.();
    this.offStatements = null;
    this.projects.onUsed(null);
    this.context = null;
  }

  private enrollment(): Enrollment | null {
    return this.context?.enrollment() ?? null;
  }

  private get home(): string {
    return this.context?.home ?? homedir();
  }

  /** Design §8's rule for a row's folder, its answer written to the row (and told, as any change); null without an answer. */
  async deriveRow(row: OrgRow, gitTimeoutMs: number = ORG_GIT_TIMEOUT_MS): Promise<OrgDerivation | null> {
    const context = this.context;
    if (context === null) return null;
    const enrollment = context.enrollment();
    const derived = await (context.derive ?? deriveProject)(
      { directory: row.directory, machine: context.machine, projectId: row.id, name: row.name, ...(row.files === undefined ? {} : { files: row.files }) },
      enrollment,
      { statements: this.lookup, gitTimeoutMs },
    );
    if (derived === null) return null;
    this.projects.setOrg(row.id as ProjectId, derived.org, enrollment === null ? null : { remote: derived.remote, hub: derived.hub });
    // §F.5: the folder holding a deciding `.smns` a session runs in or beneath is declared (an enrolled machine's alone)
    if (enrollment !== null && derived.by === 'smns' && derived.smnsFolder !== null && this.projects.hasSession(row.id as ProjectId)) this.projects.declareByFile(derived.smnsFolder);
    return derived;
  }

  private deriveId(id: ProjectId): Promise<OrgDerivation | null> {
    const { directory, name } = this.projects.statementRow(id);
    return this.deriveRow({ id, directory, name });
  }

  private beneath(directory: string): void {
    this.queue.rederive(this.projects.rowsBeneath(directory));
  }

  // A minted id for the row, anchored to its folder; nothing where there is no folder to anchor.
  private mintRow(id: ProjectId): boolean {
    const anchor = readAnchor(this.projects.statementRow(id).directory);
    return anchor !== null && this.projects.mint(id, randomUUID(), anchor);
  }

  // Whether a row may be minted at all (§F.4): never a linked or managed worktree (a row `session.projects.add` made
  // there), which is in its owning checkout's project; the broadest folders only by an explicit add of that very folder.
  private mintable(directory: string, explicit: boolean): boolean {
    return locate(directory).worktreePath === null && (explicit || !isBroadFolder(directory, this.home));
  }

  private unavailable(): void {
    const state = this.registry.statements();
    if (!state.possible) refuse('statements-unavailable', `${state.reason}: this machine makes no stored statement now`);
  }

  // A link's target (§G): a project a verified record names and that is a hub project, or the id the folder's own `.smns` names.
  private async target(into: string, folder: string): Promise<void> {
    const known = this.registry.project(into);
    if (known === null) {
      if ((await folderSmnsId(folder)) !== into) refuse('unknown-project', `${into} is in no verified projects record`);
      return;
    }
    if (!known.hub) refuse('not-a-hub-project', `${into}'s log is not on the hub`);
  }

  /**
   * Declares a folder (`session.projects.add`, `addFolder`): today's act, then, while statements are possible, minting's
   * moment (a), `into`'s link and `own`'s minted id, the rule's answer after them and the restatement. Today's act keeps
   * its own refusals.
   */
  async declare<T extends { project: ProjectRecord }>(directory: string, declare: () => T, { into, own }: { into?: string; own?: true } = {}): Promise<T & Decided> {
    if (into !== undefined && own) refuse('into-and-own', 'a folder is linked into a project or made a project of its own, not both');
    if (into !== undefined || own) this.unavailable();
    const folder = canonicalFolder(directory);
    if (into !== undefined) {
      if (folder === null) refuse('not-a-directory', directory);
      await this.target(into, folder);
    }
    const before = folder === null ? [] : this.projects.declaredRows();
    const wasDeclared = before.some((row) => row.path === folder);
    if (folder !== null && !wasDeclared) {
      const standIn = { pid: 'new', path: folder, name: basename(folder), org: { key: 'folder:new' as OrgKey, name: basename(folder), source: 'folder' as const, smnsId: null } };
      if (!this.registry.fits([...before, standIn])) refuse('too-many-locations', 'the declared folders would not fit one projects record');
    }
    const answer = declare();
    // a statement kept on a removed row counts again, for the folder and the rows beneath it
    if (!wasDeclared) this.beneath(answer.project.directory);
    if (!this.registry.statements().possible || this.context === null) return answer as T & Decided;
    const id = answer.project.id;
    let derived = await this.deriveId(id);
    let changed = false;
    const row = this.projects.statementRow(id);
    if (derived !== null && row.minted === null && (own === true || derived.by === 'machine') && this.mintable(row.directory, true)) changed = this.mintRow(id);
    if (into !== undefined) changed = this.projects.setLink(id, into, readAnchor(row.directory)) || changed;
    if (changed) {
      derived = await this.deriveId(id);
      this.beneath(row.directory);
    }
    const { restated } = await this.registry.published();
    return { ...answer, project: this.projects.record(id), ...(derived === null ? {} : { by: derived.by, at: derived.at }), restated } as T & Decided;
  }

  /** `addFolder`'s act: the folder by the membership rule, then `declare`. */
  addFolder(directory: string, options: { into?: string; own?: true; files?: GitFiles; locateIn?: typeof locate } = {}): Promise<{ project: ProjectRecord; location: Location } & Decided> {
    return this.declare(directory, () => addFolder(this.projects, directory, options.locateIn, options.files), options);
  }

  /** `session.projects.resolve`: the rule for a directory, changing nothing. */
  async resolve(directory: string): Promise<{ project: string | null; by: OrgDerivation['by']; at: string | null; label: OrgDerivation['org'] }> {
    const folder = canonicalFolder(directory);
    if (folder === null) refuse('not-a-directory', directory);
    const context = this.context;
    if (context === null) refuse('unresolved', 'the rule cannot be computed yet');
    const located = locate(folder);
    const row = located.projectDirectory === null ? null : this.projects.projectAt(located);
    const derived = await (context.derive ?? deriveProject)({ directory: folder, machine: context.machine, projectId: row ?? 'new', name: basename(folder) }, context.enrollment(), { statements: this.lookup });
    if (derived === null) refuse('unresolved', 'git gave no answer in time: try again');
    return { project: derived.org.smnsId, by: derived.by, at: derived.at, label: derived.org };
  }

  /** `session.projects.link`: a declared row's link set or, with null, cleared. It never mints. */
  async link(id: ProjectId, into: string | null): Promise<{ project: ProjectRecord; restated: boolean }> {
    const row = this.projects.statementRow(id);
    if (!row.declared) refuse('not-declared', `${row.directory} is not a declared folder`);
    if (into !== null) {
      this.unavailable();
      await this.target(into, row.directory);
    }
    const changed = this.projects.setLink(id, into, readAnchor(row.directory));
    if (!changed) return { project: this.projects.record(id), restated: true };
    await this.deriveId(id);
    this.beneath(row.directory);
    const { restated } = await this.registry.published();
    return { project: this.projects.record(id), restated };
  }

  /** `session.projects.relocate`: a declared row pointed at its folder's path now, merging an unstated row there. */
  async relocate(id: ProjectId, directory: string): Promise<{ project: ProjectRecord; merged: boolean; restated: boolean }> {
    const row = this.projects.statementRow(id);
    if (!row.declared) refuse('not-declared', `${row.directory} is not a declared folder`);
    const folder = canonicalFolder(directory);
    const anchor = folder === null ? null : readAnchor(folder);
    if (folder === null || anchor === null) refuse('not-a-directory', directory);
    const moved = this.projects.relocate(id, folder, anchor);
    if ('refused' in moved) refuse('has-statement', `${folder} is a folder with a stored statement of its own`);
    await this.deriveId(id);
    this.beneath(row.directory);
    if (folder !== row.directory) this.beneath(folder);
    const { restated } = await this.registry.published();
    return { project: this.projects.record(id), merged: moved.merged, restated };
  }

  /** `session.projects.update`: a rename sets the name counter one above the highest the records and this machine hold. */
  update(id: ProjectId, patch: { name?: string; order?: number }): ProjectRecord {
    if (patch.name === undefined || this.enrollment() === null) return this.projects.update(id, patch);
    const { smnsId, nameRev } = this.projects.statementRow(id);
    const highest = smnsId === null ? (nameRev ?? 0) : Math.max(this.registry.project(smnsId)?.nameRev ?? 0, this.projects.highestNameRev(smnsId));
    return this.projects.update(id, patch, highest + 1);
  }

  /**
   * `session.projects.remove`: the row hidden; with `expect`, only while its path and the rule's project now are the
   * expected ones (else `changed`), the rule tied to the hide by `statements_gen` (`unresolved` when it has no answer).
   */
  async remove(id: ProjectId, expect?: { path: string; project: string | null }): Promise<void> {
    const { directory } = this.projects.statementRow(id);
    if (expect === undefined) {
      this.projects.hide(id);
    } else {
      for (let attempt = 0; ; attempt += 1) {
        if (attempt === 3) refuse('unresolved', 'the rule kept changing: try again');
        const gen = this.projects.statementsGen();
        const row = this.projects.statementRow(id);
        if (row.directory !== expect.path) refuse('changed', `the location is at ${row.directory} now`);
        const context = this.context;
        const derived = context === null ? null : await (context.derive ?? deriveProject)({ directory: row.directory, machine: context.machine, projectId: id, name: row.name }, context.enrollment(), { statements: this.lookup });
        if (derived === null) refuse('unresolved', 'the rule has no answer now: try again');
        if (derived.org.smnsId !== expect.project) refuse('changed', `the location is in ${derived.org.smnsId ?? "this machine's own project"} now`);
        if (this.projects.hideAt(id, gen)) break;
      }
    }
    // its statement no longer counts: the folder and the rows beneath it derived again
    await this.deriveId(id);
    this.beneath(directory);
    if (this.registry.statements().possible) await this.registry.published();
  }

  // §F.4's moment (b): a first MAWS use made the row the user's
  private async used(id: ProjectId): Promise<void> {
    if (!this.registry.statements().possible || this.context === null) return;
    const row = this.projects.statementRow(id);
    if (!row.declared || row.minted !== null || !this.mintable(row.directory, false)) return;
    const derived = await this.deriveId(id);
    if (derived?.by !== 'machine' || !this.mintRow(id)) return;
    await this.deriveId(id);
    this.beneath(row.directory);
  }

  /**
   * §F.4's moment (c): statements became possible (and, at a start, are possible while the rows of the last time they were
   * not are unminted). Every declared row is evaluated first, then those the rule leaves in the machine's project are
   * minted, so which of two nested folders comes first decides nothing. `index_meta.minting` remembers it was done.
   */
  async statementsChanged(): Promise<void> {
    const state = this.registry.statements();
    if (!state.possible) {
      if (this.projects.meta('minting') !== '0') this.projects.setMeta('minting', '0');
      return;
    }
    if (this.context === null || this.evaluating || this.projects.meta('minting') === '1') return;
    this.evaluating = true;
    try {
      const candidates: ProjectId[] = [];
      let unfound = false;
      await Promise.all(
        this.projects.declaredIds().map((id) =>
          this.queue.slot(async () => {
            const row = this.projects.statementRow(id);
            if (row.minted !== null || !this.mintable(row.directory, false)) return;
            if ((await this.deriveId(id))?.by === 'machine') candidates.push(id);
          }),
        ),
      );
      for (const id of candidates) if (!this.mintRow(id)) unfound = true;
      for (const id of candidates) {
        await this.deriveId(id);
        this.beneath(this.projects.statementRow(id).directory);
      }
      // a folder not found now is minted once it is (`checkFolders`)
      this.projects.setMeta('minting', unfound ? '0' : '1');
    } finally {
      this.evaluating = false;
    }
  }

  /**
   * §F.6: each declared row's folder checked, on an enrolled machine (elsewhere no state is kept). A folder found again
   * that the upgrade's minting could not anchor is minted now (design §8, "At the upgrade").
   */
  async checkFolders(ids: readonly ProjectId[] = this.projects.declaredIds()): Promise<void> {
    if (this.enrollment() === null) {
      for (const id of ids) if (this.projects.statementRow(id).state !== null) this.projects.setState(id, null);
      return;
    }
    let found = false;
    for (const id of ids) {
      const before = this.projects.statementRow(id).state;
      const after = this.projects.observe(id);
      if (before === 'missing' && after === null && this.projects.statementRow(id).minted === null) found = true;
    }
    if (found && this.projects.meta('minting') === '0') await this.statementsChanged();
  }

  /** What the endpoint reads of the index (§H): null while the index is not available or a declared row is underived. */
  source(): ProjectsSource {
    return {
      snapshot: () => {
        if (this.projects.unavailable || !this.projects.declaredDerived()) return null;
        return { indexId: this.projects.indexId(), rows: this.projects.declaredRows(), statements: this.projects.keptStatements() };
      },
      restore: (statements) => {
        this.projects.restore(statements);
        this.queue.rederive(this.projects.orgRows());
      },
      onChange: (listener) => this.projects.onChange(() => listener()),
    };
  }
}
