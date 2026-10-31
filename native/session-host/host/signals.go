package host

import (
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
