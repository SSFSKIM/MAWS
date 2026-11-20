// The harness's records name no path of this machine (UX wave U6b-5b M1): each named folder becomes its placeholder,
// in both of the forms a record can hold it (a path, a file URL), longest first so a folder inside another keeps its
// own name; `pathsIn` says which of the given paths a text still holds, so run.mjs refuses to print one that does.
import { pathToFileURL } from 'node:url';

const formsOf = (path) => [pathToFileURL(path).href, path];

export function scrubber(names) {
  const pairs = Object.entries(names)
    .flatMap(([name, path]) => formsOf(path).map((form) => [form, name]))
    .sort((a, b) => b[0].length - a[0].length);
  return (text) => pairs.reduce((out, [form, name]) => out.split(form).join(name), text);
}

export const pathsIn = (text, paths) => paths.filter((path) => formsOf(path).some((form) => text.includes(form)));
