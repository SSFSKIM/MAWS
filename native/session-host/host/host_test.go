package host

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

const testToken = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

type harness struct {
	t       *testing.T
	h       *Host
	dir     string
	sock    string
	signals chan os.Signal
	done    chan int
}

func start(t *testing.T, tune func(*Limits)) *harness {
	t.Helper()
	dir, err := os.MkdirTemp("", "msh") // short: a socket path must fit sun_path
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	hosts := filepath.Join(dir, "hosts")
	if err := os.Mkdir(hosts, 0o700); err != nil {
		t.Fatal(err)
	}
	limits := DefaultLimits()
	if tune != nil {
		tune(&limits)
	}
	sig := make(chan os.Signal, 1)
	sock := filepath.Join(hosts, "TESTHOST.sock")
	h, err := New(Options{SocketPath: sock, HostsDir: hosts, HolderID: "TESTHOST", Binary: "/test/maws-session-host", Limits: limits, Signals: sig})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hosts, "TESTHOST.token"), []byte(testToken), 0o600); err != nil {
		t.Fatal(err)
	}
	done := make(chan int, 1)
	go func() { done <- h.Run() }()
	h.SetToken(testToken)
	t.Cleanup(func() {
		select {
		case sig <- syscall.SIGTERM:
		default:
		}
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("the host did not exit at cleanup")
		}
	})
	return &harness{t: t, h: h, dir: hosts, sock: sock, signals: sig, done: done}
}

func (hs *harness) waitExit(within time.Duration) int {
	hs.t.Helper()
	select {
	case code := <-hs.done:
		hs.done <- code // the cleanup reads it again
		return code
	case <-time.After(within):
		hs.t.Fatal("the host did not exit")
		return -1
	}
}

type client struct {
	t  *testing.T
	nc net.Conn
	br *bufio.Reader
}

type msg struct {
	T    string
	Raw  map[string]any
	Data []byte // an out or err record's bytes
}

func dial(t *testing.T, sock string) *client {
	t.Helper()
	var nc net.Conn
	var err error
	for i := 0; i < 100; i++ {
		if nc, err = net.Dial("unix", sock); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { nc.Close() })
	return &client{t: t, nc: nc, br: bufio.NewReader(nc)}
}

func (c *client) send(v map[string]any) {
	c.t.Helper()
	b, _ := json.Marshal(v)
	if _, err := c.nc.Write(append(b, '\n')); err != nil {
		c.t.Fatal(err)
	}
}

func (c *client) stdin(offset uint64, data string) {
	c.t.Helper()
	header := fmt.Sprintf(`{"t":"stdin","offset":%d,"len":%d}`+"\n", offset, len(data))
	if _, err := c.nc.Write(append([]byte(header), data...)); err != nil {
		c.t.Fatal(err)
	}
}

func (c *client) next() (msg, error) {
	c.nc.SetReadDeadline(time.Now().Add(5 * time.Second))
	line, err := c.br.ReadBytes('\n')
	if err != nil {
		return msg{}, err
	}
	var raw map[string]any
	if err := json.Unmarshal(line, &raw); err != nil {
		c.t.Fatalf("not JSON: %q", line)
	}
	m := msg{T: raw["t"].(string), Raw: raw}
	if m.T == "out" || m.T == "err" {
		m.Data = make([]byte, int(raw["len"].(float64)))
		if _, err := io.ReadFull(c.br, m.Data); err != nil {
			return msg{}, err
		}
	}
	return m, nil
}

// expect reads until a message of type t, failing on any type in `never`.
func (c *client) expect(t string, never ...string) msg {
	c.t.Helper()
	for {
		m, err := c.next()
		if err != nil {
			c.t.Fatalf("waiting for %s: %v", t, err)
		}
		for _, bad := range never {
			if m.T == bad {
				c.t.Fatalf("got %s while waiting for %s: %v", m.T, t, m.Raw)
			}
		}
		if m.T == t {
			return m
		}
	}
}

func num(m msg, key string) uint64 { return uint64(m.Raw[key].(float64)) }

func (hs *harness) writer(fence uint64) *client {
	c := dial(hs.t, hs.sock)
	c.send(map[string]any{"t": "auth", "token": testToken})
	c.expect("hello")
	c.send(map[string]any{"t": "attach", "role": "writer", "fence": fence})
	c.expect("attached")
	return c
}

func (hs *harness) launchCat(c *client, argv ...string) msg {
	if len(argv) == 0 {
		argv = []string{"/bin/cat"}
	}
	c.send(map[string]any{"t": "read", "fromSeq": 1})
	c.expect("caughtUp")
	c.send(map[string]any{"t": "launch", "appSessionId": "app-1", "engineSessionId": "eng-1", "argv": argv, "cwd": "/", "env": map[string]string{"PATH": "/usr/bin:/bin"}})
	c.send(map[string]any{"t": "commit"})
	return c.expect("spawned", "spawnFailed")
}

