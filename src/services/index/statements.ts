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
import type { DeclaredRow, ProjectsSource, RegistrySeam } from '@shared/machine/registry';
import type { Location } from '@shared/sessions/intent';
import { addFolder } from './add-folder';
import { readAnchor } from './anchor';
import { deriveProject, folderSmns, inLinkedWorktree, ORG_GIT_TIMEOUT_MS, type OrgDerivation, type RemoteReads, type StatementLookup } from './org-project';
import { isBroadFolder, locate, prospectiveRow, type OrgRow, type ProjectStore, type StatementRow } from './projects';

export type DeriveRule = typeof deriveProject;

/** A row's derivation: the rule's answer, `missing` for a declared folder not at its path (whose answer is kept), or none. */
export type RowDerivation = OrgDerivation | 'missing' | null;
const answerOf = (derived: RowDerivation): OrgDerivation | null => (derived === 'missing' ? null : derived);

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

/** How many times a row's rule is read again when the row or a statement moved while it was read (`deriveAsNow`). */
const STALE_READS = 3;

function refuse(code: ProjectRefusal, words: string): never {
  throw new HostCommandError(ipcError('invalid_input', `${code}: ${words}`));
}

/** An enrollment as the rows' derivations read it: its org and machine name; null while not enrolled. */
const enrollmentKey = (enrollment: Enrollment | null): string | null => (enrollment === null ? null : JSON.stringify([enrollment.org, enrollment.machine]));

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
  /** The enrollment the rows were last derived under (`enrollmentKey`): a start's, then each move's. */
  private derivedUnder: string | null = null;
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
    this.derivedUnder = enrollmentKey(context.enrollment()); // the start derives every row under it next
    this.projects.onFits((rows) => this.registry.fits(rows));
    this.projects.onUsed((id) => void this.used(id).catch((error) => console.error('[index] minting a first-used project failed:', error instanceof Error ? error.message : error)));
    this.offStatements?.();
    this.offStatements = this.registry.onStatements(() => void this.statementsChanged().catch((error) => console.error('[index] minting at the statements’ turn failed:', error instanceof Error ? error.message : error)));
  }

  unbind(): void {
    this.offStatements?.();
    this.offStatements = null;
    this.projects.onUsed(null);
    this.projects.onFits(null);
    this.context = null;
  }

  private enrollment(): Enrollment | null {
    return this.context?.enrollment() ?? null;
  }

  private get home(): string {
    return this.context?.home ?? homedir();
  }

  /**
   * Design §8's rule for a row's folder, its answer written to the row (and told, as any change); null without an answer.
   * On an enrolled machine a declared folder that is not at its path keeps its identity (design §10: missing removes
   * nothing; M8's review 1, finding 2; review 2, findings 1 and 6): `missing`. Elsewhere statements count for nothing, so
   * the rule answers for it as for any folder.
   */
  async deriveRow(row: OrgRow, gitTimeoutMs: number = ORG_GIT_TIMEOUT_MS): Promise<RowDerivation> {
    return this.deriveAsNow(row, gitTimeoutMs, 1);
  }

  /**
   * `deriveRow`, its answer written only while it is still the row's (panel 1, scalpel-5#2): a rule read while the row
   * moved to another folder, or while any stored statement changed (`statements_gen`), is read again for the row as it is
   * now, and after STALE_READS such reads the row goes to the refresh queue instead, its answer written by neither.
   */
  private async deriveAsNow(row: OrgRow, gitTimeoutMs: number, read: number): Promise<RowDerivation> {
    const context = this.context;
    if (context === null) return null;
    const enrollment = context.enrollment();
    if (enrollment !== null && this.projects.missingDeclared(row.id) && this.projects.keepMissing(row.id, context.machine)) return 'missing';
    const gen = this.projects.statementsGen();
    const derived = await (context.derive ?? deriveProject)(
      { directory: row.directory, machine: context.machine, projectId: row.id, name: row.name, ...(row.files === undefined ? {} : { files: row.files }) },
      enrollment,
      { statements: this.lookup, gitTimeoutMs, ...(row.remoteReads === undefined ? {} : { remoteReads: row.remoteReads }) },
    );
    if (derived === null) return null;
    const now = this.projects.placeOf(row.id);
    if (now === null) return derived; // gone meanwhile: nothing to write
    if (now.directory !== row.directory || this.projects.statementsGen() !== gen) {
      const current = { ...row, ...now };
      if (read < STALE_READS) return this.deriveAsNow(current, gitTimeoutMs, read + 1);
      this.queue.rederive([current]);
      return null;
    }
    this.projects.setOrg(row.id, derived.org, enrollment === null ? null : { remote: derived.remote, hub: derived.hub, by: derived.by, at: derived.at });
    // §F.5: the folder holding a deciding `.smns` a session runs in or beneath is declared (an enrolled machine's alone)
    // (asked to fit as it will be published: the row the rule gives that folder; review 2, finding 5)
    if (enrollment !== null && derived.by === 'smns' && derived.smnsFolder !== null && this.projects.hasSession(row.id) && this.projects.promotionDue(derived.smnsFolder)) {
      this.projects.declareByFile(derived.smnsFolder, await this.prospective(derived.smnsFolder));
    }
    return derived;
  }

  // `files` (M8's review 1, finding 1): a remote setup's checked reader, which every derivation of its act reads through; a
  // read it refuses gives no answer
  // `reads`: the act's reads of the remotes, shared by its derivations
  private async deriveId(id: ProjectId, files?: GitFiles, reads?: RemoteReads): Promise<OrgDerivation | null> {
    const { directory, name } = this.projects.statementRow(id);
    const shared = reads === undefined ? {} : { remoteReads: reads };
    if (files === undefined) return answerOf(await this.deriveRow({ id, directory, name, ...shared }));
    try {
      return answerOf(await this.deriveRow({ id, directory, name, files, ...shared }));
    } catch (error) {
      console.warn(`[index] the rule for ${directory} read past what the setup opened, so it answers nothing now:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * The project a statement at the row's own folder gives it, as `statements` reads it (design Decision Log 7: a link or
   * a minted id there decides before any `.smns`, so no file is read for it); null where none counts. It governs only a
   * folder in no linked worktree (`governs`): in one, the owning checkout decides (design §8).
   */
  private ownDecision(directory: string, statements: StatementLookup = this.lookup): { by: 'link' | 'minted'; id: string } | null {
    if (this.context === null || this.context.enrollment() === null) return null;
    const stated = statements(directory.normalize('NFC'));
    if (stated?.linked) return { by: 'link', id: stated.linked };
    if (stated?.minted) return { by: 'minted', id: stated.minted };
    return null;
  }

  /**
   * Whether a statement at the row's own folder governs it under design §8 (Fix 2c): the folder is in no linked worktree,
   * as the rule itself reads its layout from git's files, through the asker's reader (no git run). A question that reader
   * cannot answer is a no: the rule is then asked.
   */
  private async governs(directory: string, files: GitFiles): Promise<boolean> {
    return (await inLinkedWorktree(directory, files).catch(() => null)) === false;
  }

  /**
   * A remote act's derivation of its row through the asker's reader (M9's re-review, Fix 2b). The rule's label reads the
   * folder's `.smns` before the rule does, so a read past the asker's opens refuses even a row its own statement decides;
   * that statement then decides with no file read, its project written under the label as stored. False when neither
   * answers: nothing is written.
   */
  private async deriveThrough(id: ProjectId, files: GitFiles): Promise<boolean> {
    const { directory, name } = this.projects.statementRow(id);
    try {
      return (await this.deriveRow({ id, directory, name, files })) !== null;
    } catch (error) {
      const own = (await this.governs(directory, files)) ? this.ownDecision(directory) : null;
      if (own === null || this.context === null) {
        console.warn(`[index] the rule for ${directory} read past what the asker opened, so it answers nothing now:`, error instanceof Error ? error.message : error);
        return false;
      }
      const stored = this.projects.record(id);
      const label = stored.org ?? { key: `folder:${this.context.machine}:${id}` as OrgKey, name, source: 'folder' as const, smnsId: null };
      this.projects.setOrg(id, { ...label, smnsId: own.id }, { remote: stored.remote ?? null, hub: true, by: own.by, at: directory });
      return true;
    }
  }

  /**
   * A remote link or unlink after which no statement of the row's own governs it, and whose rule then needs a file the
   * asker cannot read, is refused before anything changes (Fix 2b; Fix 2c: a linked worktree's row is always the rule's):
   * `unresolved`, an answer this device cannot have now but another may.
   */
  private async linkReadable(row: StatementRow, into: string | null, files: GitFiles): Promise<void> {
    const context = this.context;
    if (context === null) return;
    const at = row.directory.normalize('NFC');
    const now = this.lookup(at);
    const stated = into !== null ? { minted: now?.minted ?? null, linked: into } : now === null ? null : { ...now, linked: null };
    const after: StatementLookup = (path) => (path === at ? stated : this.lookup(path));
    if ((await this.governs(row.directory, files)) && this.ownDecision(row.directory, after) !== null) return;
    const read = await (context.derive ?? deriveProject)({ directory: row.directory, machine: context.machine, projectId: row.id, name: row.name, files }, context.enrollment(), { statements: after }).then(
      () => true,
      () => false,
    );
    if (!read) refuse('unresolved', `${row.directory}: ${into === null ? 'unlinked' : 'linked'}, its project is read from a file this device has not opened: open its folder from this device, or do it on the machine`);
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

  // A link's target (§G): a hub project a verified record names, or the id the folder's own `.smns` names, which waives the
  // record and not the hub (M8's review 1, finding 5): that file must name this org's hub.
  private async target(into: string, folder: string, files?: GitFiles): Promise<void> {
    const known = this.registry.project(into);
    if (known === null) {
      const own = await folderSmns(folder, files).catch(() => null); // a file the setup did not open names nothing
      if (own?.project !== into) refuse('unknown-project', `${into} is in no verified projects record`);
      const org = this.enrollment()?.org;
      if (org === undefined || own.hub !== org) refuse('not-a-hub-project', `${into}'s .smns names no hub of this org`);
      return;
    }
    if (!known.hub) refuse('not-a-hub-project', `${into}'s log is not on the hub`);
  }

  /**
   * The row a declaration of `folder` would publish (M8's review 1, finding 8; review 2, finding 5): the rule's answer for
   * it now, or the row there as derived, under the statement the act will make: `into`'s link, or the minted id moment (a)
   * or `own` gives it (a fresh UUID: the length of the one it will be). Nothing is written.
   */
  private async prospective(folder: string, files?: GitFiles, { into, own }: { into?: string; own?: true } = {}, remoteReads: RemoteReads = new Map()): Promise<DeclaredRow> {
    const context = this.context;
    const pid = randomUUID();
    const existing = this.projects.statementRowAt(folder);
    const derived =
      context === null
        ? null
        : await (context.derive ?? deriveProject)({ directory: folder, machine: context.machine, projectId: existing?.id ?? pid, name: existing?.name ?? basename(folder), ...(files === undefined ? {} : { files }) }, context.enrollment(), { statements: this.lookup, remoteReads }).catch(
            () => null, // a read the setup refused: the folder row's size stands in
          );
    const minted = existing?.minted ?? null;
    const stating = context !== null && context.enrollment() !== null && this.registry.statements().possible;
    const decided: { smnsId: string; by: 'link' | 'minted'; at: string } | null = !stating
      ? null
      : into !== undefined
        ? { smnsId: into, by: 'link', at: folder }
        : existing?.linked != null && own !== true
          ? null
          : minted !== null && own === true
            ? { smnsId: minted, by: 'minted', at: folder }
            : minted === null && derived !== null && (own === true || derived.by === 'machine') && this.mintable(folder, true)
              ? { smnsId: randomUUID(), by: 'minted', at: folder }
              : null;
    const kept = existing === null ? null : this.projects.declaredRowUnder(folder, decided);
    if (kept !== null) return kept;
    if (derived === null) return prospectiveRow({ pid: existing?.id ?? pid, path: folder });
    const enrolled = context?.enrollment() != null;
    const org = decided === null ? derived.org : { ...derived.org, smnsId: decided.smnsId };
    const by = decided?.by ?? derived.by;
    const at = decided?.at ?? derived.at;
    return prospectiveRow({ pid: existing?.id ?? pid, path: folder, org, ...(enrolled ? { remote: derived.remote, hub: decided === null ? derived.hub : true, by, at } : {}) });
  }

  // M8's review 2 (finding 4): declarations are admitted one at a time, each seeing the rows the one before it made
  private admitting: Promise<unknown> = Promise.resolve();
  private oneAtATime<T>(act: () => Promise<T>): Promise<T> {
    const run = this.admitting.then(act, act);
    this.admitting = run.catch(() => {});
    return run;
  }

  /**
   * Declares a folder (`session.projects.add`, `addFolder`): today's act, then, while statements are possible, minting's
   * moment (a), `into`'s link and `own`'s minted id, the rule's answer after them and the restatement. Today's act keeps
   * its own refusals.
   */
  async declare<T extends { project: ProjectRecord }>(directory: string, declare: (remoteReads: RemoteReads) => T, options: { into?: string; own?: true; files?: GitFiles } = {}): Promise<T & Decided> {
    const decided = await this.oneAtATime(() => this.admit(directory, declare, options));
    if (!('derived' in decided)) return decided.answer as T & Decided;
    const { answer, derived } = decided;
    const { restated } = await this.registry.published();
    return { ...answer, project: this.projects.record(answer.project.id), ...(derived === null ? {} : { by: derived.by, at: derived.at }), restated } as T & Decided;
  }

  // The declaration through its statements, one at a time (finding 4): its restatement is asked after, outside the turn.
  private async admit<T extends { project: ProjectRecord }>(directory: string, declare: (remoteReads: RemoteReads) => T, { into, own, files }: { into?: string; own?: true; files?: GitFiles }): Promise<{ answer: T } | { answer: T; derived: OrgDerivation | null }> {
    if (into !== undefined && own) refuse('into-and-own', 'a folder is linked into a project or made a project of its own, not both');
    if (into !== undefined || own) this.unavailable();
    const folder = canonicalFolder(directory);
    if (into !== undefined) {
      if (folder === null) refuse('not-a-directory', directory);
      await this.target(into, folder, files);
    }
    // one read of the folder's remotes for the act's every derivation, the new row's own after its commit included (Fix 3)
    const reads: RemoteReads = new Map();
    const before = folder === null ? [] : this.projects.admissionRows();
    const wasDeclared = before.some((row) => row.path === folder);
    // the record's bound is asked with the row as it will be published (review 1, finding 8; review 2, finding 5), and
    // with every declared row, one not yet derived included (finding 4)
    if (folder !== null && (!wasDeclared || into !== undefined || own === true)) {
      const shape = await this.prospective(folder, files, { ...(into === undefined ? {} : { into }), ...(own === true ? { own } : {}) }, reads);
      if (!this.registry.fits([...before.filter((row) => row.path !== folder), shape])) refuse('too-many-locations', 'the declared folders would not fit one projects record');
    }
    const answer = declare(reads);
    // a statement kept on a removed row counts again, for the folder and the rows beneath it
    if (!wasDeclared) this.beneath(answer.project.directory);
    if (!this.registry.statements().possible || this.context === null) return { answer };
    const id = answer.project.id;
    let derived = await this.deriveId(id, files, reads);
    let changed = false;
    const row = this.projects.statementRow(id);
    // review 1, finding 11: the broadest folders are minted only by an add of that very folder, never one that folds to it
    const explicit = folder === row.directory;
    if (own === true && row.linked !== null) changed = this.projects.setLink(id, null, readAnchor(row.directory)); // finding 10
    if (derived !== null && row.minted === null && (own === true || derived.by === 'machine') && this.mintable(row.directory, explicit)) changed = this.mintRow(id) || changed;
    if (into !== undefined) changed = this.projects.setLink(id, into, readAnchor(row.directory)) || changed;
    if (changed) {
      derived = await this.deriveId(id, files, reads);
      this.beneath(row.directory);
    }
    return { answer, derived };
  }

  /** `addFolder`'s act: the folder by the membership rule, then `declare`. */
  addFolder(directory: string, options: { into?: string; own?: true; files?: GitFiles; locateIn?: typeof locate } = {}): Promise<{ project: ProjectRecord; location: Location } & Decided> {
    return this.declare(directory, (reads) => addFolder(this.projects, directory, options.locateIn, options.files, reads), options);
  }

  /**
   * `session.projects.resolve`: the rule for a directory, changing nothing. `files` and `locateIn`: another machine's
   * owner's, read through the setup's checked reader with no git run (M9's review 1, F1).
   */
  async resolve(directory: string, { files, locateIn = locate }: { files?: GitFiles; locateIn?: typeof locate } = {}): Promise<{ project: string | null; by: OrgDerivation['by']; at: string | null; label: OrgDerivation['org'] }> {
    const folder = canonicalFolder(directory);
    if (folder === null) refuse('not-a-directory', directory);
    const context = this.context;
    if (context === null) refuse('unresolved', 'the rule cannot be computed yet');
    const located = locateIn(folder);
    const row = located.projectDirectory === null ? null : this.projects.projectAt(located);
    const derived = await (context.derive ?? deriveProject)({ directory: folder, machine: context.machine, projectId: row ?? 'new', name: basename(folder), ...(files === undefined ? {} : { files }) }, context.enrollment(), { statements: this.lookup });
    if (derived === null) refuse('unresolved', 'git gave no answer in time: try again');
    return { project: derived.org.smnsId, by: derived.by, at: derived.at, label: derived.org };
  }

  /**
   * `session.projects.link`: a declared row's link set or, with null, cleared. It never mints. `files`: another machine's
   * owner's reader, which its target's `.smns` and the derivation it answers read through (M9's review 1, Fix 1c; its
   * re-review, Fix 2).
   */
  async link(id: ProjectId, into: string | null, { files }: { files?: GitFiles } = {}): Promise<{ project: ProjectRecord; restated: boolean }> {
    const row = this.projects.statementRow(id);
    if (!row.declared) refuse('not-declared', `${row.directory} is not a declared folder`);
    const anchor = readAnchor(row.directory);
    if (into !== null) {
      this.unavailable();
      // finding 4: a link is about the folder at the path, so there must be one to anchor it to
      if (anchor === null) refuse('not-a-directory', `${row.directory}: there is no folder there to link`);
      await this.target(into, row.directory, files);
    }
    if (files !== undefined && row.linked !== into) await this.linkReadable(row, into, files);
    const changed = this.projects.setLink(id, into, anchor);
    if (!changed) return { project: this.projects.record(id), restated: true };
    if (files === undefined) await this.deriveId(id);
    else await this.deriveThrough(id, files);
    this.beneath(row.directory);
    const { restated } = await this.registry.published();
    return { project: this.projects.record(id), restated };
  }

  /**
   * `session.projects.relocate`: a declared row pointed at its folder's path now, merging an unstated row there. `files`:
   * another machine's owner's, the setup's checked reader its derivation reads through (M9's review 1, F1).
   */
  async relocate(id: ProjectId, directory: string, { files }: { files?: GitFiles } = {}): Promise<{ project: ProjectRecord; merged: boolean; restated: boolean }> {
    const row = this.projects.statementRow(id);
    if (!row.declared) refuse('not-declared', `${row.directory} is not a declared folder`);
    const folder = canonicalFolder(directory);
    const anchor = folder === null ? null : readAnchor(folder);
    if (folder === null || anchor === null) refuse('not-a-directory', directory);
    const moved = this.projects.relocate(id, folder, anchor);
    if ('refused' in moved) refuse('has-statement', `${folder} is a folder with a stored statement of its own`);
    await this.deriveId(id, files);
    this.beneath(row.directory);
    if (folder !== row.directory) this.beneath(folder);
    const { restated } = await this.registry.published();
    return { project: this.projects.record(id), merged: moved.merged, restated };
  }

  /**
   * `session.projects.update`: a rename sets the name counter one above the highest the records and this machine hold. A
   * rename is admitted as a declaration is, with the row as it will be published (panel 1, scalpel-2#2): one that would
   * take the record past §A's bounds is refused before anything is written.
   */
  update(id: ProjectId, patch: { name?: string; order?: number }): ProjectRecord {
    if (patch.name === undefined || this.enrollment() === null) return this.projects.update(id, patch);
    const { smnsId, nameRev } = this.projects.statementRow(id);
    const highest = smnsId === null ? (nameRev ?? 0) : Math.max(this.registry.project(smnsId)?.nameRev ?? 0, this.projects.highestNameRev(smnsId));
    const renamed = this.projects.declaredRowRenamed(id, patch.name, highest + 1);
    if (renamed !== null && !this.registry.fits([...this.projects.admissionRows().filter((row) => row.pid !== id), renamed])) refuse('too-many-locations', 'the renamed folder would not fit one projects record');
    return this.projects.update(id, patch, highest + 1);
  }

  /**
   * `session.projects.remove`: the row hidden; with `expect`, only while its path and the rule's project now are the
   * expected ones (else `changed`), the rule tied to the hide by `statements_gen` (`unresolved` when it has no answer).
   * `files`: another machine's owner's reader, which the rule reads through (M9's re-review, Fix 2): a read it refuses
   * leaves the rule no answer.
   */
  async remove(id: ProjectId, expect?: { path: string; project: string | null }, { files }: { files?: GitFiles } = {}): Promise<void> {
    const { directory } = this.projects.statementRow(id);
    if (expect === undefined) {
      this.projects.hide(id);
    } else {
      for (let attempt = 0; ; attempt += 1) {
        if (attempt === 3) refuse('unresolved', 'the rule kept changing: try again');
        const gen = this.projects.statementsGen();
        const row = this.projects.statementRow(id);
        if (row.directory !== expect.path) refuse('changed', `the location is at ${row.directory} now`);
        const project = await this.projectNow(row, files);
        if (project === undefined) refuse('unresolved', 'the rule has no answer now: try again');
        if (project !== expect.project) refuse('changed', `the location is in ${project ?? "this machine's own project"} now`);
        if (this.projects.hideAt(id, gen)) break;
      }
    }
    // its statement no longer counts: the folder and the rows beneath it derived again
    await this.deriveId(id, files);
    this.beneath(directory);
    if (this.registry.statements().possible) await this.registry.published();
  }

  /**
   * The rule's project for a row now (`remove`'s `expect`); undefined without an answer. `files`: another machine's
   * owner's reader (Fix 2), which the rule reads through; a read past the asker's opens leaves the statement at the row's
   * own folder deciding where it governs (Fix 2b, 2c), else no answer. A replaced folder's row answers its own
   * statement's project, the one its location is published under (panel 1, sweep#1).
   */
  private async projectNow(row: StatementRow, files?: GitFiles): Promise<string | null | undefined> {
    const context = this.context;
    if (context === null) return undefined;
    // a replaced folder's location is its statement's, as the registry lists it (sweep#1), and that is what a removal names
    const own = row.linked ?? row.minted;
    if (context.enrollment() !== null && own !== null && this.projects.observe(row.id) === 'replaced') return own;
    const subject = { directory: row.directory, machine: context.machine, projectId: row.id, name: row.name, ...(files === undefined ? {} : { files }) };
    const refused = Symbol('refused');
    const derived = await (context.derive ?? deriveProject)(subject, context.enrollment(), { statements: this.lookup }).catch((error: unknown) => (files === undefined ? Promise.reject(error) : refused));
    if (derived === refused) return files !== undefined && (await this.governs(row.directory, files)) ? this.ownDecision(row.directory)?.id : undefined;
    return derived === null ? undefined : derived.org.smnsId;
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
    // begun at the turn, as the state is read: the rows derived again if the enrollment moved, before any is minted
    const moved = this.enrollmentMoved();
    if (!state.possible) {
      if (this.projects.meta('minting') !== '0') this.projects.setMeta('minting', '0');
      if (this.pending().length > 0) this.projects.setMeta('minting_pending', '[]'); // the next (c) considers every row
      return moved;
    }
    if (this.context === null || this.evaluating || this.projects.meta('minting') === '1') return moved;
    this.evaluating = true;
    try {
      await moved;
      const candidates: ProjectId[] = [];
      // a folder not found now is minted once it is, and it alone (`checkFolders`; M8's review 1, finding 7)
      const unfound: ProjectId[] = [];
      await Promise.all(
        this.projects.declaredIds().map((id) =>
          this.queue.slot(async () => {
            const row = this.projects.statementRow(id);
            if (row.minted !== null || !this.mintable(row.directory, false)) return;
            if (this.projects.missingDeclared(id)) unfound.push(id);
            else if ((await this.deriveId(id))?.by === 'machine') candidates.push(id);
          }),
        ),
      );
      for (const id of candidates) if (!this.mintRow(id) && this.projects.statementRow(id).minted === null) unfound.push(id);
      for (const id of candidates) {
        await this.deriveId(id);
        this.beneath(this.projects.statementRow(id).directory);
      }
      this.projects.setMeta('minting_pending', JSON.stringify(unfound));
      this.projects.setMeta('minting', '1');
    } finally {
      this.evaluating = false;
    }
  }

  /**
   * The enrollment moved since the rows were derived (an enrollment, a re-enrollment or its end, with no restart): every
   * row derived again under it, before minting considers any. What the rule gives reads the enrollment throughout: a
   * stored statement counts on an enrolled machine alone, and a remote's and the machine's own project's ids are its
   * org's. So a minted or linked row takes its statement again on enrolling, and loses its statement-made identity on
   * unenrolling; whether a row is minted is no part of whether it is derived again (branch review 1, P2). A row the rule
   * gives no answer for now goes to the refresh queue, which asks again.
   */
  private async enrollmentMoved(): Promise<void> {
    const context = this.context;
    if (context === null) return;
    const now = enrollmentKey(context.enrollment());
    if (now === this.derivedUnder) return;
    this.derivedUnder = now;
    const unanswered: OrgRow[] = [];
    await Promise.all(
      this.projects.orgRows().map((row) =>
        this.queue.slot(async () => {
          if ((await this.deriveRow(row).catch(() => null)) === null) unanswered.push(row);
        }),
      ),
    );
    this.queue.rederive(unanswered);
  }

  /**
   * §F.6: each declared row's folder checked, on an enrolled machine (elsewhere no state is kept). A folder moment (c)
   * could not anchor is minted once it is found, and no other row (design §8, "At the upgrade"; M8's review 1, finding 7).
   */
  async checkFolders(ids: readonly ProjectId[] = this.projects.declaredIds()): Promise<void> {
    if (this.enrollment() === null) {
      for (const id of ids) if (this.projects.statementRow(id).state !== null) this.projects.setState(id, null);
      return;
    }
    for (const id of ids) this.projects.observe(id);
    const pending = this.pending();
    if (pending.length === 0) return;
    const left: ProjectId[] = [];
    for (const id of pending) {
      let row;
      try {
        row = this.projects.statementRow(id);
      } catch {
        continue; // a row deleted since (a relocate's merge)
      }
      if (row.state === 'missing') {
        left.push(id);
        continue;
      }
      if (!this.registry.statements().possible || !row.declared || row.minted !== null || !this.mintable(row.directory, false)) continue;
      if ((await this.deriveId(id))?.by === 'machine' && this.mintRow(id)) {
        await this.deriveId(id);
        this.beneath(row.directory);
      }
    }
    this.projects.setMeta('minting_pending', JSON.stringify(left));
  }

  private pending(): ProjectId[] {
    try {
      const ids: unknown = JSON.parse(this.projects.meta('minting_pending') ?? '[]');
      return Array.isArray(ids) ? ids.filter((id): id is ProjectId => typeof id === 'string') : [];
    } catch {
      return [];
    }
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
