// A remote lane A session's state (P5 O9 M9, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, "Capabilities", "`model`
// sends only what changed", "`launch` comes from the plane's `presence`"; Decision Log 2026-10-29, the pre-flight's items
// 2 to 4): what one watch's subscription says of the session, folded into `LaneAState`. A remote session's state comes
// only from its subscription, so none of it is a spine file.
//
// - `bridge` is `starting` until the first snapshot; then `none` when the presence names no process ("the session is not
//   running"), no bridge or no launch ("no bridge": an act would be refused `unavailable` with no launch to fence it), or
//   capabilities without `controls` (a sminos older than MW1); else `live`. The link's own state is the machine row's.
// - `turn.running` comes from the plane alone, never from disk turns (custody, item 2): the engine record's status says
//   anything but `idle`, or a main-loop model request is open (opened by a snapshot's `streaming` or a chunk, closed by
//   its `step-end`; sminos's plane closes every open step at its turn's end).
// - `model` and `effort` are, each on its own, what the main loop's latest step-end naming it said (sminos 1.27.12; a
//   present `effort: null` names the default), else the model `read status` gave and no effort; `override` is `read status`'s, since the plane carries none (item 4).
// - `mode` is the one `read status` reported (sminos 1.27.14; the plane carries none), from a bridge that reports one,
//   while the presence names the launch it was read under: a new process starts with none.
// - `pending` is what the plane says now: a snapshot clears it and the endpoint restates the session's pending requests
//   as `raised` right after it. `settled` keeps the last 100, across snapshots.
import type { LaneAAct, LaneACatalog, LaneADelivery, LaneALink, LaneAMode, LaneARaised, LaneASettled, LaneAState, PlaneMessage } from '@shared/ipc/schema/lane-a';
import type { AppSessionId } from '@shared/graph/ids';
import { controlsMissingReason } from '@shared/lane-a/bridge';
import { reportsMode } from '@shared/lane-a/mode';
import { stepEndFields } from '@shared/lane-a/step-end';
import type { StepEnd } from 'desk-hub/protocol';

/** What the bridge's `read status` says that the plane doesn't: the session's model, its per-request override, and the
 * mode the session last reported (null: none, or a field the bridge doesn't send); `launch`, the presence's when it was
 * read. */
export type StatusRead = { model: string | null; override: LaneAState['override']; mode: LaneAMode | null; launch: string | null };

type Fields = Record<string, unknown>;
const SETTLED_KEPT = 100;
export const NO_BRIDGE = 'no bridge';
export const NOT_RUNNING = 'the session is not running';
const STARTING = 'reading the session from its machine';

const record = (value: unknown): Fields | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []);
const stepKey = (body: Fields) => JSON.stringify([body.turnId, body.step]);
const isMain = (body: Fields) => (body.agentId ?? null) === null;

export class RemoteFold {
  #presence: Fields | null = null;
  #snapshot = false;
  #catalog: LaneACatalog | null = null;
  #open = new Set<string>(); // the main loop's open model requests, by (turnId, step)
  #ranModel: string | null = null; // what the main loop's latest step-end that named it said
  #ranEffort: string | null = null;
  #pending = new Map<string, LaneARaised>();
  #settled = new Map<string, LaneASettled>();

  constructor(private readonly session: string) {}

