// The reattach sources against the real emulator (Residue *Reattach checkpoint*): `@xterm/headless` 6.0.0 with
// `@xterm/addon-serialize` 0.14.0, no DOM. The checkpoints here are built exactly as the registry builds them: the
// stream tracker runs over every parsed chunk, a checkpoint is taken only where it reports a boundary, and its state
// is `serialize()` followed by the tracker's explicit modes (`checkpointState`).
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal } from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { alignReplay, atBoundary, checkpointState, explicitModes, INITIAL_STREAM, trackStream, type StreamState } from './replay';

const utf8 = (text: string) => new TextEncoder().encode(text);
const concat = (chunks: Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
};

function emulator() {
  const terminal = new Terminal({ cols: 40, rows: 8, scrollback: 1000, allowProposedApi: true });
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);
  const write = (data: Uint8Array | string) => new Promise<void>((resolve) => terminal.write(data, resolve));
  const line = (row: number) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? '';
  const screenLine = (row: number) => line(terminal.buffer.active.baseY + row);
  const modes = () => ({
    alternateScreen: terminal.buffer.active.type === 'alternate',
    bracketedPaste: terminal.modes.bracketedPasteMode,
    applicationCursorKeys: terminal.modes.applicationCursorKeysMode,
    mouseTracking: terminal.modes.mouseTrackingMode,
  });
  // DECRQM: the terminal's own answer to "is private mode N set?" (`CSI ? N ; 1 $ y` set, `; 2` reset).
  const query = async (mode: number) => {
    let reply = '';
    const listener = terminal.onData((data) => (reply += data));
    await write(`\x1b[?${mode}$p`);
    listener.dispose();
    return reply;
  };
  return { terminal, serializer, write, line, screenLine, modes, query };
}

type Checkpoint = { offset: number; state: string };

// The registry's checkpointing, over a real emulator: each chunk is parsed, tracked, and checkpointed when it ends on a
// boundary. Returns every checkpoint taken and the whole stream (what the host's ring holds).
async function checkpointedRun(chunks: Uint8Array[]) {
  const source = emulator();
  let tracker: StreamState = INITIAL_STREAM;
  let offset = 0;
  const checkpoints: Checkpoint[] = [];
  for (const chunk of chunks) {
    await source.write(chunk);
    tracker = trackStream(tracker, chunk);
    offset += chunk.byteLength;
    if (atBoundary(tracker)) checkpoints.push({ offset, state: checkpointState(source.serializer.serialize(), tracker) });
  }
  return { source, checkpoints, stream: concat(chunks) };
}

// What a reloaded renderer does on the exact path: the checkpoint, then the ring's bytes after it.
async function restore(checkpoint: Checkpoint, stream: Uint8Array) {
  const target = emulator();
  await target.write(checkpoint.state);
  await target.write(stream.subarray(checkpoint.offset));
  return target;
}

