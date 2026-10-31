// maws-session-host: one per lane B process (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M1). The engine host
// spawns it detached as
//
//	maws-session-host <socket> --hosts <hostsDir>
//
// with the connection token on its stdin, then closes that stdin. The socket's base name, less `.sock`, is the holder
// id, the launch's id. The host listens first, then reads the token; it serves the protocol of Interfaces §A over the
// socket and writes its roster entry and log under <hostsDir>. `--version` prints the version and protocol and exits.
//
// Test seams, which the engine host never passes: --ring-cap-bytes, --no-child-ms, --linger-ms, --socket-check-ms.
package main

import (
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"sessionhost/host"
	"sessionhost/proto"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 1 && args[0] == "--version" {
		fmt.Fprintf(stdout, "maws-session-host %s protocol %d\n", host.Version, proto.Protocol)
		return 0
	}
	opt, err := parse(args)
	if err != nil {
		fmt.Fprintf(stderr, "maws-session-host: %v\nusage: maws-session-host <socket> --hosts <dir> | --version\n", err)
		return 2
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT, syscall.SIGHUP)
	opt.Signals = sig
	h, err := host.New(opt)
	if err != nil {
		fmt.Fprintf(stderr, "maws-session-host: %v\n", err)
		return 1
	}
	go func() {
		token, _ := io.ReadAll(io.LimitReader(stdin, 4096))
		h.SetToken(strings.TrimSpace(string(token)))
	}()
	return h.Run()
}

func parse(args []string) (host.Options, error) {
	opt := host.Options{Limits: host.DefaultLimits()}
	duration := func(v string) (time.Duration, error) {
		ms, err := strconv.Atoi(v)
		if err != nil || ms <= 0 {
			return 0, fmt.Errorf("%q is not a positive number of milliseconds", v)
		}
		return time.Duration(ms) * time.Millisecond, nil
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !strings.HasPrefix(arg, "--") {
			if opt.SocketPath != "" {
				return opt, fmt.Errorf("a second socket path %q", arg)
			}
			opt.SocketPath = arg
			continue
		}
		if i+1 >= len(args) {
			return opt, fmt.Errorf("%s needs a value", arg)
		}
		i++
		value := args[i]
		var err error
		switch arg {
		case "--hosts":
			opt.HostsDir = value
		case "--ring-cap-bytes":
			opt.Limits.RingCap, err = strconv.Atoi(value)
		case "--no-child-ms":
			opt.Limits.NoChild, err = duration(value)
		case "--linger-ms":
			opt.Limits.Linger, err = duration(value)
		case "--socket-check-ms":
			opt.Limits.SocketCheck, err = duration(value)
		default:
			return opt, fmt.Errorf("unknown option %s", arg)
		}
		if err != nil {
			return opt, fmt.Errorf("%s: %v", arg, err)
		}
	}
	if opt.SocketPath == "" || opt.HostsDir == "" {
		return opt, fmt.Errorf("a socket path and --hosts are required")
	}
	if !filepath.IsAbs(opt.SocketPath) || !filepath.IsAbs(opt.HostsDir) {
		return opt, fmt.Errorf("the socket path and --hosts must be absolute")
	}
	base := filepath.Base(opt.SocketPath)
	id, ok := strings.CutSuffix(base, ".sock")
	if !ok || id == "" || strings.HasPrefix(id, ".") {
		return opt, fmt.Errorf("the socket's name %q is not <launchId>.sock", base)
	}
	opt.HolderID = id
	if self, err := os.Executable(); err == nil {
		opt.Binary = self
	}
	return opt, nil
}
