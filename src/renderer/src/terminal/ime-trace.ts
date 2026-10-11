// P2-F S ime-trace, temporary (removed once tracker L98's fix is pinned by a replay of the trace it captures): with
// MAWS_IME_TRACE=1 main loads the page with `?imeTrace=1`, and every terminal's helper textarea then logs its key,
// composition and input events and the bytes xterm hands to onData as `[ime-trace]` console lines, which main appends
// to <logs>/ime-trace.log (window.ts). Without the flag it installs nothing.
export const IME_TRACE_PREFIX = '[ime-trace]';

export const imeTraceRequested = (search: string): boolean => new URLSearchParams(search).get('imeTrace') === '1';

const hex = (text: string) => Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, '0')).join(' ');

export function installImeTrace(textarea: HTMLTextAreaElement, onData: (cb: (data: string) => void) => unknown, enabled: boolean): void {
  if (!enabled) return;
  const record = (fields: string) => console.info(`${IME_TRACE_PREFIX} ${performance.now().toFixed(1)} ${fields} value=${JSON.stringify(textarea.value)}`);
  const on = <E extends Event>(types: string[], describe: (ev: E) => string) => {
    for (const type of types) textarea.addEventListener(type, (ev) => record(`${type} ${describe(ev as E)}`), true);
  };
  on<KeyboardEvent>(['keydown', 'keyup'], (ev) => {
    const mods = (['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const).filter((mod) => ev[mod]).map((mod) => mod.slice(0, -3));
    return `key=${JSON.stringify(ev.key)} code=${ev.code} keyCode=${ev.keyCode} isComposing=${ev.isComposing} mods=${mods.join('+') || '-'}`;
  });
  on<CompositionEvent>(['compositionstart', 'compositionupdate', 'compositionend'], (ev) => `data=${JSON.stringify(ev.data)}`);
  on<InputEvent>(['beforeinput', 'input'], (ev) => `inputType=${ev.inputType} data=${JSON.stringify(ev.data)} isComposing=${ev.isComposing}`);
  onData((data) => record(`onData ${hex(data)}`));
}