func TestAuthRefusesAWrongTokenWithNothingWritten(t *testing.T) {
	hs := start(t, nil)
	c := dial(t, hs.sock)
	c.send(map[string]any{"t": "auth", "token": strings.Repeat("0", 64)})
	c.nc.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, err := c.br.Read(make([]byte, 1))
	if n != 0 || err == nil {
		t.Fatalf("a wrong token read %d bytes, err %v", n, err)
	}
	ok := dial(t, hs.sock)
	ok.send(map[string]any{"t": "auth", "token": testToken})
	hello := ok.expect("hello")
	if hello.Raw["state"] != "ready" || hello.Raw["holderId"] != "TESTHOST" || hello.Raw["child"] != nil || num(hello, "protocol") != 1 {
		t.Fatalf("hello: %v", hello.Raw)
	}
}

func TestCatEchoesInSequenceAndOffsetsAreExact(t *testing.T) {
	hs := start(t, nil)
	w := hs.writer(1)
	spawned := hs.launchCat(w)
	if spawned.Raw["pid"].(float64) <= 0 {
		t.Fatalf("spawned: %v", spawned.Raw)
	}
	w.stdin(0, "one\ntwo\n")
	if a := w.expect("applied"); num(a, "offset") != 8 {
		t.Fatalf("applied: %v", a.Raw)
	}
	for i, want := range []string{"one", "two"} {
		out := w.expect("out")
		if string(out.Data) != want || num(out, "seq") != uint64(i+1) {
			t.Fatalf("record %d: seq %v %q", i, out.Raw["seq"], out.Data)
		}
	}
	w.stdin(0, "one\ntwo\n")
	if d := w.expect("duplicate"); num(d, "accepted") != 8 || num(d, "applied") != 8 {
		t.Fatalf("duplicate: %v", d.Raw)
	}
	w.stdin(20, "x\n")
	if g := w.expect("gap"); num(g, "accepted") != 8 {
		t.Fatalf("gap: %v", g.Raw)
	}
	w.stdin(8, "three\n")
	w.expect("applied")
	if out := w.expect("out"); string(out.Data) != "three" || num(out, "seq") != 3 {
		t.Fatalf("after the duplicate: %v %q", out.Raw, out.Data)
	}
}

func TestFenceSupersedesAndRefuses(t *testing.T) {
	hs := start(t, nil)
	first := hs.writer(1)
	hs.launchCat(first)

	same := dial(t, hs.sock)
	same.send(map[string]any{"t": "auth", "token": testToken})
	same.expect("hello")
	same.send(map[string]any{"t": "attach", "role": "writer", "fence": 1})
	if r := same.expect("refused"); r.Raw["reason"] != "fence" {
		t.Fatalf("refused: %v", r.Raw)
	}

	first.stdin(0, "a\n")
	first.expect("applied")
	second := dial(t, hs.sock)
	second.send(map[string]any{"t": "auth", "token": testToken})
	second.expect("hello")
	second.send(map[string]any{"t": "attach", "role": "writer", "fence": 2})
	att := second.expect("attached")
	if num(att, "fence") != 2 || num(att, "stdinApplied") != 2 || num(att, "stdinAccepted") != 2 {
		t.Fatalf("attached: %v", att.Raw)
	}
	if f := first.expect("fenced"); num(f, "fence") != 2 {
		t.Fatalf("fenced: %v", f.Raw)
	}
	first.stdin(2, "late\n")
	first.expect("fenced", "applied")
	second.stdin(2, "b\n")
	if a := second.expect("applied"); num(a, "offset") != 4 {
		t.Fatalf("the new writer's applied: %v", a.Raw)
	}
}

func TestSignalRelayAndExitRecord(t *testing.T) {
	hs := start(t, nil)
	w := hs.writer(1)
	hs.launchCat(w)
	w.send(map[string]any{"t": "signal", "name": "SIGTERM", "group": false})
	exit := w.expect("exit")
	if exit.Raw["signal"] != "SIGTERM" || exit.Raw["code"] != nil {
		t.Fatalf("exit: %v", exit.Raw)
	}
	w.send(map[string]any{"t": "release"})
	if code := hs.waitExit(5 * time.Second); code != 0 {
		t.Fatalf("exit code %d", code)
	}
	for _, name := range []string{"TESTHOST.json", "TESTHOST.token", "TESTHOST.sock"} {
		if _, err := os.Lstat(filepath.Join(hs.dir, name)); !os.IsNotExist(err) {
			t.Fatalf("%s survived the release", name)
		}
	}
}

