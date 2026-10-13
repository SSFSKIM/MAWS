import { describe, expect, it } from 'vitest';
import {
  attributionMap,
  contentIdsOf,
  decodeMap,
  deletedBy,
  encodeMap,
  idAt,
  insertedBy,
  insertedClients,
  mergeMaps,
  type ContentMap,
} from './attribution';
import { applyV1, diffV1, newDoc, onUpdate, transact, type Doc } from './doc';

const T0 = Date.parse('2026-10-12T09:00:00Z');
const MINUTE = 60_000;

// A doc whose every update is recorded with the actor its origin names and a time `stepMs` after the last, the way the
// host's log rows carry them (Decision Log 5: inserts by the clientID's binding, deletions by the sender).
function recorded(stepMs = 25_000): { doc: Doc; maps: ContentMap[]; edit: (actor: string, change: () => void) => void } {
  const doc = newDoc();
  const maps: ContentMap[] = [];
  let tick = 0;
  onUpdate(doc, (update, origin) => {
    tick += 1;
    const actor = String(origin);
    maps.push(attributionMap(contentIdsOf(update), { insertActor: actor, deleteActor: actor, at: T0 + tick * stepMs }));
  });
  return { doc, maps, edit: (actor, change) => transact(doc, change, actor) };
}

describe('attribution maps (X29 on v14)', () => {
  it('answers who inserted and who deleted each character, and when, to the minute', () => {
    const { doc, maps, edit } = recorded(); // at T0 + 25 s, + 50 s, + 75 s
    const text = doc.get('content');
    edit('session:a', () => text.insert(0, 'agent text '));
    edit('human', () => text.insert(text.length, 'human'));
    const firstDeleted = idAt(text, 0);
    edit('human', () => text.delete(0, 6)); // "agent "
    const merged = mergeMaps(maps);
    expect(firstDeleted).not.toBeNull();
    expect(insertedBy(merged, firstDeleted!)).toEqual({ actor: 'session:a', at: T0 });
    expect(deletedBy(merged, firstDeleted!)).toEqual({ actor: 'human', at: T0 + MINUTE });
    expect(text.toString()).toBe('text human');
    expect(insertedBy(merged, idAt(text, 0)!)).toEqual({ actor: 'session:a', at: T0 });
    expect(deletedBy(merged, idAt(text, 0)!)).toBeNull();
    expect(insertedBy(merged, idAt(text, 5)!)).toEqual({ actor: 'human', at: T0 });
  });

  it('attributes the inserts of each client to that client’s actor when one update carries several', () => {
    const agent = newDoc();
    agent.get('content').insert(0, 'from the agent ');
    const human = newDoc();
    applyV1(human, diffV1(agent));
    human.get('content').insert(15, 'and the human');
    const step2 = diffV1(human); // one update carrying both clients' structs
    const ids = contentIdsOf(step2);
    expect(insertedClients(ids).sort()).toEqual([agent.clientID, human.clientID].sort());
    const actorOf = (client: number) => (client === agent.clientID ? 'session:a' : 'human');
    const map = attributionMap(ids, { insertActor: actorOf, deleteActor: 'human', at: T0 });
    const text = human.get('content');
    expect(insertedBy(map, idAt(text, 0)!)?.actor).toBe('session:a');
    expect(insertedBy(map, idAt(text, 20)!)?.actor).toBe('human');
  });

  it('survives encoding: the decoded map answers as the original does', () => {
    const { doc, maps, edit } = recorded();
    const text = doc.get('content');
    edit('session:a', () => text.insert(0, 'abc'));
    edit('human', () => text.delete(1, 1));
    const merged = mergeMaps(maps);
    const back = decodeMap(encodeMap(merged));
    const id = { client: doc.clientID, clock: 1 };
    expect(insertedBy(back, id)).toEqual(insertedBy(merged, id));
    expect(deletedBy(back, id)).toEqual({ actor: 'human', at: T0 });
  });

  it('coalesces one actor’s keystrokes within a minute into one range when maps merge', () => {
    const { doc, maps, edit } = recorded(1000);
    const text = doc.get('content');
    for (const ch of 'typed one key at a time') edit('human', () => text.insert(text.length, ch));
    const merged = mergeMaps(maps);
    const ranges: { clock: number; len: number }[] = [];
    merged.inserts.forEach((range) => ranges.push({ clock: range.clock, len: range.len }));
    expect(ranges).toEqual([{ clock: 0, len: text.length }]);
    expect(insertedBy(merged, idAt(text, text.length - 1)!)).toEqual({ actor: 'human', at: T0 });
  });

  it('gives an empty map for an update with no content (awareness-free no-op)', () => {
    const doc = newDoc();
    const map = attributionMap(contentIdsOf(diffV1(doc)), { insertActor: 'human', deleteActor: 'human', at: T0 });
    expect(insertedClients(contentIdsOf(diffV1(doc)))).toEqual([]);
    expect(decodeMap(encodeMap(map)).inserts.isEmpty()).toBe(true);
  });
});
