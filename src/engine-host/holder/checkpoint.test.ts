// The host map and the acknowledged frontier (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, Interfaces §C, D6, D23,
// D39, D44): the map's line forms and rotation, the contiguous frontier and its coalesced acks, and the read an adopter
// makes (M3's), which never identifies a record by its content.
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Frontier, HostMap, mapFileOf, readCheckpoint } from './checkpoint';

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-hseq-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('the host map', () => {
  it('names each map file after its journal file', () => {
    expect(mapFileOf('/j/abc.jsonl')).toBe('/j/abc.hseq');
    expect(mapFileOf('/j/abc.3.jsonl')).toBe('/j/abc.3.hseq');
  });

  it('appends one line per record, a retraction and a lost range, 0600, beside the journal file it is told', () => {
    const dir = scratch();
    const map = new HostMap();
    map.line(1, 4, join(dir, 'L.jsonl'));
    map.line(2, 5, join(dir, 'L.jsonl'));
    map.retract(2, join(dir, 'L.jsonl'));
    map.line(3, 6, join(dir, 'L.1.jsonl')); // the journal rotated
    map.lost(9, join(dir, 'L.1.jsonl'));
    map.close();
    expect(readFileSync(join(dir, 'L.hseq'), 'utf8')).toBe('1 4\n2 5\n2 -\n');
    expect(readFileSync(join(dir, 'L.1.hseq'), 'utf8')).toBe('3 6\n9 *\n');
    expect(statSync(join(dir, 'L.hseq')).mode & 0o777).toBe(0o600);
  });
});

describe('the frontier', () => {
  it('advances only while the next sequence is journaled, so a held record stops it however far later ones go', () => {
    const acks: number[] = [];
    const f = new Frontier({ ack: (seq) => acks.push(seq) });
    f.journaled(2);
    f.journaled(3);
    expect(f.value).toBe(0);
    f.flush();
    expect(acks).toEqual([]); // nothing contiguous to acknowledge
    f.journaled(1);
    expect(f.value).toBe(3);
    f.flush();
    expect(acks).toEqual([3]);
    f.flush();
    expect(acks).toEqual([3]); // an ack only when the frontier moved
    f.dispose();
  });

  it('coalesces acks: one per 50 ms, or at once every 64 records', () => {
    vi.useFakeTimers();
    const acks: number[] = [];
    const f = new Frontier({ ack: (seq) => acks.push(seq) });
    f.journaled(1);
    f.journaled(2);
    expect(acks).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(acks).toEqual([2]);
    for (let seq = 3; seq <= 66; seq += 1) f.journaled(seq);
    expect(acks).toEqual([2, 66]); // the 64th record since the last ack goes at once
    vi.advanceTimersByTime(100);
    expect(acks).toEqual([2, 66]);
    f.dispose();
  });

  it('starts from a given frontier and reports when it has reached a sequence', () => {
    const f = new Frontier({ start: 10, ack: () => {} });
    expect(f.reached(10)).toBe(true);
    expect(f.reached(11)).toBe(false);
    f.journaled(11);
    expect(f.reached(11)).toBe(true);
    f.dispose();
  });
});

describe('the checkpoint an adopter reads', () => {
  const write = (dir: string, name: string, text: string) => writeFileSync(join(dir, name), text, { mode: 0o600 });

  it('a launch with no map reads frontier 0 and nothing above', () => {
    expect(readCheckpoint(scratch(), 'L', 10)).toEqual({ frontier: 0, above: [] });
  });

  it('is the contiguous frontier of mapped sequences whose rows are on disk, the rest listed above it', () => {
    const dir = scratch();
    write(dir, 'L.hseq', '1 2\n2 3\n4 5\n6 7\n');
    expect(readCheckpoint(dir, 'L', 7)).toEqual({ frontier: 2, above: [4, 6] });
  });

  it('reads every rotation in order and the lines of identical records apart', () => {
    const dir = scratch();
    write(dir, 'L.hseq', '1 2\n2 3\n');
    write(dir, 'L.1.hseq', '3 4\n4 5\n');
    expect(readCheckpoint(dir, 'L', 5)).toEqual({ frontier: 4, above: [] });
  });

  it('drops a line whose row never landed, and retracts it in the map so a later read never matches it', () => {
    const dir = scratch();
    write(dir, 'L.hseq', '1 2\n2 3\n3 4\n');
    expect(readCheckpoint(dir, 'L', 3)).toEqual({ frontier: 2, above: [] }); // row 4 never landed: record 3 is replayed
    expect(readFileSync(join(dir, 'L.hseq'), 'utf8')).toBe('1 2\n2 3\n3 4\n3 -\n');
    // the resumed writer reuses journal seq 4 for another record; the stale line stays retracted
    appendFileSync(join(dir, 'L.hseq'), '5 4\n');
    expect(readCheckpoint(dir, 'L', 4)).toEqual({ frontier: 2, above: [5] });
  });

  it('a retraction drops the lines before it for that sequence; a line after it counts again', () => {
    const dir = scratch();
    write(dir, 'L.hseq', '1 2\n2 3\n2 -\n2 3\n3 4\n');
    expect(readCheckpoint(dir, 'L', 4)).toEqual({ frontier: 3, above: [] });
    write(dir, 'L.hseq', '1 2\n2 3\n2 -\n3 3\n');
    expect(readCheckpoint(dir, 'L', 3)).toEqual({ frontier: 1, above: [3] });
  });

  it('a lost range accounts for every sequence at or below it', () => {
    const dir = scratch();
    write(dir, 'L.hseq', '1 2\n7 *\n8 9\n');
    expect(readCheckpoint(dir, 'L', 9)).toEqual({ frontier: 8, above: [] });
  });

  it('truncates a torn last line before reading or appending', () => {
    const dir = scratch();
    write(dir, 'L.hseq', '1 2\n2 3\n3 ');
    expect(readCheckpoint(dir, 'L', 3)).toEqual({ frontier: 2, above: [] });
    expect(readFileSync(join(dir, 'L.hseq'), 'utf8')).toBe('1 2\n2 3\n');
  });
});
