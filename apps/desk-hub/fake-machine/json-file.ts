// A key or state file read as JSON without its text ever reaching a message: V8's JSON.parse error quotes the text
// around where it failed (`Unexpected token 'S', ..."d": SECRETd0No"... is not valid JSON`), and these files hold
// private keys and service tokens. Read failures (a missing file, say) name the path alone already.
import { readFileSync } from 'node:fs';

/** `text`, read from `path`, as JSON; text that does not parse throws a fixed diagnostic naming `path` and `what` it
 * is, and nothing of the text. */
export function parseJsonFile<T>(text: string, path: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    // Neither the text nor the parser's error (no `cause`): either would carry the text.
    throw new Error(`${path} is not valid JSON (${what}): its contents are not shown`);
  }
}

/** `path`'s JSON, as `parseJsonFile` reads it. */
export function readJsonFile<T>(path: string, what: string): T {
  return parseJsonFile<T>(readFileSync(path, 'utf8'), path, what);
}
