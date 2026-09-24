package studio

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
)

func seal(key []byte, owner, provider, value string) ([]byte, error) {
	b, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(b)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, g.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return g.Seal(nonce, nonce, []byte(value), []byte(owner+":"+provider+":1")), nil
}
func unseal(key []byte, owner, provider string, data []byte) (string, error) {
	b, e := aes.NewCipher(key)
	if e != nil {
		return "", e
	}
	g, e := cipher.NewGCM(b)
	if e != nil || len(data) < g.NonceSize() {
		return "", errors.New("Credential invalide")
	}
	v, e := g.Open(nil, data[:g.NonceSize()], data[g.NonceSize():], []byte(owner+":"+provider+":1"))
	return string(v), e
}
func (s *Store) SetKey(ctx context.Context, c Config, owner, provider, value string) error {
	if provider != "openrouter" && provider != "groq" {
		return errors.New("Fournisseur invalide")
	}
	value = strings.TrimSpace(value)
	if len(value) > 4096 || strings.ContainsAny(value, "\r\n") {
		return errors.New("Clé invalide")
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if value == "" {
		_, e = tx.Exec(ctx, "DELETE FROM credentials WHERE owner_id=$1 AND provider=$2", owner, provider)
	} else {
		var b []byte
		b, e = seal(c.EncryptionKey, owner, provider, value)
		if e == nil {
			_, e = tx.Exec(ctx, `INSERT INTO credentials(owner_id,provider,ciphertext) VALUES($1,$2,$3) ON CONFLICT(owner_id,provider) DO UPDATE SET ciphertext=excluded.ciphertext,version=1`, owner, provider, b)
		}
	}
	if e != nil {
		return e
	}
	// In-flight calls keep their resolved key; only waiting/failed provider jobs wake up.
	kinds := []string{"cleanup", "translate"}
	if provider == "groq" {
		kinds = []string{"transcribe"}
	}
	_, e = tx.Exec(ctx, `UPDATE jobs SET state='queued',next_attempt_at=now(),message='',attempts=0 WHERE owner_id=$1 AND kind=ANY($2) AND state IN ('waiting_provider','failed')`, owner, kinds)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) Key(ctx context.Context, c Config, owner, provider string) (string, string, error) {
	if provider != "openrouter" && provider != "groq" {
		return "", "", errors.New("Fournisseur invalide")
	}
	var b []byte
	e := s.DB.QueryRow(ctx, "SELECT ciphertext FROM credentials WHERE owner_id=$1 AND provider=$2", owner, provider).Scan(&b)
	if e == nil {
		v, e := unseal(c.EncryptionKey, owner, provider, b)
		return v, provider + ":" + hash(v), e
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return "", "", e
	}
	v := c.OpenRouterKey
	if provider == "groq" {
		v = c.GroqKey
	}
	if v == "" {
		return "", "", errors.New("La clé partagée du service n’est pas configurée. L’administrateur doit la renseigner, ou vous pouvez ajouter votre clé.")
	}
	return v, provider + ":shared", nil
}
