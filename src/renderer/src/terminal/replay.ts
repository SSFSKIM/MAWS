// The two reattach sources' byte-level rules (Residue *Reattach checkpoint*), both pure:
//
// `alignReplay` is the lossy path's boundary: a ring tail can begin inside a UTF-8 character or an escape sequence, so
// the renderer writes it from the byte after its first line feed, or not at all. It never guesses at escape-sequence
// structure.
//
// `trackStream` is the exact path's guard: a byte-level mirror of what xterm.js 6.0.0's parser and UTF-8 decoder
// hold between writes (`src/common/parser/EscapeSequenceParser.ts` VT500_TRANSITION_TABLE and
// `src/common/input/TextDecoder.ts` Utf8ToUtf32), run over every chunk the registry writes. A checkpoint is taken only
// where it reports a boundary (the parser in its ground state, no partial UTF-8 character, no open OSC 8 hyperlink,
// the default charset in force), because `@xterm/addon-serialize` serialises the screen but no parser or decoder
// continuation, writes the pen's open hyperlink as a plain SGR 4 underline that outlives the link's end, and carries
// no charset designation (found by the split-point round trip in `replay.node.test.ts`). The tracker also records the
// private modes the serializer does not restore (measured against `@xterm/headless` 6.0.0: SGR mouse encoding 1006,
// SGR-pixels 1016 and cursor visibility 25; mouse tracking and focus reporting are carried explicitly too, as the
// residue asks), and `checkpointState` appends them to `serialize()` as explicit DECSET/DECRST sequences.

export interface TrackedModes {
  mouseProtocol: 0 | 9 | 1000 | 1002 | 1003; // 0: none (xterm keeps one active protocol)
  mouseEncoding: 0 | 1006 | 1016; // 0: xterm's default encoding (1005 and 1015 are unsupported by xterm)
  focusReporting: boolean; // 1004
  cursorHidden: boolean; // DECTCEM (25) reset
}

// xterm's parser states, by the transition table's names.
const GROUND = 0;
const ESCAPE = 1;
const ESCAPE_INTERMEDIATE = 2;
const CSI_ENTRY = 3;
const CSI_PARAM = 4;
const CSI_INTERMEDIATE = 5;
const CSI_IGNORE = 6;
const SOS_PM_APC_STRING = 7;
const OSC_STRING = 8;
const DCS_ENTRY = 9;
const DCS_PARAM = 10;
const DCS_INTERMEDIATE = 11;
const DCS_IGNORE = 12;
const DCS_PASSTHROUGH = 13;

export interface StreamState {
  readonly parser: number; // one of the states above
  readonly utf8Need: number; // continuation bytes still expected
  readonly utf8Size: number; // the pending character's length in bytes (2 to 4)
  readonly utf8Value: number; // its code point bits so far
  readonly collected: string; // CSI prefix and intermediates, or ESC intermediates, of the sequence being parsed
  readonly params: string; // CSI parameters of the sequence being parsed
  readonly osc: OscScan; // the OSC string being parsed, as far as OSC 8 needs it
  readonly hyperlink: boolean; // an OSC 8 hyperlink is open in the pen
  readonly charsets: Charsets;
  readonly modes: Readonly<TrackedModes>;
}

// xterm's CharsetService as far as a boundary needs it: what G0 to G3 designate (a charset's final byte; `B`, US
// ASCII, is the default), the shift level, the set in force (normally the level's designation; DECRC puts back the
// set DECSC saved) and that saved set. xterm keeps the saved set per buffer; programs pair DECSC and DECRC within
// one, so one slot is enough here.
interface Charsets {
  readonly g: string; // four designations, G0 to G3
  readonly level: number;
  readonly active: string;
  readonly saved: string;
}
const DEFAULT_CHARSETS: Charsets = { g: 'BBBB', level: 0, active: 'B', saved: 'B' };
const CHARSET_FINALS = '0AB4C5RQKYE6ZH7='; // xterm's `CHARSETS` keys; other finals have no handler
const DESIGNATOR_LEVEL: Record<string, number> = { '(': 0, ')': 1, '*': 2, '+': 3, '-': 1, '.': 2 };

// What an OSC string is, read in constant memory: its identifier, then for OSC 8 (`8 ; params ; uri`) whether the
// params and the uri are non-empty, which is all xterm's `setHyperlink` decides on.
interface OscScan {
  readonly phase: 'ident' | 'params' | 'uri' | 'other';
  readonly ident: string;
  readonly id: boolean; // params hold a non-blank character
  readonly uri: boolean;
}
const OSC_START: OscScan = { phase: 'ident', ident: '', id: false, uri: false };

