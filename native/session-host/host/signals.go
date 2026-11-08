package host

import (
	"errors"
	"fmt"
	"syscall"
)

// The signals a writer may send its child (Interfaces §A).
var signalsByName = map[string]syscall.Signal{
	"SIGTERM": syscall.SIGTERM,
	"SIGINT":  syscall.SIGINT,
	"SIGKILL": syscall.SIGKILL,
}

// Node's names for the signals a child may die of, so the exit record reads as Node's `exit` event does.
var signalNames = map[syscall.Signal]string{
	syscall.SIGHUP: "SIGHUP", syscall.SIGINT: "SIGINT", syscall.SIGQUIT: "SIGQUIT", syscall.SIGILL: "SIGILL",
	syscall.SIGTRAP: "SIGTRAP", syscall.SIGABRT: "SIGABRT", syscall.SIGBUS: "SIGBUS", syscall.SIGFPE: "SIGFPE",
	syscall.SIGKILL: "SIGKILL", syscall.SIGUSR1: "SIGUSR1", syscall.SIGSEGV: "SIGSEGV", syscall.SIGUSR2: "SIGUSR2",
	syscall.SIGPIPE: "SIGPIPE", syscall.SIGALRM: "SIGALRM", syscall.SIGTERM: "SIGTERM", syscall.SIGCHLD: "SIGCHLD",
	syscall.SIGCONT: "SIGCONT", syscall.SIGSTOP: "SIGSTOP", syscall.SIGTSTP: "SIGTSTP", syscall.SIGTTIN: "SIGTTIN",
	syscall.SIGTTOU: "SIGTTOU", syscall.SIGURG: "SIGURG", syscall.SIGXCPU: "SIGXCPU", syscall.SIGXFSZ: "SIGXFSZ",
	syscall.SIGVTALRM: "SIGVTALRM", syscall.SIGPROF: "SIGPROF", syscall.SIGWINCH: "SIGWINCH", syscall.SIGIO: "SIGIO",
	syscall.SIGSYS: "SIGSYS",
}

func signalName(s syscall.Signal) string {
	if name, ok := signalNames[s]; ok {
		return name
	}
	return fmt.Sprintf("SIG%d", int(s))
}

// signalChild signals the child, or the group it leads, and says whether it found the child gone though its reap is not
// yet recorded (signallable): reaped (ESRCH), or, on macOS, a zombie, whose group refuses a signal (EPERM) while the
// zombie itself still takes one, where a live child refusing on its credentials refuses both. The group is signalled
// only while the child is there: a descendant left in it would take a signal the reap's record would have refused.
func signalChild(pid int, group bool, sig syscall.Signal) (gone bool, err error) {
	if !group {
		err = syscall.Kill(pid, sig)
		return errors.Is(err, syscall.ESRCH), err
	}
	probe := syscall.Kill(pid, 0)
	if errors.Is(probe, syscall.ESRCH) {
		return true, probe
	}
	err = syscall.Kill(-pid, sig)
	return errors.Is(err, syscall.ESRCH) || errors.Is(err, syscall.EPERM) && probe == nil, err
}
