// UC-7 in the window (the UX wave, U9, M4; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, A13's second
// sentence and M4's "The coverage test's rule"): every renderer source that issues a command still declared unavailable
// on another machine (`REMOTE_UNAVAILABLE`, src/shared/ipc/remote-unavailable.ts) reads the one helper that greys its
// control (src/renderer/src/lane-b/remote-unavailable.ts), or is named in `GUARDED_ELSEWHERE` below with the guard it
// relies on, as `ANSWERED_IN_MAIN` is a declaration test/lane-b/offer-coverage.test.ts reads. A module that names a
// declared command is taken to issue it: a command's name in a string literal outside comments, its input's type
// included. An entry the code no longer needs fails too, so the list stays the code's.
//
// `reported`: a module this list cannot honestly excuse. It issues the command for a session on another machine with no
// guard; M4's executor reported each to the file's owner rather than fixing it, and its entry goes when that is fixed.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';

const ROOT = resolve(__dirname, '../..');
const RENDERER = join(ROOT, 'src/renderer/src');
const HELPER = 'lane-b/remote-unavailable.ts';

type Entry = { commands: readonly string[]; guard: string } | { commands: readonly string[]; reported: string };

/** Each renderer module that names a declared command without reading the helper, by its path under src/renderer/src. */
const GUARDED_ELSEWHERE: Readonly<Record<string, Entry>> = {
  // the session's start and setup: intents this window created, which another machine is never asked to make
  'artifacts/session-context.ts': { commands: ['session.start'], guard: 'starts an intent this window made through session.create, which no RL2 machine answers (main refuses it not-open)' },
  'gateway/session-start.ts': { commands: ['session.start'], guard: 'only reached from tools/session-info/RouteSwitch.tsx through switch-route.ts, whose controls read the helper for session.stop' },
  'gateway/switch-route.ts': { commands: ['session.stop'], guard: 'only called from tools/session-info/RouteSwitch.tsx, whose buttons read the helper' },
  'sessions/setup-actions.ts': {
    commands: ['session.start', 'session.intent.patch', 'session.intent.release', 'session.intent.resolveWorktree', 'session.intent.discard'],
    guard: 'acts on intents of useSetup, which come from session.create and session.intent.list, both this Mac’s',
  },
  'sessions/remote-spawn.ts': { commands: ['session.intent.discard'], guard: 'discards the New chat tab’s own intent, on this Mac, once the session started on the other machine' },
  'composer/dev/ResumeLauncher.tsx': { commands: ['session.launch'], guard: 'a development tool, drawn only under import.meta.env.DEV (app/Diagnostics.tsx)' },
  // the record's acts, from controls a session on another machine is not offered
  'sessions/record-ops.ts': {
    commands: ['session.delete', 'session.intent.get', 'session.takeOver'],
    guard:
      'delete: its dialog opens from "Delete conversation…", which remoteSessionActions never offers, and from the archived dialog’s Delete…, which reads the helper; intent.get: adoptFork, which a fork on another machine skips (forkThere) and the side thread reaches behind side/comment-form.ts and side/BtwView.tsx; takeOver: see the report on HolderActions',
  },
  'sessions/DeleteDialog.tsx': { commands: ['session.deletions.preview'], guard: 'the delete dialog: opened only as record-ops.ts’ entry says' },
  'sessions/SessionDialogs.tsx': { commands: ['session.deletions.keep'], guard: 'a manifest’s notice; manifests come from session.deletions.list, which this Mac answers' },
  // the composer's extras, behind the composer's own reads of the helper
  'composer/modes/bash.ts': { commands: ['session.bash'], guard: 'only through composer/editor/submit.ts’ dispatchByMode, behind composer/Composer.tsx’s read of the helper (button and Enter)' },
  'composer/modes/memory.ts': { commands: ['session.memoryAppend'], guard: 'as composer/modes/bash.ts' },
  'composer/frame/bindings.ts': { commands: ['session.applyFlagSettings'], guard: 'liveBindings serve this Mac’s sessions; a session on another machine takes remoteBindings or lane A’s controls, which refuse the added directories (session/controls/lane-b.ts, lane-a.ts)' },
  'widgets/SkillsWidget.tsx': { commands: ['session.reloadSkills'], guard: 'through widgets/operation.ts’ useOperation, which reads the helper and greys the control' },
  'widgets/plugins/reload.tsx': { commands: ['session.reloadSkills'], guard: 'through widgets/operation.ts’ useOperation, which reads the helper; its controls take that answer' },
  'side/actions.ts': { commands: ['side.thread.open', 'side.sendToMain'], guard: 'called only behind side/comment-form.ts’ canSend and side/BtwView.tsx’s canPromote, which read the helper' },
  // what acts on this window, branched before the command
  'session/visibility.ts': { commands: ['session.setVisible'], guard: 'a lane B session on another machine goes to showRemote; only ids with a record are sent, and a terminal session there has none' },
  'lane-b/open-copy.ts': { commands: ['files.openExternal'], guard: 'branches on isRemoteLaneB to a copy opened here' },
  'tools/maws/actions.ts': { commands: ['files.reveal'], guard: 'its one caller, transcript/view/rows/Delivery.tsx, disables Reveal by useElsewhereMachine for a session on another machine' },
  'stores/replay-diagnostics.ts': { commands: ['session.replay.control'], guard: 'replays this Mac starts (machine: the local one) and its own progress events' },
  'budget/BudgetSheets.tsx': { commands: ['session.stop'], guard: 'its sheet lists this Mac’s engine host’s blocked sessions (engine.budget crosses no link)' },
  'engine-surface/actions.ts': {
    commands: ['session.ui.press', 'session.ui.input', 'session.ui.select', 'session.ui.focus', 'session.ui.scroll'],
    guard: 'a mod’s drawn tree acts; engine-surface/registry.ts reads the helper and draws no tree for a session on another machine',
  },
  'app/supervisor-notices.ts': { commands: ['session.start', 'session.takeOver', 'session.launch'], guard: 'names commands to recognise their refusals; issues none' },
  // reported: issued for a session on another machine with no guard
  'engine-surface/asks.ts': { commands: ['session.ui.answer'], reported: 'an automatic answer to a mod’s ask, with no control, sent for every session’s plugin.ask, another machine’s included (engine-surface/)' },
  'owner/report/answering.ts': {
    commands: ['ownerChannel.answered', 'ownerChannel.markRead', 'ownerChannel.cancel'],
    reported: 'request-card/RequestCard.tsx’s MarkRead marks an essential item read with no guard, an item of another machine’s attention feed included (request-card/, owner/report/)',
  },
  'stores/owner-channel.ts': { commands: ['ownerChannel.state'], reported: 'read at mount by transcript/view/TranscriptSlot.tsx for a lane B session on another machine (stores/, transcript/view/)' },
  'composer/editor/submit.ts': {
    commands: ['session.history.append'],
    reported: 'appendHistory returns early on isRemoteLaneB alone, so a terminal session on an RL2 machine appends (composer/editor/; isOverRl2 or the helper would close it)',
  },
  'widgets/model.ts': {
    commands: ['session.applyFlagSettings'],
    reported: '`/fast off` (widgets/typed.ts’ applyFast) issues it with no guard for a ready session on another machine; ModelSelector.tsx greys its own control (widgets/)',
  },
};

