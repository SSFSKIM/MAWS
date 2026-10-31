// Package host is the session host (O16 M1; Interfaces §A, §B): one per lane B process, it owns `claude`'s pipes,
// numbers every output line into the ring, applies stdin by offset exactly once, holds the writer fence, writes its
// roster entry and serves one Unix socket. It has no self-termination policy beyond its own housekeeping: it exits when
// its writer releases it after the child's exit, when the linger after that exit ends, when it has no child and no
// writer, or on its own SIGTERM, SIGINT or SIGHUP, which it relays to the child's process group first (D7).
package host

import (
	"bufio"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"syscall"
	"time"

	"sessionhost/proto"
	"sessionhost/ring"
	"sessionhost/roster"
)

// Version is the binary's version, printed by --version.
const Version = "1.0.0"

// Options name the host's socket and files; HolderID is the launch id.
type Options struct {
	SocketPath string
	HostsDir   string
	HolderID   string
	Binary     string
	Limits     Limits
	Signals    <-chan os.Signal // the host's own SIGTERM, SIGINT and SIGHUP
}

const (
	stateReady     = "ready"
	stateCommitted = "committed"
	stateRunning   = "running"
	stateExited    = "exited"
)

type launchSpec struct {
	argv []string
	cwd  string
	env  []string
}

type queued struct {
	data   []byte
	origin *conn // answered `applied` or `stdinClosed` when the record leaves the queue
}

// Host is one session host. Every field below mu is guarded by it.
type Host struct {
	opt       Options
	lim       Limits
	log       *logger
	pid       int
	procStart string
	startedAt string
	tokenSet  chan struct{} // closed once a valid token is read
	token     string
	tokenOnce sync.Once
	quit      chan int

	mu          sync.Mutex
	inCond      *sync.Cond // the stdin goroutine waits on it
	ln          *net.UnixListener
	closing     bool
	state       string
	ring        *ring.Ring
	fence       Fence
	writer      *conn
	pending     *conn   // a writer whose fence won, waiting for the queue it supersedes to be applied
	superseded  []*conn // writers told `fenced` once that queue is applied
	conns       map[*conn]struct{}
	launch      *launchSpec
	appID       *string
	engineID    *string
	child       *proto.Child
	stdinW      *os.File
	exit        *proto.Exit
	exited      chan struct{} // closed at the child's exit, once it is recorded
	spawnFailed bool
	in          Offsets
	queue       []queued
	inClosed    bool // the child's stdin is gone: ended, closed under a write, the child exited, or never opened
	endAsked    bool
	noChild     *time.Timer
	linger      *time.Timer
}

// New makes the host's directories, opens its log, listens on its socket and writes its roster entry (`ready`).
func New(opt Options) (*Host, error) {
	h := &Host{opt: opt, lim: opt.Limits, tokenSet: make(chan struct{}), quit: make(chan int, 1), state: stateReady,
		ring: ring.New(opt.Limits.RingCap), conns: map[*conn]struct{}{}}
	h.inCond = sync.NewCond(&h.mu)
	h.in.Cap = opt.Limits.StdinQueueCap
	if err := makePrivateDir(opt.HostsDir); err != nil {
		return nil, err
	}
	log, err := openLog(filepath.Join(opt.HostsDir, opt.HolderID+".log"))
	if err != nil {
		return nil, err
	}
	h.log = log
	if err := makePrivateDir(filepath.Dir(opt.SocketPath)); err != nil {
		log.printf("refused the socket's directory: %v", err)
		return nil, err
	}
	ln, err := listenAt(opt.SocketPath)
	if err != nil {
		log.printf("cannot listen on %s: %v", opt.SocketPath, err)
		return nil, err
	}
	h.ln = ln
	h.pid = os.Getpid()
	h.procStart = procStartOf(h.pid)
	h.startedAt = isoNow()
	h.mu.Lock()
	h.writeRoster()
	h.mu.Unlock()
	log.printf("ready: pid %d, socket %s", h.pid, opt.SocketPath)
	return h, nil
}

