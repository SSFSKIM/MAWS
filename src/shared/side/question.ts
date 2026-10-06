// A side question as the engine host keeps it (E3 execution document, Interfaces "The host's side-question log";
// Design §7): one exchange of the session's `/btw` log, which `side.question.list` answers. The log is host memory
// (X13): it outlives a renderer reload and lives as long as the session's process; nothing of it reaches the
// conversation, as the engine's own `side_question` writes no transcript record.
import * as z from 'zod';

export const SideExchangeSchema = z.strictObject({
  id: z.string(), // the operation id (the minted request id)
  question: z.string(),
  state: z.enum(['pending', 'answered', 'failed']),
  response: z.string().nullable(),
  synthetic: z.boolean(), // the engine substituted the answer (`side_question`'s `synthetic`)
  error: z.string().nullable(),
  askedAt: z.string(),
  answeredAt: z.string().nullable(),
});
export type SideExchange = z.infer<typeof SideExchangeSchema>;
