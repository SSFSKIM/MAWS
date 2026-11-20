// The harness's printed and stored records name no path of this machine (UX wave U6b-5b M1, the review's ninth
// finding): a Preferences key holds the page's whole file URL, and a launch's output can hold the checkout's path.
//   node --test spikes/zoom-probe/scrub.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathsIn, scrubber } from './scrub.mjs';

const harness = join(homedir(), 'a checkout', 'spikes', 'zoom-probe'); // a space, as a checkout's path may hold
const page = pathToFileURL(join(harness, 'page', 'index.html')).href;

test('a Preferences key holding the page\'s file URL, and a bare path, are named by their placeholder', () => {
  const scrub = scrubber({ '<harness>': harness });
  const line = JSON.stringify({ key: 'partition.per_host_zoom_levels', value: { '123': { [page]: 2.2239 } }, log: `${harness}/runs/x.log` });
  const clean = scrub(line);
  assert.equal(clean.includes('<harness>/page/index.html'), true);
  assert.deepEqual(pathsIn(clean, [harness, homedir()]), []);
  assert.deepEqual(pathsIn(line, [harness, homedir()]), [harness, homedir()]); // the control: the same check finds both before
});

test('a path under the home folder that no placeholder names is still found', () => {
  const scrub = scrubber({ '<harness>': harness });
  const elsewhere = `RECORD x ${join(homedir(), 'another folder', 'profile')}`;
  assert.deepEqual(pathsIn(scrub(elsewhere), [homedir()]), [homedir()]);
});
