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
	"time"
)

type identity struct{ User, CSRF string }
type identityKey struct{}
type Auth struct {
	Store    *Store
	Config   Config
	OAuth    oauth2.Config
	Verifier *oidc.IDTokenVerifier
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
	}
	return a, nil
}
func hash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func (a *Auth) cookie(w http.ResponseWriter, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: a.Config.Mode == "production", SameSite: http.SameSiteLaxMode, MaxAge: age})
}
func (a *Auth) session(w http.ResponseWriter, r *http.Request, user string) error {
	token, csrf := id()+id(), id()
	_, e := a.Store.DB.Exec(r.Context(), "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')", hash(token), user, csrf)
	if e == nil {
		a.cookie(w, "tarjama_session", token, 43200)
	}
	return e
}
func (a *Auth) Routes(m *http.ServeMux) {
	m.HandleFunc("GET /auth/login", func(w http.ResponseWriter, r *http.Request) {
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
		http.Redirect(w, r, a.OAuth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)), 302)
	})
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
		uid, e := a.Store.User(r.Context(), verified.Issuer, verified.Subject)
		if e != nil {
			fail()
			return
		}
		if a.session(w, r, uid) != nil {
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
