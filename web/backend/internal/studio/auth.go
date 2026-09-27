package studio

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type identity struct{ User, CSRF string }
type identityKey struct{}

// Absolute lifetime from sign-in, shared by the database and browser cookie.
const sessionLifetime = 24 * time.Hour

type Auth struct {
	Store          *Store
	Config         Config
	OAuth          oauth2.Config
	Verifier       *oidc.IDTokenVerifier
	LogoutVerifier *oidc.IDTokenVerifier
	LogoutEndpoint string
}

func NewAuth(ctx context.Context, s *Store, c Config) (*Auth, error) {
	ctx = oidc.ClientContext(ctx, &http.Client{Timeout: 20 * time.Second})
	a := &Auth{Store: s, Config: c}
	if c.Issuer != "" {
		p, e := oidc.NewProvider(ctx, c.Issuer)
		if e != nil {
			return nil, errors.New("Découverte OIDC impossible")
		}
		a.OAuth = oauth2.Config{ClientID: c.ClientID, ClientSecret: c.ClientSecret, RedirectURL: c.Origin + "/auth/callback", Endpoint: p.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "profile"}}
		a.Verifier = p.Verifier(&oidc.Config{ClientID: c.ClientID})
		if c.IdentityProvider == "keycloak" {
			a.OAuth.Scopes = append(a.OAuth.Scopes, "email")
			// Logout tokens have different required claims from ID tokens.
			// Signature/issuer/audience stay verified; freshness is checked below.
			a.LogoutVerifier = p.Verifier(&oidc.Config{ClientID: c.ClientID, SkipExpiryCheck: true})
			var metadata struct {
				Logout string `json:"end_session_endpoint"`
			}
			if p.Claims(&metadata) != nil || metadata.Logout != strings.TrimRight(c.Issuer, "/")+"/protocol/openid-connect/logout" || a.OAuth.Endpoint.AuthURL != strings.TrimRight(c.Issuer, "/")+"/protocol/openid-connect/auth" {
				return nil, errors.New("Métadonnées Keycloak invalides")
			}
			a.LogoutEndpoint = metadata.Logout
		}
	}
	return a, nil
}
func hash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func (a *Auth) cookie(w http.ResponseWriter, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: a.Config.Mode == "production", SameSite: http.SameSiteLaxMode, MaxAge: age})
}
func (a *Auth) session(w http.ResponseWriter, r *http.Request, user string) error {
	token, csrf := id()+id(), id()
	age := int(sessionLifetime / time.Second)
	_, e := a.Store.DB.Exec(r.Context(), "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+$4::int * interval '1 second')", hash(token), user, csrf, age)
	if e == nil {
		a.cookie(w, "tarjama_session", token, age)
	}
	return e
}
func (a *Auth) Routes(m *http.ServeMux) {
	login := func(w http.ResponseWriter, r *http.Request) {
		if a.Verifier == nil {
			http.Error(w, "OIDC non configuré", 503)
			return
		}
		state, nonce, verifier := id(), id(), oauth2.GenerateVerifier()
		_, e := a.Store.DB.Exec(r.Context(), "INSERT INTO login_flows(state_hash,nonce,verifier,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')", hash(state), nonce, verifier)
		if e != nil {
			http.Error(w, "Connexion indisponible", 503)
			return
		}
		a.cookie(w, "tarjama_login", state, 600)
		oauth := a.OAuth
		if r.URL.Path == "/auth/register" {
			oauth.Endpoint.AuthURL = strings.TrimSuffix(oauth.Endpoint.AuthURL, "/auth") + "/registrations"
		}
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)), 302)
	}
	m.HandleFunc("GET /auth/login", login)
	if a.Config.IdentityProvider == "keycloak" {
		m.HandleFunc("GET /auth/register", login)
		m.HandleFunc("POST /auth/backchannel-logout", a.backchannelLogout)
	}
	m.HandleFunc("GET /auth/callback", func(w http.ResponseWriter, r *http.Request) {
		fail := func() { http.Error(w, "Connexion refusée. Recommencez la connexion.", 400) }
		cookie, e := r.Cookie("tarjama_login")
		state := r.URL.Query().Get("state")
		if e != nil || state == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 || a.Verifier == nil {
			fail()
			return
		}
		var nonce, verifier string
		e = a.Store.DB.QueryRow(r.Context(), "DELETE FROM login_flows WHERE state_hash=$1 AND expires_at>now() RETURNING nonce,verifier", hash(state)).Scan(&nonce, &verifier)
		a.cookie(w, "tarjama_login", "", -1)
		if e != nil {
			fail()
			return
		}
		token, e := a.OAuth.Exchange(oidc.ClientContext(r.Context(), &http.Client{Timeout: 20 * time.Second}), r.URL.Query().Get("code"), oauth2.VerifierOption(verifier))
		if e != nil {
			fail()
			return
		}
		raw, ok := token.Extra("id_token").(string)
		if !ok {
			fail()
			return
		}
		verified, e := a.Verifier.Verify(r.Context(), raw)
		if e != nil || verified.Nonce != nonce || verified.Subject == "" {
			fail()
			return
		}
		var claims struct {
			SID string `json:"sid"`
		}
		// No email verification is required by product policy. Email is never an
		// identity key: only the cryptographically verified issuer/subject is used.
		if a.Config.IdentityProvider == "keycloak" && (verified.Claims(&claims) != nil || claims.SID == "") {
			fail()
			return
		}
		uid, e := a.Store.User(r.Context(), verified.Issuer, verified.Subject)
		if e != nil {
			fail()
			return
		}
		if a.loginSession(w, r, uid, claims.SID, verified) != nil {
			fail()
			return
		}
		http.Redirect(w, r, "/", 303)
	})
	if a.Config.Mode != "production" {
		m.HandleFunc("POST /auth/development", func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Origin") != a.Config.Origin {
				http.Error(w, "Origine refusée", 403)
				return
			}
			var body struct {
				User string `json:"user"`
			}
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body) != nil || (body.User != "alice" && body.User != "bob") {
				http.Error(w, "Compte test invalide", 400)
				return
			}
			uid, e := a.Store.User(r.Context(), "development", body.User)
			if e != nil || a.session(w, r, uid) != nil {
				http.Error(w, "Connexion indisponible", 503)
				return
			}
			w.WriteHeader(204)
		})
	}
}

// client_id + an exact registered redirect URI avoids retaining ID/access/refresh
// tokens in the application. Keycloak can ask for logout confirmation.
func (a *Auth) LogoutURL() string {
	if a.LogoutEndpoint == "" {
		return ""
	}
	return a.LogoutEndpoint + "?" + url.Values{"client_id": {a.Config.ClientID}, "post_logout_redirect_uri": {a.Config.Origin + "/"}}.Encode()
}
func (a *Auth) Protect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, e := r.Cookie("tarjama_session")
		if e != nil {
			http.Error(w, "Connexion requise", 401)
			return
		}
		var who identity
		e = a.Store.DB.QueryRow(r.Context(), "SELECT user_id,csrf FROM sessions WHERE token_hash=$1 AND expires_at>now()", hash(cookie.Value)).Scan(&who.User, &who.CSRF)
		if e != nil {
			http.Error(w, "Connexion requise", 401)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Origin") != a.Config.Origin || subtle.ConstantTimeCompare([]byte(who.CSRF), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
				http.Error(w, "Requête refusée", 403)
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, identityKey{}, who)))
	})
}
func who(r *http.Request) identity { return r.Context().Value(identityKey{}).(identity) }
