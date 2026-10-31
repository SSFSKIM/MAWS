package host

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"sessionhost/proto"
	"sessionhost/ring"
)

// commit forks the launch: the child leads its own process group (what `detached: true` gives the engine today), with
// piped stdio and exactly the launch's environment. Answered `spawned` or `spawnFailed`.
func (h *Host) commit(c *conn) {
	h.mu.Lock()
	if !h.isWriter(c) {
		h.mu.Unlock()
		return
	}
	if h.state != stateReady {
		c.send(proto.Error{T: "error", Message: "commit was already sent"})
		h.mu.Unlock()
		return
	}
	if h.launch == nil {
		c.send(proto.Error{T: "error", Message: "commit needs a launch"})
		h.mu.Unlock()
		return
	}
	spec := *h.launch
	h.state = stateCommitted
	h.writeRoster()
	h.mu.Unlock()

	cmd, stdinW, outR, errR, err := startChild(spec)
	if err != nil {
		h.mu.Lock()
		h.spawnFailed, h.inClosed = true, true
		h.log.printf("spawn failed: %v", err)
		c.send(proto.SpawnFailed{T: "spawnFailed", Message: err.Error()})
		h.reviewNoChild()
		h.mu.Unlock()
		return
	}
	pid := cmd.Process.Pid
	start := procStartOf(pid)
	h.mu.Lock()
	h.child = &proto.Child{Pid: pid, ProcStart: start}
	h.stdinW, h.exited = stdinW, make(chan struct{})
	h.state = stateRunning
	h.writeRoster()
	h.log.printf("spawned %d", pid)
	c.send(proto.Spawned{T: "spawned", Pid: pid, ProcStart: start})
	h.reviewNoChild()
	h.mu.Unlock()

	var readers sync.WaitGroup
	readers.Add(2)
	go h.readLines(outR, ring.Out, &readers)
	go h.readLines(errR, ring.Err, &readers)
	go h.writeStdin(stdinW)
	go h.wait(cmd, &readers)
}

func startChild(spec launchSpec) (cmd *exec.Cmd, stdinW, outR, errR *os.File, err error) {
	path, err := resolveBinary(spec.argv[0], spec.env)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	var files []*os.File
	closeAll := func() {
		for _, f := range files {
			f.Close()
		}
	}
	pipe := func() (*os.File, *os.File) {
		r, w, perr := os.Pipe()
		if perr != nil && err == nil {
			err = perr
		}
		files = append(files, r, w)
		return r, w
	}
	inR, inW := pipe()
	oR, oW := pipe()
	eR, eW := pipe()
	if err != nil {
		closeAll()
		return nil, nil, nil, nil, err
	}
	cmd = &exec.Cmd{Path: path, Args: spec.argv, Dir: spec.cwd, Env: spec.env, Stdin: inR, Stdout: oW, Stderr: eW,
		SysProcAttr: &syscall.SysProcAttr{Setpgid: true}}
	err = cmd.Start()
	inR.Close()
	oW.Close()
	eW.Close()
	if err != nil {
		inW.Close()
		oR.Close()
		eR.Close()
		return nil, nil, nil, nil, err
	}
	return cmd, inW, oR, eR, nil
}