const DEFAULT_MODES: TrackedModes = { mouseProtocol: 0, mouseEncoding: 0, focusReporting: false, cursorHidden: false };

export const INITIAL_STREAM: StreamState = {
  parser: GROUND,
  utf8Need: 0,
  utf8Size: 0,
  utf8Value: 0,
  collected: '',
  params: '',
  osc: OSC_START,
  hyperlink: false,
  charsets: DEFAULT_CHARSETS,
  modes: DEFAULT_MODES,
};

export function atBoundary(state: StreamState): boolean {
  const { g, level, active } = state.charsets;
  return state.parser === GROUND && state.utf8Need === 0 && !state.hyperlink && g === 'BBBB' && level === 0 && active === 'B';
}

const encoder = new TextEncoder();

// C0 controls that execute without leaving the state they arrive in (0x18 CAN, 0x1A SUB and 0x1B ESC are global).
const isExecutable = (c: number) => c <= 0x17 || c === 0x19 || (c >= 0x1c && c <= 0x1f);
const NON_ASCII = 0xa0; // every code point from U+00A0 up behaves alike in the table

export function trackStream(state: StreamState, chunk: Uint8Array | string): StreamState {
  const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
  let parser = state.parser;
  let need = state.utf8Need;
  let size = state.utf8Size;
  let value = state.utf8Value;
  let collected = state.collected;
  let params = state.params;
  let osc = state.osc;
  let hyperlink = state.hyperlink;
  let charsets = state.charsets;
  let modes = state.modes;

  const setModes = (next: Partial<TrackedModes>) => {
    modes = { ...modes, ...next };
  };
  const shift = (level: number) => {
    charsets = { ...charsets, level, active: charsets.g[level]! };
  };
  const designate = (level: number, final: string) => {
    const g = charsets.g.slice(0, level) + final + charsets.g.slice(level + 1);
    charsets = { ...charsets, g, active: charsets.level === level ? final : charsets.active };
  };
  const saveCursor = () => {
    charsets = { ...charsets, saved: charsets.active };
  };
  const restoreCursor = () => {
    charsets = { ...charsets, active: charsets.saved };
  };
  const execute = (c: number) => {
    if (c === 0x0e) shift(1); // SO
    else if (c === 0x0f) shift(0); // SI
  };

  const csiDispatch = (final: number) => {
    if ((final === 0x68 || final === 0x6c) && collected === '?') {
      const set = final === 0x68; // h
      for (const param of params.split(';')) {
        const mode = Number.parseInt(param.split(':')[0] || '0', 10);
        if (mode === 9 || mode === 1000 || mode === 1002 || mode === 1003) setModes({ mouseProtocol: set ? mode : 0 });
        else if (mode === 1006 || mode === 1016) setModes({ mouseEncoding: set ? mode : 0 });
        else if (mode === 1004) setModes({ focusReporting: set });
        else if (mode === 25) setModes({ cursorHidden: !set });
        else if (mode === 1048 || (mode === 1049 && set)) (set ? saveCursor : restoreCursor)();
        else if (mode === 1049) restoreCursor();
      }
    } else if (final === 0x70 && collected === '!') {
      // DECSTR: xterm resets the DEC private modes, the pen (so any open hyperlink) and shows the cursor; its mouse
      // service is untouched.
      setModes({ focusReporting: false, cursorHidden: false });
      hyperlink = false;
      charsets = DEFAULT_CHARSETS;
    } else if (collected === '' && (final === 0x73 || final === 0x75)) {
      (final === 0x73 ? saveCursor : restoreCursor)(); // SCOSC `CSI s`, SCORC `CSI u`
    }
  };

  const escDispatch = (final: number) => {
    const ch = String.fromCharCode(final);
    if (collected === '') {
      if (ch === 'c') {
        // RIS: xterm's full reset clears every tracked mode, the pen and the charsets
        modes = DEFAULT_MODES;
        hyperlink = false;
        charsets = DEFAULT_CHARSETS;
      } else if (ch === '7') saveCursor();
      else if (ch === '8') restoreCursor();
      else if (ch === 'n' || ch === '}') shift(2); // LS2, LS2R
      else if (ch === 'o' || ch === '|') shift(3); // LS3, LS3R
      else if (ch === '~') shift(1); // LS1R
    } else if (collected in DESIGNATOR_LEVEL && CHARSET_FINALS.includes(ch)) {
      designate(DESIGNATOR_LEVEL[collected]!, ch);
    } else if (collected === '%' && (ch === '@' || ch === 'G')) {
      shift(0);
      designate(0, 'B');
    }
  };

  const oscPut = (c: number) => {
    const ch = String.fromCodePoint(c);
    if (osc.phase === 'ident') {
      if (c === 0x3b) osc = osc.ident === '8' ? { ...osc, phase: 'params' } : { ...osc, phase: 'other' };
      else if (c >= 0x30 && c <= 0x39 && osc.ident.length < 4) osc = { ...osc, ident: osc.ident + ch };
      else osc = { ...osc, phase: 'other' };
    } else if (osc.phase === 'params') {
      if (c === 0x3b) osc = { ...osc, phase: 'uri' };
      else if (!osc.id && ch.trim()) osc = { ...osc, id: true };
    } else if (osc.phase === 'uri' && !osc.uri) osc = { ...osc, uri: true };
  };

  // A successfully terminated OSC string (BEL, ST or ESC; CAN and SUB abort it), applied as xterm's setHyperlink does.
  const oscEnd = () => {
    if (osc.phase === 'uri') {
      if (osc.uri) hyperlink = true;
      else if (!osc.id) hyperlink = false;
    }
  };

  const feed = (cp: number) => {
    // Rules that apply in every state.
    if (parser === OSC_STRING && (cp === 0x1b || cp === 0x9c || cp === 0x07)) oscEnd();
    if (cp === 0x1b) {
      parser = ESCAPE;
      collected = '';
      return;
    }
    if (cp === 0x18 || cp === 0x1a || cp === 0x99 || cp === 0x9a || cp === 0x9c || (cp >= 0x80 && cp <= 0x97 && cp !== 0x90)) {
      parser = GROUND;
      return;
    }
    if (cp === 0x9b) {
      parser = CSI_ENTRY;
      collected = '';
      params = '';
      return;
    }
    if (cp === 0x9d) {
      parser = OSC_STRING;
      osc = OSC_START;
      return;
    }
    if (cp === 0x90) return void (parser = DCS_ENTRY);
    if (cp === 0x98 || cp === 0x9e || cp === 0x9f) return void (parser = SOS_PM_APC_STRING);
    const c = cp < NON_ASCII ? cp : NON_ASCII;
    switch (parser) {
      case GROUND:
        if (isExecutable(c)) execute(c);
        return;
      case ESCAPE:
        if (isExecutable(c)) return execute(c);
        if (c === 0x7f) return;
        if (c === 0x5b) {
          parser = CSI_ENTRY;
          collected = '';
          params = '';
        } else if (c === 0x5d) {
          parser = OSC_STRING;
          osc = OSC_START;
        }
        else if (c === 0x50) parser = DCS_ENTRY;
        else if (c === 0x58 || c === 0x5e || c === 0x5f) parser = SOS_PM_APC_STRING;
        else if (c >= 0x20 && c <= 0x2f) {
          collected += String.fromCharCode(c);
          parser = ESCAPE_INTERMEDIATE;
        } else {
          if (c !== NON_ASCII) escDispatch(c);
          parser = GROUND;
        }
        return;
      case ESCAPE_INTERMEDIATE:
        if (isExecutable(c)) return execute(c);
        if (c === 0x7f) return;
        if (c >= 0x20 && c <= 0x2f) collected += String.fromCharCode(c);
        else {
          if (c !== NON_ASCII) escDispatch(c);
          parser = GROUND;
        }
        return;
      case CSI_ENTRY:
      case CSI_PARAM:
        if (isExecutable(c)) return execute(c);
        if (c === 0x7f) return;
        if (c >= 0x30 && c <= 0x3b) {
          params += String.fromCharCode(c);
          parser = CSI_PARAM;
        } else if (c >= 0x3c && c <= 0x3f) {
          if (parser === CSI_ENTRY) {
            collected += String.fromCharCode(c);
            parser = CSI_PARAM;
          } else parser = CSI_IGNORE;
        } else if (c >= 0x20 && c <= 0x2f) {
          collected += String.fromCharCode(c);
          parser = CSI_INTERMEDIATE;
        } else if (c >= 0x40 && c <= 0x7e) {
          csiDispatch(c);
          parser = GROUND;
        } else parser = GROUND;
        return;
      case CSI_INTERMEDIATE:
        if (isExecutable(c)) return execute(c);
        if (c === 0x7f) return;
        if (c >= 0x20 && c <= 0x2f) collected += String.fromCharCode(c);
        else if (c >= 0x30 && c <= 0x3f) parser = CSI_IGNORE;
        else if (c >= 0x40 && c <= 0x7e) {
          csiDispatch(c);
          parser = GROUND;
        } else parser = GROUND;
        return;
      case CSI_IGNORE:
        if (isExecutable(c)) execute(c);
        else if (c >= 0x40 && c <= 0x7e) parser = GROUND;
        return;
      case OSC_STRING:
        if (c === 0x07) parser = GROUND; // BEL ends an OSC string (ESC, CAN, SUB and ST are handled above)
        else if (c >= 0x20) oscPut(cp); // printables, DEL and non-ASCII are the payload; C0 controls are ignored
        return;
      case SOS_PM_APC_STRING:
        if (c === NON_ASCII) parser = GROUND; // not in xterm's table: its default transition is to ground
        return;
      case DCS_ENTRY:
      case DCS_PARAM:
      case DCS_INTERMEDIATE:
        if (isExecutable(c) || c === 0x7f) return;
        if (c >= 0x40 && c <= 0x7e) parser = DCS_PASSTHROUGH;
        else if (c >= 0x20 && c <= 0x2f) parser = DCS_INTERMEDIATE;
        else if (c >= 0x30 && c <= 0x3b) parser = parser === DCS_INTERMEDIATE ? DCS_IGNORE : DCS_PARAM;
        else if (c >= 0x3c && c <= 0x3f) parser = parser === DCS_ENTRY ? DCS_PARAM : DCS_IGNORE;
        else parser = GROUND;
        return;
      case DCS_IGNORE:
      case DCS_PASSTHROUGH:
        return; // left only through ESC, ST, CAN or SUB, above
    }
  };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (need > 0) {
      if ((b & 0xc0) === 0x80) {
        value = (value << 6) | (b & 0x3f);
        if (--need === 0) {
          // xterm's decoder drops overlong forms, surrogates, the BOM and out-of-range values without emitting.
          const valid =
            size === 2 ? value >= 0x80 : size === 3 ? value >= 0x800 && (value < 0xd800 || value > 0xdfff) && value !== 0xfeff : value >= 0x10000 && value <= 0x10ffff;
          if (valid) feed(value);
        }
        continue;
      }
      need = 0; // a wrong continuation discards the pending character; the byte is read afresh
    }
    if (b < 0x80) feed(b);
    else if ((b & 0xe0) === 0xc0) [need, size, value] = [1, 2, b & 0x1f];
    else if ((b & 0xf0) === 0xe0) [need, size, value] = [2, 3, b & 0x0f];
    else if ((b & 0xf8) === 0xf0) [need, size, value] = [3, 4, b & 0x07];
    // anything else (a stray continuation byte, 0xF8 and up) is skipped, as xterm skips it
  }

  return { parser, utf8Need: need, utf8Size: size, utf8Value: value, collected, params, osc, hyperlink, charsets, modes };
}

