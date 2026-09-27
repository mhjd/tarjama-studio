package studio

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/go-jose/go-jose/v4"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestOIDCFlowPKCEStateNonceAudienceAndReplay(t *testing.T) {
	s := testStore(t)
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	nonce, challenge, subject := "", "", "person-1"
	bad := ""
	var issuer *httptest.Server
	issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			json.NewEncoder(w).Encode(map[string]any{"issuer": issuer.URL, "authorization_endpoint": issuer.URL + "/protocol/openid-connect/auth", "token_endpoint": issuer.URL + "/token", "jwks_uri": issuer.URL + "/keys", "end_session_endpoint": issuer.URL + "/protocol/openid-connect/logout", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "fixture", Algorithm: "RS256", Use: "sig"}}})
		case "/token":
			r.ParseForm()
			sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if base64.RawURLEncoding.EncodeToString(sum[:]) != challenge {
				t.Error("PKCE verifier mismatch")
				http.Error(w, "PKCE", 400)
				return
			}
			aud := any("tarjama")
			iss := issuer.URL
			n := nonce
			exp := time.Now().Add(time.Minute).Unix()
			switch bad {
			case "audience":
				aud = "attacker"
			case "issuer":
				iss = "https://wrong.invalid"
			case "nonce":
				n = "wrong"
			case "expired":
				exp = time.Now().Add(-time.Hour).Unix()
			}
			claims := map[string]any{"iss": iss, "sub": subject, "aud": aud, "nonce": n, "exp": exp, "iat": time.Now().Unix(), "email_verified": true, "sid": "identity-session"}
			if bad == "email" {
				claims["email_verified"] = false
			}
			if bad == "sid" {
				delete(claims, "sid")
			}
			payload, _ := json.Marshal(claims)
			signer, e := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "fixture"}}, nil)
			if e != nil {
				t.Fatal(e)
			}
			signed, _ := signer.Sign(payload)
			token, _ := signed.CompactSerialize()
			json.NewEncoder(w).Encode(map[string]any{"access_token": "fixture", "token_type": "Bearer", "id_token": token, "expires_in": 60})
		default:
			http.NotFound(w, r)
		}
	}))
	defer issuer.Close()
	c := Config{IdentityProvider: "keycloak", Mode: "production", Origin: "https://tarjama.invalid", Issuer: issuer.URL, ClientID: "tarjama", ClientSecret: "fixture"}
	auth, e := NewAuth(context.Background(), s, c)
	if e != nil {
		t.Fatal(e)
	}
	mux := http.NewServeMux()
	auth.Routes(mux)
	server := httptest.NewServer(mux)
	defer server.Close()
	client := server.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	start := func() (string, *http.Cookie) {
		r, e := client.Get(server.URL + "/auth/login")
		if e != nil {
			t.Fatal(e)
		}
		defer r.Body.Close()
		location, e := url.Parse(r.Header.Get("Location"))
		if e != nil {
			t.Fatal(e)
		}
		nonce = location.Query().Get("nonce")
		challenge = location.Query().Get("code_challenge")
		if location.Query().Get("code_challenge_method") != "S256" || nonce == "" || challenge == "" {
			t.Fatal("missing PKCE/nonce")
		}
		return location.Query().Get("state"), r.Cookies()[0]
	}
	callback := func(state string, cookie *http.Cookie) *http.Response {
		req, _ := http.NewRequest("GET", server.URL+"/auth/callback?code=fixture&state="+state, nil)
		req.AddCookie(cookie)
		r, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		r.Body.Close()
		return r
	}
	state, cookie := start()
	if r := callback("wrong", cookie); r.StatusCode != 400 {
		t.Fatal("state accepted")
	}
	r := callback(state, cookie)
	if r.StatusCode != 303 {
		t.Fatal("valid login failed", r.StatusCode)
	}
	found := false
	for _, c := range r.Cookies() {
		if c.Name == "tarjama_session" {
			found = true
			if !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode {
				t.Fatal("cookie security")
			}
		}
	}
	if !found {
		t.Fatal("session absent")
	}
	if r = callback(state, cookie); r.StatusCode != 400 {
		t.Fatal("callback replay accepted")
	}
	for _, v := range []string{"nonce", "audience", "issuer", "expired", "email", "sid"} {
		bad = v
		state, cookie = start()
		if r = callback(state, cookie); r.StatusCode != 400 {
			t.Fatal(v, r.StatusCode)
		}
	}
}

func TestSessionLastsOneDayAndStillExpires(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	user, err := s.User(ctx, "session-test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	a := &Auth{Store: s, Config: Config{Mode: "production"}}
	recorder := httptest.NewRecorder()
	if err := a.session(recorder, httptest.NewRequest("GET", "/", nil), user); err != nil {
		t.Fatal(err)
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("expected one session cookie")
	}
	c := cookies[0]
	if c.Name != "tarjama_session" || c.MaxAge != 86400 || !c.Secure || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode {
		t.Fatal("session lifetime or cookie protections incorrect")
	}
	var seconds float64
	if err := s.DB.QueryRow(ctx, "SELECT extract(epoch FROM expires_at-now())::float8 FROM sessions WHERE token_hash=$1", hash(c.Value)).Scan(&seconds); err != nil {
		t.Fatal(err)
	}
	if seconds < 86390 || seconds > 86400 {
		t.Fatalf("server lifetime = %.2fs", seconds)
	}
	handler := a.Protect(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if who(r).User != user {
			t.Error("wrong user")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	// Advance the persisted expiry to simulate 23 hours and just past 24 hours.
	for _, tc := range []struct {
		remaining int
		status    int
	}{{3600, 204}, {-1, 401}} {
		if _, err := s.DB.Exec(ctx, "UPDATE sessions SET expires_at=now()+$2::int * interval '1 second' WHERE token_hash=$1", hash(c.Value), tc.remaining); err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("GET", "/private", nil)
		req.AddCookie(c)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != tc.status {
			t.Fatalf("remaining=%ds: status=%d", tc.remaining, res.Code)
		}
		if len(res.Result().Cookies()) != 0 {
			t.Fatal("requests must not silently extend the absolute lifetime")
		}
	}
}

func TestOIDCWorkspaceIdentityIsStableAndIssuerScoped(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	first, err := s.User(ctx, "https://identity.example", "alice")
	if err != nil {
		t.Fatal(err)
	}
	p := Project{ID: id(), Title: "Private", Version: 1}
	if err := s.Create(ctx, first, p); err != nil {
		t.Fatal(err)
	}
	again, err := s.User(ctx, "https://identity.example", "alice")
	if err != nil || again != first {
		t.Fatal("login must recover existing workspace", err)
	}
	for _, identity := range [][2]string{{"https://identity.example", "bob"}, {"https://another.example", "alice"}} {
		other, err := s.User(ctx, identity[0], identity[1])
		if err != nil || other == first {
			t.Fatal("distinct OIDC identity", err)
		}
		projects, err := s.List(ctx, other)
		if err != nil || len(projects) != 0 {
			t.Fatal("new account must start empty", err)
		}
		if _, err := s.Get(ctx, other, p.ID); err != ErrMissing {
			t.Fatal("private workspace accessible", err)
		}
	}
}
