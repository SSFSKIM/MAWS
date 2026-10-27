// A key or state file that does not parse is named, never quoted (O11 M8): V8's JSON.parse error quotes the text where
// it failed (`Unexpected token 'S', "{"d": SECRETSCAL"... is not valid JSON`), and the deployment's launcher prints a
// command's error, so a malformed private JWK would reach the terminal. Each reader throws a fixed diagnostic instead,
// carrying neither the text nor the parser's error.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { readCheckpoint } from '../../deploy/access-sync.ts';
import { loadAdminDevice } from '../../deploy/org-admin.ts';
import { readJsonFile } from '../../fake-machine/json-file.ts';

const SCALAR = 'SECRETd0NotPrintThisScalarZ';

/** Malformed key files, each failing where V8 quotes the private scalar around the failure. */
const malformed = [
  `{"keys": {"a1.channel": {"kty": "EC", "crv": "P-256", "d": ${SCALAR}}}}`,
  `{"keys": {"a1.channel": {"d": "${SCALAR}"}}} trailing`,
  `${SCALAR}`,
  `{"keys": {"a1.channel": {"d": '${SCALAR}'}}}`,
];

function file(text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'm8-keyfile-')), 'keys.json');
  writeFileSync(path, text, { mode: 0o600 });
  return path;
}

/** Everything an uncaught error would print: its message, stack and causes. */
const printed = (error: unknown) => inspect(error, { depth: 5 });

async function failure(read: () => unknown): Promise<unknown> {
  try {
    await read();
  } catch (error) {
    return error;
  }
  throw new Error('it read the file');
}

describe('a key or state file that does not parse', () => {
  it('fails the admin device with a fixed diagnostic that quotes nothing of it', async () => {
    // The parser itself would have printed the scalar.
    expect(String(await failure(() => JSON.parse(malformed[0])))).toContain(SCALAR.slice(0, 8));
    for (const text of malformed) {
      const path = file(text);
      const error = await failure(() => loadAdminDevice(path));
      expect((error as Error).message).toBe(`${path} is not valid JSON (an admin device's keys): its contents are not shown`);
      expect(printed(error)).not.toContain(SCALAR.slice(0, 8));
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it('fails a checkpoint and a fake machine’s state the same way', async () => {
    for (const text of malformed) {
      const path = file(text);
      for (const read of [() => readCheckpoint(path), () => readJsonFile(path, 'a fake machine’s state')]) {
        const error = await failure(read);
        expect((error as Error).message).toMatch(/ is not valid JSON \(.*\): its contents are not shown$/);
        expect(printed(error)).not.toContain(SCALAR.slice(0, 8));
      }
    }
  });

  it('still reads a well-formed one', () => {
    expect(readJsonFile<{ a: number }>(file('{"a": 1}'), 'a test file')).toEqual({ a: 1 });
  });
});
