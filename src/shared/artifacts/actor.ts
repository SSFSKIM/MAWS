// X29, the actor (docs/doperpowers/plans/2026-10-12-p3-co-work.md §6; the P3 interface ledger §2): who wrote an update,
// a version or an entity row. The human or one app session; the engine host sets it from the connection or the tool
// call, never from the writer's own bytes. `actorKey` is the stored form (the provenance maps' `insert`/`delete`
// attribute, the `actors` table's key); `actorDisplay` is how history, author chips and cursors show one.
import * as z from 'zod';
import { AppSessionIdSchema } from '../graph/ids';

export const ActorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('human') }),
  z.strictObject({ kind: z.literal('session'), appSessionId: AppSessionIdSchema }),
]);
export type Actor = z.infer<typeof ActorSchema>;

export const actorKey = (actor: Actor): string => (actor.kind === 'human' ? 'human' : `session:${actor.appSessionId}`);

// The author palette: eight CSS custom property names, one per colour slot, so a theme defines the colours and the
// renderer draws with `var(<name>)`. No literal colour lives here (components use tokens only).
export const AUTHOR_COLORS = ['--author-1', '--author-2', '--author-3', '--author-4', '--author-5', '--author-6', '--author-7', '--author-8'] as const;
export type AuthorColor = (typeof AUTHOR_COLORS)[number];

// FNV-1a over the key's UTF-16 code units: stable across runs and builds, so an actor keeps its colour everywhere.
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// The human is "You"; a session is its title, else "Claude" (§4.7). The colour follows the key, not the title, so a
// renamed session keeps its colour.
export function actorDisplay(actor: Actor, sessionTitle?: string): { name: string; color: AuthorColor } {
  const name = actor.kind === 'human' ? 'You' : sessionTitle?.trim() || 'Claude';
  return { name, color: AUTHOR_COLORS[hash(actorKey(actor)) % AUTHOR_COLORS.length] };
}
