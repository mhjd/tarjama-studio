package studio

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSSOHeadersRemainBounded(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	s := httptest.NewUnstartedServer(h)
	s.Config = HTTPServer("", h)
	s.Start()
	defer s.Close()
	for _, size := range []int{4096, 24576, 60 * 1024, 80 * 1024} {
		r, _ := http.NewRequest("GET", s.URL, nil)
		r.Header.Set("Cookie", "sso_probe="+strings.Repeat("x", size))
		response, err := s.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		want := 204
		if size == 80*1024 {
			want = 431
		}
		if response.StatusCode != want {
			t.Fatalf("%d byte cookie: %d, want %d", size, response.StatusCode, want)
		}
	}
}
