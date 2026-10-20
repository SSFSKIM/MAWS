// The page's entry: versions, then the DOM, React and editor suites in turn, one report to main.
import { version as reactVersion } from 'react';
import { domSuite } from './dom';
import { editorSuite } from './editor';
import { reactSuite } from './react';
import { errText, harness, rafStats } from './util';

async function main() {
  await harness.focusContents();
  const result: Record<string, unknown> = {
    renderer: { versions: harness.versions, userAgent: navigator.userAgent, react: reactVersion, documentHasFocus: document.hasFocus(), visibilityState: document.visibilityState },
  };
  for (const [name, suite] of [
    ['dom', domSuite],
    ['react', reactSuite],
    ['editor', editorSuite],
  ] as const) {
    try {
      result[name] = await suite();
    } catch (e) {
      result[name] = { error: errText(e), stack: (e as Error).stack };
    }
  }
  result.frames = rafStats();
  await harness.report(result);
}
void main();
