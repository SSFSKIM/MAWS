// Package proto is the session host protocol's wire form (O16 Interfaces §A): newline-delimited JSON control lines,
// plus two length-prefixed byte records, `stdin` from the client and `out`/`err` from the host, whose header line is
// followed by exactly `len` raw bytes. The protocol grows additively within its major: unknown fields are ignored.
package proto

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
)

// Protocol is this major's number, carried by `hello` and the roster entry.
const Protocol = 1

// ErrFrame is a framing violation the connection cannot recover from: an oversize line or record, a line that is not
// JSON, or a record length out of range. The host answers `error` where it can and closes the connection.
var ErrFrame = errors.New("frame")

// ClientMsg is any client → host line; each `t` reads the fields it needs.
type ClientMsg struct {
	T               string            `json:"t"`
	Token           string            `json:"token"`
	Role            string            `json:"role"`
	Fence           *uint64           `json:"fence"`
	AppSessionID    *string           `json:"appSessionId"`
	EngineSessionID *string           `json:"engineSessionId"`
	Argv            []string          `json:"argv"`
	Cwd             string            `json:"cwd"`
	Env             map[string]string `json:"env"`
	FromSeq         uint64            `json:"fromSeq"`
	Seq             uint64            `json:"seq"`
	Offset          *uint64           `json:"offset"`
	Len             int64             `json:"len"`
	Name            string            `json:"name"`
	Group           bool              `json:"group"`
}

// ReadLine reads one line of at most max bytes, without its newline.
func ReadLine(br *bufio.Reader, max int) ([]byte, error) {
	var buf []byte
	for {
		frag, err := br.ReadSlice('\n')
		if len(buf)+len(frag) > max+1 {
			return nil, fmt.Errorf("%w: a line over %d bytes", ErrFrame, max)
		}
		buf = append(buf, frag...)
		if err == nil {
			return buf[:len(buf)-1], nil
		}
		if !errors.Is(err, bufio.ErrBufferFull) {
			return nil, err
		}
	}
}

// ReadFrame reads one client line and, for `stdin`, the record's bytes that follow it.
func ReadFrame(br *bufio.Reader, lineCap, payloadCap int) (ClientMsg, []byte, error) {
	var m ClientMsg
	line, err := ReadLine(br, lineCap)
	if err != nil {
		return m, nil, err
	}
	if err := json.Unmarshal(line, &m); err != nil {
		return m, nil, fmt.Errorf("%w: %v", ErrFrame, err)
	}
	if m.T != "stdin" {
		return m, nil, nil
	}
	if m.Len < 0 || m.Len > int64(payloadCap) {
		return m, nil, fmt.Errorf("%w: a stdin record of %d bytes (cap %d)", ErrFrame, m.Len, payloadCap)
	}
	payload := make([]byte, m.Len)
	if _, err := io.ReadFull(br, payload); err != nil {
		return m, nil, err
	}
	return m, payload, nil
}

// Line encodes one host → client control line.
func Line(v any) []byte {
	out, err := json.Marshal(v)
	if err != nil {
		panic(err) // every host message is a plain struct
	}
	return append(out, '\n')
}

// RecordHeader is the line that precedes an output record's bytes: `t` is "out" or "err".
func RecordHeader(t string, seq uint64, n int) []byte {
	b := make([]byte, 0, 48)
	b = append(b, `{"t":"`...)
	b = append(b, t...)
	b = append(b, `","seq":`...)
	b = strconv.AppendUint(b, seq, 10)
	b = append(b, `,"len":`...)
	b = strconv.AppendInt(b, int64(n), 10)
	return append(b, "}\n"...)
}

// Child names the child process by its pid and start time.
type Child struct {
	Pid       int    `json:"pid"`
	ProcStart string `json:"procStart"`
}

// Exit is the child's exit as waitpid reported it: a code, or the signal that ended it.
type Exit struct {
	Code   *int    `json:"code"`
	Signal *string `json:"signal"`
	At     string  `json:"at"`
}

// RingInfo is the ring's extent.
type RingInfo struct {
	FirstSeq uint64 `json:"firstSeq"`
	LastSeq  uint64 `json:"lastSeq"`
	Bytes    int    `json:"bytes"`
}

// Hello is the host's first line after a successful auth.
type Hello struct {
	T               string   `json:"t"`
	Protocol        int      `json:"protocol"`
	HolderID        string   `json:"holderId"`
	Pid             int      `json:"pid"`
	ProcStart       string   `json:"procStart"`
	AppSessionID    *string  `json:"appSessionId"`
	EngineSessionID *string  `json:"engineSessionId"`
	State           string   `json:"state"`
	Child           *Child   `json:"child"`
	Fence           uint64   `json:"fence"`
	Writer          bool     `json:"writer"`
	StdinApplied    uint64   `json:"stdinApplied"`
	StdinAccepted   uint64   `json:"stdinAccepted"`
	StdinQueued     int      `json:"stdinQueued"`
	Ring            RingInfo `json:"ring"`
	Exit            *Exit    `json:"exit"`
}

type Spawned struct {
	T         string `json:"t"`
	Pid       int    `json:"pid"`
	ProcStart string `json:"procStart"`
}

type SpawnFailed struct {
	T       string `json:"t"`
	Message string `json:"message"`
}

type Attached struct {
	T             string   `json:"t"`
	Fence         uint64   `json:"fence"`
	StdinApplied  uint64   `json:"stdinApplied"`
	StdinAccepted uint64   `json:"stdinAccepted"`
	Ring          RingInfo `json:"ring"`
}

type Refused struct {
	T      string `json:"t"`
	Reason string `json:"reason"`
}

type CaughtUp struct {
	T       string  `json:"t"`
	LastSeq uint64  `json:"lastSeq"`
	Gap     *uint64 `json:"gap"`
}

type Applied struct {
	T      string `json:"t"`
	Offset uint64 `json:"offset"`
}

type Duplicate struct {
	T        string `json:"t"`
	Accepted uint64 `json:"accepted"`
	Applied  uint64 `json:"applied"`
}

type Gap struct {
	T        string `json:"t"`
	Accepted uint64 `json:"accepted"`
}

type Fenced struct {
	T     string `json:"t"`
	Fence uint64 `json:"fence"`
}

type Busy struct {
	T      string `json:"t"`
	Queued int    `json:"queued"`
}

type StdinClosed struct {
	T       string `json:"t"`
	Applied uint64 `json:"applied"`
	Partial int    `json:"partial"`
}

type ExitMsg struct {
	T string `json:"t"`
	Exit
}

// Problem reports what the host could not do and went on without: `line_budget`, a line over the cap, dropped (with
// its `length` and its `stream`, "out" or "err"), or `roster`, an entry write that failed (with a `message`; the next
// state change writes it again). `stream` and the `roster` kind are additive.
type Problem struct {
	T       string `json:"t"`
	Kind    string `json:"kind"`
	Length  int    `json:"length,omitempty"`
	Stream  string `json:"stream,omitempty"`
	Message string `json:"message,omitempty"`
}

type Error struct {
	T       string `json:"t"`
	Message string `json:"message"`
}
