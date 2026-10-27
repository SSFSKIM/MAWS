// OX9's declaration, checked against the registry (P5 O1 M4; docs/doperpowers/plans/2026-10-27-p5-o1-seams.md, M4).
// The typecheck refuses a namespace or a mixed namespace's command with no grade; this file checks what the types
// cannot: that every grade is one of the vocabulary's, that the structural check names what is missing, and that the
// two routing classes hold exactly the commands M4's rubric gives them.
import { describe, expect, it } from 'vitest';
import { MAIN_ONLY_COMMANDS, NAMES } from './names';
import { commands } from './schema';
import {
  gradeOf, MACHINE_GRADES, missingGrades, NAMESPACE_GRADES, ROUTING_CLASSES, SESSION_RANKS,
  type Grade, type GradeSpec,
} from './grades';

const VOCABULARY: ReadonlySet<string> = new Set<string>([...SESSION_RANKS, ...MACHINE_GRADES, ...ROUTING_CLASSES]);
const names = Object.keys(commands);
const resolved = names.map((name) => [name, gradeOf(name)] as const);
const graded = (grade: Grade) => resolved.filter(([, spec]) => spec === grade).map(([name]) => name).sort();
const byEffect = resolved.filter((entry): entry is readonly [string, Extract<GradeSpec, object>] => typeof entry[1] === 'object');

describe('the vocabulary', () => {
  it('has three disjoint kinds, the session ranks in RL §5.5 order', () => {
    expect(SESSION_RANKS).toEqual(['list', 'view', 'converse', 'approve', 'manage']);
    expect(MACHINE_GRADES).toEqual(['spawn', 'shell', 'machine-admin']);
    expect(ROUTING_CLASSES).toEqual(['client', 'internal']);
    expect(VOCABULARY.size).toBe(SESSION_RANKS.length + MACHINE_GRADES.length + ROUTING_CLASSES.length);
  });
});

describe('every command of the registry', () => {
  it('resolves to a grade of the vocabulary', () => {
    for (const [name, spec] of resolved) {
      expect(spec, name).toBeDefined();
      expect(VOCABULARY.has(typeof spec === 'string' ? spec : spec!.floor), name).toBe(true);
    }
    expect(missingGrades(commands)).toEqual([]);
  });

  it('declares no grade for a namespace or command the registry lacks', () => {
    for (const [namespace, declared] of Object.entries(NAMESPACE_GRADES)) {
      expect(Object.hasOwn(NAMES, namespace), namespace).toBe(true);
      if (typeof declared === 'string' || 'byEffect' in declared) continue;
      for (const name of Object.keys(declared)) expect(Object.hasOwn(commands, name), name).toBe(true);
    }
  });

  it('names a floor of the vocabulary for every command graded by effect', () => {
    expect(byEffect.length).toBeGreaterThan(0);
    for (const [name, spec] of byEffect) {
      expect(spec.byEffect, name).toBe(true);
      expect(VOCABULARY.has(spec.floor), name).toBe(true);
    }
    // M4's two named cases: a question takes converse and a permission approve; a slash command is graded by its effect
    expect(gradeOf('session.answer')).toEqual({ floor: 'converse', byEffect: true });
    expect(gradeOf('session.send')).toEqual({ floor: 'converse', byEffect: true });
    // indirect paths into the input (RL §5.5): promoting or unpausing the queue releases queued text, a slash command
    // included
    expect(gradeOf('session.queue.promote')).toEqual({ floor: 'converse', byEffect: true });
    expect(gradeOf('session.queue.setPaused')).toEqual({ floor: 'converse', byEffect: true });
    // a plugin callback the caller names may execute or manage
    // and a keyed prompt edit is forwarded with what it triggers unknown
    for (const name of ['session.ui.press', 'session.ui.input', 'session.ui.select', 'session.ui.promptEdit']) {
      expect(gradeOf(name), name).toEqual({ floor: 'converse', byEffect: true });
    }
  });

  it("grades a cross-session read by the content it answers, the endpoint keeping the caller's sessions", () => {
    // engine.sessions answers every live session's full status (its pending plan, its background tasks' descriptions)
    for (const name of ['engine.sessions', 'session.search', 'attention.list']) expect(gradeOf(name), name).toBe('view');
  });
});

describe('the routing classes', () => {
  it('give internal to exactly the main-only commands', () => {
    expect(graded('internal')).toEqual([...MAIN_ONLY_COMMANDS].sort());
  });

  it("give client to exactly the commands that stay with the client (survey §2), as M4's rubric lists them", () => {
    const whole = (namespace: 'layout' | 'voice' | 'browser') => NAMES[namespace].commands;
    expect(graded('client')).toEqual([
      ...whole('layout'), ...whole('voice'), ...whole('browser'),
      'attention.viewing', 'attention.pendingNavigate', 'host.status', 'host.restart', 'host.openLog',
      'presentations.present', 'artifacts.downloadAsset', 'library.saveAs', 'pty.openLink', 'pty.hostState',
      // the rubric's row leaves it out; survey §2 keeps it with the client, as pty.hostState (the report's decisions)
      'engine.hostState',
    ].sort());
  });
});

describe('gradeOf', () => {
  it('answers nothing for a name outside every declared namespace', () => {
    for (const name of ['probe.echo', 'constructor', 'toString.call', '__proto__.x', 'session', '.status', '']) {
      expect(gradeOf(name), name).toBeUndefined();
    }
  });

  it("answers nothing for a command a mixed namespace's map lacks", () => {
    expect(gradeOf('session.notYetGraded')).toBeUndefined();
    expect(gradeOf('session.constructor')).toBeUndefined();
  });

  it("answers a uniform namespace's grade for any of its names", () => {
    expect(gradeOf('settings.notYetRegistered')).toBe('machine-admin');
  });
});

describe('missingGrades', () => {
  it('names an undeclared namespace once, and an ungraded command of a mixed namespace', () => {
    const fixture = {
      ...commands,
      'probe.echo': {}, 'probe.hold': {},
      'session.notYetGraded': {},
      'settings.notYetRegistered': {}, // a uniform namespace's new command inherits its grade
      constructor: {},
    };
    expect(missingGrades(fixture)).toEqual(['constructor', 'probe', 'session.notYetGraded']);
  });

  it('answers nothing for an empty map', () => {
    expect(missingGrades({})).toEqual([]);
  });
});
