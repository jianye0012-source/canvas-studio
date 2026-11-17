package service

import (
	"path/filepath"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

func TestVideoTaskStoredStatusKeepsUnknownPollable(t *testing.T) {
	cases := map[string]string{
		"submitted":   "unknown",
		"GENERATING":  "unknown",
		"in_progress": "processing",
		"success":     "completed",
		"cancelled":   "failed",
		"":            "",
		"pending":     "queued",
	}
	for input, want := range cases {
		if got := videoTaskStoredStatus(input); got != want {
			t.Fatalf("videoTaskStoredStatus(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestUnrecognizedPollStatusStaysDue(t *testing.T) {
	root := t.TempDir()
	originalConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = originalConfig })
	config.Cfg.LocalToken, config.Cfg.LocalDataDir = "local-test", root
	config.Cfg.StorageDriver, config.Cfg.DatabaseDSN = "sqlite", filepath.Join(root, "workspace.db")

	task := model.VideoTask{ID: "video-unknown-status", UserID: "local-test", Source: "canvas", Status: "processing", CreatedAt: now(), UpdatedAt: now()}
	saved, err := repository.SaveVideoTask(task)
	if err != nil {
		t.Fatal(err)
	}
	if err := UpdateVideoTaskFromPoll(saved, VideoTaskPollUpdate{Status: "submitted"}); err != nil {
		t.Fatal(err)
	}
	updated, _, _ := repository.GetUserVideoTask(saved.UserID, saved.ID)
	if updated.Status != "unknown" {
		t.Fatalf("expected stored status unknown, got %q", updated.Status)
	}
	due, err := repository.ListDueVideoTasks(10)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range due {
		if item.ID == saved.ID {
			return
		}
	}
	t.Fatalf("expected task to remain due for polling, got %+v", due)
}
