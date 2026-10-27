// `mawsd`'s Node floor (P5 O2 M8; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "The Linux runtime and the Node
// floor"): Node 24.11.0, the first 24 LTS, with `node:sqlite` unflagged, type stripping on by default and
// `--disable-sigusr1`.
import { describe, expect, it } from 'vitest';
import { NODE_FLOOR, nodeFloorProblem } from './node-floor';

describe('the Node floor', () => {
  it('is 24.11.0', () => {
    expect(NODE_FLOOR).toBe('24.11.0');
  });

  it('takes the floor and anything newer, by number rather than by text', () => {
    for (const version of ['24.11.0', 'v24.11.0', '24.11.1', '24.21.0', '24.100.0', '25.0.0', '100.0.0']) expect(nodeFloorProblem(version), version).toBeNull();
  });

  it('refuses anything older, naming the version and the floor', () => {
    for (const version of ['24.10.9', '24.9.0', '22.23.2', 'v20.0.0', '9.99.99']) expect(nodeFloorProblem(version), version).toBe(`mawsd needs Node ${NODE_FLOOR} or newer; this is Node ${version.replace(/^v/, '')}`);
  });

  it('refuses a version it cannot read', () => {
    expect(nodeFloorProblem('banana')).toMatch(/cannot read the Node version "banana"/);
  });
});
