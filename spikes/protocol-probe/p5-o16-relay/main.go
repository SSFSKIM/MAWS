// P5 O16 M0, question 6 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M0; Interfaces §A): the session host's
// output hop, measured. A copy of D3's Go prototype (~/.local/share/maws-o16-lang/go-proto/main.go) given the hot path
// M1 decides: the child's stdout and stderr read line by line into one sequenced ring, each record written to a
// reading connection as soon as it is read, from the ring at that connection's cursor, one write per record (header
// and bytes), no batching; stdin taken as offset records and applied by one writer goroutine. It speaks §A's
// framing (NDJSON control lines, `out`/`err` headers followed by the line's bytes) with one addition the measurement
// needs: each output header carries `tr`, the host's monotonic clock (runtime.nanotime, CLOCK_MONOTONIC on Linux, the
// clock Node's process.hrtime reads) when the line was read off the pipe. Not the M1 binary: no roster, fence history,
// linger or signals beyond what the bench drives.
//
//	o16-relay <socket> <argv...>      the token is the first line of stdin; the child is spawned at `commit`
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"time"
	_ "unsafe" // runtime.nanotime
)

//go:linkname nanotime runtime.nanotime
func nanotime() int64

const ringCap = 8 << 20
const lineCap = 64 << 20

type record struct {
	seq  uint64
	kind string
	data []byte
	tr   int64
}

type host struct {
	mu       sync.Mutex
	ring     []record
	firstSeq uint64
	lastSeq  uint64
	bytes    int
	readers  map[*conn]struct{}
	exited   chan struct{}
	exitLine []byte
}

type conn struct {
	c      net.Conn
	wmu    sync.Mutex
	notify chan struct{}
	cursor uint64
}

func (k *conn) send(b []byte) error {
	k.wmu.Lock()
	defer k.wmu.Unlock()
	_, err := k.c.Write(b)
	return err
}

func (k *conn) control(v any) {
	b, _ := json.Marshal(v)
	_ = k.send(append(b, '\n'))
}

func (h *host) push(kind string, line []byte, tr int64) {
	h.mu.Lock()
	h.lastSeq++
	if h.firstSeq == 0 {
		h.firstSeq = h.lastSeq
	}
	h.ring = append(h.ring, record{h.lastSeq, kind, line, tr})
	h.bytes += len(line)
	for h.bytes > ringCap && len(h.ring) > 1 {
		h.bytes -= len(h.ring[0].data)
		h.ring = h.ring[1:]
		h.firstSeq = h.ring[0].seq
	}
	for k := range h.readers {
		select {
		case k.notify <- struct{}{}:
		default:
		}
	}
	h.mu.Unlock()
}

// Lines of one pipe, each stamped when its newline is read.
func (h *host) pump(kind string, r io.Reader) {
	br := bufio.NewReaderSize(r, 64<<10)
	var pending []byte
	for {
		chunk, err := br.ReadSlice('\n')
		if errors.Is(err, bufio.ErrBufferFull) {
			if len(pending)+len(chunk) <= lineCap {
				pending = append(pending, chunk...)
			}
			continue
		}
		if len(chunk) > 0 && err == nil {
			tr := nanotime()
			line := make([]byte, 0, len(pending)+len(chunk)-1)
			line = append(append(line, pending...), chunk[:len(chunk)-1]...)
			pending = pending[:0]
			h.push(kind, line, tr)
			continue
		}
		if err != nil {
			return
		}
	}
}