/** The string literals of a TypeScript source outside its comments (a template literal is skipped whole). */
function literalsOf(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      i = source.indexOf('\n', i);
      if (i === -1) break;
    } else if (c === '/' && next === '*') {
      i = source.indexOf('*/', i + 2);
      if (i === -1) break;
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      let text = '';
      while (j < source.length && source[j] !== c) {
        if (source[j] === '\\') j += 1;
        else text += source[j];
        j += 1;
      }
      if (c !== '`') out.push(text);
      i = j + 1;
    } else i += 1;
  }
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

const DECLARED = new Set(Object.keys(REMOTE_UNAVAILABLE));
const readsHelper = (path: string, source: string) =>
  /from '[^']*lane-b\/remote-unavailable'/.test(source) || (path.startsWith('lane-b/') && /from '\.\/remote-unavailable'/.test(source));

type Module = { path: string; source: string; named: string[] };
const moduleOf = (path: string, source: string): Module => ({ path, source, named: [...new Set(literalsOf(source).filter((text) => DECLARED.has(text)))].sort() });
const modules = sources(RENDERER).map((file) => moduleOf(relative(RENDERER, file), readFileSync(file, 'utf8')));

/** Each module that names a declared command without reading the helper or an entry that covers it, as a sentence. */
function unguardedIn(list: readonly Module[], declared: Readonly<Record<string, Entry>>): string[] {
  return list.flatMap(({ path, source, named }) => {
    if (named.length === 0 || path === HELPER || readsHelper(path, source)) return [];
    const entry = declared[path];
    const missing = named.filter((command) => !entry?.commands.includes(command));
    return missing.length === 0 ? [] : [`${path}: issues ${missing.join(', ')} without the helper (lane-b/remote-unavailable.ts) or an entry in GUARDED_ELSEWHERE`];
  });
}

