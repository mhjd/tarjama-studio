package studio

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Only the trusted worker owns this client. No credentials enter tool inputs.
type IsolatedClient struct {
	URL, Token string
	HTTP       *http.Client
}

type operationRequest struct {
	Key     string            `json:"key"`
	Profile string            `json:"profile"`
	Params  map[string]string `json:"params"`
}
type remoteOperation struct {
	ID    string `json:"id"`
	State string `json:"state"`
}
type inputFingerprint struct {
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type operationDefinition struct {
	Request   operationRequest            `json:"request"`
	Inputs    map[string]inputFingerprint `json:"inputs"`
	Output    string                      `json:"output"`
	MaxOutput int64                       `json:"max_output"`
}

func NewIsolatedClient(address, token, caFile string) (*IsolatedClient, error) {
	u, e := url.Parse(address)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || len(token) < 32 {
		return nil, errors.New("Configuration HTTPS des opérations isolées invalide")
	}
	ca, e := os.ReadFile(caFile)
	if e != nil {
		return nil, errors.New("CA des opérations isolées indisponible")
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		return nil, errors.New("CA des opérations isolées invalide")
	}
	return &IsolatedClient{URL: strings.TrimRight(address, "/"), Token: token, HTTP: &http.Client{
		Timeout:       5 * time.Minute,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
			TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}, TLSHandshakeTimeout: 10 * time.Second,
			ResponseHeaderTimeout: 30 * time.Second, MaxIdleConnsPerHost: 4, IdleConnTimeout: time.Minute},
	}}, nil
}

func mediaUnavailable() error {
	return &ProviderError{Public: "Traitement média indisponible. Progression conservée ; reprise automatique.", Temporary: true, After: time.Minute}
}
func brokerError(code int) error {
	switch {
	case code == 429 || code >= 500:
		return mediaUnavailable()
	case code == 409:
		return mediaUnavailable() // same definition/key on the next turn
	default:
		return errors.New("Opération isolée refusée : vérifier profil, accès et limites administrés")
	}
}
func (c *IsolatedClient) do(ctx context.Context, method, path string, body io.Reader, length int64, headers map[string]string) (*http.Response, error) {
	req, e := http.NewRequestWithContext(ctx, method, c.URL+path, body)
	if e != nil {
		return nil, errors.New("Requête d'opération invalide")
	}
	req.ContentLength = length
	req.Header.Set("Authorization", "Bearer "+c.Token)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, e := c.HTTP.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, mediaUnavailable() // never return transport errors containing credentials/URLs
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, brokerError(resp.StatusCode)
	}
	return resp, nil
}
func operationPath(id string) (string, error) {
	if !safeID.MatchString(id) {
		return "", errors.New("Identifiant distant invalide")
	}
	return "/v1/jobs/" + id, nil
}
func (c *IsolatedClient) json(ctx context.Context, method, path string, data any, output any) error {
	var b []byte
	if data != nil {
		var e error
		b, e = json.Marshal(data)
		if e != nil {
			return e
		}
	}
	resp, e := c.do(ctx, method, path, bytes.NewReader(b), int64(len(b)), map[string]string{"Content-Type": "application/json"})
	if e != nil {
		return e
	}
	defer resp.Body.Close()
	if output == nil {
		return nil
	}
	raw, e := io.ReadAll(io.LimitReader(resp.Body, 1024*1024+1))
	if e != nil {
		return mediaUnavailable()
	}
	if len(raw) > 1024*1024 || json.Unmarshal(raw, output) != nil {
		return errors.New("Réponse du service isolé invalide")
	}
	return nil
}
func (c *IsolatedClient) create(ctx context.Context, def operationRequest) (remoteOperation, error) {
	var op remoteOperation
	e := c.json(ctx, "POST", "/v1/jobs", def, &op)
	if e == nil {
		_, e = operationPath(op.ID)
	}
	return op, e
}
func (c *IsolatedClient) status(ctx context.Context, id string) (remoteOperation, error) {
	path, e := operationPath(id)
	if e != nil {
		return remoteOperation{}, e
	}
	var op remoteOperation
	e = c.json(ctx, "GET", path, nil, &op)
	if e == nil && op.ID != id {
		e = errors.New("Identifiant de réponse incohérent")
	}
	return op, e
}
func (c *IsolatedClient) action(ctx context.Context, id, action string) error {
	path, e := operationPath(id)
	if e != nil {
		return e
	}
	return c.json(ctx, "POST", path+"/"+action, nil, nil)
}
func fingerprint(path string, maxBytes int64) (inputFingerprint, error) {
	f, e := os.Open(path)
	if e != nil {
		return inputFingerprint{}, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return inputFingerprint{}, e
	}
	if !st.Mode().IsRegular() || st.Size() <= 0 || st.Size() > maxBytes {
		return inputFingerprint{}, errors.New("Fichier média hors limites")
	}
	h := sha256.New()
	n, e := io.Copy(h, io.LimitReader(f, maxBytes+1))
	if e != nil {
		return inputFingerprint{}, e
	}
	if n != st.Size() {
		return inputFingerprint{}, errors.New("Fichier média modifié")
	}
	return inputFingerprint{Size: n, SHA256: hex.EncodeToString(h.Sum(nil))}, nil
}
func validSHA(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && s == strings.ToLower(s)
}
func (c *IsolatedClient) upload(ctx context.Context, id, name, path string, want inputFingerprint) error {
	base, e := operationPath(id)
	if e != nil {
		return e
	}
	if name != "media" && name != "audio" && name != "subtitles.ass" {
		return errors.New("Nom d'entrée invalide")
	}
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	resp, e := c.do(ctx, "PUT", base+"/inputs/"+name, f, want.Size, map[string]string{"X-Content-SHA256": want.SHA256, "Content-Type": "application/octet-stream"})
	if e == nil {
		resp.Body.Close()
	}
	return e
}

