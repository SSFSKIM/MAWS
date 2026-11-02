package host

import (
	"net"

	"sessionhost/proto"
	"sessionhost/ring"
)

// ctl is a control line queued for a connection. On a reading connection it is sent once every record up to `after`
// (the ring's head when it was queued) has been sent, so an `exit` follows the output that came before it.
type ctl struct {
	after uint64
	data  []byte
}

// conn is one authenticated client. One goroutine reads its commands (Host.readLoop) and one writes to it (sendLoop):
// output from the ring at its cursor, as its socket drains, and its control lines in order. Fields are guarded by the
// host's mu, except nc and wake, which are safe to use from any goroutine.
type conn struct {
	h    *Host
	nc   net.Conn
	wake chan struct{}

	role        string // "", "observer", "pending" (a writer waiting on the queue it supersedes) or "writer"
	fenced      bool   // a superseded writer: its writer-only commands are answered `fenced`
	reading     bool
	cursor      uint64 // the next record to send
	replayEnd   uint64 // the ring's head at the read: `caughtUp` follows it
	caughtUpDue bool
	gap         *uint64
	ctls        []ctl
	ending      bool // send what is queued, then close
	closed      bool
}

func (c *conn) poke() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

// send queues a control line; the caller holds the host's mu.
func (c *conn) send(v any) {
	if c.closed {
		return
	}
	var after uint64
	if c.reading {
		after = c.h.ring.LastSeq()
	}
	c.ctls = append(c.ctls, ctl{after: after, data: proto.Line(v)})
	if len(c.ctls) > ctlQueueCap {
		c.h.log.printf("a connection that reads nothing has %d lines queued; closed", len(c.ctls))
		c.closed = true
		c.nc.Close()
	}
	c.poke()
}

// next picks what to write next, or reports that the connection is done; the caller holds the host's mu.
func (c *conn) next() (bufs net.Buffers, done bool) {
	h := c.h
	if c.closed {
		return nil, true
	}
	if len(c.ctls) > 0 && (!c.reading || c.ending || c.ctls[0].after < c.cursor) {
		data := c.ctls[0].data
		c.ctls[0] = ctl{}
		c.ctls = c.ctls[1:]
		return net.Buffers{data}, false
	}
	if c.ending {
		c.closed = true
		c.nc.Close()
		return nil, true
	}
	if !c.reading {
		return nil, false
	}
	if c.caughtUpDue && c.cursor > c.replayEnd {
		c.caughtUpDue = false
		return net.Buffers{proto.Line(proto.CaughtUp{T: "caughtUp", LastSeq: c.replayEnd, Gap: c.gap})}, false
	}
	if c.cursor > h.ring.LastSeq() {
		return nil, false
	}
	rec, ok := h.ring.Get(c.cursor)
	if !ok { // the record left the ring before this connection was sent it
		h.log.printf("a connection fell behind the ring at seq %d; closed", c.cursor)
		c.closed = true
		c.nc.Close()
		return nil, true
	}
	c.cursor++
	t := "out"
	if rec.Kind == ring.Err {
		t = "err"
	}
	return net.Buffers{proto.RecordHeader(t, rec.Seq, len(rec.Data)), rec.Data}, false
}

// sendLoop writes each record as it is read, no batching: header and bytes in one writev.
func (c *conn) sendLoop() {
	h := c.h
	for {
		h.mu.Lock()
		bufs, done := c.next()
		for bufs == nil && !done {
			h.mu.Unlock()
			<-c.wake
			h.mu.Lock()
			bufs, done = c.next()
		}
		h.mu.Unlock()
		if done {
			return
		}
		if _, err := bufs.WriteTo(c.nc); err != nil {
			c.nc.Close()
			return
		}
	}
}