// SetToken gives the host the token the engine host wrote on its stdin; one that is not 64 hex ends the host.
func (h *Host) SetToken(token string) {
	h.tokenOnce.Do(func() {
		if _, err := hex.DecodeString(token); err != nil || len(token) != 64 {
			h.log.printf("the token on stdin is not 64 hex; exiting")
			h.requestQuit(1)
			return
		}
		h.token = token
		close(h.tokenSet)
	})
}

// Run serves until the host exits and returns its exit code; its files are removed by then.
func (h *Host) Run() int {
	go h.accept(h.ln)
	go h.watchSocket()
	h.mu.Lock()
	h.reviewNoChild()
	h.mu.Unlock()
	select {
	case sig := <-h.opt.Signals:
		return h.onSignal(sig)
	case code := <-h.quit:
		h.finish()
		return code
	}
}

func (h *Host) requestQuit(code int) {
	select {
	case h.quit <- code:
	default:
	}
}

// onSignal relays the host's own signal to the child's process group as SIGTERM and gives the child the grace to
// exit: a host that died leaving its engine would leave an engine nothing can reach (D7).
func (h *Host) onSignal(sig os.Signal) int {
	h.mu.Lock()
	alive := h.child != nil && h.exit == nil
	pgid, exited := 0, h.exited
	if alive {
		pgid = h.child.Pid
	}
	h.mu.Unlock()
	h.log.printf("%v: ending the child's process group", sig)
	if alive {
		if err := syscall.Kill(-pgid, syscall.SIGTERM); err != nil {
			h.log.printf("SIGTERM to group %d: %v", pgid, err)
		}
		select {
		case <-exited:
		case <-time.After(h.lim.HostExitGrace):
			h.log.printf("the child did not exit within %v", h.lim.HostExitGrace)
		}
	}
	h.finish()
	return 0
}

// finish closes everything and removes the socket, the token and, unless the child outlives the host, the roster
// entry: an entry whose host is dead and whose child lives is how the next engine host's sweep finds that child.
func (h *Host) finish() {
	h.mu.Lock()
	h.closing = true
	childAlive := h.child != nil && h.exit == nil
	for c := range h.conns {
		c.closed = true
		c.poke()
		c.nc.Close()
	}
	for _, t := range []*time.Timer{h.noChild, h.linger} {
		if t != nil {
			t.Stop()
		}
	}
	ln := h.ln
	h.mu.Unlock()
	ln.Close()
	if info, err := os.Lstat(h.opt.SocketPath); err == nil && info.Mode()&fs.ModeSocket != 0 {
		os.Remove(h.opt.SocketPath)
	}
	if err := os.Remove(filepath.Join(h.opt.HostsDir, h.opt.HolderID+".token")); err != nil && !errors.Is(err, fs.ErrNotExist) {
		h.log.printf("removing the token: %v", err)
	}
	if childAlive {
		h.log.printf("the child outlives its host; its roster entry stays for the sweep")
	} else if err := roster.Remove(h.opt.HostsDir, h.opt.HolderID); err != nil {
		h.log.printf("removing the roster entry: %v", err)
	}
	h.log.printf("exit")
	h.log.close()
}

// writeRoster writes the entry from the current state; the caller holds mu.
func (h *Host) writeRoster() {
	err := roster.Write(h.opt.HostsDir, roster.Entry{
		Protocol: proto.Protocol, HolderID: h.opt.HolderID, Pid: h.pid, ProcStart: h.procStart, StartedAt: h.startedAt,
		Socket: h.opt.SocketPath, Binary: h.opt.Binary, AppSessionID: h.appID, EngineSessionID: h.engineID,
		State: h.state, Child: h.child, Fence: h.fence.Value(), Exit: h.exit,
	})
	if err != nil {
		h.log.printf("writing the roster entry: %v", err)
	}
}

func (h *Host) ringInfo() proto.RingInfo {
	return proto.RingInfo{FirstSeq: h.ring.FirstSeq(), LastSeq: h.ring.LastSeq(), Bytes: h.ring.Bytes()}
}

func (h *Host) hello() proto.Hello {
	return proto.Hello{T: "hello", Protocol: proto.Protocol, HolderID: h.opt.HolderID, Pid: h.pid, ProcStart: h.procStart,
		AppSessionID: h.appID, EngineSessionID: h.engineID, State: h.state, Child: h.child, Fence: h.fence.Value(),
		Writer: h.writer != nil, StdinApplied: h.in.Applied, StdinAccepted: h.in.Accepted, StdinQueued: h.in.Queued,
		Ring: h.ringInfo(), Exit: h.exit}
}

