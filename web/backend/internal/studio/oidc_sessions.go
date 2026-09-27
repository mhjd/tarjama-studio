package studio

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

func (a *Auth) loginSession(w http.ResponseWriter, r *http.Request, user, sid string, token *oidc.IDToken) error {
	if a.Config.IdentityProvider != "keycloak" {
		return a.session(w, r, user)
	}
	ctx := r.Context()
	tx, err := a.Store.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Serialize login with logout so a delayed callback cannot resurrect a session.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "oidc:"+a.Config.Issuer); err != nil {
		return err
	}
	var revoked bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM oidc_logout_events WHERE issuer=$1 AND expires_at>now() AND
	 ((sid<>'' AND sid=$2) OR (sid='' AND subject=$3 AND issued_at >= $4)))`, a.Config.Issuer, sid, token.Subject, token.IssuedAt).Scan(&revoked)
	if err != nil {
		return err
	}
	if revoked {
		return errors.New("Session OIDC révoquée")
	}
	raw, csrf := id()+id(), id()
	age := int(sessionLifetime / time.Second)
	_, err = tx.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,csrf,expires_at,oidc_sid) VALUES($1,$2,$3,now()+$4::int*interval '1 second',$5)", hash(raw), user, csrf, age, sid)
	if err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	a.cookie(w, "tarjama_session", raw, age)
	return nil
}

func (a *Auth) backchannelLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	reject := func() { http.Error(w, "Notification OIDC invalide", 400) }
	r.Body = http.MaxBytesReader(w, r.Body, 32768)
	if a.LogoutVerifier == nil || r.ParseForm() != nil {
		reject()
		return
	}
	values := r.PostForm["logout_token"]
	if len(values) != 1 || values[0] == "" {
		reject()
		return
	}
	token, err := a.LogoutVerifier.Verify(r.Context(), values[0])
	if err != nil {
		reject()
		return
	}
	var claims struct {
		SID    string                     `json:"sid"`
		JTI    string                     `json:"jti"`
		Nonce  json.RawMessage            `json:"nonce"`
		Events map[string]json.RawMessage `json:"events"`
	}
	if token.Claims(&claims) != nil {
		reject()
		return
	}
	var event map[string]json.RawMessage
	now := time.Now()
	if json.Unmarshal(claims.Events["http://schemas.openid.net/event/backchannel-logout"], &event) != nil || event == nil || len(event) != 0 || len(claims.Nonce) != 0 || claims.JTI == "" || len(claims.JTI) > 512 || len(claims.SID) > 2048 || len(token.Subject) > 2048 || (claims.SID == "" && token.Subject == "") || token.IssuedAt.Before(now.Add(-5*time.Minute)) || token.IssuedAt.After(now.Add(30*time.Second)) || (!token.Expiry.IsZero() && token.Expiry.Before(now)) {
		reject()
		return
	}
	ctx := r.Context()
	tx, err := a.Store.DB.Begin(ctx)
	if err != nil {
		http.Error(w, "Déconnexion indisponible", 503)
		return
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "oidc:"+a.Config.Issuer); err == nil {
		// Keep tombstones longer than the app session/ID-token lifetime. jti makes
		// duplicate notifications harmless even if a later session was created.
		var inserted bool
		err = tx.QueryRow(ctx, `WITH event AS (INSERT INTO oidc_logout_events(issuer,jti,sid,subject,issued_at,expires_at)
		 VALUES($1,$2,$3,$4,$5,now()+interval '25 hours') ON CONFLICT DO NOTHING RETURNING 1) SELECT EXISTS(SELECT 1 FROM event)`, a.Config.Issuer, claims.JTI, claims.SID, token.Subject, token.IssuedAt).Scan(&inserted)
		if err == nil && inserted {
			_, err = tx.Exec(ctx, `DELETE FROM sessions s USING users u WHERE s.user_id=u.id AND u.issuer=$1
			 AND ($2='' OR s.oidc_sid=$2) AND ($3='' OR u.subject=$3)`, a.Config.Issuer, claims.SID, token.Subject)
		}
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		http.Error(w, "Déconnexion indisponible", 503)
		return
	}
	w.WriteHeader(200)
}