describe('terminal stream tracker', () => {
  it('is at a boundary only with no escape sequence and no partial UTF-8 character pending', () => {
    const after = (...chunks: (string | Uint8Array)[]) => chunks.reduce<StreamState>((s, c) => trackStream(s, c), INITIAL_STREAM);
    expect(atBoundary(after('plain text\r\n'))).toBe(true);
    expect(atBoundary(after('\x1b'))).toBe(false);
    expect(atBoundary(after('\x1b[31'))).toBe(false);
    expect(atBoundary(after('\x1b[31', 'm'))).toBe(true);
    expect(atBoundary(after('\x1b]0;title'))).toBe(false);
    expect(atBoundary(after('\x1b]0;title\x07'))).toBe(true);
    expect(atBoundary(after('\x1b]8;;https://example.com\x1b'))).toBe(false); // ESC of the ST is pending
    expect(atBoundary(after('\x1b]0;title\x1b\\'))).toBe(true);
    expect(atBoundary(after('\x1bP>|xterm'))).toBe(false);
    expect(atBoundary(after('\x1bP>|xterm\x1b\\'))).toBe(true);
    expect(atBoundary(after('\x1b(', 'B'))).toBe(true);
    const han = utf8('한'); // ED 95 9C
    expect(atBoundary(after(han.subarray(0, 1)))).toBe(false);
    expect(atBoundary(after(han.subarray(0, 2)))).toBe(false);
    expect(atBoundary(after(han.subarray(0, 2), han.subarray(2)))).toBe(true);
    expect(atBoundary(after('\x1b[3', '\x18'))).toBe(true); // CAN aborts the sequence
    // An open OSC 8 hyperlink lives in xterm's pen, which the serializer writes as a plain underline that then bleeds
    // past the link's end: not a boundary until the link closes (SGR 0 does not close it; RIS and DECSTR do).
    expect(atBoundary(after('\x1b]8;;https://example.com\x07link'))).toBe(false);
    expect(atBoundary(after('\x1b]8;id=1;https://example.com\x1b\\link\x1b[0m'))).toBe(false);
    expect(atBoundary(after('\x1b]8;;https://example.com\x07link\x1b]8;;\x07'))).toBe(true);
    expect(atBoundary(after('\x1b]8;;https://example.com\x07link\x1bc'))).toBe(true);
    expect(atBoundary(after('\x1b]8;;https://example.com\x07link\x1b[!p'))).toBe(true);
    expect(atBoundary(after('\x1b]8;;https://example.com\x18link'))).toBe(true); // CAN aborts the OSC: no link
    expect(atBoundary(after('\x1b]8;;https://a.example\x07\x1b]8;id=2;\x07'))).toBe(false); // xterm ignores a close with an id
    expect(atBoundary(after('\x1b]0;8;;not a link\x07'))).toBe(true);
    // Charsets are not serialised either: a designated line-drawing set, a shift away from G0, or the set a DECRC put
    // back is not a boundary until the default is active again.
    expect(atBoundary(after('\x1b(0lqk'))).toBe(false);
    expect(atBoundary(after('\x1b(0lqk\x1b(B'))).toBe(true);
    expect(atBoundary(after('\x1b)0'))).toBe(false); // G1 designated: an SO after the checkpoint would draw lines
    expect(atBoundary(after('\x1b)0\x1b)B\x0e'))).toBe(false); // shifted to G1, even though G1 is plain
    expect(atBoundary(after('\x1b)0\x1b)B\x0e\x0f'))).toBe(true);
    expect(atBoundary(after('\x1b(0\x1b7\x1b(B\x1b8'))).toBe(false); // DECRC restores the saved line-drawing set
    expect(atBoundary(after('\x1b(0\x1b[!p'))).toBe(true);
    expect(atBoundary(after('\x1b(0\x1b%G'))).toBe(true);
    expect(atBoundary(after('\x1b(1'))).toBe(true); // not a charset xterm knows: ignored
    // DECSC saves a cursor position, pen and charset the serializer does not write: not a boundary until the matching
    // DECRC (or a reset) consumes it.
    expect(atBoundary(after('\x1b7'))).toBe(false);
    expect(atBoundary(after('\x1b7', 'text', '\x1b8'))).toBe(true);
    expect(atBoundary(after('\x1b[s'))).toBe(false);
    expect(atBoundary(after('\x1b[s\x1b[u'))).toBe(true);
    expect(atBoundary(after('\x1b[?1048h'))).toBe(false);
    expect(atBoundary(after('\x1b[?1048h\x1b[?1048l'))).toBe(true);
    expect(atBoundary(after('\x1b7\x1bc'))).toBe(true);
    expect(atBoundary(after('\x1b7\x1b[!p'))).toBe(true);
    // The alternate screen's own save is rebuilt by the serializer's `?1049h`, except for a non-default charset.
    expect(atBoundary(after('\x1b[?1049h'))).toBe(true);
    expect(atBoundary(after('\x1b(0\x1b[?1049h\x1b(B'))).toBe(false);
    expect(atBoundary(after('\x1b(0\x1b[?1049h\x1b(B\x1b[?1049l\x1b(B'))).toBe(true);
    expect(atBoundary(after(new Uint8Array([0xc2, 0x9b])))).toBe(false); // C1 CSI, UTF-8 encoded
  });

  it('records the private modes the serializer does not restore and emits them explicitly', () => {
    const state = trackStream(INITIAL_STREAM, '\x1b[?1000h\x1b[?1006h\x1b[?1004h\x1b[?25l');
    expect(state.modes).toEqual({ mouseProtocol: 1000, mouseEncoding: 1006, focusReporting: true, cursorHidden: true });
    expect(explicitModes(state)).toBe('\x1b[?1000h\x1b[?1006h\x1b[?1004h\x1b[?25l');
    expect(explicitModes(INITIAL_STREAM)).toBe('\x1b[?1000l\x1b[?1006l\x1b[?1004l\x1b[?25h');
  });

  it('follows xterm: combined parameters, a split sequence, resets, and which modes each reset clears', () => {
    const combined = trackStream(INITIAL_STREAM, '\x1b[?1003;1016h');
    expect(combined.modes).toMatchObject({ mouseProtocol: 1003, mouseEncoding: 1016 });
    const split = trackStream(trackStream(INITIAL_STREAM, '\x1b[?10'), '02h');
    expect(split.modes.mouseProtocol).toBe(1002);
    expect(trackStream(combined, '\x1b[?1002l').modes).toMatchObject({ mouseProtocol: 0, mouseEncoding: 1016 });
    expect(trackStream(combined, '\x1b[?1016l').modes).toMatchObject({ mouseProtocol: 1003, mouseEncoding: 0 });
    const everything = trackStream(INITIAL_STREAM, '\x1b[?1002h\x1b[?1006h\x1b[?1004h\x1b[?25l');
    expect(trackStream(everything, '\x1bc').modes).toEqual(INITIAL_STREAM.modes);
    // DECSTR resets the DEC private modes and shows the cursor; xterm leaves the mouse service alone.
    expect(trackStream(everything, '\x1b[!p').modes).toEqual({ mouseProtocol: 1002, mouseEncoding: 1006, focusReporting: false, cursorHidden: false });
    // Not a DECSET: no private marker, or an intermediate.
    expect(trackStream(INITIAL_STREAM, '\x1b[1000h\x1b[?1000$p').modes.mouseProtocol).toBe(0);
  });

  it('never mutates the state it is given', () => {
    const before = trackStream(INITIAL_STREAM, '\x1b[?1000h');
    const snapshot = structuredClone(before);
    trackStream(before, '\x1b[?1000l\x1b[');
    expect(before).toEqual(snapshot);
  });
});

