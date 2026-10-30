// What a DX4 `step-end` may say beyond its step (P5 O9, Decision Log 2026-10-29 "M9's pre-flight", items 3 and 4; DX4
// `StepEnd`, sminos 1.27.12): `t`, the bridge's stamp of the event that ended the step (epoch ms, the machine's clock),
// and the model and effort the step's start carried, the override applied. `effort: null` is the default effort
// observed; an absent field is one the plane doesn't know (a watch joining mid-step gets the snapshot's model and no
// effort). The local reshaper stamps `t`. Each is read when present and never invented: a time stamped at receipt is
// another machine's clock, and wrong under a replay. The body crossed a wire, so each field is checked as it is read.
import type { StepEnd } from 'desk-hub/protocol';

export type StepEndFields = Pick<StepEnd, 't' | 'model' | 'effort'>;

/** The optional fields a step-end carries, each only when present and well-typed. */
export function stepEndFields({ t, model, effort }: StepEnd): StepEndFields {
  return {
    ...(typeof t === 'number' && Number.isFinite(t) && { t }),
    ...(typeof model === 'string' && model !== '' && { model }),
    ...(((typeof effort === 'string' && effort !== '') || effort === null) && { effort }),
  };
}
