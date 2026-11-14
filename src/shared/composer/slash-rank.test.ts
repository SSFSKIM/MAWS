import { describe, expect, it } from 'vitest';
import { createSlashRanker, rankSlashItems } from './slash-rank';
const origins = ['engine', 'custom'] as const;
const items = [
  { name: 'settings', description: 'Model options', origin: 'engine' as const, payload: 1 },
  { name: 'mango', description: '', origin: 'engine' as const, payload: 2 },
  { name: 'memory', description: '', origin: 'engine' as const, payload: 3 },
  { name: 'model', description: '', origin: 'engine' as const, payload: 4 },
  { name: 'mo', description: '', origin: 'custom' as const, payload: 5 },
];
describe('shared slash ranking', () => {
  it('preserves exact/prefix/substring/subsequence/description tiers and item payloads independently of input order', () => {
    const result = rankSlashItems('mo', items, origins);
    expect(result.map((i) => i.name)).toEqual(['mo', 'model', 'memory', 'mango', 'settings']);
    expect(result[0].payload).toBe(5);
    expect(rankSlashItems('MO', [...items].reverse(), origins)).toEqual(result);
  });
  it('keeps twenty distinct recents per consumer and promotes by one tier', () => {
    const desk = createSlashRanker(origins);
    const renderer = createSlashRanker(origins);
    desk.rememberChosen('memory');
    expect(desk.rankItems('mo', items).map((i) => i.name)).toEqual(['mo', 'memory', 'model', 'mango', 'settings']);
    expect(renderer.rankItems('mo', items).map((i) => i.name)).toEqual(['mo', 'model', 'memory', 'mango', 'settings']);
    for (let i = 0; i < 19; i++) desk.rememberChosen(`recent-${i}`);
    desk.rememberChosen('recent-18');
    expect(desk.rankItems('mo', items)[1].name).toBe('memory');
    desk.rememberChosen('twentieth-other');
    expect(desk.rankItems('mo', items)[1].name).toBe('model');
  });
  // UX wave U4a (decision 17 e): the composer's palette breaks ties by the order its items came in; desk web keeps the default
  it('breaks ties in list order when asked, the tiers and the boost unchanged', () => {
    const listed = createSlashRanker(origins, { ties: 'list' });
    const reversed = [...items].reverse(); // mo (custom), model, memory, mango, settings
    expect(listed.rankItems('', reversed).map((i) => i.name)).toEqual(['mo', 'model', 'memory', 'mango', 'settings']);
    expect(listed.rankItems('', items).map((i) => i.name)).toEqual(['settings', 'mango', 'memory', 'model', 'mo']);
    // four prefix matches in the order given, then `settings` by a word of its description
    expect(listed.rankItems('m', reversed).map((i) => i.name)).toEqual(['mo', 'model', 'memory', 'mango', 'settings']);
    expect(listed.rankItems('mo', reversed).map((i) => i.name)).toEqual(['mo', 'model', 'memory', 'mango', 'settings']); // the tiers decide first
    listed.rememberChosen('memory');
    expect(listed.rankItems('', reversed).map((i) => i.name)).toEqual(['memory', 'mo', 'model', 'mango', 'settings']);
    // the default for the same items: origin, then name
    expect(rankSlashItems('', reversed, origins).map((i) => i.name)).toEqual(['mango', 'memory', 'model', 'settings', 'mo']);
    expect(rankSlashItems('m', reversed, origins).map((i) => i.name)).toEqual(['mango', 'memory', 'model', 'mo', 'settings']);
  });
});