describe('terminal replay alignment', () => {
  it('drops a tail that starts inside a UTF-8 character up to its first line feed', async () => {
    const stream = utf8('first 한글\r\nsecond 한 line\r\nthird\r\n');
    const tail = stream.subarray(utf8('first ').byteLength + 1); // the second byte of 한
    const aligned = alignReplay(tail);
    expect(new TextDecoder().decode(aligned)).toBe('second 한 line\r\nthird\r\n');
    const target = emulator();
    await target.write(aligned);
    expect(target.line(0)).toBe('second 한 line');
    expect(target.line(0)).not.toContain('�');
    const unaligned = emulator(); // the reason: xterm skips the stray continuation bytes and 한 is lost from the line
    await unaligned.write(tail);
    expect(unaligned.line(0)).toBe('글');
  });

  it('drops a tail that starts inside an escape sequence up to its first line feed', async () => {
    const stream = utf8('x\x1b[31mred\x1b[0m\r\nwhole line\r\n');
    const tail = stream.subarray(3); // `31mred…`
    const aligned = alignReplay(tail);
    const target = emulator();
    await target.write(aligned);
    expect(target.line(0)).toBe('whole line');
    const unaligned = emulator();
    await unaligned.write(tail);
    expect(unaligned.line(0)).toBe('31mred');
  });

  it('aligns a tail without a line feed to nothing', () => {
    expect(alignReplay(utf8('no line feed here')).byteLength).toBe(0);
    expect(alignReplay(new Uint8Array(0)).byteLength).toBe(0);
  });
});

