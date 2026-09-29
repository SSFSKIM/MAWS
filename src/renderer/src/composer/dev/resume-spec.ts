// The dev-only resume launcher's launch (C7 execution document, "Dev-only resume launcher"): an existing record resumed
// under its own app id, in its directories, with the launcher's three fields passed through literally. Pure.
import { launchDefaults } from '@shared/composer/launch-defaults';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { PermissionMode } from '@shared/graph/enums';
import type { SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';

// A record the launcher can resume: listed (not archived) and with an engine session to resume.
export type Resumable = SessionRecord & { engineSessionId: SessionId };
export const isResumable = (record: SessionRecord): record is Resumable => !record.archived && record.engineSessionId !== null;

export interface ResumeFields {
  direct: boolean;
  permissionMode: PermissionMode | null; // null: the engine's default (the owner's settings)
  extraSettings: Record<string, unknown> | null;
}

// A live turn run from the launcher is capped (the M6 acceptance's budget). The engine's cap is the conversation's
// cumulative cost, the restored cost of a resumed session included, so a resume's cap is its restored cost plus the case's
// allowance; the flag is not adjusted (C11 M6, closing the C3/C11 tracker row of 2026-09-29).
export const RESUME_BUDGET_USD = 0.5;

export function resumeSpec(record: Resumable, fields: ResumeFields): LaunchSpec {
  return {
    ...launchDefaults(record.appId, record.directory),
    additionalDirectories: record.additionalDirectories,
    resume: { sessionId: record.engineSessionId, fork: false },
    gateway: fields.direct ? 'direct' : 'gateway',
    permissionMode: fields.permissionMode,
    extraSettings: fields.extraSettings,
    maxBudgetUsd: RESUME_BUDGET_USD,
  };
}

// The extraSettings field: empty is none; otherwise it must parse as a JSON object.
export function parseExtraSettings(text: string): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  if (text.trim() === '') return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'extraSettings must be a JSON object' };
  return { ok: true, value: parsed as Record<string, unknown> };
}
