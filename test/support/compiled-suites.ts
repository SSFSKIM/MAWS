// The renderer suites vitest's `renderer-compiled` project runs again under the React Compiler (P3-F, the tracker's
// compiled-include row: the library's first Export of a kind never showed while its uncompiled hook suite passed). Every
// component or hook suite of the `renderer` project: each `.tsx` suite, and each `.ts` suite that imports React,
// React DOM or Testing Library's React (`renderHook`, `createElement`), under src/renderer and among main's DOM suites
// that render renderer components; never the terminal's Node-run suites or the whole-app timing suites, which
// `renderer-compiled-timing` takes. Read from the files when vitest loads its config, so a new suite needs no list.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REACT_IMPORT = /\bfrom\s+['"](?:react|react-dom(?:\/[\w-]+)?|@testing-library\/react)['"]/;
const NODE_RUN = /^src\/renderer\/src\/terminal\/.*\.node\.test\.ts$/; // vitest.config.ts's RENDERER_NODE_TESTS
const RENDERER_SUITE = /^(?:src\/renderer\/.*\.test\.tsx?|src\/main\/artifacts\/[^/]+\.dom\.test\.tsx)$/; // the `renderer` project's include

// The suites, as paths relative to `root` with POSIX separators, sorted; `timing` names the suites left to the timing project.
export function compiledRendererSuites(root: string, timing: readonly string[]): string[] {
  const files = ['src/renderer', 'src/main/artifacts'].flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' }).map((rel) => `${dir}/${rel.split('\\').join('/')}`),
  );
  return files
    .filter((file) => RENDERER_SUITE.test(file) && !NODE_RUN.test(file) && !timing.includes(file) && !file.includes('/node_modules/'))
    .filter((file) => file.endsWith('.tsx') || REACT_IMPORT.test(readFileSync(join(root, file), 'utf8')))
    .sort();
}