func (h *Host) attached() proto.Attached {
	return proto.Attached{T: "attached", Fence: h.fence.Value(), StdinApplied: h.in.Applied, StdinAccepted: h.in.Accepted, Ring: h.ringInfo()}
}

// reviewNoChild arms the no-child exit while the host has no child and no writer, and disarms it otherwise: a host
// with nothing to protect, whose manager is gone, exits rather than wait for a writer that may never come.
func (h *Host) reviewNoChild() {
	idle := !h.closing && h.child == nil && h.writer == nil && h.pending == nil && (h.state == stateReady || h.spawnFailed)
	if idle && h.noChild == nil {
		h.noChild = time.AfterFunc(h.lim.NoChild, func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.noChild = nil
			if h.child == nil && h.writer == nil && h.pending == nil {
				h.log.printf("no child and no writer for %v; exiting", h.lim.NoChild)
				h.requestQuit(0)
			}
		})
	}
	if !idle && h.noChild != nil {
		h.noChild.Stop()
		h.noChild = nil
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// The socket

func listenAt(path string) (*net.UnixListener, error) {
	if err := clearSocketPath(path); err != nil {
		return nil, err
	}
	ln, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return nil, err
	}
	ln.SetUnlinkOnClose(false) // the host removes its socket itself, and only its own
	if err := os.Chmod(path, 0o600); err != nil {
		ln.Close()
		return nil, err
	}
	return ln, nil
}

func (h *Host) accept(ln *net.UnixListener) {
	for {
		nc, err := ln.Accept()
		if err != nil {
			return
		}
		go h.serve(nc)
	}
}

// watchSocket listens again at the same path when the socket file is gone (a tmpdir fallback's directory is subject to
// macOS's periodic cleanup of untouched files).
func (h *Host) watchSocket() {
	tick := time.NewTicker(h.lim.SocketCheck)
	defer tick.Stop()
	for range tick.C {
		h.mu.Lock()
		closing := h.closing
		h.mu.Unlock()
		if closing {
			return
		}
		if _, err := os.Lstat(h.opt.SocketPath); !errors.Is(err, fs.ErrNotExist) {
			continue
		}
		h.log.printf("the socket file is gone; listening again")
		if err := makePrivateDir(filepath.Dir(h.opt.SocketPath)); err != nil {
			h.log.printf("refused the socket's directory: %v", err)
			continue
		}
		ln, err := listenAt(h.opt.SocketPath)
		if err != nil {
			h.log.printf("cannot listen again: %v", err)
			continue
		}
		h.mu.Lock()
		if h.closing {
			h.mu.Unlock()
			ln.Close()
			return
		}
		old := h.ln
		h.ln = ln
		h.mu.Unlock()
		old.Close()
		go h.accept(ln)
	}
}

// serve authenticates a connection, then reads its commands until it closes: the first line must be `auth` with the
// token, within the auth window, or the connection is closed with nothing written.
func (h *Host) serve(nc net.Conn) {
	deadline := time.Now().Add(h.lim.AuthWindow)
	nc.SetReadDeadline(deadline)
	br := bufio.NewReaderSize(nc, 64<<10)
	line, err := proto.ReadLine(br, authLineCap)
	var m proto.ClientMsg
	if err != nil || json.Unmarshal(line, &m) != nil || m.T != "auth" {
		nc.Close()
		return
	}
	select {
	case <-h.tokenSet:
	case <-time.After(time.Until(deadline)):
		nc.Close()
		return
	}
	if subtle.ConstantTimeCompare([]byte(m.Token), []byte(h.token)) != 1 {
		h.log.printf("refused a connection's token")
		nc.Close()
		return
	}
	nc.SetReadDeadline(time.Time{})
	c := &conn{h: h, nc: nc, wake: make(chan struct{}, 1)}
	h.mu.Lock()
	if h.closing {
		h.mu.Unlock()
		nc.Close()
		return
	}
	h.conns[c] = struct{}{}
	c.send(h.hello())
	h.mu.Unlock()
	go c.sendLoop()
	h.readLoop(c, br)
	h.drop(c)
}

