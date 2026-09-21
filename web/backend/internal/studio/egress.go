package studio

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"strings"
	"time"
)

// The downloader's network is internal. This proxy is its only Internet route,
// and itself can dial the configured WARP proxy only. Every CONNECT resolves and
// pins a public address, including extractor redirects and media subrequests.
func AllowedVideoHost(host string) bool {
	for _, domain := range []string{"youtube.com", "googlevideo.com", "ytimg.com", "youtubei.googleapis.com"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}
func PublicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "2001:db8::/32", "2001::/32", "2002::/16", "64:ff9b::/96"} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return true
}

type Egress struct {
	Warp   string
	Lookup func(context.Context, string) ([]netip.Addr, error)
	Dial   func(context.Context, string, string) (net.Conn, error)
}

func (e *Egress) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	host, port, err := net.SplitHostPort(r.Host)
	if err != nil || r.Method != "CONNECT" || port != "443" || !AllowedVideoHost(host) {
		http.Error(w, "Destination refusée", 403)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	ips, err := e.Lookup(ctx, host)
	if err != nil || len(ips) == 0 {
		http.Error(w, "DNS indisponible", 503)
		return
	}
	for _, ip := range ips {
		if !PublicIP(ip) {
			http.Error(w, "Adresse refusée", 403)
			return
		}
	}
	// No direct fallback. WARP must accept HTTP CONNECT to an IP; TLS SNI remains
	// the original hostname inside the tunnel. SOCKS-only WARP needs an operator adapter.
	upstream, err := e.Dial(ctx, "tcp", e.Warp)
	if err != nil {
		http.Error(w, "WARP indisponible", 503)
		return
	}
	defer upstream.Close()
	upstream.SetDeadline(time.Now().Add(10 * time.Minute))
	target := net.JoinHostPort(ips[0].String(), "443")
	fmt.Fprintf(upstream, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", target, target)
	reader := bufio.NewReader(upstream)
	resp, err := http.ReadResponse(reader, r)
	if err != nil || resp.StatusCode != 200 {
		http.Error(w, "WARP indisponible", 503)
		return
	}
	hijack, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "Tunnel impossible", 500)
		return
	}
	client, rw, err := hijack.Hijack()
	if err != nil {
		return
	}
	defer client.Close()
	client.SetDeadline(time.Now().Add(10 * time.Minute))
	rw.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
	rw.Flush()
	done := make(chan struct{})
	go func() { io.Copy(upstream, io.LimitReader(rw, MaxMediaBytes+1)); upstream.Close(); close(done) }()
	io.Copy(client, io.LimitReader(reader, MaxMediaBytes+1))
	client.Close()
	upstream.Close()
	<-done
}
func RunEgress(ctx context.Context) error {
	warp := os.Getenv("WARP_HTTP_PROXY")
	if _, _, e := net.SplitHostPort(warp); e != nil {
		return errors.New("WARP_HTTP_PROXY host:port requis ; aucun repli direct")
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8092"
	}
	dialer := net.Dialer{Timeout: 15 * time.Second}
	proxy := &Egress{Warp: warp, Lookup: func(ctx context.Context, h string) ([]netip.Addr, error) {
		return net.DefaultResolver.LookupNetIP(ctx, "ip", h)
	}, Dial: dialer.DialContext}
	s := HTTPServer(addr, proxy)
	go func() { <-ctx.Done(); s.Close() }()
	return s.ListenAndServe()
}