func TestLingerEndsTheHost(t *testing.T) {
	hs := start(t, func(l *Limits) { l.Linger = 300 * time.Millisecond })
	w := hs.writer(1)
	hs.launchCat(w)
	w.send(map[string]any{"t": "end"})
	w.expect("exit")
	late := dial(t, hs.sock) // inside the linger the exit is still served
	late.send(map[string]any{"t": "auth", "token": testToken})
	hello := late.expect("hello")
	if hello.Raw["state"] != "exited" || hello.Raw["exit"] == nil {
		t.Fatalf("hello after exit: %v", hello.Raw)
	}
	if code := hs.waitExit(5 * time.Second); code != 0 {
		t.Fatalf("exit code %d", code)
	}
	if _, err := os.Lstat(filepath.Join(hs.dir, "TESTHOST.json")); !os.IsNotExist(err) {
		t.Fatal("the roster entry survived the linger")
	}
}

func TestRingCapAnswersAGap(t *testing.T) {
	hs := start(t, func(l *Limits) { l.RingCap = 64 })
	w := hs.writer(1) // it reads nothing: a reader 64 bytes behind would be closed (TestALaggingConnectionIsClosed)
	w.send(map[string]any{"t": "launch", "argv": []string{"/bin/cat"}, "cwd": "/", "env": map[string]string{}})
	w.send(map[string]any{"t": "commit"})
	w.expect("spawned")
	w.stdin(0, strings.Repeat("0123456789\n", 20))
	w.expect("applied")
	for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(10 * time.Millisecond) {
		hs.h.mu.Lock()
		last := hs.h.ring.LastSeq()
		hs.h.mu.Unlock()
		if last == 20 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("cat echoed %d of 20 lines", last)
		}
	}
	r := dial(t, hs.sock)
	r.send(map[string]any{"t": "auth", "token": testToken})
	r.expect("hello")
	r.send(map[string]any{"t": "attach", "role": "observer"})
	r.expect("attached")
	r.send(map[string]any{"t": "read", "fromSeq": 1})
	first := r.expect("out")
	caught := r.expect("caughtUp")
	if caught.Raw["gap"] == nil || num(caught, "gap") != num(first, "seq") || num(caught, "lastSeq") != 20 || num(first, "seq") <= 1 {
		t.Fatalf("caughtUp %v after first record %v", caught.Raw, first.Raw)
	}
}

func TestNoChildHostExitsAfterItsWriterLeaves(t *testing.T) {
	hs := start(t, func(l *Limits) { l.NoChild = 200 * time.Millisecond })
	w := hs.writer(1)
	time.Sleep(400 * time.Millisecond) // a writer attached holds the host
	select {
	case <-hs.done:
		t.Fatal("the host exited with its writer attached")
	default:
	}
	w.nc.Close()
	if code := hs.waitExit(5 * time.Second); code != 0 {
		t.Fatalf("exit code %d", code)
	}
}

func TestHostSignalTakesTheChildDown(t *testing.T) {
	hs := start(t, nil)
	w := hs.writer(1)
	spawned := hs.launchCat(w)
	pid := int(spawned.Raw["pid"].(float64))
	hs.signals <- syscall.SIGTERM
	if code := hs.waitExit(10 * time.Second); code != 0 {
		t.Fatalf("exit code %d", code)
	}
	if err := syscall.Kill(pid, 0); err == nil {
		t.Fatalf("the child %d outlived its host", pid)
	}
}

func TestALaggingConnectionIsClosed(t *testing.T) {
	hs := start(t, func(l *Limits) { l.RingCap = 64 })
	w := hs.writer(1)
	w.send(map[string]any{"t": "launch", "argv": []string{"/bin/cat"}, "cwd": "/", "env": map[string]string{}})
	w.send(map[string]any{"t": "commit"})
	w.expect("spawned")
	slow := dial(t, hs.sock)
	slow.send(map[string]any{"t": "auth", "token": testToken})
	slow.expect("hello")
	slow.send(map[string]any{"t": "attach", "role": "observer"})
	slow.expect("attached")
	slow.send(map[string]any{"t": "read", "fromSeq": 1})
	slow.expect("caughtUp")
	// the observer stops reading; the ring's cap pushes out records it was never sent
	w.stdin(0, strings.Repeat(strings.Repeat("x", 1000)+"\n", 2000))
	w.expect("applied")
	slow.nc.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.Copy(io.Discard, slow.br); err != nil {
		t.Fatalf("the lagging connection was not closed: %v", err)
	}
}