describe('terminal checkpoint restores modes and the alternate screen', () => {
  it('restores bracketed paste, application cursor keys, mouse tracking, the alternate screen and the cursor', async () => {
    const { source, checkpoints } = await checkpointedRun([
      utf8('normal one\r\nnormal two\r\n'),
      utf8('\x1b[?2004h\x1b[?1h\x1b[?1000h'),
      utf8('\x1b[?1049h\x1b[H'),
      utf8('frame line\x1b[3;5H'),
    ]);
    const last = checkpoints.at(-1)!;
    const target = emulator();
    await target.write(last.state);
    expect(target.modes()).toEqual({ alternateScreen: true, bracketedPaste: true, applicationCursorKeys: true, mouseTracking: 'vt200' });
    expect(target.screenLine(0)).toBe('frame line');
    expect([target.terminal.buffer.active.cursorX, target.terminal.buffer.active.cursorY]).toEqual([
      source.terminal.buffer.active.cursorX,
      source.terminal.buffer.active.cursorY,
    ]);
    await target.write('\x1b[?1049l');
    expect(target.modes().alternateScreen).toBe(false);
    expect(target.line(0)).toBe('normal one');
    expect(target.line(1)).toBe('normal two');
  });

  it('takes no checkpoint inside an escape sequence, so a split SGR restores as red RED, never mRED', async () => {
    const chunks = [utf8('start\r\n'), utf8('\x1b[31'), utf8('mRED\x1b[0m\r\n')];
    const { checkpoints, stream } = await checkpointedRun(chunks);
    expect(checkpoints.map((c) => c.offset)).toEqual([7, stream.byteLength]); // none at 11, after `ESC [ 3 1`
    for (const checkpoint of checkpoints) {
      const target = await restore(checkpoint, stream);
      expect(target.line(1)).toBe('RED');
      const cell = target.terminal.buffer.active.getLine(1)!.getCell(0)!;
      expect([cell.isFgPalette(), cell.getFgColor()]).toEqual([true, 1]);
    }
    // The counterfactual the boundary rule exists for: a checkpoint after `ESC [ 3 1`, replayed from there.
    const naive = emulator();
    await naive.write(stream.subarray(0, 11));
    const broken = await restore({ offset: 11, state: naive.serializer.serialize() }, stream);
    expect(broken.line(1)).toBe('mRED');
  });

  it('takes no checkpoint inside a UTF-8 character, so a split 한 restores whole', async () => {
    const han = utf8('한');
    const chunks = [utf8('a'), han.subarray(0, 1), han.subarray(1, 2), han.subarray(2), utf8('\r\n')];
    const { checkpoints, stream } = await checkpointedRun(chunks);
    expect(checkpoints.map((c) => c.offset)).toEqual([1, 4, 6]);
    for (const checkpoint of checkpoints) {
      const target = await restore(checkpoint, stream);
      expect(target.line(0)).toBe('a한');
    }
  });

  it('takes no checkpoint while DECSC holds state, so a saved line-drawing set restores as ┌─┐, never lqk', async () => {
    const chunks = [utf8('start\r\n'), utf8('\x1b(0\x1b7\x1b(B'), utf8('\x1b8lqk\x1b(B\r\n')];
    const { checkpoints, stream } = await checkpointedRun(chunks);
    expect(checkpoints.map((c) => c.offset)).toEqual([7, stream.byteLength]); // none after `ESC(0 ESC7 ESC(B`
    for (const checkpoint of checkpoints) {
      const target = await restore(checkpoint, stream);
      expect(target.line(1)).toBe('┌─┐');
    }
    // The counterfactual the reviewer reproduced: a checkpoint after the DECSC, replayed from there.
    const naive = emulator();
    await naive.write(stream.subarray(0, 15));
    const broken = await restore({ offset: 15, state: naive.serializer.serialize() }, stream);
    // Both saved parts are lost: the position (DECRC lands at the origin, over `start`) and the charset (ASCII).
    expect([broken.line(0), broken.line(1)]).toEqual(['lqkrt', '']);
  });

  it('keeps SGR mouse encoding, focus reporting and a hidden cursor, which the serializer alone drops', async () => {
    const { checkpoints } = await checkpointedRun([utf8('\x1b[?1000h\x1b[?1006h'), utf8('\x1b[?1004h\x1b[?25l')]);
    const target = emulator();
    await target.write(checkpoints.at(-1)!.state);
    expect(await target.query(1006)).toBe('\x1b[?1006;1$y');
    expect(target.modes().mouseTracking).toBe('vt200');
    expect(await target.query(1004)).toBe('\x1b[?1004;1$y');
    expect(await target.query(25)).toBe('\x1b[?25;2$y');
    // Without the explicit modes, the restored terminal would report mouse events in the default encoding.
    const { source } = await checkpointedRun([utf8('\x1b[?1000h\x1b[?1006h')]);
    const bare = emulator();
    await bare.write(source.serializer.serialize());
    expect(await bare.query(1006)).toBe('\x1b[?1006;2$y');
  });

  it('keeps the pen out of the alternate screen the serializer writes after it', async () => {
    // @xterm/addon-serialize 0.14.0 writes the current pen at the end of the normal buffer and again at the end of
    // the alternate one; the first copy would colour the alternate screen's first cells.
    const { source, checkpoints } = await checkpointedRun([utf8('shell\r\n\x1b[?1049h\x1b[Hframe\x1b[2;1H\x1b[7m')]);
    const target = emulator();
    await target.write(checkpoints.at(-1)!.state);
    expect(target.terminal.buffer.active.getLine(0)!.getCell(0)!.isInverse()).toBe(0);
    await Promise.all([source.write('cell'), target.write('cell')]);
    expect(target.serializer.serialize()).toBe(source.serializer.serialize());
  });

  it('restores exactly from every split point the tracker calls a boundary', async () => {
    const stream = utf8(
      [
        'plain \x1b[1;31mbold red\x1b[0m 한글 👍🏽\r\n',
        '\x1b]0;a title\x07\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\\r\n',
        '\x1bP>|ignored\x1b\\\x1b(0lqk\x1b(B\x1b[?1002;1006h\x1b[?25l',
        '\x1b[31m\x1b(0\x1b7\x1b(B\x1b[0m\x1b[2;30Hsaved\x1b8x\x1b(B\x1b[0m\r\n',
        '\x1b[?1049h\x1b[Hframe 日本語\x1b[2;3H\x1b[7mcell\x1b[27m',
      ].join(''),
    );
    const whole = emulator();
    await whole.write(stream);
    const expected = { screen: whole.serializer.serialize(), sgr: await whole.query(1006), cursor: await whole.query(25) };
    let boundaries = 0;
    for (let split = 1; split < stream.byteLength; split++) {
      const head = stream.subarray(0, split);
      const tracker = trackStream(INITIAL_STREAM, head);
      if (!atBoundary(tracker)) continue;
      boundaries++;
      const source = emulator();
      await source.write(head);
      const target = await restore({ offset: split, state: checkpointState(source.serializer.serialize(), tracker) }, stream);
      const actual = { screen: target.serializer.serialize(), sgr: await target.query(1006), cursor: await target.query(25) };
      expect(actual, `split at byte ${split}`).toEqual(expected);
    }
    expect(boundaries).toBeGreaterThan(40);
  });

  it('carries the explicit modes of a restored checkpoint into the next one', async () => {
    const first = await checkpointedRun([utf8('\x1b[?1003h\x1b[?1006h')]);
    const reloaded = emulator();
    const state = first.checkpoints.at(-1)!.state;
    await reloaded.write(state);
    const tracker = trackStream(INITIAL_STREAM, state); // the registry tracks what it writes, the checkpoint included
    const next = emulator();
    await next.write(checkpointState(reloaded.serializer.serialize(), tracker));
    expect(await next.query(1006)).toBe('\x1b[?1006;1$y');
    expect(next.modes().mouseTracking).toBe('any');
  });
});