// Partial output remains in the private durable cache across HTTP/worker restarts.
// Identity is the broker digest and total length, checked again on every Range response.
func (c *IsolatedClient) download(ctx context.Context, id, name, path string, maxBytes int64, want inputFingerprint, saveMetadata func(inputFingerprint) error) (inputFingerprint, error) {
	base, e := operationPath(id)
	if e != nil {
		return want, e
	}
	if name == "" || strings.ContainsAny(name, "/\\") {
		return want, errors.New("Nom de résultat invalide")
	}
	f, e := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return want, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return want, e
	}
	offset := st.Size()
	if offset > 0 && want.Size == offset && validSHA(want.SHA256) {
		got, e := fingerprint(path, maxBytes)
		if e == nil && got == want {
			return want, nil
		}
		return want, errors.New("Empreinte du résultat incomplet invalide")
	}
	if offset > 0 && (want.Size == 0 || offset > want.Size) {
		if e = f.Truncate(0); e != nil {
			return want, e
		}
		offset = 0
	}
	headers := map[string]string{}
	if offset > 0 {
		headers["Range"] = fmt.Sprintf("bytes=%d-", offset)
	}
	resp, e := c.do(ctx, "GET", base+"/outputs/"+url.PathEscape(name), nil, 0, headers)
	if e != nil {
		return want, e
	}
	defer resp.Body.Close()
	total := resp.ContentLength
	if resp.StatusCode == http.StatusPartialContent {
		var first, last int64
		if _, e = fmt.Sscanf(resp.Header.Get("Content-Range"), "bytes %d-%d/%d", &first, &last, &total); e != nil || first != offset || last != total-1 || resp.ContentLength != total-offset {
			return want, errors.New("Plage de résultat incohérente")
		}
	} else if resp.StatusCode == http.StatusOK {
		offset = 0
		if e = f.Truncate(0); e != nil {
			return want, e
		}
	} else {
		return want, errors.New("Réponse de transfert inattendue")
	}
	got := inputFingerprint{Size: total, SHA256: resp.Header.Get("X-Content-SHA256")}
	if total <= 0 || total > maxBytes || !validSHA(got.SHA256) || (want.Size > 0 && want != got) {
		return want, errors.New("Identité ou taille du résultat invalide")
	}
	if e = saveMetadata(got); e != nil {
		return got, e
	}
	if _, e = f.Seek(offset, io.SeekStart); e != nil {
		return got, e
	}
	n, e := io.Copy(f, io.LimitReader(resp.Body, total-offset+1))
	if syncErr := f.Sync(); syncErr != nil {
		return got, syncErr
	}
	if e != nil || n != total-offset {
		return got, mediaUnavailable()
	}
	actual, e := fingerprint(path, maxBytes)
	if e != nil {
		return got, e
	}
	if actual != got {
		return got, errors.New("Empreinte du résultat invalide")
	}
	return got, nil
}
