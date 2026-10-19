// The React Compiler as the shipped renderer build runs it (electron.vite.config.ts: @vitejs/plugin-react with
// babel-plugin-react-compiler and no options). The compiler skips a function it refuses without failing the build, so a
// component can ship uncompiled unnoticed; each file listed here compiles every component and hook it holds (L255).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { LoggerEvent } from 'babel-plugin-react-compiler';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
// babel as the build loads it, through @vitejs/plugin-react
const babel = createRequire(createRequire(__filename).resolve('@vitejs/plugin-react'))('@babel/core') as typeof import('@babel/core');

/** Each file, and the components it must compile (besides its other functions refusing none). */
const FILES: Record<string, string[]> = {
  'src/artifacts/slides/editor/present/Presentation.tsx': ['Presentation'],
  'src/renderer/src/tools/presentation/DeckBody.tsx': ['DeckBody'],
};

/** The compiler's events for one file, compiled as plugin-react's transform does (its parser plugins for a .tsx). */
async function compile(file: string): Promise<LoggerEvent[]> {
  const events: LoggerEvent[] = [];
  const path = resolve(ROOT, file);
  await babel.transformAsync(readFileSync(path, 'utf8'), {
    babelrc: false,
    configFile: false,
    root: ROOT,
    filename: path,
    parserOpts: { sourceType: 'module', allowAwaitOutsideFunction: true, plugins: ['jsx', 'typescript'] },
    // the logger only reports; it changes nothing the compiler does
    plugins: [['babel-plugin-react-compiler', { logger: { logEvent: (_: string | null, event: LoggerEvent) => events.push(event) } }]],
  });
  return events;
}

const describeEvent = (event: LoggerEvent) => {
  const line = 'fnLoc' in event ? event.fnLoc?.start.line : undefined;
  const reason = event.kind === 'CompileError' ? event.detail.reason : event.kind === 'CompileSkip' ? event.reason : event.kind === 'PipelineError' ? event.data : '';
  return `${event.kind} at line ${line ?? '?'}: ${reason}`;
};

describe('the React Compiler compiles the renderer files listed', () => {
  for (const [file, components] of Object.entries(FILES))
    it(file, async () => {
      const events = await compile(file);
      expect(events.filter((event) => event.kind !== 'CompileSuccess').map(describeEvent)).toEqual([]);
      const compiled = events.flatMap((event) => (event.kind === 'CompileSuccess' && event.fnName ? [event.fnName] : []));
      expect(compiled).toEqual(expect.arrayContaining(components));
    });
});