describe('every renderer module that issues a declared command', () => {
  it('reads the window’s helper, or is declared with the guard it relies on', () => {
    expect(unguardedIn(modules, GUARDED_ELSEWHERE)).toEqual([]);
  });

  it('declares nothing the code no longer needs', () => {
    const byPath = new Map(modules.map((m) => [m.path, m]));
    const stale = Object.entries(GUARDED_ELSEWHERE).flatMap(([path, entry]) => {
      const held = byPath.get(path);
      if (held === undefined) return [`${path}: no such module`];
      if (readsHelper(path, held.source)) return [`${path}: reads the helper now; its entry goes`];
      const gone = entry.commands.filter((command) => !held.named.includes(command));
      return gone.length === 0 ? [] : [`${path}: no longer names ${gone.join(', ')}`];
    });
    expect(stale).toEqual([]);
  });
});

describe('the window’s helper', () => {
  // M1's bridge (Decision Log 2026-11-13, "M1's bridge in the window's helper, a seam M4 removes") is gone: the acts M1
  // and M2 offer are read from the offers
  it('holds no list of its own for the offered acts', () => {
    const helper = modules.find((m) => m.path === HELPER)!;
    expect(helper.source).not.toMatch(/ACTS_UNTIL_M4/);
    expect(helper.source).toMatch(/disabledWords\(/);
  });
});

// Review (M4): the rule holds a module to the helper in every form a command or an import is written, so a fixture in each
// form the rule once missed is rejected, and only a real import of the helper exempts a module
describe('the rule itself', () => {
  const FIXTURE = 'sessions/fixture.ts';
  const rejects = (source: string, path = FIXTURE) => expect(unguardedIn([moduleOf(path, source)], {})).toEqual([`${path}: issues session.stop without the helper (lane-b/remote-unavailable.ts) or an entry in GUARDED_ELSEWHERE`]);
  const accepts = (source: string, path = FIXTURE) => expect(unguardedIn([moduleOf(path, source)], {})).toEqual([]);

  it('rejects a command named in a quoted string or a template literal', () => {
    rejects("void ipc.invoke('session.stop', { appSessionId });");
    rejects('void ipc.invoke("session.stop", { appSessionId });');
    rejects('void ipc.invoke(`session.stop`, { appSessionId });');
    rejects('void ipc.invoke(`session.stop`, { appSessionId, note: `${why}` });');
  });

  it('takes no command named only in a comment', () => {
    accepts("// void ipc.invoke('session.stop')\n/* ipc.invoke(`session.stop`) */\nexport const x = 1;");
  });

  it('rejects a module whose helper import is commented out or brings types alone', () => {
    rejects("// import { useRemoteUnavailable } from '../lane-b/remote-unavailable';\nvoid ipc.invoke('session.stop', {});");
    rejects("/* import { useRemoteUnavailable } from '../lane-b/remote-unavailable'; */\nvoid ipc.invoke('session.stop', {});");
    rejects("const note = \"import { useRemoteUnavailable } from '../lane-b/remote-unavailable'\";\nvoid ipc.invoke('session.stop', {});");
    rejects("import type { RemoteStanding } from '../lane-b/remote-unavailable';\nvoid ipc.invoke('session.stop', {});");
  });

  it('rejects an import of another module of the same name', () => {
    rejects("import { useRemoteUnavailable } from './remote-unavailable';\nvoid ipc.invoke('session.stop', {});");
  });

  it('accepts a module that imports the helper', () => {
    accepts("import { useRemoteUnavailable } from '../lane-b/remote-unavailable';\nvoid ipc.invoke('session.stop', {});");
    accepts("import { useRemoteUnavailable } from './remote-unavailable';\nvoid ipc.invoke('session.stop', {});", 'lane-b/fixture.ts');
    accepts("import {\n  useRemoteUnavailable,\n} from '../../lane-b/remote-unavailable';\nvoid ipc.invoke('session.stop', {});", 'tools/maws/fixture.ts');
  });
});
