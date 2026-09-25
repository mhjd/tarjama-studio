// Local JSON-lines interface: one {tool, arguments} request per line. No network.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"tarjama/web/internal/references"
)

func main() {
	dir := flag.String("corpus", "", "immutable corpus directory")
	list := flag.Bool("tools", false, "print tool definitions")
	flag.Parse()
	s, err := references.Load(*dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Reference corpus unavailable:", err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	if *list {
		enc.Encode(s.Tools())
		return
	}
	scan := bufio.NewScanner(os.Stdin)
	scan.Buffer(make([]byte, 8192), 16384)
	for scan.Scan() {
		var q struct {
			Tool      string          `json:"tool"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if json.Unmarshal(scan.Bytes(), &q) != nil {
			enc.Encode(map[string]string{"error": "invalid_request"})
			continue
		}
		v, err := s.Call(q.Tool, q.Arguments)
		if err != nil {
			enc.Encode(map[string]string{"error": err.Error()})
		} else {
			enc.Encode(v)
		}
	}
	if scan.Err() != nil {
		os.Exit(1)
	}
}
