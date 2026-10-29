import type { ChildProcess } from 'node:child_process';

export function captureAllowed(options: {
  file: string;
  env: Record<string, string | undefined>;
  userData?: string;
  syntheticEngineBin?: string;
  realEngine?: boolean;
  ownerConfigHome?: boolean;
}): boolean;
export function processEvidence(outputDir: string, userData: string, canKeep?: () => boolean): {
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
