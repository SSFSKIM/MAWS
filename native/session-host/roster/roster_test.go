package roster

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"sessionhost/proto"
)

func TestWriteIsAtomicPrivateAndComplete(t *testing.T) {
	dir := t.TempDir()
	app := "app-1"
	e := Entry{Protocol: proto.Protocol, HolderID: "ABCD2345", Pid: 42, ProcStart: "Fri Oct 31 10:00:00 2026", StartedAt: "2026-10-31T10:00:00.000Z",
		Socket: "/x/ABCD2345.sock", Binary: "/x/maws-session-host", AppSessionID: &app, State: "ready", Fence: 0}
	if err := Write(dir, e); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "ABCD2345.json")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v, want 0600", info.Mode().Perm())
	}
	var back map[string]any
	raw, _ := os.ReadFile(path)
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("not JSON: %s", raw)
	}
	for _, key := range []string{"protocol", "holderId", "pid", "procStart", "startedAt", "socket", "binary", "appSessionId", "engineSessionId", "state", "child", "fence", "exit"} {
		if _, ok := back[key]; !ok {
			t.Fatalf("the entry lacks %q: %s", key, raw)
		}
	}

	// a rewrite replaces the whole file and leaves no temp file behind
	e.State = "running"
	e.Child = &proto.Child{Pid: 43, ProcStart: "Fri Oct 31 10:00:01 2026"}
	e.Fence = 2
	if err := Write(dir, e); err != nil {
		t.Fatal(err)
	}
	names, _ := os.ReadDir(dir)
	if len(names) != 1 {
		t.Fatalf("the directory holds %d files after a rewrite, want 1", len(names))
	}
	var again Entry
	raw, _ = os.ReadFile(path)
	if err := json.Unmarshal(raw, &again); err != nil || again.State != "running" || again.Child.Pid != 43 || again.Fence != 2 {
		t.Fatalf("rewrite: %s", raw)
	}

	if err := Remove(dir, "ABCD2345"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("Remove left the entry")
	}
	if err := Remove(dir, "ABCD2345"); err != nil {
		t.Fatalf("a second Remove: %v", err)
	}
}

func TestWriteFailsWithoutTheDirectory(t *testing.T) {
	if err := Write(filepath.Join(t.TempDir(), "missing"), Entry{HolderID: "X"}); err == nil {
		t.Fatal("a write into a missing directory succeeded")
	}
}
