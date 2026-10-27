// Selection for iteration runs (ci-kit docs/doperpowers/specs/2026-10-21-test-history-design.md, M4, agreed with the
// architect 2026-10-21). `scripts/ci-gate.sh --affected` marks the pushed commit `Selection: affected` and lists the
// change's paths in it: `Affected-Count: <n>`, then one `Affected:` trailer per line of `git diff --name-status -M` from
// the merge base with origin/master to the tested commit (its status, a tab, the path, and for a rename a tab and the
// new path), none when n passes ci-gate's bound. unit and unit:darwin then run vitest's related mode over the paths
// that still exist: only the suites whose module graph reaches one. What that graph cannot see runs the full suite
// instead (the fallbacks below, the first that applies giving the reason), and the suites that read source without
// importing it join the list (SOURCE_READERS). A path no suite reads (UNREAD: docs/, but for the evidence one suite
// reads) counts for nothing.
// A selected run never counts as landing evidence, even when a fallback ran the full suite, and a red one counts as red:
// a landing needs a full class 1a on the head's tree, which catches whatever selection missed.
// The decision alone, for gate-plan.mjs (which reads the trailers and writes the outputs) and gate-plan.test.mjs.

// vitest's related mode follows a test file's imports (static, and dynamic ones written as a literal), as vite
// transforms them. It does not see a file a suite reads through fs or a glob, and it drops every import carrying a query
// (`?raw`, `?inline`, `?asset`): it looks for the id, query and all, on disk. Run in vitest 5.0.2's own
// getRelevantTestSpecifications, `src/renderer/src/styles/tokens.css` reaches no suite though four import it `?raw`;
// a plain `.css` or `.json` import is followed. So a non-script file anywhere in the source and test trees runs the full
// suite, as does any file under a directory the suites read as data. The directories were found by reading the suites
// (readFileSync, readdir, import.meta.glob, query imports, in test files and test support); outside the trees the
// suites also read spikes/protocol-probe/fixtures, spikes/browser-probe, e2e/fixtures, e2e/support,
// apps/desk-hub/{deploy,fake-machine,local}, apps/desk-hub/wrangler.jsonc and apps/desk-web/public, which the
// outside-the-trees rule already sends to the full suite, and docs/doperpowers/evidence/p1-e8, listed here since the
// rest of docs/ is not (UNREAD).
export const READ_AS_DATA = [
  'test/fixtures/', // readFileSync, the harness's import.meta.glob, the document suites' `?raw` imports
  'test/snapshots/', // the transcript model's snapshots
  'apps/desk-web/test/fixtures/', // the depth double's recordings
  'src/artifacts/types/design_system/defaults/', // import.meta.glob `?raw`, `?inline` and `?asset`; r3-labelled-set's tokens
  'src/artifacts/slides/fixtures/claude/', // corpus.ts's import.meta.glob `?raw`
  'src/renderer/src/terminal/__fixtures__/', // scroll-up's recorded terminal bytes
  'docs/doperpowers/evidence/p1-e8/', // src/shared/plugins/cli.test.ts reads g0-cli-probe.txt
];

// What no suite reads: a change there contributes no path, so a change of docs alone runs no suite. Read for it: the
// suites, their support, the scripts they spawn and the configs (fs reads, globs, query imports, path joins naming
// docs/), 2026-10-21. The one read under docs/ is cli.test.ts's of docs/doperpowers/evidence/p1-e8, a READ_AS_DATA
// directory, which runs the full suite; test/artifacts/r3-labelled-set.test.ts writes evidence/p4-b4 and reads none of
// it, and elsewhere docs/ appears in suites only as strings (sample paths, provenance). A suite that starts reading
// under docs/ makes its directory a READ_AS_DATA entry.
export const UNREAD = ['docs/'];

// Suites that read source trees without importing them: through fs, a lint, a build of the tree, or a bundle a suite
// builds and runs. A change under a tree adds its readers to the related list, so they run on the changed source;
// a support module in the list brings every suite that imports it. A suite that starts reading a source tree that way
// belongs here. One that is missing goes unrun in a selected run while it should have run, and the landing's full
// class 1a is what catches it.
export const SOURCE_READERS = [
  // X7: every .ts, .tsx and .css under src/renderer, for a literal colour.
  { trees: ['src/renderer/'], suites: ['test/support/tokens-guard.test.ts'] },
  // P3-F: the suites the compiled projects take, read from src/renderer and src/main/artifacts by name and imports.
  { trees: ['src/renderer/', 'src/main/artifacts/'], suites: ['test/support/compiled-suites.test.ts'] },
  // C4: the filesystem service's sources, for a Node API that writes.
  { trees: ['src/engine-host/fs/'], suites: ['test/support/read-only-guard.test.ts'] },
  // The one-schema rule linted over every src/ file that builds a ProseMirror schema.
  { trees: ['src/'], suites: ['test/artifacts/one-schema.test.ts'] },
  // out/main and out/preload, which the unit job builds from src/ (`pnpm build:main-preload`) before its tests.
  { trees: ['src/'], suites: ['src/engine-host/bundle-guard.test.ts', 'src/preload/bundle.test.ts'] },
  // The preload's import graph walked through fs from its index.ts, @shared included.
  { trees: ['src/preload/', 'src/shared/'], suites: ['src/preload/bridge.test.ts'] },
  // The components compiled through babel from their files.
  {
    trees: [
      'src/artifacts/slides/editor/present/Presentation.tsx',
      'src/renderer/src/tools/presentation/DeckBody.tsx',
      'src/artifacts/slides/editor/Filmstrip.tsx',
      'src/artifacts/design/editor/BoardList.tsx',
    ],
    suites: ['test/react-compiler.test.ts'],
  },
  // A writer fixture bundled by esbuild and forked, with the store's modules it imports.
  { trees: ['src/engine-host/', 'src/artifacts/', 'src/shared/'], suites: ['src/engine-host/documents/sigkill.test.ts', 'src/engine-host/documents/retention-crash.test.ts'] },
  // The hub's Worker reaches its suites as a bundle: the global setup's (loaded into Miniflare through local.ts and
  // hub.ts, so every suite that imports either), the fake machine's bin.ts and local/run.ts, each spawned.
  {
    trees: ['apps/desk-hub/src/', 'apps/org-protocol/src/'], // P5-O11 M1: the Worker bundles the protocol package
    suites: ['apps/desk-hub/test/support/local.ts', 'apps/desk-hub/test/support/hub.ts', 'apps/desk-hub/test/fake-machine/command.test.ts', 'apps/desk-hub/test/stream-close.test.ts'],
  },
  // The service worker's import graph walked through fs.
  { trees: ['apps/desk-web/src/sw/'], suites: ['apps/desk-web/src/sw/sw-imports.test.ts'] },
];

