// `mawsd`'s trash (P5 O3-D M5; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D10): the spine's `SpineDeps.trash`,
// what the session service's Delete moves a session's files with once the spine runs here, where no Electron `shell`
// exists. It moves the path into the user's trash directory itself: `~/.Trash` on macOS, the freedesktop.org home trash
// on Linux (`$XDG_DATA_HOME/Trash`, `~/.local/share/Trash` by default: the item under `files/`, a `.trashinfo` under
// `info/` naming its original path and the deletion date, written first so the name is reserved). A rename, or across
// devices (EXDEV) a copy then an unlink. Finder's Put Back is not recorded (D10, a taste call the architect may revisit).
//
// Never over a name the trash already holds: a taken name becomes `<stem> <hh.mm.ss><ext>`, then with a count; when the
// trash cannot be read (macOS's privacy protection may refuse a look inside `~/.Trash`), a random suffix is used instead
// of a guess. The chosen name is claimed before the move, by an exclusive create of an empty item of the source's kind
// that the rename then replaces, so two moves of one name at once never land on one item: the second finds it taken and
// chooses again. The root applies the e2e seam (`trashFor`, MAWS_E2E_TRASH_DIR) around this, as it does around main's.
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, rename as fsRename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

export interface TrashOptions {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
  rename?: (from: string, to: string) => Promise<void>; // a test's EXDEV
}

export async function trashPath(path: string, options: TrashOptions): Promise<void> {
  const source = resolve(path);
  const directory = (await lstat(source)).isDirectory(); // a path that is not there is refused before the trash is touched
  const now = options.now?.() ?? new Date();
  // true: `to` is this move's, an empty file or directory the move replaces; false: the name is taken
  const claim = async (to: string): Promise<boolean> => {
    try {
      await (directory ? mkdir(to, { mode: 0o700 }) : writeFile(to, '', { flag: 'wx', mode: 0o600 }));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  };
  // onto the claimed `to`: a rename replaces it; across devices the copy fills it (it holds nothing but the claim)
  const move = async (to: string) => {
    try {
      await (options.rename ?? fsRename)(source, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        await (directory ? rmdir(to) : unlink(to)).catch(() => {});
        throw error;
      }
      await cp(source, to, { recursive: true, force: true, verbatimSymlinks: true });
      await rm(source, { recursive: true, force: true });
    }
  };

  if (options.platform === 'darwin') {
    const dir = join(options.home, '.Trash');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    for (;;) {
      const to = join(dir, await freeName(basename(source), now, (name) => present(join(dir, name))));
      if (await claim(to)) return move(to);
    }
  }
  if (options.platform === 'linux') {
    const trash = join(options.env.XDG_DATA_HOME || join(options.home, '.local', 'share'), 'Trash');
    const files = join(trash, 'files');
    const info = join(trash, 'info');
    await mkdir(files, { recursive: true, mode: 0o700 });
    await mkdir(info, { recursive: true, mode: 0o700 });
    const record = `[Trash Info]\nPath=${source.split('/').map(encodeURIComponent).join('/')}\nDeletionDate=${localStamp(now)}\n`;
    for (;;) {
      const name = await freeName(basename(source), now, async (candidate) => {
        const [file, entry] = await Promise.all([present(join(files, candidate)), present(join(info, `${candidate}.trashinfo`))]);
        return file === null || entry === null ? null : file || entry;
      });
      const infoPath = join(info, `${name}.trashinfo`);
      try {
        await writeFile(infoPath, record, { flag: 'wx', mode: 0o600 }); // the name's reservation
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; // taken meanwhile: the next name
        throw error;
      }
      try {
        if (!(await claim(join(files, name)))) {
          await unlink(infoPath); // an item without a .trashinfo holds the name: the next one
          continue;
        }
        return await move(join(files, name));
      } catch (error) {
        await unlink(infoPath).catch(() => {});
        throw error;
      }
    }
  }
  throw new Error(`mawsd knows no trash on ${options.platform}: ${source} kept`);
}

// true: taken; false: free; null: the trash could not be read there
async function present(path: string): Promise<boolean | null> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : null;
  }
}

async function freeName(name: string, now: Date, taken: (name: string) => Promise<boolean | null>): Promise<string> {
  const ext = extname(name);
  const stem = ext === '' ? name : name.slice(0, -ext.length);
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join('.');
  const candidates = [name, `${stem} ${time}${ext}`];
  for (let n = 2; n <= 100; n += 1) candidates.push(`${stem} ${time} ${n}${ext}`);
  for (const candidate of candidates) {
    const found = await taken(candidate);
    if (found === false) return candidate;
    if (found === null) break; // unreadable: no guess
  }
  return `${stem} ${time} ${randomUUID().slice(0, 8)}${ext}`;
}

function localStamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
