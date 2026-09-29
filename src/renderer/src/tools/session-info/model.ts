// Session info's six sections as rows (C11 execution document, Interfaces "Session info tool"; §5.6; mockup 06 vignette
// 03 at Codex's key/value density, D-20): Engine, Model, Gateway, Permissions, Context·usage·cost, Hooks and MCP, from
// C5's stores, C7's usage windows, the routing facts, the lane and the four bounded reads. Pure: the view gathers the
// inputs and renders what this answers. A value not known yet reads `—`, never a guess.
import type { BinaryInfo } from '@shared/ipc/schema/engine';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { SessionDigest } from '@shared/ipc/schema';
import type { GetContextUsageResponse, GetHooksListingResponse, GetStatusResponse, ListPermissionRulesResponse, McpStatusResponse } from '@shared/wire/control';
import type { SessionWindows } from '../../stores/usage';
import { MODE_REFUSAL_WORDS } from '../../statusline/mode-menu';
import { resetsIn, windowShown } from '../../statusline/format';
import { directLoginOf } from '../../gateway/direct-login';
import type { DirectLogin, RoutingFacts } from '../../gateway/routing-facts';
import { present as presentContext } from '../../widgets/ContextWidget';
import { present as presentMcp } from '../../widgets/McpWidget';
import { CONTEXT } from '../../widgets/copy';
import { num } from '../../widgets/parts';
import { INFO, LANE } from './copy';
import type { Lane } from './lane';

export type InfoRow = { label: string; value: string; note?: string; action?: 'permissions' };
export type InfoSection = { title: string; rows: InfoRow[] };

export interface SessionInfoInput {
  record: SessionRecord;
  status: EngineSessionStatus | null;
  digest: SessionDigest | null;
  binary: BinaryInfo | null;
  pinnedVersion: string;
  facts: RoutingFacts;
  directLogin: DirectLogin | null;
  lane: Lane | null; // null without a status
  windows: SessionWindows;
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

function engineSection({ record, status, binary, pinnedVersion }: SessionInfoInput): InfoSection {
  const version = status?.engineVersion ?? record.engineVersion;
  const tree = status?.memory.treeRssKiB ?? null;
  return {
    title: INFO.sections.engine,
    rows: [
      { label: INFO.version, value: version ?? NONE, note: version === null ? undefined : version === pinnedVersion ? INFO.pinned : INFO.notPinned(pinnedVersion) },
      { label: INFO.binary, value: binary ? homeAbbreviated(binary.path) : NONE },
      { label: INFO.sessionId, value: record.engineSessionId ?? NONE },
      { label: INFO.processTree, value: tree === null ? NONE : INFO.tree(mb(tree), status?.memory.rssKiB == null ? null : mb(status.memory.rssKiB)) },
    ],
  };
}

function modelSection({ record, status }: SessionInfoInput): InfoSection {
  const model = status?.model ?? record.model;
  const effort = status ? status.effort : record.effort;
  const name = model.resolved ?? model.requested;
  const rows: InfoRow[] = [
    { label: INFO.main, value: name === null ? NONE : effort ? `${name} · ${effort}` : name },
    status?.subagentModel ? { label: INFO.subagents, value: status.subagentModel, note: INFO.subagentChosen } : { label: INFO.subagents, value: status ? INFO.engineDefault : NONE },
  ];
  const overrides = Object.entries(status?.modelOverrides ?? {});
  if (overrides.length > 0) rows.push({ label: INFO.overrides, value: overrides.map(([k, v]) => `${k} → ${v}`).join('; '), note: INFO.passedThrough });
  return { title: INFO.sections.model, rows };
}

function gatewaySection({ status, facts, directLogin, reads }: SessionInfoInput): InfoSection {
  const login = (reads.status && directLoginOf(reads.status)) ?? directLogin;
  const rows: InfoRow[] = [];
  if (!status) rows.push({ label: INFO.route, value: facts.line });
  else if (status.gateway.verified === 'routed') rows.push({ label: INFO.route, value: INFO.routed(status.gateway.baseUrl ?? NONE) });
  else if (status.gateway.verified === 'direct') rows.push({ label: INFO.route, value: login ? INFO.directLogin(login.login) : INFO.direct });
  else rows.push({ label: INFO.route, value: INFO.unverified, note: status.gateway.verified === 'mismatch' ? INFO.mismatch(status.gateway.mode) : INFO.pending });
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
      { label: INFO.mode, value: mode.effective, note: mode.refusal ? `${INFO.effectiveNote} · ${MODE_REFUSAL_WORDS[mode.refusal]}` : INFO.effectiveNote },
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
      ? presentContext(reads.context).line
      : NONE;
  const meter = (label: string, w: NonNullable<SessionWindows['windows']>['fiveHour']) => {
    if (!w) return null;
    const shown = windowShown(w, now);
    return `${label} ${Math.round(shown.percent)}%${shown.resetInMs === null ? '' : ` · resets in ${resetsIn(shown.resetInMs)}`}`;
  };
  const usage = windows.windows ? [meter('5h', windows.windows.fiveHour), meter('Weekly', windows.windows.sevenDay)].filter((m) => m !== null).join(' · ') : '';
  return {
    title: INFO.sections.usage,
    rows: [
      { label: INFO.context, value: context },
      { label: INFO.usage, value: usage || NONE, note: usage ? (windows.source === 'direct' ? INFO.fromEngine : INFO.fromClaudeUsage) : undefined },
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
