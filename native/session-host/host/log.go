package host

import (
	"fmt"
	"os"
	"sync"
)

// logger writes `<hosts>/<launchId>.log`: 0600, one line per state change and problem, truncated at open when it is
// past LogCap.
type logger struct {
	mu sync.Mutex
	f  *os.File
}

func openLog(path string) (*logger, error) {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return nil, err
	}
	if info, err := f.Stat(); err == nil && info.Size() > LogCap {
		f.Truncate(0)
	}
	return &logger{f: f}, nil
}

func (l *logger) printf(format string, args ...any) {
	line := isoNow() + " " + fmt.Sprintf(format, args...) + "\n"
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f != nil {
		l.f.WriteString(line)
	}
}

func (l *logger) close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f != nil {
		l.f.Close()
		l.f = nil
	}
}