func (h *Host) readLoop(c *conn, br *bufio.Reader) {
	for {
		m, payload, err := proto.ReadFrame(br, h.lim.FrameCap, h.lim.LineCap)
		if err != nil {
			if errors.Is(err, proto.ErrFrame) {
				// answered, then closed once the answer is written (or after a second, for a client that reads nothing)
				h.mu.Lock()
				c.send(proto.Error{T: "error", Message: err.Error()})
				c.ending = true
				c.poke()
				h.mu.Unlock()
				stop := time.AfterFunc(time.Second, func() { c.nc.Close() })
				io.Copy(io.Discard, br)
				stop.Stop()
			}
			return
		}
		if m.T == "commit" {
			h.commit(c)
		} else {
			h.handle(c, m, payload)
		}
	}
}

func (h *Host) drop(c *conn) {
	h.mu.Lock()
	c.closed = true
	c.poke()
	delete(h.conns, c)
	if h.writer == c {
		h.writer = nil
		h.log.printf("the writer's connection closed")
	}
	if h.pending == c {
		h.pending = nil
	}
	for i, old := range h.superseded {
		if old == c {
			h.superseded = append(h.superseded[:i], h.superseded[i+1:]...)
			break
		}
	}
	h.reviewNoChild()
	h.mu.Unlock()
	c.nc.Close()
}

// closeLagging closes every reading connection whose next record has left the ring: it cannot be served in order,
// and its client reads again from the ring on reconnect (a `caughtUp` with a gap). The caller holds mu.
func (h *Host) closeLagging() {
	first := h.ring.FirstSeq()
	for c := range h.conns {
		if c.reading && !c.closed && c.cursor < first {
			h.log.printf("a connection fell behind the ring at seq %d (first %d); closed", c.cursor, first)
			c.closed = true
			c.poke()
			c.nc.Close()
		}
	}
}

// ---------------------------------------------------------------------------------------------------------------------
// Commands

// isWriter answers a writer-only command from any other connection: `fenced` to a superseded writer, `error` else.
func (h *Host) isWriter(c *conn) bool {
	if c == h.writer {
		return true
	}
	if c.fenced {
		c.send(proto.Fenced{T: "fenced", Fence: h.fence.Value()})
	} else {
		c.send(proto.Error{T: "error", Message: "not the writer"})
	}
	return false
}

func (h *Host) handle(c *conn, m proto.ClientMsg, payload []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch m.T {
	case "hb":
	case "attach":
		h.attach(c, m)
	case "launch":
		if !h.isWriter(c) {
			return
		}
		if h.state != stateReady || h.launch != nil {
			c.send(proto.Error{T: "error", Message: "launch was already given"})
			return
		}
		if len(m.Argv) == 0 || m.Argv[0] == "" {
			c.send(proto.Error{T: "error", Message: "launch needs argv"})
			return
		}
		env := make([]string, 0, len(m.Env)) // never nil: a nil Env would hand the child the host's environment
		for k, v := range m.Env {
			env = append(env, k+"="+v)
		}
		sort.Strings(env)
		h.launch = &launchSpec{argv: m.Argv, cwd: m.Cwd, env: env}
		h.appID, h.engineID = m.AppSessionID, m.EngineSessionID
		h.writeRoster()
		h.log.printf("launch: %s", m.Argv[0])
	case "read":
		if c.role == "" {
			c.send(proto.Error{T: "error", Message: "attach first"})
			return
		}
		from := max(m.FromSeq, 1)
		first := h.ring.FirstSeq()
		c.reading, c.cursor, c.gap = true, from, nil
		if from < first {
			gap := first
			c.cursor, c.gap = first, &gap
		}
		c.replayEnd, c.caughtUpDue = h.ring.LastSeq(), true
		c.poke()
	case "ack":
		if !h.isWriter(c) {
			return
		}
		h.ring.Ack(m.Seq)
		h.closeLagging()
	case "stdin":
		h.stdin(c, m, payload)
	case "end":
		if !h.isWriter(c) {
			return
		}
		h.endAsked = true
		h.inCond.Broadcast()
	case "signal":
		if !h.isWriter(c) {
			return
		}
		sig, ok := signalsByName[m.Name]
		if !ok {
			c.send(proto.Error{T: "error", Message: "signal takes SIGTERM, SIGINT or SIGKILL"})
			return
		}
		if h.child == nil || h.exit != nil {
			c.send(proto.Error{T: "error", Message: "no running child"})
			return
		}
		target := h.child.Pid
		if m.Group {
			target = -target // the child leads its own process group
		}
		h.log.printf("signal %s to %d", m.Name, target)
		if err := syscall.Kill(target, sig); err != nil {
			c.send(proto.Error{T: "error", Message: "signal: " + err.Error()})
		}
	case "release":
		if !h.isWriter(c) {
			return
		}
		if (h.child != nil && h.exit == nil) || (h.state == stateCommitted && !h.spawnFailed) {
			c.send(proto.Error{T: "error", Message: "the child has not exited"})
			return
		}
		h.log.printf("released by the writer")
		h.requestQuit(0)
	case "auth":
		c.send(proto.Error{T: "error", Message: "already authenticated"})
	default:
		c.send(proto.Error{T: "error", Message: "unknown t"})
	}
}

