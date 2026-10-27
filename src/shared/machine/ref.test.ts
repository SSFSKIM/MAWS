import { describe, expect, it } from 'vitest';
import { MachineRefSchema } from './ref';

describe('MachineRefSchema', () => {
  it("accepts RL5's whole range: [A-Za-z0-9_-] from 16 to 64 characters", () => {
    for (const ref of ['a'.repeat(16), 'Z'.repeat(64), 'AbC_09-xyzXYZ_-_', 'q3J8Vb2bQyKh0bN7k6m2Fw']) {
      expect(MachineRefSchema.safeParse(ref).success, ref).toBe(true);
    }
  });

  it('refuses a ref outside the range or the alphabet, a slash above all', () => {
    const refused = ['', 'a'.repeat(15), 'a'.repeat(65), 'abcdefgh/ijklmnop', 'abcdefgh+ijklmnop', 'abcdefghijklmnop=', 'abcdefgh.ijklmnop', 'abcdefgh:ijklmnop', 'abcdefgh ijklmnop'];
    for (const ref of refused) {
      expect(MachineRefSchema.safeParse(ref).success, ref).toBe(false);
    }
  });
});