const SCRIPT = /\.[cm]?[jt]sx?$/;
const TEST = /\.test(?:-d)?\.[cm]?[jt]sx?$/;
// The source and test trees: the root's and each desk app's, whose suites are projects of the same vitest run.
const TREES = /^(?:src|test|apps\/[^/]+\/(?:src|test))\//;
// Test support: setup and global-setup files, the config's own helpers, scripts the suites spawn. Its test files are
// suites like any other.
const SUPPORT = /^(?:test|apps\/[^/]+\/test)\/(?:.+\/)?support\//;
const CONFIG = /(?:^|\/)(?:vitest|vite|electron\.vite)\.(?:config|workspace)\.[^/]+$/;
const under = (path, prefixes) => prefixes.some((prefix) => (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix));
const unread = (path) => under(path, UNREAD) && !under(path, READ_AS_DATA);

// Why one changed path sends the run to the full suite, or null. `status` is git's (A, M, T, D, R<score>); `path` is the
// path in the tested commit, or the deleted path; `from` is a rename's old path.
function fallback({ status, path, from }) {
  const paths = (from === undefined ? [path] : [from, path]).filter((p) => !unread(p));
  for (const p of paths) {
    if (p === 'pnpm-lock.yaml' || p === 'package.json' || p.endsWith('/package.json')) return `the lockfile or a package.json (${p})`;
    if (CONFIG.test(p)) return `a vitest or vite config (${p})`;
    if (SUPPORT.test(p) && !TEST.test(p)) return `test support (${p})`;
    if (p.startsWith('.github/') || p.startsWith('scripts/')) return `a gate file (${p})`;
    if (under(p, READ_AS_DATA)) return `read through fs, a glob or a query import (${p})`;
    if (!TREES.test(p)) return `outside the source and test trees (${p})`;
  }
  if (status === 'D' && !TEST.test(path)) return `a deleted non-test file (${path})`;
  if (status.startsWith('R') && !TEST.test(from)) return `a renamed non-test file (${from} → ${path})`;
  for (const p of paths) if (!SCRIPT.test(p) || under(p, READ_AS_DATA)) return `read through fs, a glob or a query import (${p})`;
  if (!/^(?:[AMTD]|R\d*)$/.test(status)) return `a change git calls ${status} (${path})`;
  return null;
}

// The pushed commit's message → { paths, related } (vitest related over `related`) or { paths, reason } (the full
// suite), `paths` being the change's path count, null when the message does not say.
export function affected(message) {
  const lines = message.split('\n');
  const countLine = lines.findLast((line) => /^affected-count:/i.test(line));
  const count = countLine === undefined ? null : Number(countLine.slice('affected-count:'.length).trim());
  if (count === null || !Number.isInteger(count) || count < 0) return { paths: null, reason: 'no Affected-Count: trailer' };
  const changes = lines
    .filter((line) => /^affected:/i.test(line))
    .map((line) => {
      const [status, path, to] = line.slice('affected:'.length).trimStart().split('\t');
      return /^[RC]/.test(status) ? { status, path: to, from: path } : { status, path };
    });
  if (count > 0 && changes.length === 0) return { paths: count, reason: `too many paths (${count})` };
  if (changes.length !== count || changes.some(({ status, path, from }) => !status || !path || (/^[RC]/.test(status) && !from))) {
    return { paths: count, reason: `the path list is incomplete (${changes.length} of ${count} read)` };
  }
  // A rename across docs/'s border keeps both paths, so the other one decides.
  const counted = changes.filter(({ path, from }) => !(unread(path) && (from === undefined || unread(from))));
  for (const change of counted) {
    const reason = fallback(change);
    if (reason) return { paths: count, reason };
  }
  const touched = counted.flatMap(({ path, from }) => (from === undefined ? [path] : [from, path]));
  const existing = counted.filter(({ status }) => status !== 'D').map(({ path }) => path);
  const readers = SOURCE_READERS.filter(({ trees }) => touched.some((path) => under(path, trees))).flatMap(({ suites }) => suites);
  return { paths: count, related: [...new Set([...existing, ...readers])] };
}
