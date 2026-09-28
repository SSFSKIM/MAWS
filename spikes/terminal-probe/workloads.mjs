// The spike's workload table (C9 M1, the item table), shared by the `#probe` page (which imports it) and `run.mjs`
// (which names workloads by id). A `program` workload is the pty's own program (no shell, no prompt, no echo); a
// `typed` workload is a command typed into the shell the page already runs (`$SHELL` without `-l` in M1; since M2 the
// host's default, the login shell `$SHELL -l`). Expected counts are PTY bytes: the
// program's output plus one CR per line feed under the tty's `onlcr`, verified on this Mac (Decision Log, W2/W3).
import widths from './fixtures/width.json' with { type: 'json' };

export const CLAUDE_BIN_DEFAULT = '/Users/new/.local/share/claude/versions/2.1.283';
export const CODEX_BIN_DEFAULT = '/Users/new/.codex/packages/standalone/current/bin/codex';
export const SCRATCH_CWD = '/tmp/maws-harness/a';

export const WIDTH_FIXTURES = widths;

const FOX = "yes 'the quick brown fox jumps over the lazy dog 0123456789'";
const B64 = '/usr/bin/base64 -b 120 -i /dev/urandom';
const SEQ = "seq -f '%.0f' 1 20000000";

// `sh -c` wrappers so head can cut the M1 phase; the gate runs the full producers.
const flood = (producer, m1Expected, gateExpected, gateOutput = 50_000_000, gateProducer = `${producer} | head -c ${gateOutput}`) => ({
  kind: 'program',
  measure: 'flood',
  program: {
    m1: { shell: '/bin/sh', args: ['-c', `${producer} | head -c 20000000`] },
    'm2-gate': { shell: '/bin/sh', args: ['-c', gateProducer] },
  },
  // PTY bytes, the program's own output bytes, and the line feeds (PTY bytes minus output bytes, one CR each).
  expectedBytes: { m1: m1Expected, 'm2-gate': gateExpected },
  expectedOutputBytes: { m1: 20_000_000, 'm2-gate': gateOutput },
});

// The width workload prints each fixture, asks for the cursor position (`CSI 6 n`) and moves to the next line, with
// echo off so the replies the terminal writes back are not drawn.
const widthScript = 'stty -echo; for s in "$@"; do printf "%s\\033[6n\\r\\n" "$s"; done; sleep 2';

export const workloads = {
  shell: { kind: 'program', title: 'Shell (the host default: $SHELL -l since M2)', program: { shell: null, args: null } },
  claude: { kind: 'program', title: 'claude', tui: 'claude', program: { shell: '$CLAUDE', args: [] } },
  'claude-nosync': {
    kind: 'program',
    title: 'claude (no force-sync)',
    tui: 'claude',
    program: { shell: '/bin/sh', args: ['-c', 'unset CLAUDE_CODE_FORCE_SYNC_OUTPUT; exec "$0"', '$CLAUDE'] },
  },
  codex: { kind: 'program', title: 'codex', tui: 'codex', program: { shell: '$CODEX', args: [] } },
  less: { kind: 'typed', title: 'less /etc/services', command: 'less /etc/services\r' },
  seq20000: { kind: 'typed', title: 'seq 1 20000', command: 'seq 1 20000\r' },
  'stty-size': { kind: 'typed', title: 'stty size', command: 'stty size\r' },
  osc8: {
    kind: 'typed',
    title: 'OSC 8 link + bare URL',
    command: "printf '\\e]8;;https://example.com\\e\\\\example\\e]8;;\\e\\\\\\n'; printf 'https://example.org\\n'\r",
  },
  // M2 gate: an OSC 8 link whose scheme main must refuse (`pty.openLink` answers opened: false).
  'osc8-script': {
    kind: 'typed',
    title: 'OSC 8 javascript: link',
    command: "printf '\\e]8;;javascript:alert(1)\\e\\\\scripted\\e]8;;\\e\\\\\\n'\r",
  },
  colours: { kind: 'typed', title: 'red/blue', command: "printf '\\e[31mred \\e[34mblue\\e[0m\\n'\r" },
  W1: { title: 'W1 yes | head', ...flood(FOX, 20_363_636, 50_909_090) },
  W2: { title: 'W2 base64 urandom', ...flood(B64, 20_165_289, 50_413_223) },
  W3: { title: 'W3 seq 1..20000000', ...flood(SEQ, 22_638_888, 188_888_897, 168_888_897, SEQ) },
  width: {
    kind: 'program',
    title: 'width fixtures + DSR',
    measure: 'width',
    program: { shell: '/bin/sh', args: ['-c', widthScript, 'sh', ...widths.map((f) => f.text)] },
  },
  latency: { kind: 'program', title: 'input echo latency (cat)', measure: 'latency', program: { shell: '/bin/cat', args: [] } },
  // Item 13 without model cost: a scroll region with inserted and deleted lines, checked against the expected screen.
  'scroll-region': {
    kind: 'program',
    title: 'scroll region inserts',
    measure: 'screen',
    program: {
      shell: '/bin/sh',
      args: [
        '-c',
        "printf '\\033[2J\\033[H'; for i in 1 2 3 4 5 6 7 8; do printf 'row%s\\r\\n' $i; done; printf '\\033[2;6r\\033[3;1H\\033[2L\\033[3;1Hins1\\033[4;1Hins2\\033[5;1H\\033[1M\\033[r\\033[9;1Hdone\\r\\n'; sleep 1",
      ],
    },
    // region 2..6: IL 2 at row 3 pushes row3/row4 down (row5/row6 leave the region), DL 1 at row 5 removes row3
    expectedScreen: ['row1', 'row2', 'ins1', 'ins2', 'row4', '', 'row7', 'row8', 'done'],
  },
};

export const AUTOMATED_MEASUREMENTS = ['W1', 'W2', 'W3', 'width', 'latency'];

// The transport gate closing M2 (item 9 judged): the three floods at full size on the binary stream with acks. Each
// passes when its output bytes and line feeds are exact (checked by the page), its last line is right, its frame p95
// is at most 50 ms; MB/s is recorded against a floor (below it is a finding, not a switch).
export const GATE_MEASUREMENTS = ['W1', 'W2', 'W3'];
export const GATE_CRITERIA = {
  // 50,000,000 bytes of 55-byte lines end 50 bytes into a line
  W1: { lastLine: (line) => line === 'the quick brown fox jumps over the lazy dog 012345', floorMBps: 5 },
  // 50,000,000 bytes of 121-byte lines end 17 random base64 characters into a line
  W2: { lastLine: (line) => /^[A-Za-z0-9+/]{17}$/.test(line), floorMBps: 10 },
  W3: { lastLine: (line) => line === '20000000', floorMBps: null },
};
export const GATE_FRAME_P95_MS = 50;

// Resolves a program's `$CLAUDE`/`$CODEX` placeholders against the binaries in use.
export function resolveProgram(workload, phase, bins) {
  const spec = workload.program[phase] ?? workload.program;
  const substitute = (s) => (s === '$CLAUDE' ? bins.claude : s === '$CODEX' ? bins.codex : s);
  return { shell: spec.shell === null ? null : substitute(spec.shell), args: spec.args === null ? null : spec.args.map(substitute) };
}
