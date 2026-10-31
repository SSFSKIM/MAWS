package host

import "time"

// The session host's constants (O16 Interfaces §A and M1's decisions), mirrored in src/engine-host/holder/protocol.ts.
const (
	LineCap       = 64 << 20         // LINE_CAP: an output line past it is dropped with a `problem` record
	RingCap       = 8 << 20          // RING_CAP: unacknowledged output kept for a writer
	StdinQueueCap = 64 << 20         // STDIN_QUEUE_CAP: queued stdin bytes; one record of any valid size into an empty queue
	Linger        = 10 * time.Minute // LINGER: how long an exited child's host keeps serving
	HostExitGrace = 5 * time.Second  // HOST_EXIT_GRACE: the child's time to exit after the host's own SIGTERM relay
	AuthWindow    = 2 * time.Second  // AUTH_WINDOW: a connection's time to authenticate
	FrameCap      = LineCap + 256    // FRAME_CAP: a control line or a record's header and bytes
	NoChild       = 30 * time.Second // HOST_NO_CHILD_MS: a host with no child and no writer exits after it
	SocketCheck   = 60 * time.Second // how often the host checks that its socket file is still there
	LogCap        = 1 << 20          // the log is truncated at open past it
	ExitDrain     = time.Second      // after the child's exit, how long its output pipes get to reach end of file
	authLineCap   = 4 << 10          // the auth line holds a 64-hex token
	ctlQueueCap   = 1 << 14          // control lines queued for a client that does not read; past it the connection closes
)

// Limits are the constants a Host runs with; the binary's test flags override some of them.
type Limits struct {
	RingCap       int
	LineCap       int
	StdinQueueCap int
	FrameCap      int
	Linger        time.Duration
	HostExitGrace time.Duration
	AuthWindow    time.Duration
	NoChild       time.Duration
	SocketCheck   time.Duration
	ExitDrain     time.Duration
}

// DefaultLimits are the protocol's constants.
func DefaultLimits() Limits {
	return Limits{
		RingCap:       RingCap,
		LineCap:       LineCap,
		StdinQueueCap: StdinQueueCap,
		FrameCap:      FrameCap,
		Linger:        Linger,
		HostExitGrace: HostExitGrace,
		AuthWindow:    AuthWindow,
		NoChild:       NoChild,
		SocketCheck:   SocketCheck,
		ExitDrain:     ExitDrain,
	}
}
