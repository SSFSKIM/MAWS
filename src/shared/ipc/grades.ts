// OX9: the grade a remote caller needs to use each registered command (P5 §Cross-child contracts; P5 O1 M4,
// docs/doperpowers/plans/2026-10-27-p5-o1-seams.md). Declared only: O10's endpoint enforces it, and refuses a command
// `gradeOf` answers nothing for (default deny). Zod-free, beside `./names.ts`; each namespace's grades live in
// `./grades/<namespace>.ts`.
//
// Three kinds, never ranked against each other (P5 Decision Log 20). Only the session ranks are ordered; the types keep
// the kinds apart, so `SESSION_RANKS.indexOf` takes a `SessionRank` alone, and a command graded by a machine grade or a
// routing class can never be satisfied by a rank. O1 compares no grades; O10 defines the comparison.
import type { NAMES, Namespace } from './names';
import { grades as artifacts } from './grades/artifacts';
import { grades as attention } from './grades/attention';
import { grades as browser } from './grades/browser';
import { grades as catalog } from './grades/catalog';
import { grades as connectors } from './grades/connectors';
import { grades as customization } from './grades/customization';
import { grades as delivery } from './grades/delivery';
import { grades as designSystems } from './grades/design-systems';
import { grades as engine } from './grades/engine';
import { grades as files } from './grades/files';
import { grades as fs } from './grades/fs';
import { grades as git } from './grades/git';
import { grades as host } from './grades/host';
import { grades as layout } from './grades/layout';
import { grades as library } from './grades/library';
import { grades as marketplaces } from './grades/marketplaces';
import { grades as maws } from './grades/maws';
import { grades as mods } from './grades/mods';
import { grades as ownerChannel } from './grades/owner-channel';
import { grades as plugins } from './grades/plugins';
import { grades as presentations } from './grades/presentations';
import { grades as pty } from './grades/pty';
import { grades as scm } from './grades/scm';
import { grades as session } from './grades/session';
import { grades as settings } from './grades/settings';
import { grades as side } from './grades/side';
import { grades as spaces } from './grades/spaces';
import { grades as voice } from './grades/voice';

export const SESSION_RANKS = ['list', 'view', 'converse', 'approve', 'manage'] as const; // RL §5.5's order: each includes the ones before it
export const MACHINE_GRADES = ['spawn', 'shell', 'machine-admin'] as const;           // per machine, outside the session order
export const ROUTING_CLASSES = ['client', 'internal'] as const;                        // held by no caller; the endpoint refuses both
export type SessionRank = (typeof SESSION_RANKS)[number];
export type MachineGrade = (typeof MACHINE_GRADES)[number];
export type RoutingClass = (typeof ROUTING_CLASSES)[number];
export type Grade = SessionRank | MachineGrade | RoutingClass;
// A command whose grade depends on its input: at least `floor`, refined by the endpoint, which refuses one it has no
// rule for.
export type GradeSpec = Grade | { readonly floor: Grade; readonly byEffect: true };

type NamesOf<N extends Namespace> = (typeof NAMES)[N];
// The namespace's bridged and main-only commands: every key of its registry module.
export type CommandsOf<N extends Namespace> =
  | NamesOf<N>['commands'][number]
  | (NamesOf<N> extends { readonly mainOnlyCommands: readonly (infer M extends string)[] } ? M : never);
// A mixed namespace's complete map, which a `./grades/<namespace>.ts` module satisfies: a new command fails the typecheck
// until it is graded. A uniform namespace declares one `GradeSpec`, which a new command inherits.
export type CommandGrades<N extends Namespace> = { readonly [K in CommandsOf<N>]: GradeSpec };
export type NamespaceGrades<C extends string> = GradeSpec | { readonly [K in C]: GradeSpec };

// One entry per namespace; `satisfies` refuses a missing namespace.
export const NAMESPACE_GRADES = {
  session, engine, fs, git, pty, layout, attention, settings, files, plugins, marketplaces, voice, maws, scm, side, host,
  browser, mods, ownerChannel, artifacts, spaces, library, designSystems, presentations, connectors, delivery,
  customization, catalog,
} as const satisfies { readonly [N in Namespace]: NamespaceGrades<CommandsOf<N>> };

const isSpec = (declared: NamespaceGrades<string>): declared is GradeSpec =>
  typeof declared === 'string' || (declared as { byEffect?: unknown }).byEffect === true;

// A command's namespace is the name before its first dot; a name with none has no namespace.
const namespaceOf = (name: string): string | null => {
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(0, dot) : null;
};

const declaredFor = (name: string): NamespaceGrades<string> | undefined => {
  const namespace = namespaceOf(name);
  return namespace !== null && Object.hasOwn(NAMESPACE_GRADES, namespace) ? NAMESPACE_GRADES[namespace as Namespace] : undefined;
};

// Structural: a declared namespace's grade for `name`, whether or not the registry holds it; that the name is registered
// is the registry's check.
export function gradeOf(name: string): GradeSpec | undefined {
  const declared = declaredFor(name);
  if (declared === undefined) return undefined;
  if (isSpec(declared)) return declared;
  return Object.hasOwn(declared, name) ? (declared as Readonly<Record<string, GradeSpec>>)[name] : undefined;
}

// The namespaces (each once) and the commands of `commands`' keys with no grade, sorted. Structural, so a fixture map
// needs nothing from the registry's types.
export function missingGrades(commands: Readonly<Record<string, unknown>>): string[] {
  const missing = new Set<string>();
  for (const name of Object.keys(commands)) {
    if (gradeOf(name) !== undefined) continue;
    // an undeclared namespace is named once; a mixed namespace's ungraded command, or a name with no namespace, itself
    missing.add(declaredFor(name) === undefined ? (namespaceOf(name) ?? name) : name);
  }
  return [...missing].sort();
}
