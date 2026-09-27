package studio

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"

	"github.com/jackc/pgx/v5"
)

// Explicit operator mapping, never inferred from an email or browser request.
type IdentityLink struct {
	UserID     string `json:"user_id"`
	OldIssuer  string `json:"old_issuer"`
	OldSubject string `json:"old_subject"`
	NewIssuer  string `json:"new_issuer"`
	NewSubject string `json:"new_subject"`
}

func (s *Store) LinkIdentity(ctx context.Context, link IdentityLink, apply bool) error {
	issuer, err := url.Parse(link.NewIssuer)
	if err != nil || issuer.Scheme != "https" || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" || !safeID.MatchString(link.UserID) || link.OldIssuer == "" || link.OldSubject == "" || link.NewSubject == "" || len(link.NewSubject) > 2048 {
		return errors.New("Correspondance d'identité invalide")
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var oldIssuer, oldSubject string
	err = tx.QueryRow(ctx, "SELECT issuer,subject FROM users WHERE id=$1 FOR UPDATE", link.UserID).Scan(&oldIssuer, &oldSubject)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrMissing
	}
	if err != nil {
		return err
	}
	if oldIssuer != link.OldIssuer || oldSubject != link.OldSubject {
		return errors.New("Identité source différente de celle attendue")
	}
	var exists bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE issuer=$1 AND subject=$2)", link.NewIssuer, link.NewSubject).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return errors.New("Identité cible déjà rattachée ; aucune fusion automatique")
	}
	if !apply {
		return nil
	}
	if _, err = tx.Exec(ctx, "UPDATE users SET issuer=$2,subject=$3 WHERE id=$1", link.UserID, link.NewIssuer, link.NewSubject); err != nil {
		return errors.New("Rattachement impossible ; aucune modification conservée")
	}
	if _, err = tx.Exec(ctx, "DELETE FROM sessions WHERE user_id=$1", link.UserID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func IdentityLinkCommand(ctx context.Context, s *Store, args []string) error {
	flags := flag.NewFlagSet("identity-link", flag.ContinueOnError)
	file := flags.String("file", "", "reviewed mapping JSON")
	apply := flags.Bool("apply", false, "apply after a successful dry run and backup")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *file == "" || flags.NArg() != 0 {
		return errors.New("identity-link --file requis ; simulation par défaut")
	}
	f, err := os.Open(*file)
	if err != nil {
		return errors.New("Fichier de correspondance inaccessible")
	}
	defer f.Close()
	decoder := json.NewDecoder(io.LimitReader(f, 16384))
	decoder.DisallowUnknownFields()
	var link IdentityLink
	if decoder.Decode(&link) != nil || decoder.Decode(new(any)) != io.EOF {
		return errors.New("Correspondance JSON invalide")
	}
	if err = s.LinkIdentity(ctx, link, *apply); err != nil {
		return err
	}
	if *apply {
		fmt.Println("Identité rattachée, sessions précédentes révoquées, projets conservés.")
	} else {
		fmt.Println("Simulation réussie. Aucune donnée modifiée.")
	}
	return nil
}
