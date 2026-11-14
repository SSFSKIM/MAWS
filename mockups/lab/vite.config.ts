import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The experiment list is read from the folders under src/experiments, so adding an experiment touches no shared
// file. ONLY=<id>[,<id>] builds just those, which keeps one experiment's half-written code out of another's build.
function experiments(): Plugin {
  const id = 'virtual:experiments';
  return {
    name: 'lab-experiments',
    resolveId: (source) => (source === id ? '\0' + id : null),
    load(resolved) {
      if (resolved !== '\0' + id) return null;
      const root = resolve(__dirname, 'src/experiments');
      const only = (process.env.ONLY ?? '').split(',').filter(Boolean);
      const dirs = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(resolve(root, d.name, 'meta.ts')))
        .map((d) => d.name)
        .filter((name) => only.length === 0 || only.includes(name))
        .sort();
      const imports = dirs.map((d, i) => `import { experiment as e${i} } from '/src/experiments/${d}/meta.ts';`);
      return `${imports.join('\n')}\nexport const all = [${dirs.map((_, i) => `e${i}`).join(', ')}];\n`;
    },
  };
}

// `pnpm build` writes one self-contained index.html, so the lab opens by double-click (file://) with no server.
export default defineConfig({
  plugins: [experiments(), react(), viteSingleFile()],
  build: { target: 'esnext', chunkSizeWarningLimit: 8000, outDir: process.env.OUT ?? 'dist' },
});
