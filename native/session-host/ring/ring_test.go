package ring

import (
	"bytes"
	"testing"
)

func line(n int, b byte) []byte { return bytes.Repeat([]byte{b}, n) }

func TestSequencesFromOneAcrossKinds(t *testing.T) {
	r := New(1 << 20)
	if r.FirstSeq() != 1 || r.LastSeq() != 0 || r.Bytes() != 0 {
		t.Fatalf("empty ring reads first %d last %d bytes %d", r.FirstSeq(), r.LastSeq(), r.Bytes())
	}
	a, _ := r.Append(Out, []byte("a"))
	b, _ := r.Append(Err, []byte("bb"))
	c, _ := r.Append(Out, []byte("ccc"))
	if a != 1 || b != 2 || c != 3 {
		t.Fatalf("sequences %d %d %d, want 1 2 3", a, b, c)
	}
	got, ok := r.Get(2)
	if !ok || got.Kind != Err || string(got.Data) != "bb" || got.Seq != 2 {
		t.Fatalf("Get(2) = %+v %v", got, ok)
	}
	if r.Bytes() != 6 || r.FirstSeq() != 1 || r.LastSeq() != 3 {
		t.Fatalf("first %d last %d bytes %d", r.FirstSeq(), r.LastSeq(), r.Bytes())
	}
}

func TestAckDropsEverythingAtOrBelow(t *testing.T) {
	r := New(1 << 20)
	for i := 0; i < 5; i++ {
		r.Append(Out, line(10, 'x'))
	}
	r.Ack(3)
	if r.FirstSeq() != 4 || r.LastSeq() != 5 || r.Bytes() != 20 {
		t.Fatalf("after ack 3: first %d last %d bytes %d", r.FirstSeq(), r.LastSeq(), r.Bytes())
	}
	if _, ok := r.Get(3); ok {
		t.Fatal("an acknowledged record is still served")
	}
	r.Ack(2) // an ack below the floor changes nothing
	if r.FirstSeq() != 4 {
		t.Fatalf("a stale ack moved firstSeq to %d", r.FirstSeq())
	}
	r.Ack(99) // past the head: everything goes, the sequence does not
	if r.FirstSeq() != 6 || r.LastSeq() != 5 || r.Bytes() != 0 {
		t.Fatalf("after ack past the head: first %d last %d bytes %d", r.FirstSeq(), r.LastSeq(), r.Bytes())
	}
	if seq, _ := r.Append(Out, []byte("y")); seq != 6 {
		t.Fatalf("the next record took %d, want 6", seq)
	}
}

func TestCapEvictsOldestAndMovesFirstSeq(t *testing.T) {
	per := 10 + RecordOverhead // what one 10-byte record costs against the cap
	r := New(10 * per)
	for i := 0; i < 10; i++ {
		_, evicted := r.Append(Out, line(10, 'a'))
		if evicted {
			t.Fatalf("record %d evicted under the cap", i+1)
		}
	}
	_, evicted := r.Append(Out, line(2*per+5, 'b'))
	if !evicted {
		t.Fatal("a record past the cap evicted nothing")
	}
	// three 10-byte records must go to make room for one costing 3*per+5-10
	if r.FirstSeq() != 4 || r.LastSeq() != 11 || r.Bytes() != 7*10+2*per+5 {
		t.Fatalf("first %d last %d bytes %d", r.FirstSeq(), r.LastSeq(), r.Bytes())
	}
	if _, ok := r.Get(3); ok {
		t.Fatal("an evicted record is still served")
	}
}

func TestEmptyAndShortLinesAreBoundedToo(t *testing.T) {
	r := New(100 * RecordOverhead)
	for i := 0; i < 100_000; i++ {
		r.Append(Out, nil) // a blank line: no bytes, still a record the ring holds
	}
	if held := r.LastSeq() - r.FirstSeq() + 1; held > 100 {
		t.Fatalf("the ring holds %d empty records under a cap of 100 records' overhead", held)
	}
	if r.LastSeq() != 100_000 || r.Bytes() != 0 {
		t.Fatalf("last %d bytes %d", r.LastSeq(), r.Bytes())
	}
	r = New(100 * (1 + RecordOverhead))
	for i := 0; i < 10_000; i++ {
		r.Append(Err, []byte("x"))
	}
	if held := r.LastSeq() - r.FirstSeq() + 1; held != 100 {
		t.Fatalf("the ring holds %d one-byte records, want 100", held)
	}
	if _, ok := r.Get(r.FirstSeq() - 1); ok {
		t.Fatal("an evicted short record is still served")
	}
}

func TestOneRecordOverTheCapIsKept(t *testing.T) {
	r := New(100)
	r.Append(Out, line(10, 'a'))
	seq, _ := r.Append(Out, line(500, 'b'))
	got, ok := r.Get(seq)
	if !ok || len(got.Data) != 500 {
		t.Fatal("the newest record was evicted for its own size")
	}
	if r.FirstSeq() != seq || r.Bytes() != 500 {
		t.Fatalf("first %d bytes %d", r.FirstSeq(), r.Bytes())
	}
}

func TestGetOutsideTheRing(t *testing.T) {
	r := New(100)
	r.Append(Out, []byte("a"))
	if _, ok := r.Get(0); ok {
		t.Fatal("Get(0) answered")
	}
	if _, ok := r.Get(2); ok {
		t.Fatal("a future record answered")
	}
}
