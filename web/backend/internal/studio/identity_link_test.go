package studio

import (
	"context"
	"testing"
)

func TestIdentityLinkPreservesWorkspaceAndRevokesSessions(t *testing.T) {
	s := testStore(t)
	owner, p := fixture(t, s)
	ctx := context.Background()
	_, _ = sessionFor(t, s, owner)
	link := IdentityLink{UserID: owner, NewIssuer: "https://identity.example/realms/tarjama", NewSubject: "new-subject"}
	if err := s.DB.QueryRow(ctx, "SELECT issuer,subject FROM users WHERE id=$1", owner).Scan(&link.OldIssuer, &link.OldSubject); err != nil {
		t.Fatal(err)
	}
	if err := s.LinkIdentity(ctx, link, false); err != nil {
		t.Fatal(err)
	}
	var n int
	s.DB.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE user_id=$1", owner).Scan(&n)
	if n != 1 {
		t.Fatal("dry run changed session")
	}
	wrong := link
	wrong.OldSubject = "wrong"
	if s.LinkIdentity(ctx, wrong, true) == nil {
		t.Fatal("unverified source accepted")
	}
	other, _ := s.User(ctx, link.NewIssuer, "taken")
	wrong = link
	wrong.NewSubject = "taken"
	if s.LinkIdentity(ctx, wrong, true) == nil {
		t.Fatal("merged existing users", other)
	}
	if err := s.LinkIdentity(ctx, link, true); err != nil {
		t.Fatal(err)
	}
	actual, err := s.User(ctx, link.NewIssuer, link.NewSubject)
	if err != nil || actual != owner {
		t.Fatal("identity changed owner id", err)
	}
	got, err := s.Get(ctx, actual, p.ID)
	if err != nil || got.Segments[0].Arabic != p.Segments[0].Arabic {
		t.Fatal("workspace lost", err)
	}
	s.DB.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE user_id=$1", owner).Scan(&n)
	if n != 0 {
		t.Fatal("old sessions remained")
	}
	if s.LinkIdentity(ctx, link, true) == nil {
		t.Fatal("stale mapping accepted")
	}
}
