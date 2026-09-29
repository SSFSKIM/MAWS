// Types for workloads.mjs, so the `#probe` page (TypeScript) can import the same table run.mjs uses.
export type Phase = 'm1' | 'm2-gate';
export type Tui = 'claude' | 'codex';
export interface ProgramSpec {
  shell: string | null; // null: the login shell
  args: string[] | null; // null: the login shell's default arguments
}
export interface WidthFixture {
  text: string;
  width: number;
  note: string;
}
export interface ProgramWorkload {
  kind: 'program';
  title: string;
  tui?: Tui;
  measure?: 'flood' | 'width' | 'latency' | 'screen';
  program: ProgramSpec | Record<Phase, ProgramSpec>;
  expectedBytes?: Record<Phase, number>;
  expectedOutputBytes?: Record<Phase, number>;
  expectedScreen?: string[];
  spacingMs?: number; // a spaced echo-latency workload, sampled by run.mjs
}
export interface TypedWorkload {
  kind: 'typed';
  title: string;
  command: string;
}
export type Workload = ProgramWorkload | TypedWorkload;
export interface Bins {
  claude: string;
  codex: string;
}
export const CLAUDE_BIN_DEFAULT: string;
export const CODEX_BIN_DEFAULT: string;
export const SCRATCH_CWD: string;
export const WIDTH_FIXTURES: WidthFixture[];
export const AUTOMATED_MEASUREMENTS: string[];
export const GATE_MEASUREMENTS: string[];
export const GATE_CRITERIA: Record<string, { lastLine: (line: string) => boolean; floorMBps: number | null }>;
export const GATE_FRAME_P95_MS: number;
export const GATE_ECHO_P95_MS: number;
export const workloads: Record<string, Workload>;
export function resolveProgram(workload: ProgramWorkload, phase: Phase, bins: Bins): ProgramSpec;
