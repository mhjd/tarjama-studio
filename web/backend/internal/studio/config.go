package studio

import (
	"encoding/base64"
	"errors"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Mode, Addr, Origin, DB, Storage, Frontend string
	Issuer, ClientID, ClientSecret            string
	EncryptionKey                             []byte
	GroqKey, GeminiKey, MediaURL, MediaToken  string
	MediaEngine, JobsURL, JobsToken, JobsCA   string
}

func secret(name string) string {
	if f := os.Getenv(name + "_FILE"); f != "" {
		b, e := os.ReadFile(f)
		if e != nil {
			return ""
		}
		return strings.TrimSpace(string(b))
	}
	return os.Getenv(name)
}

// Migrations need database access only, never application or provider secrets.
func LoadDatabaseURL() (string, error) {
	dsn := secret("DATABASE_URL")
	if dsn == "" {
		return "", errors.New("DATABASE_URL absent")
	}
	return dsn, nil
}
func LoadConfig() (Config, error) {
	return loadConfig(true)
}

func LoadWorkerConfig() (Config, error) {
	return loadConfig(false)
}

func loadConfig(identityRequired bool) (Config, error) {
	c := Config{Mode: os.Getenv("APP_MODE"), Addr: os.Getenv("LISTEN_ADDR"), Origin: os.Getenv("PUBLIC_ORIGIN"), DB: secret("DATABASE_URL"), Storage: os.Getenv("STORAGE_DIR"), Frontend: os.Getenv("FRONTEND_DIR"), Issuer: os.Getenv("OIDC_ISSUER"), ClientID: os.Getenv("OIDC_CLIENT_ID"), ClientSecret: secret("OIDC_CLIENT_SECRET"), GroqKey: secret("GROQ_API_KEY"), GeminiKey: secret("GEMINI_API_KEY"), MediaURL: os.Getenv("MEDIA_URL"), MediaToken: secret("MEDIA_TOKEN")}
	c.MediaEngine = os.Getenv("MEDIA_ENGINE")
	c.JobsURL = os.Getenv("VPS_JOBS_URL")
	c.JobsToken = secret("VPS_JOBS_TOKEN")
	c.JobsCA = os.Getenv("VPS_JOBS_CA_FILE")
	if c.Mode == "" {
		c.Mode = "production"
	}
	if c.Addr == "" {
		c.Addr = "127.0.0.1:8090"
	}
	if c.Storage == "" {
		c.Storage = "./.runtime/storage"
	}
	if c.Frontend == "" {
		c.Frontend = "../frontend/dist"
	}
	c.EncryptionKey, _ = base64.StdEncoding.DecodeString(secret("ENCRYPTION_KEY"))
	if len(c.EncryptionKey) != 32 {
		return c, errors.New("ENCRYPTION_KEY doit contenir 32 octets encodés en base64")
	}
	u, e := url.Parse(c.Origin)
	if e != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return c, errors.New("PUBLIC_ORIGIN invalide")
	}
	if c.Mode != "development" && c.Mode != "test" && c.Mode != "production" {
		return c, errors.New("APP_MODE invalide")
	}
	if c.Mode == "production" && (u.Scheme != "https" || (identityRequired && (c.Issuer == "" || c.ClientID == "" || c.ClientSecret == ""))) {
		return c, errors.New("HTTPS et OIDC sont obligatoires en production")
	}
	if c.Mode != "production" && (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		return c, errors.New("Le développement doit rester sur loopback")
	}
	if c.Mode == "production" && identityRequired {
		issuer, e := url.Parse(c.Issuer)
		if e != nil || issuer.Scheme != "https" || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" {
			return c, errors.New("OIDC_ISSUER HTTPS requis")
		}
	}

	if c.DB == "" {
		return c, errors.New("DATABASE_URL absent")
	}
	return c, nil
}
