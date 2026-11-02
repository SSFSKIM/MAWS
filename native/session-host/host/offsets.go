package host

// Verdict is the host's answer to a `stdin` record's offset (Interfaces §A, D30).
type Verdict int

const (
	Queue     Verdict = iota // offset == accepted: queued, answered `applied` once every byte reached the pipe
	Duplicate                // offset < accepted: a resend; the original's `applied` is the answer that counts
	Gap                      // offset > accepted: a record is missing before it
	Busy                     // the queue is not empty and this record would take it past the cap
)

// Offsets are the two stdin offsets and the queue's byte count. Accepted is the byte after the last record queued,
// Applied the byte after the last record fully written to the pipe; both move by whole records.
type Offsets struct {
	Accepted uint64
	Applied  uint64
	Queued   int // bytes accepted and not yet applied, the record in the pipe included
	Cap      int
}

// Offer decides a record of n bytes at offset and, when it is queued, counts it as accepted.
func (o *Offsets) Offer(offset uint64, n int) Verdict {
	switch {
	case offset < o.Accepted:
		return Duplicate
	case offset > o.Accepted:
		return Gap
	case o.Queued > 0 && o.Queued+n > o.Cap:
		return Busy
	}
	o.Accepted += uint64(n)
	o.Queued += n
	return Queue
}

// Apply counts n queued bytes as applied: a whole record reached the pipe, or the pipe closed under it.
func (o *Offsets) Apply(n int) {
	o.Applied += uint64(n)
	o.Queued -= n
}

// Fence is the writer fence: a writer attaches only with a fence above the current one, and the host never lowers it.
type Fence struct{ v uint64 }

// Supersede raises the fence to n when n exceeds it.
func (f *Fence) Supersede(n uint64) bool {
	if n <= f.v {
		return false
	}
	f.v = n
	return true
}

// Value is the current fence, 0 before the first writer.
func (f *Fence) Value() uint64 { return f.v }
