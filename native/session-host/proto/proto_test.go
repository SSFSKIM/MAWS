package proto

import (
	"bufio"
	"bytes"
	"errors"
	"strings"
	"testing"
)

func reader(s string) *bufio.Reader { return bufio.NewReaderSize(strings.NewReader(s), 16) }

func TestReadFrameControlLines(t *testing.T) {
	br := reader(`{"t":"attach","role":"writer","fence":7,"extra":true}` + "\n" + `{"t":"read","fromSeq":3}` + "\n")
	m, payload, err := ReadFrame(br, 1<<10, 1<<10)
	if err != nil || m.T != "attach" || m.Role != "writer" || m.Fence == nil || *m.Fence != 7 || payload != nil {
		t.Fatalf("attach: %+v %v %v", m, payload, err)
	}
	m, _, err = ReadFrame(br, 1<<10, 1<<10)
	if err != nil || m.T != "read" || m.FromSeq != 3 {
		t.Fatalf("read: %+v %v", m, err)
	}
	if _, _, err = ReadFrame(br, 1<<10, 1<<10); err == nil {
		t.Fatal("no error at the end of the stream")
	}
}

func TestReadFrameStdinCarriesItsBytes(t *testing.T) {
	body := "hello\nworld\n" // a record may hold newlines: its length frames it
	br := reader(`{"t":"stdin","offset":12,"len":12}` + "\n" + body + `{"t":"end"}` + "\n")
	m, payload, err := ReadFrame(br, 1<<10, 1<<10)
	if err != nil || m.T != "stdin" || m.Offset == nil || *m.Offset != 12 || string(payload) != body {
		t.Fatalf("stdin: %+v %q %v", m, payload, err)
	}
	m, _, err = ReadFrame(br, 1<<10, 1<<10)
	if err != nil || m.T != "end" {
		t.Fatalf("after the record: %+v %v", m, err)
	}
}

func TestReadFrameRefusesOversizeLinesAndRecords(t *testing.T) {
	_, _, err := ReadFrame(reader(strings.Repeat("x", 100)+"\n"), 50, 50)
	if !errors.Is(err, ErrFrame) {
		t.Fatalf("a 100-byte line under a 50-byte cap: %v", err)
	}
	_, _, err = ReadFrame(reader(`{"t":"stdin","offset":0,"len":51}`+"\n"+strings.Repeat("x", 51)), 1<<10, 50)
	if !errors.Is(err, ErrFrame) {
		t.Fatalf("a 51-byte record under a 50-byte cap: %v", err)
	}
	_, _, err = ReadFrame(reader(`{"t":"stdin","offset":0,"len":-1}`+"\n"), 1<<10, 50)
	if !errors.Is(err, ErrFrame) {
		t.Fatalf("a negative length: %v", err)
	}
	_, _, err = ReadFrame(reader("not json\n"), 1<<10, 50)
	if !errors.Is(err, ErrFrame) {
		t.Fatalf("a line that is not JSON: %v", err)
	}
}

func TestLineAndRecordHeader(t *testing.T) {
	got := string(Line(Error{T: "error", Message: "unknown t"}))
	if got != `{"t":"error","message":"unknown t"}`+"\n" {
		t.Fatalf("Line = %q", got)
	}
	if h := string(RecordHeader("out", 5, 3)); h != `{"t":"out","seq":5,"len":3}`+"\n" {
		t.Fatalf("RecordHeader = %q", h)
	}
	var hello bytes.Buffer
	hello.Write(Line(Hello{T: "hello", Protocol: Protocol}))
	if !strings.Contains(hello.String(), `"child":null`) || !strings.Contains(hello.String(), `"exit":null`) || !strings.Contains(hello.String(), `"appSessionId":null`) {
		t.Fatalf("hello's absent fields are not null: %s", hello.String())
	}
}
