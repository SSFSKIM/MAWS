// The grant scopes a permission card offers (C7 execution document, Request card, "Scope options"): `once` always,
// `session` unless the request is downgraded, `local_settings` only from the engine's own `localSettings` suggestion
// and never when downgraded. Downgraded is exactly what C3's broker downgrades (an ask rule outranks any allow rule,
// §4.6), so the card never offers a scope the broker would answer as once. `updatedPermissions` is what the broker
// writes for the scope (`engine-host/broker.ts`, `sessionRule` and `localSettingsRule`), shown, never sent: the answer
// carries the scope alone. Pure.
import type { SessionEvent } from '@shared/graph/events';
import { toolClass } from './tools';

type PermissionEvent = Extract<SessionEvent, { kind: 'permission.requested' }>;
export type Scope = 'once' | 'session' | 'local_settings';

export interface ScopeOption {
  scope: Scope;
  label: string;
  detail: string;
  updatedPermissions: unknown[] | null;
}

interface AddRules {
  type: 'addRules';
  rules: { toolName: string; ruleContent?: string }[];
  behavior: string;
  destination: string;
}

export const isDowngraded = (ev: PermissionEvent): boolean => ev.decisionReasonType === 'rule' || ev.matchedAskRule != null || ev.suppressAlwaysAllow === true;

function addRulesSuggestions(ev: PermissionEvent): AddRules[] {
  return ev.suggestions.filter((s): s is AddRules => {
    const candidate = s as Partial<AddRules> | null;
    return candidate?.type === 'addRules' && Array.isArray(candidate.rules) && candidate.rules.every((r) => typeof r?.toolName === 'string');
  });
}

// The rule the request itself names when the engine suggested none (the broker's `ruleFromRequest`).
function ruleFromRequest(ev: PermissionEvent, destination: string): AddRules {
  const command = ev.toolName === 'Bash' ? (ev.input as { command?: unknown } | null)?.command : undefined;
  const rule = typeof command === 'string' ? { toolName: ev.toolName, ruleContent: command } : { toolName: ev.toolName };
  return { type: 'addRules', rules: [rule], behavior: 'allow', destination };
}

const ruleText = (rules: AddRules['rules']) => rules.map((r) => r.ruleContent ?? r.toolName).join(', ');

export function scopeOptions(ev: PermissionEvent, project: { name: string } | null): ScopeOption[] {
  const once: ScopeOption = { scope: 'once', label: 'Allow once', detail: toolClass(ev.toolName) === 'edit' ? 'This file only' : 'Only this invocation', updatedPermissions: null };
  if (isDowngraded(ev)) return [once];

  const suggestions = addRulesSuggestions(ev);
  const [first] = suggestions;
  const session: ScopeOption = {
    scope: 'session',
    label: 'Allow for this session',
    detail: first?.rules.some((r) => r.ruleContent) ? `Matching ${ruleText(first.rules)} commands` : 'Until this session ends',
    updatedPermissions: [first ? { ...first, destination: 'session' } : ruleFromRequest(ev, 'session')],
  };
  const local = suggestions.find((s) => s.destination === 'localSettings');
  if (!local) return [once, session];
  return [
    once,
    session,
    { scope: 'local_settings', label: `Always allow ${ruleText(local.rules)} in ${project?.name ?? 'this project'}`, detail: 'Project rule', updatedPermissions: [local] },
  ];
}