  /** One plane message of the watch's subscription: its snapshot (the envelope) or a later message. */
  message(m: PlaneMessage): void {
    const body = record(m.body);
    if (body === null) return;
    switch (m.kind) {
      case 'snapshot': {
        this.#snapshot = true;
        this.#presence = record(body.presence);
        const catalog = record(body.catalog);
        if (catalog !== null && typeof catalog.fingerprint === 'string') this.#catalog = catalog as unknown as LaneACatalog;
        this.#open = new Set((Array.isArray(body.streaming) ? body.streaming : []).map(record).filter((s): s is Fields => s !== null && isMain(s)).map(stepKey));
        this.#pending = new Map();
        return;
      }
      case 'presence':
        this.#presence = body;
        return;
      case 'raised':
        if (typeof body.request === 'string') this.#pending.set(body.request, { ...body, session: typeof body.session === 'string' ? body.session : this.session } as unknown as LaneARaised);
        return;
      case 'settled':
        if (typeof body.request !== 'string') return;
        this.#pending.delete(body.request);
        this.#settled.delete(body.request);
        this.#settled.set(body.request, { ...body, session: this.session } as unknown as LaneASettled);
        while (this.#settled.size > SETTLED_KEPT) this.#settled.delete(this.#settled.keys().next().value as string);
        return;
      case 'catalog':
        if (typeof body.fingerprint === 'string') this.#catalog = body as unknown as LaneACatalog;
        return;
      case 'chunk':
        if (isMain(body)) this.#open.add(stepKey(body));
        return;
      case 'step-end': {
        if (!isMain(body)) return;
        this.#open.delete(stepKey(body));
        const { model, effort } = stepEndFields(body as unknown as StepEnd);
        // Each on its own: an absent field is one the plane doesn't know, so the last one known stands; a present
        // `effort: null` is the default effort observed, and replaces it.
        if (model !== undefined) this.#ranModel = model;
        if (effort !== undefined) this.#ranEffort = effort;
        return;
      }
      default:
        return;
    }
  }

  hasSnapshot(): boolean {
    return this.#snapshot;
  }

  /** The launch an act names in its context: the presence's, once the bridge is live. */
  launch(): string | null {
    return typeof this.#presence?.launch === 'string' ? this.#presence.launch : null;
  }

  catalog(): LaneACatalog | null {
    return this.#catalog;
  }

  raised(request: string): LaneARaised | null {
    return this.#pending.get(request) ?? null;
  }

  settledOf(request: string): LaneASettled | null {
    return this.#settled.get(request) ?? null;
  }

  state({ appSessionId, status, deliveries, link, acts }: { appSessionId: string; status: StatusRead | null; deliveries: LaneADelivery[]; link?: LaneALink; acts?: LaneAAct[] }): LaneAState {
    const presence = this.#presence;
    const capabilities = record(presence?.capabilities);
    const controls = record(capabilities?.controls);
    const engineRecord = record(presence?.record);
    const status_ = engineRecord?.status;
    const sminos = typeof capabilities?.sminos === 'string' ? capabilities.sminos : null;
    return {
      appSessionId: appSessionId as AppSessionId,
      engineSessionId: this.session,
      ...this.#bridge(),
      launch: this.launch(),
      sminos,
      ops: strings(capabilities?.ops),
      reads: strings(capabilities?.reads),
      controls: (controls ?? {}) as LaneAState['controls'],
      turn: { running: (typeof status_ === 'string' && status_ !== 'idle') || this.#open.size > 0, unknown: false },
      model: this.#ranModel ?? status?.model ?? null,
      effort: this.#ranEffort,
      override: status?.override ?? null,
      mode: reportsMode(sminos) && status !== null && status.launch === this.launch() ? status.mode : null,
      catalog: this.#catalog === null ? null : { fingerprint: this.#catalog.fingerprint },
      pending: [...this.#pending.values()],
      settled: [...this.#settled.values()],
      deliveries,
      ...(link !== undefined && { link }),
      ...(acts !== undefined && { acts }),
    };
  }

  #bridge(): Pick<LaneAState, 'bridge' | 'reason'> {
    if (!this.#snapshot) return { bridge: 'starting', reason: STARTING };
    const presence = this.#presence;
    if (presence === null || presence.record === null || presence.record === undefined) return { bridge: 'none', reason: NOT_RUNNING };
    if (presence.bridge !== true || this.launch() === null) return { bridge: 'none', reason: NO_BRIDGE };
    const capabilities = record(presence.capabilities);
    if (record(capabilities?.controls) === null) return { bridge: 'none', reason: controlsMissingReason(capabilities?.sminos) };
    return { bridge: 'live', reason: null };
  }
}
