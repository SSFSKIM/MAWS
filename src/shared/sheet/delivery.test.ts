// The delivery's block (X3; C2's I7): every envelope the pin publishes, and its terminal example's steer, hold one
// block a reader reads alone.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSheetDeliveries } from './delivery';

const EXAMPLES = join(__dirname, '../../../test/fixtures/sheet/set/examples');

function envelopes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'input' ? [] : envelopes(path);
    return entry.name === 'envelope.txt' || entry.name === 'steer.txt' ? [path] : [];
  });
}

const block = (body: string): string => `[sheet v1] The human answered questions on your sheet.\nq1 "Ship?" → Yes.\n<sheet-delivery>${body}</sheet-delivery>`;

describe('parseSheetDeliveries', () => {
  const found = envelopes(EXAMPLES);

  it('finds every envelope of the pin, split/then’s and the steer among them', () => {
    const names = found.map((path) => relative(EXAMPLES, path));
    expect(names).toContain('split/then/envelope.txt');
    expect(names).toContain('terminal/steer.txt');
  });

  for (const path of found) {
    it(`${relative(EXAMPLES, path)}: one block, a key for each answered and dismissed question`, () => {
      const deliveries = parseSheetDeliveries(readFileSync(path, 'utf8'));
      expect(deliveries).toHaveLength(1);
      const [delivery] = deliveries;
      expect(delivery.keys).toHaveLength(delivery.answered.length + delivery.dismissed.length);
    });
  }

  it('reads the terminal example’s answers as places, with their texts and images', () => {
    const [delivery] = parseSheetDeliveries(readFileSync(join(EXAMPLES, 'terminal/envelope.txt'), 'utf8'));
    expect(delivery.answered[0]).toEqual({ id: 'q7', revision: 2, picks: [1, 2], text: 'passkeys only on mobile', images: [expect.stringMatching(/uploads\/sketch\.png$/)] });
    expect(delivery.dismissed).toEqual(['q9', 'q11']);
    expect(delivery.more).toBeUndefined();
  });

  it('reads a cut text with its flag and file, and an envelope that says more follows', () => {
    const [long] = parseSheetDeliveries(readFileSync(join(EXAMPLES, 'long/envelope.txt'), 'utf8'));
    expect(long.answered.some((answer) => answer.textCut === true && answer.textFile !== undefined)).toBe(true);
    const [more] = parseSheetDeliveries(readFileSync(join(EXAMPLES, 'more/envelope.txt'), 'utf8'));
    expect(more.more).toBe(true);
  });

  it('reads none in a text without a block, and every block of a text with two', () => {
    expect(parseSheetDeliveries('The human answered: OAuth.')).toEqual([]);
    const one = '{"v":1,"keys":["page-00000001"],"answered":[],"dismissed":["q1"]}';
    const two = '{"v":1,"keys":["page-00000002"],"answered":[],"dismissed":["q2"]}';
    expect(parseSheetDeliveries(`${block(one)}\n${block(two)}`).map((delivery) => delivery.dismissed)).toEqual([['q1'], ['q2']]);
  });

  it('holds each block to the delivery schema, and drops one that fails it', () => {
    const bad = [
      '{"v":2,"keys":[],"answered":[],"dismissed":[]}',
      '{"v":1,"keys":["short"],"answered":[],"dismissed":[]}',
      '{"v":1,"keys":[],"answered":[{"id":"q1","revision":1,"picks":[0],"text":"","images":[]}],"dismissed":[]}',
      `{"v":1,"keys":[],"answered":[{"id":"q1","revision":1,"picks":[],"text":"${'x'.repeat(501)}","images":[]}],"dismissed":[]}`,
      '{"v":1,"keys":[],"answered":[],"dismissed":["q0"]}',
      '{"v":1,"keys":[],"answered":[],"dismissed":[],"more":false}',
      '{"v":1,"keys":[],"answered":[]}',
      'not json',
    ];
    for (const body of bad) expect(parseSheetDeliveries(block(body)), body).toEqual([]);
    // 500 characters in code points, not UTF-16 units
    const wide = `{"v":1,"keys":["page-00000001"],"answered":[{"id":"q1","revision":1,"picks":[],"text":"${'\u{1F600}'.repeat(500)}","images":[]}],"dismissed":[]}`;
    expect(parseSheetDeliveries(block(wide))).toHaveLength(1);
  });
});
