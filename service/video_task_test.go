package service

import (
	"path/filepath"
	"testing"
	"time"

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

func TestVideoTaskExpiredAfter24Hours(t *testing.T) {
	now := time.Now()
	cases := []struct {
		createdAt string
		want      bool
	}{
		{videoTaskTime(now.Add(-25 * time.Hour)), true},
		{videoTaskTime(now.Add(-23 * time.Hour)), false},
		{"", false},
		{now.Add(-25 * time.Hour).UTC().Format(time.RFC3339Nano), true},
	}
	for _, item := range cases {
		if got := videoTaskExpired(model.VideoTask{CreatedAt: item.createdAt}, now); got != item.want {
			t.Fatalf("videoTaskExpired(%q) = %v, want %v", item.createdAt, got, item.want)
		}
	}
}

func TestExpiredVideoTaskMarkedFailed(t *testing.T) {
	root := t.TempDir()
	originalConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = originalConfig })
	config.Cfg.LocalToken, config.Cfg.LocalDataDir = "local-test", root
	config.Cfg.StorageDriver, config.Cfg.DatabaseDSN = "sqlite", filepath.Join(root, "workspace.db")

	task := model.VideoTask{ID: "video-expired", UserID: "local-test", Source: "canvas", Status: "processing", CreatedAt: videoTaskTime(time.Now().Add(-25 * time.Hour)), UpdatedAt: now()}
	saved, err := repository.SaveVideoTask(task)
	if err != nil {
		t.Fatal(err)
	}
	if !videoTaskExpired(saved, time.Now()) {
		t.Fatal("expected task to be expired")
	}
	if err := UpdateVideoTaskFromPoll(saved, VideoTaskPollUpdate{Status: "failed", Error: "任务超时"}); err != nil {
		t.Fatal(err)
	}
	updated, _, _ := repository.GetUserVideoTask(saved.UserID, saved.ID)
	if updated.Status != "failed" || updated.Error != "任务超时" || updated.CompletedAt == "" {
		t.Fatalf("unexpected expired task result %+v", updated)
	}
}
