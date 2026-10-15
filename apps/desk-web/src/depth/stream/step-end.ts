// DX4's `step-end` (the desk composite's Decision Log, DC6's M1), typed here until DC3's protocol carries it: a model
// request ended — finished, aborted, or cut off by its turn's end — sent after every `block-row` of that step, so a
// block of it still without one never gets one. When `SessionBodies['step-end']` and DX8's `SubscriptionMessage` with
// the kind land, they replace these two types and this file goes.
import type { SubscriptionMessage } from '../../shell/session-plane';

export type StepEnd = { turnId: string; agentId: string | null; step: number };

export type StepEndMessage = Omit<SubscriptionMessage, 'kind' | 'body'> & { kind: 'step-end'; body: StepEnd };

/** What a subscription delivers to depth: DX8's messages and `step-end`. */
export type DepthMessage = SubscriptionMessage | StepEndMessage;
