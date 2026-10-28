// The cards a `cards` subscription carries (P5 O13 M4, §D; O10 M8): a session's pending requests on a cut-over
// machine, each drawn from what the snapshot carries and nothing else, and its request digest computed here from what is
// drawn, so an answer is bound to the request as the phone showed it.
//
//   lane A   { raised: Raised[], launch: string | null }   sminos's raised bodies (the tool, its input, the session) and
//            the bridge's launch, which an answer's context names (null with no bridge: nothing can take an answer then)
//   lane B   { pendingItems: [{ item, request, context: { launchId, engineSessionId | null }, requestDigest }] }   each
//            broker item hydrated with its `*.requested` event by the endpoint
//
// Lane A's digest is `desk-hub/protocol`'s DX6 digest over the raised input, as today's card computes it. Lane B's
// applies `src/shared/host/request-digest.ts`'s field rule (the engine host's, which hashes with node:crypto and so stays
// Node's) over the same `inputSha256`; the suite pins the two byte-equal. The endpoint's own digest rides beside a lane
// B card: one that differs from the phone's would be refused `digest-mismatch`, so the card is not answerable.
import { inputSha256, type Digest, type JsonObject, type JsonValue, type Raised as DeskRaised } from 'desk-hub/protocol';
import { canonicalize } from 'org-protocol';
import type { AttentionItem } from '@shared/graph/attention';
import { isQuestion } from '../conversation/card-state';
import type { SessionEvent } from '@shared/graph/events';

/** A session the phone subscribes to: lane A by its engine session id, lane B by its appSessionId. */
export type CardSession = { lane: 'A'; id: string } | { lane: 'B'; id: string };

/** A pending request as sminos raises it; RL10 carries no DX6 code with it. */
export type Raised = Omit<DeskRaised, 'mac'> & { mac?: unknown };

export type LaneBContext = { launchId: string; engineSessionId: string | null };

export type Card =
  | { lane: 'A'; raised: Raised; launch: string | null; digest: Digest }
  /** `digest` is the phone's, `endpointDigest` the endpoint's; either is null for a request no digest can be drawn of. */
  | { lane: 'B'; item: AttentionItem; request: SessionEvent; context: LaneBContext; digest: Digest | null; endpointDigest: Digest | null };

/** What answering a card means: a question's answers, or a permission's Allow or Deny; `other` the phone doesn't answer. */
export type CardKind = 'question' | 'permission' | 'other';

/** Why a card is drawn but cannot be answered from the phone. */
export type Unanswerable = { why: 'no-bridge' | 'not-prompted' | 'no-request' | 'request-changed' | 'not-here'; text: string };

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

function isRaised(value: unknown): value is Raised {
  return isObject(value) && isText(value.request) && isText(value.session) && isText(value.tool) && isObject(value.input);
}

function isDigest(value: unknown): value is Digest {
  return isObject(value) && isText(value.session) && isText(value.request) && isText(value.tool) && typeof value.input_sha256 === 'string';
}

/** DX6's digest of a raised request, over the input the card draws. */
export async function laneADigest(raised: Raised): Promise<Digest> {
  return { session: raised.session, request: raised.request, tool: raised.tool, input_sha256: await inputSha256(raised.input as JsonObject) };
}

/** A lane A card. */
export async function laneACard(raised: Raised, launch: string | null): Promise<Card> {
  return { lane: 'A', raised, launch, digest: await laneADigest(raised) };
}

/** A lane A snapshot's cards and launch; an entry that is not a raised request is left out. */
export async function laneACards(body: unknown): Promise<{ cards: Card[]; launch: string | null }> {
  const fields = isObject(body) ? body : {};
  const launch = isText(fields.launch) ? fields.launch : null;
  const raised = Array.isArray(fields.raised) ? fields.raised.filter(isRaised) : [];
  return { cards: await Promise.all(raised.map((r) => laneACard(r, launch))), launch };
}

/** The tool a request is named by and what it asks, as lane A draws them from the tool call (request-digest.ts's rule). */
function askedOf(kind: string, fields: Fields): [string, unknown] {
  if (kind === 'question.requested') return ['AskUserQuestion', { questions: fields.questions }];
  if (kind === 'plan.requested') return ['ExitPlanMode', fields.input];
  if (typeof fields.toolName === 'string') return [fields.toolName, fields.input];
  return [kind, fields.payload];
}

/** Lane B's request digest of `request` on `appSessionId`, as the engine host draws it (`requestDigestOf`); null where it is. */
export async function laneBDigest(appSessionId: string, request: SessionEvent): Promise<Digest | null> {
  const fields = request as unknown as Fields;
  if (typeof fields.requestId !== 'string' || typeof fields.kind !== 'string' || !fields.kind.endsWith('.requested')) return null;
  const [tool, asked] = askedOf(fields.kind, fields);
  const input = (asked ?? null) as JsonValue;
  try {
    canonicalize(input);
  } catch {
    return null;
  }
  return { session: appSessionId, request: fields.requestId, tool, input_sha256: await inputSha256(input) };
}

function isLaneBEntry(value: unknown): value is { item: AttentionItem; request: SessionEvent; context: LaneBContext; requestDigest?: unknown } {
  if (!isObject(value) || !isObject(value.item) || !isObject(value.item.request) || !isObject(value.request) || !isObject(value.context)) return false;
  const { launchId, engineSessionId } = value.context;
  return isText(value.item.id) && typeof value.request.kind === 'string' && isText(launchId) && (engineSessionId === null || isText(engineSessionId));
}

/** A lane B snapshot's cards, each with the phone's digest beside the endpoint's; an entry that is not one is left out. */
export async function laneBCards(appSessionId: string, body: unknown): Promise<Card[]> {
  const items = isObject(body) && Array.isArray(body.pendingItems) ? body.pendingItems.filter(isLaneBEntry) : [];
  return Promise.all(
    items.map(async (entry): Promise<Card> => ({
      lane: 'B',
      item: entry.item,
      request: entry.request,
      context: { launchId: entry.context.launchId, engineSessionId: entry.context.engineSessionId },
      digest: await laneBDigest(appSessionId, entry.request),
      endpointDigest: isDigest(entry.requestDigest) ? entry.requestDigest : null,
    })),
  );
}

/** The card's request, as the set keys it. */
export function cardId(card: Card): string {
  return card.lane === 'A' ? card.raised.request : (card.item.request.requestId ?? card.item.id);
}

export function cardKind(card: Card): CardKind {
  if (card.lane === 'A') return isQuestion(card.raised.tool) ? 'question' : 'permission';
  if (card.request.kind === 'question.requested') return 'question';
  return card.request.kind === 'permission.requested' ? 'permission' : 'other';
}

const sameDigest = (a: Digest | null, b: Digest | null) => a !== null && b !== null && canonicalize(a) === canonicalize(b);

/** Why the card can't be answered from the phone, or null when it can. */
export function unanswerable(card: Card): Unanswerable | null {
  if (card.lane === 'A') return card.launch === null ? { why: 'no-bridge', text: 'this session has no bridge running to take an answer' } : null;
  if (cardKind(card) === 'other') return { why: 'not-here', text: 'answer this one in MAWS' };
  if (card.item.request.requestId === null) return { why: 'no-request', text: "this request can't be answered from the phone yet" };
  if (card.context.engineSessionId === null) return { why: 'not-prompted', text: "this session hasn't been prompted locally yet" };
  if (!sameDigest(card.digest, card.endpointDigest)) return { why: 'request-changed', text: 'the request changed' };
  return null;
}