// resolveBinary takes argv[0] as a path when it has a slash, else looks it up in the launch's own PATH.
func resolveBinary(name string, env []string) (string, error) {
	if strings.Contains(name, "/") {
		return name, nil
	}
	path := ""
	for _, kv := range env {
		if v, ok := strings.CutPrefix(kv, "PATH="); ok {
			path = v
		}
	}
	for _, dir := range filepath.SplitList(path) {
		if dir == "" {
			dir = "."
		}
		candidate := filepath.Join(dir, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("%s: not found in the launch's PATH", name)
}

// readLines numbers each line of one of the child's streams into the ring. A line past the cap is dropped with a
// `problem` sent the moment it passes the cap (the manager decides the child's fate), and the rest of it up to its
// newline is discarded. An unterminated last line at end of file is a record, as the direct transport's flush is.
func (h *Host) readLines(r *os.File, kind ring.Kind, done *sync.WaitGroup) {
	defer done.Done()
	defer r.Close()
	br := bufio.NewReaderSize(r, 64<<10)
	var line []byte
	over := false
	for {
		frag, err := br.ReadSlice('\n')
		complete := err == nil
		body := frag
		if complete {
			body = frag[:len(frag)-1]
		}
		switch {
		case over:
		case len(line)+len(body) > h.lim.LineCap:
			h.problem(kind, len(line)+len(body))
			over, line = true, nil
		default:
			line = append(line, body...)
		}
		if complete {
			if !over {
				h.record(kind, line)
			}
			line, over = nil, false
			continue
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if len(line) > 0 && !over {
			h.record(kind, line)
		}
		return
	}
}

func (h *Host) record(kind ring.Kind, data []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, evicted := h.ring.Append(kind, data); evicted {
		h.closeLagging()
	}
	for c := range h.conns {
		if c.reading {
			c.poke()
		}
	}
}

func (h *Host) problem(kind ring.Kind, length int) {
	stream := "out"
	if kind == ring.Err {
		stream = "err"
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.log.printf("dropped a %s line over %d bytes", stream, h.lim.LineCap)
	for c := range h.conns {
		c.send(proto.Problem{T: "problem", Kind: "line_budget", Length: length, Stream: stream})
	}
}

// writeStdin is the one writer of the child's stdin: whole records from the queue in arrival order, each answered
// `applied` once every byte reached the pipe, or `stdinClosed` with the bytes that did when the pipe closed under it.
func (h *Host) writeStdin(w *os.File) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for {
		for len(h.queue) == 0 && !h.endAsked && !h.inClosed {
			h.inCond.Wait()
		}
		if h.inClosed {
			break
		}
		if len(h.queue) == 0 { // `end`, with every record applied
			h.inClosed = true
			w.Close()
			h.log.printf("stdin ended by the writer")
			break
		}
		q := h.queue[0]
		h.mu.Unlock()
		n, err := w.Write(q.data)
		h.mu.Lock()
		h.queue[0] = queued{}
		h.queue = h.queue[1:]
		h.in.Apply(len(q.data))
		if err != nil {
			h.inClosed = true
			w.Close()
			h.log.printf("stdin closed under a record: %d of %d bytes written", n, len(q.data))
			q.origin.send(proto.StdinClosed{T: "stdinClosed", Applied: h.in.Applied, Partial: n})
			break
		}
		q.origin.send(proto.Applied{T: "applied", Offset: h.in.Applied})
		h.settleAttach()
	}
	for _, q := range h.queue { // what was still queued never reached the pipe, and counts as applied
		h.in.Apply(len(q.data))
		q.origin.send(proto.StdinClosed{T: "stdinClosed", Applied: h.in.Applied, Partial: 0})
	}
	h.queue = nil
	h.settleAttach()
}

// wait records the child's exit once its output has reached end of file (or after ExitDrain, when a descendant holds
// the pipes), tells every client, and starts the linger.
func (h *Host) wait(cmd *exec.Cmd, readers *sync.WaitGroup) {
	cmd.Wait()
	drained := make(chan struct{})
	go func() {
		readers.Wait()
		close(drained)
	}()
	select {
	case <-drained:
	case <-time.After(h.lim.ExitDrain):
		h.log.printf("the output pipes are still open after the child's exit (a descendant holds them)")
	}
	exit := exitOf(cmd.ProcessState)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.exit, h.state = &exit, stateExited
	h.inClosed = true
	h.inCond.Broadcast()
	h.stdinW.Close() // a write blocked on a pipe no one reads returns now
	h.writeRoster()
	for c := range h.conns {
		c.send(proto.ExitMsg{T: "exit", Exit: exit})
	}
	h.log.printf("the child exited: %s", describeExit(exit))
	h.linger = time.AfterFunc(h.lim.Linger, func() {
		h.log.printf("the linger ended")
		h.requestQuit(0)
	})
	close(h.exited)
}

func exitOf(ps *os.ProcessState) proto.Exit {
	exit := proto.Exit{At: isoNow()}
	if ps == nil {
		return exit
	}
	if ws, ok := ps.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
		name := signalName(ws.Signal())
		exit.Signal = &name
		return exit
	}
	code := ps.ExitCode()
	exit.Code = &code
	return exit
}

func describeExit(e proto.Exit) string {
	if e.Signal != nil {
		return "signal " + *e.Signal
	}
	if e.Code != nil {
		return fmt.Sprintf("code %d", *e.Code)
	}
	return "unknown"
}