// The tracked modes as explicit sequences, written after `serialize()` so a restored terminal holds exactly these
// values whatever the serializer emitted before them.
export function explicitModes(state: StreamState): string {
  const { mouseProtocol, mouseEncoding, focusReporting, cursorHidden } = state.modes;
  return [
    mouseProtocol ? `\x1b[?${mouseProtocol}h` : '\x1b[?1000l',
    mouseEncoding ? `\x1b[?${mouseEncoding}h` : '\x1b[?1006l',
    `\x1b[?1004${focusReporting ? 'h' : 'l'}`,
    `\x1b[?25${cursorHidden ? 'l' : 'h'}`,
  ].join('');
}

// Where `@xterm/addon-serialize` 0.14.0 starts the alternate screen. Buffer content never holds an ESC, so the first
// occurrence is the addon's.
const ALTERNATE_SCREEN_START = '\x1b[?1049h\x1b[H';

// A checkpoint's state: the emulator's serialisation plus the modes it does not carry. Only valid where
// `atBoundary(state)` holds. The addon writes the current pen after the normal buffer and again after the alternate
// one; an SGR reset before the alternate screen keeps the first copy from colouring its first cells.
export function checkpointState(serialized: string, state: StreamState): string {
  const alternate = serialized.indexOf(ALTERNATE_SCREEN_START);
  const repaired = alternate === -1 ? serialized : `${serialized.slice(0, alternate)}\x1b[0m${serialized.slice(alternate)}`;
  return repaired + explicitModes(state);
}

export function alignReplay(tail: Uint8Array): Uint8Array {
  const lineFeed = tail.indexOf(0x0a);
  return lineFeed === -1 ? new Uint8Array(0) : tail.subarray(lineFeed + 1);
}
