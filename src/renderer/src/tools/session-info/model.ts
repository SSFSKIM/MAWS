// Session info's six sections as rows (C11 execution document, Interfaces "Session info tool"; §5.6; mockup 06 vignette
// 03 at Codex's key/value density, D-20): Engine, Model, Gateway, Permissions, Context·usage·cost, Hooks and MCP, from
// C5's stores, C7's usage windows, the routing facts, the lane and the four bounded reads. Pure: the view gathers the
// inputs and renders what this answers. A value not known yet reads `—`, never a guess. W2 (§5.5 as amended
// 2026-10-01): with the status line gone, the Route row carries the Direct⇄gateway switch as its action, with the reason
// when none is offered, and the usage rows carry the pace line the usage popover's footer showed.
import { PERMISSION_MODE_LABELS } from '@shared/sessions/permission-mode-labels';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import { contextTotal, type GetContextUsageResponse, type GetHooksListingResponse, type GetStatusResponse, type ListPermissionRulesResponse, type McpStatusResponse } from '@shared/wire/control';
import type { SessionWindows } from '../../stores/usage';
import { MODE_REFUSAL_WORDS } from '../../statusline/mode-menu';
import { resetsIn, windowShown } from '../../statusline/format';
import { directLoginOf } from '../../gateway/direct-login';
import type { Route } from '../../gateway/copy';
import { paceLine, type DirectLogin, type RoutingFacts } from '../../gateway/routing-facts';
import { present as presentContext } from '../../widgets/ContextWidget';
import { present as presentMcp } from '../../widgets/McpWidget';
import { CONTEXT, MODEL } from '../../widgets/copy';
import { liveModel, type ModelRow } from '../../widgets/model';
import { num } from '../../widgets/parts';
import { INFO, LANE } from './copy';
import { contestLine, holderLine } from '../../attention/derive'; // W7
import type { Lane } from './lane';
// C12 start
import type { BudgetState } from '@shared/ipc/schema/engine';
import { BUDGET } from '../../budget/copy';
// C12 end

// W2: `route` is the Direct⇄gateway switch, offering `targets` (the routing facts' own)
export type InfoRow = { label: string; value: string; note?: string; action?: 'permissions' | 'route'; targets?: Route[] };
export type InfoSection = { title: string; rows: InfoRow[] };

export interface SessionInfoInput {
  record: SessionRecord;
  status: EngineSessionStatus | null;
  digest: SessionDigest | null;
  facts: RoutingFacts;
  directLogin: DirectLogin | null;
  lane: Lane | null; // null without a status
  models: readonly ModelRow[] | null; // the session's listed catalogue, when C7 read one (an alias matched to its resolved id)
  windows: SessionWindows;
  budget: BudgetState | null; // C12: the engine host's memory budget, null before it answered
  now: number;
  reads: {
    status: GetStatusResponse | null;
    rules: ListPermissionRulesResponse | null;
    hooks: GetHooksListingResponse | null;
    mcp: McpStatusResponse | null;
    context: GetContextUsageResponse | null;
  };
}

const NONE = INFO.none;
// A path under a home directory, written from `~` (the renderer has no home of its own to ask).
export const homeAbbreviated = (path: string): string => path.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
const mb = (kib: number) => `${Math.round(kib / 1024)} MB`;
const usd = (n: number) => `$${n.toFixed(2)}`;

// C12 start: the memory budget beside the process tree (§4.4: "visible in Session info"): the sum of the live trees
// against the limit with the live sessions counted, and for a released session when and why. W7: with the budget off,
// the sum and the count without a limit.
export function budgetRows(budget: BudgetState | null, digest: SessionDigest | null): InfoRow[] {
  const sessions = budget === null ? 0 : budget.blocked.length + budget.settling + budget.candidates;
  const line = (b: BudgetState) => (b.enabled ? BUDGET.budgetLine(b.totalKiB, b.limitKiB, sessions) : BUDGET.budgetOffLine(b.totalKiB, sessions));
  const rows: InfoRow[] = [{ label: BUDGET.budgetLabel, value: budget === null ? NONE : line(budget) }];
  if (digest?.released) rows.push({ label: BUDGET.releasedLabel, value: BUDGET.releasedLine(digest.released) });
  return rows;
}
// C12 end

