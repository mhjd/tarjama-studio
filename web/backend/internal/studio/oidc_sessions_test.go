package studio

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestKeycloakBackchannelLogout(t *testing.T) {
	s := testStore(t)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var issuer *httptest.Server
	issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/keys" {
			json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test", Algorithm: "RS256", Use: "sig"}}})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"issuer": issuer.URL, "authorization_endpoint": issuer.URL + "/protocol/openid-connect/auth", "token_endpoint": issuer.URL + "/token", "jwks_uri": issuer.URL + "/keys", "end_session_endpoint": issuer.URL + "/protocol/openid-connect/logout", "id_token_signing_alg_values_supported": []string{"RS256"}})
	}))
	defer issuer.Close()
	ctx := context.Background()
	a, err := NewAuth(ctx, s, Config{IdentityProvider: "keycloak", Issuer: issuer.URL, ClientID: "tarjama", Origin: "https://app.example"})
	if err != nil {
		t.Fatal(err)
	}
	alice, _ := s.User(ctx, issuer.URL, "alice")
	bob, _ := s.User(ctx, issuer.URL, "bob")
	add := func(user, sub, sid string) error {
		return a.loginSession(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil), user, sid, &oidc.IDToken{Subject: sub, IssuedAt: time.Now().Add(-time.Minute)})
	}
	for _, p := range [][3]string{{alice, "alice", "alice-one"}, {alice, "alice", "alice-two"}, {bob, "bob", "bob-one"}} {
		if err := add(p[0], p[1], p[2]); err != nil {
			t.Fatal(err)
		}
	}
	count := func(user string) int {
		var n int
		if err := s.DB.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE user_id=$1", user).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	base := func() map[string]any {
		return map[string]any{"iss": issuer.URL, "aud": "tarjama", "sub": "alice", "sid": "alice-one", "jti": id(), "iat": time.Now().Unix(), "events": map[string]any{"http://schemas.openid.net/event/backchannel-logout": map[string]any{}}}
	}
	send := func(claims map[string]any) int {
		payload, _ := json.Marshal(claims)
		signer, _ := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "test"}}, nil)
		signed, _ := signer.Sign(payload)
		raw, _ := signed.CompactSerialize()
		req := httptest.NewRequest("POST", "/auth/backchannel-logout", strings.NewReader(url.Values{"logout_token": {raw}}.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res := httptest.NewRecorder()
		a.backchannelLogout(res, req)
		return res.Code
	}
	for _, change := range []struct {
		key   string
		value any
	}{
		{"aud", "other"}, {"iss", "https://wrong.example"}, {"nonce", ""}, {"iat", time.Now().Add(-6 * time.Minute).Unix()},
		{"iat", time.Now().Add(time.Hour).Unix()}, {"exp", time.Now().Add(-time.Minute).Unix()}, {"jti", ""}, {"events", map[string]any{}},
	} {
		claims := base()
		claims[change.key] = change.value
		if got := send(claims); got != 400 {
			t.Fatalf("%s accepted: %d", change.key, got)
		}
	}
	if count(alice) != 2 || count(bob) != 1 {
		t.Fatal("invalid notification revoked sessions")
	}
	claims := base()
	if got := send(claims); got != 200 {
		t.Fatal("valid signed logout", got)
	}
	if count(alice) != 1 || count(bob) != 1 {
		t.Fatal("logout was not sid scoped")
	}
	if err := add(alice, "alice", "alice-one"); err == nil {
		t.Fatal("delayed callback resurrected revoked session")
	}
	if err := add(alice, "alice", "alice-three"); err != nil {
		t.Fatal(err)
	}
	if got := send(claims); got != 200 || count(alice) != 2 {
		t.Fatal("replayed logout changed another session")
	}
	claims = base()
	delete(claims, "sid")
	if got := send(claims); got != 200 || count(alice) != 0 || count(bob) != 1 {
		t.Fatal("subject logout scope", got)
	}
	// Unsigned requests cannot invoke logout, and absent sid+sub is invalid.
	claims = base()
	delete(claims, "sid")
	delete(claims, "sub")
	if send(claims) != 400 {
		t.Fatal("unscoped logout")
	}
	res := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/auth/backchannel-logout", strings.NewReader("logout_token=unsigned"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	a.backchannelLogout(res, req)
	if res.Code != 400 {
		t.Fatal("unsigned token")
	}
	mux := http.NewServeMux()
	a.Routes(mux)
	for path, endpoint := range map[string]string{
		"/sign-up": "/registrations?", "/auth/register": "/registrations?",
		"/sign-in": "/auth?", "/auth/login": "/auth?",
	} {
		res = httptest.NewRecorder()
		mux.ServeHTTP(res, httptest.NewRequest("GET", path, nil))
		if res.Code != 302 || !strings.Contains(res.Header().Get("Location"), endpoint) {
			t.Fatalf("identity entrypoint %s: %d", path, res.Code)
		}
	}
}