// Writes every record at or after the connection's cursor, one write per record, as soon as the ring has it.
func (h *host) serveReads(k *conn) {
	for {
		h.mu.Lock()
		if k.cursor < h.firstSeq {
			k.cursor = h.firstSeq
		}
		var batch []record
		if h.lastSeq >= k.cursor && h.firstSeq != 0 {
			batch = append(batch, h.ring[k.cursor-h.firstSeq:]...)
		}
		h.mu.Unlock()
		for _, r := range batch {
			head := []byte(`{"t":"` + r.kind + `","seq":` + strconv.FormatUint(r.seq, 10) + `,"len":` + strconv.Itoa(len(r.data)) + `,"tr":` + strconv.FormatInt(r.tr, 10) + "}\n")
			if err := k.send(append(head, r.data...)); err != nil {
				return
			}
			k.cursor = r.seq + 1
		}
		if len(batch) > 0 {
			continue
		}
		select {
		case <-k.notify:
		case <-h.exited:
			h.mu.Lock()
			done := h.lastSeq < k.cursor
			h.mu.Unlock()
			if done {
				_ = k.send(h.exitLine)
				return
			}
		}
	}
}

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: o16-relay <socket> <argv...>")
		os.Exit(2)
	}
	sock, argv := os.Args[1], os.Args[2:]
	_ = os.Remove(sock)
	ln, err := net.Listen("unix", sock)
	if err != nil {
		panic(err)
	}
	_ = os.Chmod(sock, 0o600)
	token, _ := bufio.NewReader(os.Stdin).ReadString('\n')
	if len(token) > 0 {
		token = token[:len(token)-1]
	}
	h := &host{readers: map[*conn]struct{}{}, exited: make(chan struct{})}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Env = os.Environ()
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	type inRec struct {
		data []byte
		k    *conn
		end  uint64
	}
	queue := make(chan inRec, 1024)
	var applied uint64
	go func() {
		for r := range queue {
			if _, err := stdin.Write(r.data); err != nil {
				r.k.control(map[string]any{"t": "stdinClosed", "applied": applied})
				continue
			}
			applied = r.end
			r.k.control(map[string]any{"t": "applied", "offset": applied})
		}
	}()
	var accepted uint64
	var started sync.Once
	fmt.Printf("ready %d\n", os.Getpid())
	for {
		c, err := ln.Accept()
		if err != nil {
			return
		}
		go func(c net.Conn) {
			defer c.Close()
			k := &conn{c: c, notify: make(chan struct{}, 1)}
			rd := bufio.NewReaderSize(c, 64<<10)
			first, err := rd.ReadBytes('\n')
			var auth struct{ T, Token string }
			if err != nil || json.Unmarshal(first, &auth) != nil || auth.T != "auth" || auth.Token != token {
				return
			}
			k.control(map[string]any{"t": "hello", "protocol": 1, "pid": os.Getpid()})
			for {
				line, err := rd.ReadBytes('\n')
				if err != nil {
					h.mu.Lock()
					delete(h.readers, k)
					h.mu.Unlock()
					return
				}
				var m struct {
					T       string
					FromSeq uint64 `json:"fromSeq"`
					Offset  uint64
					Len     int
				}
				if json.Unmarshal(line, &m) != nil {
					continue
				}
				switch m.T {
				case "attach":
					k.control(map[string]any{"t": "attached", "fence": 1})
				case "commit":
					started.Do(func() {
						if err := cmd.Start(); err != nil {
							k.control(map[string]any{"t": "spawnFailed", "message": err.Error()})
							return
						}
						go h.pump("out", stdout)
						go h.pump("err", stderr)
						go func() {
							err := cmd.Wait()
							code := cmd.ProcessState.ExitCode()
							b, _ := json.Marshal(map[string]any{"t": "exit", "code": code, "error": fmt.Sprint(err)})
							h.mu.Lock()
							h.exitLine = append(b, '\n')
							h.mu.Unlock()
							close(h.exited)
							// the bench's host ends with its child, once the reader had a moment for the exit record
							time.Sleep(time.Second)
							os.Exit(0)
						}()
						k.control(map[string]any{"t": "spawned", "pid": cmd.Process.Pid})
					})
				case "read":
					k.cursor = m.FromSeq
					h.mu.Lock()
					h.readers[k] = struct{}{}
					h.mu.Unlock()
					go h.serveReads(k)
				case "ack":
				case "stdin":
					data := make([]byte, m.Len)
					if _, err := io.ReadFull(rd, data); err != nil {
						return
					}
					if m.Offset != accepted {
						k.control(map[string]any{"t": "gap", "accepted": accepted})
						continue
					}
					accepted += uint64(m.Len)
					queue <- inRec{data, k, accepted}
				case "end":
					_ = stdin.Close()
				default:
					k.control(map[string]any{"t": "error", "message": "unknown t"})
				}
			}
		}(c)
	}
}
