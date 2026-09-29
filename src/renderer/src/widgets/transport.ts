// A control's transport branch in words (C11 execution document, Interfaces "Transport and timeout errors are the separate
// branch"): a rejected invoke infers nothing; the control keeps the value the engine last reported and says why. Kept
// free of renderer imports so C7's mode menu can word its own rejected invoke the same way without an import cycle.
import type { IpcError } from '@shared/ipc/schema';

export const NO_ANSWER = 'The engine did not answer';
export const LAST_VALUE = 'showing the last value it reported';

export const transportWords = (error: IpcError): string => `${error.code === 'timeout' ? NO_ANSWER : error.message} · ${LAST_VALUE}`;