// W7: who holds the session, read through the same derivation as the glyph and the tab (§5.7).
export function heldByRow(record: SessionRecord): InfoRow {
  const contest = contestLine(record);
  if (contest !== null) return { label: INFO.heldBy, value: INFO.contested(contest), note: INFO.contestedNote };
  const foreign = holderLine(record);
  if (foreign !== null) return { label: INFO.heldBy, value: foreign, note: INFO.readOnly };
  return { label: INFO.heldBy, value: record.holder.kind === 'self' ? INFO.heldByMaws : INFO.heldByNone };
}

function engineSection({ record, status, digest, budget }: SessionInfoInput): InfoSection { // C12: digest, budget
  const version = status?.engineVersion ?? record.engineVersion;
  const tree = status?.memory.treeRssKiB ?? null;
  return {
    title: INFO.sections.engine,
    rows: [
      // W13: the session's own version (its init frame's, else the probe's at spawn, else the record's) and the binary it
      // was spawned from (the spawn row's), never today's setting
      { label: INFO.version, value: version ?? NONE },
      { label: INFO.binary, value: status ? homeAbbreviated(status.bin) : NONE },
      { label: INFO.sessionId, value: record.engineSessionId ?? NONE },
      heldByRow(record), // W7
      { label: INFO.processTree, value: tree === null ? NONE : INFO.tree(mb(tree), status?.memory.rssKiB == null ? null : mb(status.memory.rssKiB)) },
      ...budgetRows(budget, digest), // C12
    ],
  };
}

function modelSection({ record, status, models }: SessionInfoInput): InfoSection {
  const model = status?.model ?? record.model;
  const effort = status ? status.effort : record.effort;
  // A set_model the engine accepted and no init frame has confirmed yet: the requested model, pending in the model
  // widget's words, as the lane reads it. Without the catalogue an alias cannot be matched to its resolved id, so the
  // resolved one shows (a set_model from this app always listed the catalogue first).
  const pending = status !== null && models !== null && liveModel(models, status.model).pending;
  const name = pending ? model.requested : (model.resolved ?? model.requested);
  const rows: InfoRow[] = [
    { label: INFO.main, value: name === null ? NONE : effort ? `${name} · ${effort}` : name, note: pending ? MODEL.pending : undefined },
    status?.subagentModel ? { label: INFO.subagents, value: status.subagentModel, note: INFO.subagentChosen } : { label: INFO.subagents, value: status ? INFO.subagentsInherit : NONE },
  ];
  const overrides = Object.entries(status?.modelOverrides ?? {});
  if (overrides.length > 0) rows.push({ label: INFO.overrides, value: overrides.map(([k, v]) => `${k} → ${v}`).join('; '), note: INFO.passedThrough });
  return { title: INFO.sections.model, rows };
}

function gatewaySection({ status, facts, directLogin, reads }: SessionInfoInput): InfoSection {
  const login = (reads.status && directLoginOf(reads.status)) ?? directLogin;
  const rows: InfoRow[] = [];
  let route: InfoRow;
  if (!status) route = { label: INFO.route, value: facts.line };
  else if (status.gateway.verified === 'routed') route = { label: INFO.route, value: INFO.routed(status.gateway.baseUrl ?? NONE) };
  else if (status.gateway.verified === 'direct') route = { label: INFO.route, value: login ? INFO.directLogin(login.login) : INFO.direct };
  else route = { label: INFO.route, value: INFO.unverified, note: status.gateway.verified === 'mismatch' ? INFO.mismatch(status.gateway.mode) : INFO.pending };
  // W2: the switch the usage popover's footer offered, or why there is none (held elsewhere, archived)
  const note = [route.note, facts.refusal].filter((n): n is string => typeof n === 'string').join(' · ');
  rows.push({ ...route, note: note || undefined, ...(facts.targets.length > 0 ? { action: 'route' as const, targets: facts.targets } : {}) });
  const direct = status ? status.gateway.mode === 'direct' : facts.route === 'direct';
  if (direct) {
    if (login?.organization) rows.push({ label: INFO.organization, value: login.organization });
    if (login?.email) rows.push({ label: INFO.email, value: login.email });
  } else {
    rows.push({ label: INFO.account, value: facts.account?.email ?? INFO.noAccount, note: facts.account ? (facts.account.why === 'pinned' ? INFO.pinnedHere : INFO.routingNow) : undefined });
  }
  rows.push({ label: INFO.toolSearch, value: status || facts.route !== 'unknown' ? (direct ? INFO.toolSearchOff : INFO.toolSearchOn) : NONE });
  return { title: INFO.sections.gateway, rows };
}

