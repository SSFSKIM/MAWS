package host

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// makePrivateDir creates dir 0700 when it is missing and checks it as @shared/host/private-listen does: a directory,
// not a symlink, owned by this uid, with no group or other bits. One that exists is checked, never corrected.
func makePrivateDir(dir string) error {
	if _, err := os.Lstat(dir); errors.Is(err, fs.ErrNotExist) {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return err
		}
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return fmt.Errorf("%s is a symlink", dir)
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", dir)
	}
	if err := ownedByMe(dir, info); err != nil {
		return err
	}
	if perm := info.Mode().Perm(); perm&0o077 != 0 {
		return fmt.Errorf("%s is mode 0%o, more open than 0700", dir, perm)
	}
	return nil
}

// clearSocketPath makes way for a listen: nothing there is fine, a socket this uid owns is unlinked, anything else is
// refused and left where it is.
func clearSocketPath(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return fmt.Errorf("%s is a symlink", path)
	}
	if info.Mode()&fs.ModeSocket == 0 {
		return fmt.Errorf("%s is not a socket", path)
	}
	if err := ownedByMe(path, info); err != nil {
		return err
	}
	return os.Remove(path)
}

func ownedByMe(path string, info fs.FileInfo) error {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return fmt.Errorf("%s: no owner to check", path)
	}
	if int(st.Uid) != os.Getuid() {
		return fmt.Errorf("%s is owned by uid %d, not this process's %d", path, st.Uid, os.Getuid())
	}
	return nil
}

// procStartOf reads a process's start time as supervisor-files.ts `procStartOf` does (`ps -o lstart=` under LC_ALL=C
// TZ=UTC), so the engine host's `isSameProcess` compares like with like; "" when ps finds nothing or cannot run.
func procStartOf(pid int) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/bin/ps", "-o", "lstart=", "-p", strconv.Itoa(pid))
	cmd.Env = []string{"LC_ALL=C", "TZ=UTC"}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// isoNow is a timestamp in JavaScript's toISOString form.
func isoNow() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }
