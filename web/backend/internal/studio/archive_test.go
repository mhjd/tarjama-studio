package studio

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestArchivePreservesContentJobsAndDuplicateIdentity(t *testing.T) {
	s := testStore(t)
	owner, _ := fixture(t, s)
	other, _ := fixture(t, s)
	_, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	otherToken, otherCSRF := sessionFor(t, s, other)
	body := map[string]string{"title": "Projet original", "url": "https://youtu.be/YuV8IY-Bgoc"}
	code, data := call(t, server, token, csrf, "POST", "/api/projects", body)
	var original Project
	if code != 200 || json.Unmarshal(data, &original) != nil {
		t.Fatalf("create: %d %s", code, data)
	}
	path := "/api/projects/" + original.ID
	jobs, _ := s.Jobs(context.Background(), owner, original.ID)
	if code, _ = call(t, server, otherToken, otherCSRF, "PATCH", path+"/archive", map[string]bool{"archived": true}); code != 404 {
		t.Fatal("other account archived project", code)
	}
	if code, _ = call(t, server, token, "bad-csrf", "PATCH", path+"/archive", map[string]bool{"archived": true}); code != 403 {
		t.Fatal("missing CSRF guard", code)
	}
	for _, archived := range []bool{true, false, true} {
		code, data = call(t, server, token, csrf, "PATCH", path+"/archive", map[string]bool{"archived": archived})
		var p Project
		if code != 200 || json.Unmarshal(data, &p) != nil || p.Archived != archived {
			t.Fatalf("archive: %d %s", code, data)
		}
		p.Archived = false
		a, _ := json.Marshal(p)
		b, _ := json.Marshal(original)
		if string(a) != string(b) {
			t.Fatal("archive modified content or versions")
		}
		after, _ := s.Jobs(context.Background(), owner, original.ID)
		if len(after) != len(jobs) || after[0].ID != jobs[0].ID || after[0].State != jobs[0].State {
			t.Fatal("archive restarted/cancelled work")
		}
	}
	// A title change never identifies a different video; an archived project is reusable.
	body["title"] = "Un autre titre"
	code, data = call(t, server, token, csrf, "POST", "/api/projects", body)
	var conflict map[string]string
	if code != 409 || json.Unmarshal(data, &conflict) != nil || conflict["project_id"] != original.ID || conflict["archived"] != "true" || !strings.Contains(conflict["message"], original.Title) {
		t.Fatalf("wrong conflict: %d %s", code, data)
	}
	if code, _ = call(t, server, token, csrf, "DELETE", path, nil); code != 204 {
		t.Fatal("delete archived project", code)
	}
	if code, data = call(t, server, token, csrf, "POST", "/api/projects", body); code != 200 {
		t.Fatalf("deleted link not reusable: %d %s", code, data)
	}
}
