// The end-to-end stand-in for the voice helper (E9 execution document, Design §3): chosen at startup under `MAWS_E2E=1`
// with `MAWS_E2E_VOICE` set, so no test ever opens the microphone or raises a consent dialog. The variable is read at
// each `probe` and `start`, so a Playwright spec changes the next answer through `electronApp.evaluate` on main's
// `process.env`. Its value is JSON; every field is optional:
//
//   { "permission": { "microphone": "authorized", "speech": "authorized" }, "startedDelayMs": 0,
//     "partials": ["hello", "hello world"], "partialDelayMs": 40, "final": "Hello world.", "lateAfterFinal": false,
//     "error": null, "helper": "ready" }
//
// A script that names its own `partials` and no `final` settles on its last partial. What main asked is logged on
// `globalThis.__mawsVoiceScript`, which the spec reads the same way.
import * as z from 'zod';
import { PermissionStateSchema, VoiceErrorCodeSchema, type VoicePrivacyPane, type VoiceStartResult, type VoiceStatus } from '@shared/ipc/schema/voice';
import type { HelperEvent, VoiceBackend } from './backend';

const ScriptSchema = z.strictObject({
  permission: z.strictObject({ microphone: PermissionStateSchema, speech: PermissionStateSchema }).optional(),
  startedDelayMs: z.number().int().min(0).optional(),
  partials: z.array(z.string()).optional(),
  partialDelayMs: z.number().int().min(0).optional(),
  final: z.string().optional(),
  lateAfterFinal: z.boolean().optional(),
  error: z.strictObject({ code: VoiceErrorCodeSchema, message: z.string() }).nullable().optional(),
  helper: z.enum(['ready', 'missing']).optional(),
});

const DEFAULT_PARTIALS = ['hello', 'hello world'];
const DEFAULT_FINAL = 'Hello world.';
const LATE_PARTIAL_MS = 20;
// The stub's own answers to what the helper would read from the Mac.
const SYSTEM_LOCALE = 'en-US';
const LOCALES = ['en-GB', 'en-US', 'ja-JP', 'ko-KR'];

function readScript(env: NodeJS.ProcessEnv) {
  let raw: unknown;
  try {
    raw = JSON.parse(env.MAWS_E2E_VOICE || '{}');
  } catch (error) {
    throw new Error(`MAWS_E2E_VOICE is not JSON: ${(error as Error).message}`, { cause: error });
  }
  const parsed = ScriptSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`MAWS_E2E_VOICE is not a voice script: ${z.prettifyError(parsed.error)}`);
  const script = parsed.data;
  return {
    permission: script.permission ?? { microphone: 'authorized' as const, speech: 'authorized' as const },
    startedDelayMs: script.startedDelayMs ?? 0,
    partials: script.partials ?? DEFAULT_PARTIALS,
    partialDelayMs: script.partialDelayMs ?? 40,
    final: script.final ?? (script.partials ? (script.partials.at(-1) ?? '') : DEFAULT_FINAL),
    lateAfterFinal: script.lateAfterFinal ?? false,
    error: script.error ?? null,
    helper: script.helper ?? 'ready',
  };
}

export interface VoiceScriptLog {
  starts: { captureId: string; locale: string | null }[];
  stops: string[];
  cancels: string[];
  privacyPanes: VoicePrivacyPane[];
}

// The log the end-to-end spec reads through `electronApp.evaluate`; created on first use.
export function voiceScriptLog(): VoiceScriptLog {
  const holder = globalThis as { __mawsVoiceScript?: VoiceScriptLog };
  holder.__mawsVoiceScript ??= { starts: [], stops: [], cancels: [], privacyPanes: [] };
  return holder.__mawsVoiceScript;
}

const denied = (state: string) => state === 'denied' || state === 'restricted';

interface Capture {
  id: string;
  sink: (event: HelperEvent) => void;
  final: string;
  lateAfterFinal: boolean;
  started: boolean;
  timers: Set<ReturnType<typeof setTimeout>>;
}

