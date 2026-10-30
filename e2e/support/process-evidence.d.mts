import type { ChildProcess } from 'node:child_process';

export function captureAllowed(options: {
  file: string;
  env: Record<string, string | undefined>;
  userData?: string;
  syntheticEngineBin?: string;
  realEngine?: boolean;
  ownerConfigHome?: boolean;
}): boolean;
// `daemon` (P5 O3-D M2): a mawsd directory whose own log is published beside the engine host's; `host` false (P5 O3-D
// M6): mawsd's log alone, the host's being a launch's own evidence
export function processEvidence(outputDir: string, userData: string, canKeep?: () => boolean, env?: Record<string, string | undefined>, options?: { daemon?: string | null; host?: boolean }): {
  capture(child: ChildProcess): void;
  finish(): void;
};
interface Call {
  name: string;
  requestSeq: number;
  startedAt: string;
  toolUseId: string | null;
}
export function writeTimingEvidence(file: string, spans: readonly (Call & {
  responseSeq: number;
  answeredAt: string;
  ms: number;
})[], unanswered: readonly Call[], loadavg: readonly number[]): void;
