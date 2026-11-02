// What an artifact answer says of sessions (P5 O7 M5a2 fix wave 1; the architect's ruling on the task review's first
// finding): a member learns nothing of a session they can't view, in any answer. An artifact the member views may name
// sessions they don't: its creator (`createdBy`), its last editor (`lastEditor`, linked to it or not, and its title), the
// sessions that touched it (a library row's `sessions`, with their titles, roles and times), a version's author
// (`actor`). Every answer of the artifact rows that carries them (SESSION_NAMING: the reads, an act's result, a query's
// outcome, `library.list`'s rows) goes through `projectSessions` as it is sent:
//   - an actor naming a hidden session names WITHHELD_SESSION instead (org-protocol: one reserved id for every hidden
//     session, an agent's provenance, never the human's), which the schemas take as they took the session;
//   - a list of sessions leaves a hidden one out, with nothing in its place: no count, no title, no role, no time of it;
//   - a hidden last editor's title goes with it.
// The artifact's own fields stay: its times (`updatedAt`, `lastEditedAt`: the artifact's activity, which its revision
// and the `artifacts` feed show the member anyway), its project, its order in a listing.
//
// A session is hidden unless the member holds `view` on it at every placement the answer's reads saw of it (M6's rule:
// no placement widens a caller's rights); a session the spine has no record of is hidden. The machine's owners are held
// to it as anyone is (fix wave 2): owning the machine gives them every artifact, not a member's private session, which
// they can't view. `SessionSafe.prepare` makes every read first (the member's ranks, each named session's placement)
// and returns the step that projects, taken as the answer is sent, against the records as they stand then. Every
// prepared step is taken, the answer sent or dropped: until it is, it watches the spine's index (`event`).
//
// Known limits, the architect's (2026-11-01): an artifact's bytes (`artifacts.attributions`' map, `artifacts.versionState`'s
// document, the document stream) keep the sessions' ids their provenance carries, opaque but comparable across artifacts;
// and an `artifacts.changed {change: 'linked'}` a hidden session caused says when some session touched the artifact.
import { WITHHELD_SESSION } from 'org-protocol';
import type { SessionRanks } from './authorize';
import type { EndpointServices } from './services';
import { placeRecorded, recordedPlacement, type Placement } from './targets';

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const idOf = (value: unknown): string | null => (isObject(value) && typeof value.appSessionId === 'string' && value.appSessionId !== '' ? value.appSessionId : null);

/** Whether the member views a session, by its app session id. */
type Sees = (appSessionId: string) => boolean;

/** An actor (`{kind: 'human'}` or `{kind: 'session', appSessionId}`) the member may be told of. */
function actor(value: unknown, sees: Sees): unknown {
  if (!isObject(value) || value.kind !== 'session') return value;
  const id = idOf(value);
  return id !== null && sees(id) ? value : { ...value, appSessionId: WITHHELD_SESSION };
}

/** An artifact row (`ArtifactRowSchema`): its creator. */
function artifactRow(value: unknown, sees: Sees): unknown {
  if (!isObject(value) || value.createdBy === undefined) return value;
  return { ...value, createdBy: actor(value.createdBy, sees) };
}

/** A library row (`LibraryRowSchema`): the artifact's, its last editor and that one's title, the sessions that touched it. */
function libraryRow(value: unknown, sees: Sees): unknown {
  const row = artifactRow(value, sees);
  if (!isObject(row)) return row;
  const out: Fields = { ...row };
  if (row.lastEditor !== undefined) {
    out.lastEditor = actor(row.lastEditor, sees);
    if (out.lastEditor !== row.lastEditor) delete out.lastEditorTitle;
  }
  if (Array.isArray(row.sessions)) {
    out.sessions = row.sessions.filter((session) => {
      const id = idOf(session);
      return id !== null && sees(id);
    });
  }
  return out;
}

/** A version (`ArtifactVersionSchema`): its author. */
const version = (value: unknown, sees: Sees): unknown => (isObject(value) && value.actor !== undefined ? { ...value, actor: actor(value.actor, sees) } : value);

