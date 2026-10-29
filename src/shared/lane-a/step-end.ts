// What a DX4 `step-end` may say beyond its step (P5 O9, Decision Log 2026-10-29 "M9's pre-flight", items 3 and 4): the
// step's end time `t` (epoch ms, the machine's clock), and the model and effort the step ran on. The local reshaper
// stamps `t`; sminos's plane sends all three from 1.27.12, each absent when it doesn't know it. Each is read when present
// and never invented: a time stamped at receipt is another machine's clock, and wrong under a replay.
import type { StepEnd } from 'desk-hub/protocol';

export type StepEndFields = { t?: number; model?: string; effort?: string };

/** The optional fields a step-end carries, each only when present and well-typed. */
export function stepEndFields(body: StepEnd): StepEndFields {
  // StepEnd.t/model/effort: pending desk-track PR, sminos 1.27.12 (the cast goes at that merge).
  const { t, model, effort } = body as StepEnd & { t?: unknown; model?: unknown; effort?: unknown };
  return {
    ...(typeof t === 'number' && Number.isFinite(t) && { t }),
    ...(typeof model === 'string' && model !== '' && { model }),
    ...(typeof effort === 'string' && effort !== '' && { effort }),
  };
}
