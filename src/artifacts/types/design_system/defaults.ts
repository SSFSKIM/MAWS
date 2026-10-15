// The built-in design systems (D11 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md; Decision Log 7, "defaults
// are data"): one directory per system under ./defaults/, each a system's files as `artifact_create` takes them
// (`DESIGN.md`, `tokens.tokens.json`, `layouts/*.html`, `components/*`). This module is the one place that enumerates
// them: seeding, the validation tests and the page read `DEFAULT_SYSTEMS`, so a further default is a new directory and
// nothing else. The text files are bundled by Vite's `?raw` import into whichever build imports this module (the host's,
// the renderer's), as `../guides.ts` bundles the guides; a system's binary assets are `./default-assets.ts`'s, loaded
// on demand, so a build that needs only the text carries no font.
const TEXTS = import.meta.glob<string>(['./defaults/*/**/*', '!./defaults/*/assets/**'], { query: '?raw', import: 'default', eager: true });

/** The house system's key (D9's floor and the chain's last link): the one default the code names. */
export const HOUSE_KEY = 'maws';

export interface DefaultSystemSource {
  /** The directory's name; the seeded artifact's `origin.key`. */
  readonly key: string;
  /** The system's name: its law's title (the first line, `# <name>`). */
  readonly name: string;
  /** Every text file by its path inside the directory. Assets (`assets/<name>`) are `loadDefaultAssets`'s. */
  readonly files: Readonly<Record<string, string>>;
}

function collect(): DefaultSystemSource[] {
  const byKey = new Map<string, Record<string, string>>();
  for (const [module, text] of Object.entries(TEXTS)) {
    const [key, ...rest] = module.slice('./defaults/'.length).split('/');
    const files = byKey.get(key!) ?? byKey.set(key!, {}).get(key!)!;
    files[rest.join('/')] = text;
  }
  return [...byKey.keys()].sort().map((key) => {
    const files = byKey.get(key)!;
    const name = /^# (.+)$/m.exec(files['DESIGN.md'] ?? '')?.[1]?.trim() ?? key;
    return { key, name, files };
  });
}

/** The bundled defaults, by key. */
export const DEFAULT_SYSTEMS: readonly DefaultSystemSource[] = collect();

export const defaultSystem = (key: string): DefaultSystemSource | undefined => DEFAULT_SYSTEMS.find((system) => system.key === key);