/** `field` of an answer, each of its items when a list, through `part`. */
const at =
  (field: string, part: (value: unknown, sees: Sees) => unknown, list = false) =>
  (output: unknown, sees: Sees): unknown => {
    if (!isObject(output) || !(field in output)) return output;
    const value = output[field];
    return { ...output, [field]: list ? (Array.isArray(value) ? value.map((item) => part(item, sees)) : value) : value === null ? null : part(value, sees) };
  };

/** The artifact rows' answers that name sessions, each by how it names them (its output schema). */
const PROJECTIONS: Record<string, (output: unknown, sees: Sees) => unknown> = {
  'artifacts.get': at('artifact', artifactRow),
  'artifacts.list': at('artifacts', artifactRow, true),
  'artifacts.create': at('artifact', artifactRow),
  'artifacts.update': at('artifact', artifactRow),
  'artifacts.duplicate': at('artifact', artifactRow),
  'artifacts.versions': at('versions', version, true),
  'artifacts.nameVersion': at('version', version),
  'library.get': at('row', libraryRow),
  'library.list': at('rows', libraryRow, true),
};

/** The commands whose answers name sessions, which go through the projection. */
export const SESSION_NAMING: ReadonlySet<string> = new Set(Object.keys(PROJECTIONS));

/** `output`, `name`'s answer, with every session the member doesn't view (`sees`) withheld. */
export function projectSessions(name: string, output: unknown, sees: Sees): unknown {
  return Object.hasOwn(PROJECTIONS, name) ? PROJECTIONS[name](output, sees) : output;
}

/** Every session `name`'s answer names, each once. */
export function namedSessions(name: string, output: unknown): string[] {
  const named = new Set<string>();
  projectSessions(name, output, (id) => (named.add(id), true));
  return [...named];
}

export type SessionSafeContext = {
  /** The member's ranks on the machine's sessions (`Authorizer.ranks`). */
  ranks(member: string): Promise<SessionRanks>;
};

/** The step that sends an answer: projected, or `unavailable` when what it rests on moved past reading. */
export type Projected = () => { ok: true; output: unknown } | { ok: false; code: 'unavailable' };

export class SessionSafe {
  /** Each answer being prepared: every placement the spine's index gave its sessions since its reads began. */
  readonly #heard = new Set<Map<string, Placement[]>>();

  constructor(private readonly ctx: SessionSafeContext) {}

  /** A machine event (`onEvent`): a session's record moved in the spine's index, which every answer being prepared places it by too. */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'machine' || message.name !== 'session.changed' || this.#heard.size === 0) return;
    const record = isObject(message.payload) ? message.payload.record : undefined;
    const appId = isObject(record) ? record.appId : undefined;
    if (typeof appId !== 'string' || appId === '') return;
    const placement = recordedPlacement(appId, record);
    for (const heard of this.#heard) heard.set(appId, [...(heard.get(appId) ?? []), placement]);
  }

  /**
   * `name`'s answer for `member`, every read made: the member's ranks and, for one who doesn't own the machine, each
   * named session's placement (`dispatch`, on the member's behalf). Throws when the spine can't place one.
   */
  async prepare(member: string, name: string, output: unknown, dispatch: EndpointServices['dispatch']): Promise<Projected> {
    if (!SESSION_NAMING.has(name)) return () => ({ ok: true, output });
    const heard = new Map<string, Placement[]>();
    this.#heard.add(heard);
    try {
      const ranks = await this.ctx.ranks(member);
      const placed = new Map(await Promise.all(namedSessions(name, output).map(async (id): Promise<[string, Placement]> => [id, await placeRecorded(id, dispatch)])));
      const seen = (id: string): Placement[] => [placed.get(id) ?? null, ...(heard.get(id) ?? [])];
      return () => {
        this.#heard.delete(heard);
        if (!ranks.current()) return { ok: false, code: 'unavailable' };
        return { ok: true, output: projectSessions(name, output, (id) => placed.has(id) && seen(id).every((placement) => ranks.holds(placement, 'view'))) };
      };
    } catch (error) {
      this.#heard.delete(heard);
      throw error;
    }
  }
}
