package studio

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDuplicateVideoConcurrentCreation(t *testing.T) {
	s := testStore(t)
	owner, _ := fixture(t, s)
	a, _ := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	urls := []string{
		"https://www.youtube.com/watch?v=b1MKJ5gHig0",
		"https://youtu.be/b1MKJ5gHig0?t=10&si=tracking",
		"https://m.youtube.com/watch?v=b1MKJ5gHig0&list=playlist&index=2",
		"https://youtube.com/shorts/b1MKJ5gHig0",
	}
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, len(urls))
	h := a.Routes()
	for _, url := range urls {
		go func(url string) {
			<-start
			body, _ := json.Marshal(map[string]string{"title": "Vidéo", "url": url})
			r := httptest.NewRequest("POST", "/api/projects", bytes.NewReader(body))
			r.Header.Set("Origin", a.Config.Origin)
			r.Header.Set("X-CSRF-Token", csrf)
			r.AddCookie(&http.Cookie{Name: "tarjama_session", Value: token})
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, r)
			results <- rr
		}(url)
	}
	close(start)
	var created string
	var duplicates []string
	for range urls {
		rr := <-results
		switch rr.Code {
		case 200:
			var p Project
			if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil || created != "" || p.URL != urls[0] {
				t.Fatalf("unexpected second creation or noncanonical URL: %s", rr.Body)
			}
			created = p.ID
		case 409:
			var conflict map[string]string
			if err := json.Unmarshal(rr.Body.Bytes(), &conflict); err != nil || conflict["code"] != "duplicate_video" {
				t.Fatalf("missing structured conflict: %s", rr.Body)
			}
			duplicates = append(duplicates, conflict["project_id"])
		default:
			t.Fatalf("unexpected response %d: %s", rr.Code, rr.Body)
		}
	}
	if created == "" || len(duplicates) != len(urls)-1 {
		t.Fatal("expected exactly one creation", created, duplicates)
	}
	for _, duplicate := range duplicates {
		if duplicate != created {
			t.Fatal("wrong existing project", duplicate, created)
		}
	}
	var projects, jobs int
	err := s.DB.QueryRow(context.Background(), `SELECT
		(SELECT count(*) FROM projects WHERE owner_id=$1 AND document->>'url'=$2),
		(SELECT count(*) FROM jobs WHERE owner_id=$1 AND kind='download')`, owner, urls[0]).Scan(&projects, &jobs)
	if err != nil || projects != 1 || jobs != 1 {
		t.Fatal("duplicate work queued", projects, jobs, err)
	}
}

func TestDuplicateVideoPrivateAndReusableAfterDeletion(t *testing.T) {
	s := testStore(t)
	owner, _ := fixture(t, s)
	other, _ := fixture(t, s)
	_, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	otherToken, otherCSRF := sessionFor(t, s, other)
	body := map[string]string{"title": "Vidéo", "url": "https://youtu.be/b1MKJ5gHig0"}
	create := func(token, csrf string, body map[string]string) Project {
		t.Helper()
		code, data := call(t, server, token, csrf, "POST", "/api/projects", body)
		var p Project
		if code != 200 || json.Unmarshal(data, &p) != nil {
			t.Fatalf("create: %d %s", code, data)
		}
		return p
	}
	first := create(token, csrf, body)
	second := create(otherToken, otherCSRF, body)
	if first.ID == second.ID {
		t.Fatal("shared project across users")
	}
	code, data := call(t, server, otherToken, otherCSRF, "POST", "/api/projects", body)
	var conflict map[string]string
	if code != 409 || json.Unmarshal(data, &conflict) != nil || conflict["project_id"] != second.ID {
		t.Fatalf("conflict leaked another user's project: %d %s", code, data)
	}
	// A different video and file-only projects remain allowed.
	create(token, csrf, map[string]string{"title": "Autre", "url": "https://youtu.be/YuV8IY-Bgoc"})
	create(token, csrf, map[string]string{"title": "Fichier"})
	create(token, csrf, map[string]string{"title": "Fichier"})
	code, data = call(t, server, token, csrf, "DELETE", "/api/projects/"+first.ID, nil)
	if code != 204 {
		t.Fatalf("delete: %d %s", code, data)
	}
	recreated := create(token, csrf, body)
	if recreated.ID == first.ID {
		t.Fatal("deleted project reused")
	}
}

func TestDuplicateVideoAtLimitPrefersExistingMedia(t *testing.T) {
	s := testStore(t)
	owner, _ := fixture(t, s)
	_, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	const url = "https://www.youtube.com/watch?v=b1MKJ5gHig0"
	var withMedia string
	// Keep historical duplicates intact; favor the project with downloaded media.
	for i := 0; i < 29; i++ {
		p := Project{ID: id(), Title: "Existant", URL: url, Stage: "preparing", Version: 1}
		if i == 28 {
			p.Media = "video.mp4"
			p.Stage = "arabic"
			withMedia = p.ID
		}
		if err := s.Create(context.Background(), owner, p); err != nil {
			t.Fatal(err)
		}
	}
	code, data := call(t, server, token, csrf, "POST", "/api/projects", map[string]string{"title": "Doublon", "url": url})
	var conflict map[string]string
	if code != 409 || json.Unmarshal(data, &conflict) != nil || conflict["project_id"] != withMedia {
		t.Fatalf("limit hid existing project: %d %s", code, data)
	}
}
