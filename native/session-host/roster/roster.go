// Package roster writes a session host's roster entry, `<hosts>/<holderId>.json` (O16 Interfaces §B): the record a
// new engine host reads at start to find and adopt the hosts that outlived its predecessor. Each write is a whole file,
// written under a temp name and renamed over the entry, so a reader sees the previous entry or the next, never part.
package roster

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"sessionhost/proto"
)

// Entry is the roster entry's content.
type Entry struct {
	Protocol        int          `json:"protocol"`
	HolderID        string       `json:"holderId"`
	Pid             int          `json:"pid"`
	ProcStart       string       `json:"procStart"`
	StartedAt       string       `json:"startedAt"`
	Socket          string       `json:"socket"`
	Binary          string       `json:"binary"`
	AppSessionID    *string      `json:"appSessionId"`
	EngineSessionID *string      `json:"engineSessionId"`
	State           string       `json:"state"`
	Child           *proto.Child `json:"child"`
	Fence           uint64       `json:"fence"`
	Exit            *proto.Exit  `json:"exit"`
}

// Path is the entry's file.
func Path(dir, holderID string) string { return filepath.Join(dir, holderID+".json") }

// Write replaces the entry: a 0600 temp file (`.<holderId>.json.<pid>.tmp`, which a roster reader skips by its
// leading dot) renamed over `<holderId>.json`.
func Write(dir string, e Entry) error {
	body, err := json.Marshal(e)
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, fmt.Sprintf(".%s.json.%d.tmp", e.HolderID, os.Getpid()))
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(body, '\n')); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, Path(dir, e.HolderID)); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// Remove deletes the entry; an entry already gone is not an error.
func Remove(dir, holderID string) error {
	if err := os.Remove(Path(dir, holderID)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}