export class ScriptedBackend implements VoiceBackend {
  readonly kind = 'scripted';
  private capture: Capture | null = null;
  private lateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: { env: NodeJS.ProcessEnv; path: string }) {}

  async probe(locale: string | null): Promise<VoiceStatus> {
    const script = readScript(this.deps.env);
    const path = this.deps.path;
    if (script.helper === 'missing') {
      return { helper: { state: 'missing', path }, backend: 'scripted', permission: null, systemLocale: null, locale, supportsOnDevice: null, locales: [] };
    }
    return { helper: { state: 'ready', path }, backend: 'scripted', permission: script.permission, systemLocale: SYSTEM_LOCALE, locale: locale ?? SYSTEM_LOCALE, supportsOnDevice: true, locales: LOCALES };
  }

  async start(captureId: string, locale: string | null, sink: (event: HelperEvent) => void): Promise<VoiceStartResult> {
    const script = readScript(this.deps.env);
    voiceScriptLog().starts.push({ captureId, locale });
    if (script.helper === 'missing') return { accepted: false, reason: 'helper_missing', path: this.deps.path };
    if (this.capture) this.end(this.capture);
    const capture: Capture = { id: captureId, sink, final: script.final, lateAfterFinal: script.lateAfterFinal, started: false, timers: new Set() };
    this.capture = capture;
    const at = (ms: number, run: () => void) => {
      const timer = setTimeout(() => {
        capture.timers.delete(timer);
        run();
      }, ms);
      capture.timers.add(timer);
    };
    at(script.startedDelayMs, () => {
      const { permission } = script;
      sink({ type: 'permission', id: captureId, ...permission });
      if (denied(permission.microphone)) return this.fail(capture, 'microphone_denied', `Microphone access is ${permission.microphone} for this app.`);
      if (denied(permission.speech)) return this.fail(capture, 'speech_denied', `Speech recognition is ${permission.speech} for this app.`);
      if (script.error) return this.fail(capture, script.error.code, script.error.message);
      capture.started = true;
      sink({ type: 'started', id: captureId, locale: locale ?? SYSTEM_LOCALE });
      script.partials.forEach((text, index) => at(script.partialDelayMs * (index + 1), () => sink({ type: 'partial', id: captureId, text })));
    });
    return { accepted: true };
  }

  stop(captureId: string): void {
    voiceScriptLog().stops.push(captureId);
    const capture = this.held(captureId);
    if (!capture) return;
    this.end(capture);
    // Nothing was heard before `started`: the helper answers an empty final then too.
    capture.sink({ type: 'final', id: captureId, text: capture.started ? capture.final : '', timedOut: false });
    if (capture.lateAfterFinal) this.lateTimer = setTimeout(() => capture.sink({ type: 'partial', id: captureId, text: `${capture.final} (late)` }), LATE_PARTIAL_MS);
  }

  cancel(captureId: string): void {
    voiceScriptLog().cancels.push(captureId);
    const capture = this.held(captureId);
    if (!capture) return;
    this.end(capture);
    capture.sink({ type: 'cancelled', id: captureId });
  }

  dispose(): void {
    if (this.capture) this.end(this.capture);
    if (this.lateTimer) clearTimeout(this.lateTimer);
  }

  private held(captureId: string): Capture | null {
    return this.capture?.id === captureId ? this.capture : null;
  }

  private fail(capture: Capture, code: z.infer<typeof VoiceErrorCodeSchema>, message: string): void {
    this.end(capture);
    capture.sink({ type: 'error', id: capture.id, code, message });
  }

  // Clears every pending timer of the capture and lets it go.
  private end(capture: Capture): void {
    for (const timer of capture.timers) clearTimeout(timer);
    capture.timers.clear();
    if (this.capture === capture) this.capture = null;
  }
}
