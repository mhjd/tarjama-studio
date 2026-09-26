package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestBudgetSurvivesRestartAndUnknownCharges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "budget.json")
	b, err := openReviewBudget(path)
	if err != nil {
		t.Fatal(err)
	}
	i, err := b.reserve("fixture", 1.5)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := openReviewBudget(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restored.reserve("fixture", .6); err == nil {
		t.Fatal("restart refunded unknown charge")
	}
	if err = restored.settle(i, .05); err != nil {
		t.Fatal(err)
	}
	if _, err = restored.reserve("fixture", 1.5); err != nil {
		t.Fatal(err)
	}
	restored.Deadline = time.Now().Add(-time.Minute)
	if _, err = restored.reserve("fixture", .01); err == nil {
		t.Fatal("expired campaign restarted")
	}
}
