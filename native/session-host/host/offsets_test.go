package host

import "testing"

func TestOffsetsQueueOnlyAtTheAcceptedOffset(t *testing.T) {
	o := Offsets{Cap: 100}
	if v := o.Offer(0, 10); v != Queue {
		t.Fatalf("the first record: %v", v)
	}
	if o.Accepted != 10 || o.Applied != 0 || o.Queued != 10 {
		t.Fatalf("after queueing: %+v", o)
	}
	if v := o.Offer(0, 10); v != Duplicate {
		t.Fatalf("a resend of a queued record: %v", v)
	}
	if v := o.Offer(25, 5); v != Gap {
		t.Fatalf("a record past the accepted offset: %v", v)
	}
	if o.Accepted != 10 || o.Queued != 10 {
		t.Fatalf("a refused offer moved the offsets: %+v", o)
	}
	o.Apply(10)
	if o.Applied != 10 || o.Queued != 0 {
		t.Fatalf("after applying: %+v", o)
	}
	if v := o.Offer(0, 10); v != Duplicate {
		t.Fatalf("a resend of an applied record: %v", v)
	}
}

func TestOffsetsBusyOnlyPastTheCapOfANonEmptyQueue(t *testing.T) {
	o := Offsets{Cap: 100}
	if v := o.Offer(0, 480); v != Queue {
		t.Fatalf("one record over the cap into an empty queue: %v", v)
	}
	if v := o.Offer(480, 1); v != Busy {
		t.Fatalf("any record behind an over-cap one: %v", v)
	}
	o.Apply(480)
	if v := o.Offer(480, 60); v != Queue {
		t.Fatal("after the queue drained")
	}
	if v := o.Offer(540, 40); v != Queue {
		t.Fatal("up to the cap")
	}
	if v := o.Offer(580, 1); v != Busy {
		t.Fatal("one byte past the cap")
	}
}

func TestFenceIsCompareAndSwapUpward(t *testing.T) {
	var f Fence
	if !f.Supersede(1) {
		t.Fatal("the first writer's fence 1 refused")
	}
	if f.Supersede(1) {
		t.Fatal("a second writer at the same fence accepted")
	}
	if f.Supersede(0) {
		t.Fatal("a lower fence accepted")
	}
	if !f.Supersede(5) || f.Value() != 5 {
		t.Fatalf("a higher fence: %d", f.Value())
	}
	if f.Supersede(4) {
		t.Fatal("a fence under the current accepted")
	}
}