function permissionsSection({ record, status, lane, reads }: SessionInfoInput): InfoSection {
  const mode = status?.permissionMode ?? record.permissionMode;
  const grants = status?.grants.length ?? 0;
  const rules = reads.rules?.state.rules;
  const count = (behavior: string) => rules?.filter((r) => r.behavior === behavior).length ?? 0;
  const laneValue = lane ? lane.sentence : NONE;
  return {
    title: INFO.sections.permissions,
    rows: [
      { label: INFO.mode, value: PERMISSION_MODE_LABELS[mode.effective], note: mode.refusal ? `${INFO.effectiveNote} · ${MODE_REFUSAL_WORDS[mode.refusal]}` : INFO.effectiveNote },
      { label: INFO.lane, value: laneValue, note: lane?.reviews ? LANE.reviews(lane.reviews.evaluated, lane.reviews.flagged) : undefined },
      { label: INFO.rules, value: rules ? INFO.ruleCounts(count('allow'), count('ask'), count('deny'), grants) : INFO.grantsOnly(grants), action: 'permissions' },
    ],
  };
}

function usageSection({ digest, windows, now, reads }: SessionInfoInput): InfoSection {
  // C3's sample (the digest, at ready and after every turn) first; the engine's summary only before one arrived
  const sampled = digest?.context;
  const context = sampled
    ? CONTEXT.line(num(sampled.totalTokens), num(sampled.maxTokens), Math.round(sampled.percent), sampled.autoCompactThreshold === null ? null : num(sampled.autoCompactThreshold))
    : reads.context
      ? presentContext({ ...reads.context, ...contextTotal(reads.context) }).line // corrected as C3 corrects its sample (debt wave 4)
      : NONE;
  const meter = (label: string, w: NonNullable<SessionWindows['windows']>['fiveHour']) => {
    if (!w) return null;
    const shown = windowShown(w, now);
    return `${label} ${Math.round(shown.percent)}%${shown.resetInMs === null ? '' : ` · resets in ${resetsIn(shown.resetInMs)}`}`;
  };
  const usage = windows.windows ? [meter('5h', windows.windows.fiveHour), meter('Weekly', windows.windows.sevenDay)].filter((m) => m !== null).join(' · ') : '';
  // W2: the pace the usage popover's footer gave a routed session, when a window runs out before it resets
  const pace = windows.source === 'direct' || !windows.windows ? [] : [paceLine(windows.windows.sevenDay, 'weekly', now), paceLine(windows.windows.fiveHour, 'fiveHour', now)].filter((l) => l !== null);
  return {
    title: INFO.sections.usage,
    rows: [
      { label: INFO.context, value: context },
      { label: INFO.usage, value: usage || NONE, note: usage ? (windows.source === 'direct' ? INFO.fromEngine : INFO.fromClaudeUsage) : undefined },
      ...(pace.length > 0 ? [{ label: INFO.pace, value: pace.join(' · ') }] : []),
      { label: INFO.cost, value: digest?.cost ? INFO.costLine(usd(digest.cost.totalUsd), usd(digest.cost.sinceSeenUsd)) : NONE },
    ],
  };
}

function hooksSection({ status, reads }: SessionInfoInput): InfoSection {
  const hooks = reads.hooks?.hooks.map((h) => (h as { source?: unknown }).source).filter((s): s is string => typeof s === 'string');
  const plugin = hooks?.filter((s) => /plugin/i.test(s)).length ?? 0;
  let mcp: string;
  if (reads.mcp) {
    const servers = presentMcp(reads.mcp).servers;
    const connected = servers.filter((s) => s.status === 'connected');
    const failed = servers.filter((s) => s.status === 'failed');
    const named = connected.map((s) => (s.transport ? `${s.name} (${s.transport.split(' · ')[0]})` : s.name));
    mcp = [INFO.mcpConnected(connected.length) + (named.length ? ` · ${named.join(', ')}` : ''), ...failed.map((s) => INFO.failed(s.name, s.error))].join(' · ');
  } else if (status && status.mcpServers.length > 0) {
    mcp = INFO.mcpConnected(status.mcpServers.filter((s) => s.status === 'connected').length);
  } else mcp = status ? INFO.mcpConnected(0) : NONE;
  return {
    title: INFO.sections.hooks,
    rows: [
      { label: INFO.hooks, value: hooks ? INFO.hookCounts(hooks.length - plugin, plugin) : NONE },
      { label: INFO.mcp, value: mcp },
    ],
  };
}

export function sessionInfoSections(input: SessionInfoInput): InfoSection[] {
  return [engineSection(input), modelSection(input), gatewaySection(input), permissionsSection(input), usageSection(input), hooksSection(input)];
}