// attach: a writer whose fence exceeds the host's wins the fence at once, and is answered `attached` once every
// record the writers it supersedes had queued is applied, so its offsets never move under it; those writers are told
// `fenced` at the same moment and refused from then on.
func (h *Host) attach(c *conn, m proto.ClientMsg) {
	switch m.Role {
	case "writer":
		if m.Fence == nil {
			c.send(proto.Error{T: "error", Message: "attach writer needs a fence"})
			return
		}
		if !h.fence.Supersede(*m.Fence) {
			c.send(proto.Refused{T: "refused", Reason: "fence"})
			return
		}
		h.log.printf("writer fence %d", *m.Fence)
		if h.pending != nil && h.pending != c {
			h.pending.fenced, h.pending.role = true, ""
			h.pending.send(proto.Fenced{T: "fenced", Fence: h.fence.Value()})
		}
		if h.writer != nil && h.writer != c {
			h.writer.fenced = true
			h.superseded = append(h.superseded, h.writer)
		}
		h.writer, h.pending = nil, c
		c.role = "pending"
		h.writeRoster()
		h.settleAttach()
	case "observer":
		if c == h.writer || c == h.pending {
			c.send(proto.Refused{T: "refused", Reason: "role"})
			return
		}
		c.role = "observer"
		c.send(h.attached())
	default:
		c.send(proto.Refused{T: "refused", Reason: "role"})
	}
}

// settleAttach completes a pending writer's attach once the stdin queue is empty. The caller holds mu.
func (h *Host) settleAttach() {
	if h.pending == nil || h.in.Queued > 0 {
		return
	}
	for _, old := range h.superseded {
		old.send(proto.Fenced{T: "fenced", Fence: h.fence.Value()})
	}
	h.superseded = nil
	c := h.pending
	h.pending, h.writer = nil, c
	c.role = "writer"
	c.send(h.attached())
	h.reviewNoChild()
}

// stdin queues a record iff its offset is the accepted one (Interfaces §A's input semantics, D30). The caller holds mu.
func (h *Host) stdin(c *conn, m proto.ClientMsg, payload []byte) {
	if !h.isWriter(c) {
		return
	}
	if m.Offset == nil {
		c.send(proto.Error{T: "error", Message: "stdin needs an offset"})
		return
	}
	if h.child == nil && !h.spawnFailed {
		c.send(proto.Error{T: "error", Message: "no child to write to"})
		return
	}
	switch h.in.Offer(*m.Offset, len(payload)) {
	case Duplicate:
		c.send(proto.Duplicate{T: "duplicate", Accepted: h.in.Accepted, Applied: h.in.Applied})
	case Gap:
		c.send(proto.Gap{T: "gap", Accepted: h.in.Accepted})
	case Busy:
		c.send(proto.Busy{T: "busy", Queued: h.in.Queued})
	case Queue:
		if h.inClosed {
			h.in.Apply(len(payload))
			c.send(proto.StdinClosed{T: "stdinClosed", Applied: h.in.Applied, Partial: 0})
			return
		}
		h.queue = append(h.queue, queued{data: payload, origin: c})
		h.inCond.Broadcast()
	}
}
