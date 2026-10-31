// Package ring keeps a session host's output records: every stdout and stderr line of the child in one sequence from 1,
// held until the writer acknowledges it or the byte cap pushes it out (O16 Interfaces §A, D6). Not safe for concurrent
// use: the host holds its lock around every call.
package ring

// Kind says which of the child's streams a record came from.
type Kind uint8

const (
	Out Kind = iota // stdout, sent as an `out` record
	Err             // stderr, sent as an `err` record
)

// Record is one line of the child's output, without its newline.
type Record struct {
	Seq  uint64
	Kind Kind
	Data []byte
}

// Ring holds the records from FirstSeq to LastSeq, oldest first.
type Ring struct {
	cap   int
	recs  []Record
	next  uint64 // the sequence the next record takes
	bytes int
}

// New returns an empty ring whose records' bytes stay at or under cap, except that the newest record is always kept.
func New(cap int) *Ring { return &Ring{cap: cap, next: 1} }

// Append adds a record and returns its sequence, and whether older records were pushed out to make room.
func (r *Ring) Append(kind Kind, data []byte) (seq uint64, evicted bool) {
	seq = r.next
	r.next++
	r.recs = append(r.recs, Record{Seq: seq, Kind: kind, Data: data})
	r.bytes += len(data)
	for r.bytes > r.cap && len(r.recs) > 1 {
		r.dropOldest()
		evicted = true
	}
	return seq, evicted
}

// Ack drops every record at or below seq.
func (r *Ring) Ack(seq uint64) {
	for len(r.recs) > 0 && r.recs[0].Seq <= seq {
		r.dropOldest()
	}
}

// Get returns the record with this sequence, if the ring still holds it.
func (r *Ring) Get(seq uint64) (Record, bool) {
	if len(r.recs) == 0 || seq < r.recs[0].Seq || seq >= r.next {
		return Record{}, false
	}
	return r.recs[seq-r.recs[0].Seq], true
}

// FirstSeq is the oldest record's sequence, or LastSeq+1 when the ring is empty.
func (r *Ring) FirstSeq() uint64 {
	if len(r.recs) == 0 {
		return r.next
	}
	return r.recs[0].Seq
}

// LastSeq is the newest record's sequence, 0 before the first.
func (r *Ring) LastSeq() uint64 { return r.next - 1 }

// Bytes is the sum of the held records' lengths.
func (r *Ring) Bytes() int { return r.bytes }

func (r *Ring) dropOldest() {
	r.bytes -= len(r.recs[0].Data)
	r.recs[0].Data = nil // the backing array outlives the slice head; let the line go
	r.recs = r.recs[1:]
}
