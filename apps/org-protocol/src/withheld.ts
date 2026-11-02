// The session a machine withholds (P5 O7 M5a2 fix wave 1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md M5;
// the architect's ruling on artifact answers): a member learns nothing of a session they can't view, in any answer. Where
// an answer's schema requires a session in an actor field (an artifact's `createdBy`, a library row's `lastEditor`, a
// version's `actor`: `{kind: 'session', appSessionId}`), the endpoint writes this id in place of every session the member
// can't view, so the field stays valid, its provenance an agent's (never the human's), and no two hidden sessions can be
// told apart or counted. It appears in actor fields alone: a list of sessions leaves a hidden one out, with nothing in its
// place.
//
// It is reserved: an app session id is minted as a UUID (`randomUUID`), which this can never be, so it names no record
// on any machine, and a request naming it is answered as one naming an unknown session. Shown, it is the agent with no
// title: `actorDisplay` (src/shared/artifacts/actor.ts) renders a session it finds no title for "Claude".
export const WITHHELD_SESSION = 'withheld-session';
