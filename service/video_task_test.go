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

func TestMarkInterruptedCanvasTasks(t *testing.T) {
	root := t.TempDir()
	originalConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = originalConfig })
	config.Cfg.LocalToken, config.Cfg.LocalDataDir = "local-test", root
	config.Cfg.StorageDriver, config.Cfg.DatabaseDSN = "sqlite", filepath.Join(root, "workspace.db")

	const message = "服务重启，任务已中断，请重新生成"
	normalImage := model.CanvasImageTask{ID: "img-normal", UserID: "local-test", Status: "processing", Endpoint: "/images/generations", CreatedAt: now(), UpdatedAt: now()}
	runningHubImage := model.CanvasImageTask{ID: "img-runninghub", UserID: "local-test", Status: "processing", Endpoint: RunningHubStandardImageEndpoint, ResponseBody: `{"taskId":"1"}`, CreatedAt: now(), UpdatedAt: now()}
	normalAudio := model.CanvasAudioTask{ID: "audio-normal", UserID: "local-test", Status: "queued", Endpoint: "/audio/speech", CreatedAt: now(), UpdatedAt: now()}
	doneImage := model.CanvasImageTask{ID: "img-done", UserID: "local-test", Status: "completed", Endpoint: "/images/generations", CompletedAt: now(), CreatedAt: now(), UpdatedAt: now()}
	workflowRef := `{"scope":"personal","channelId":"rh","kind":"workflow","workflowId":"123"}`
	workflowImage := model.CanvasImageTask{ID: "wf-image-running", UserID: "local-test", Status: "running", Endpoint: RunningHubStandardImageEndpoint, WorkflowRef: workflowRef, ResponseBody: `{"upstreamTaskId":"2013508786110730241"}`, CreatedAt: now(), UpdatedAt: now()}
	workflowAudio := model.CanvasAudioTask{ID: "wf-audio-running", UserID: "local-test", Status: "running", WorkflowRef: workflowRef, ResponseBody: `{"upstreamTaskId":"2013508786110730242"}`, CreatedAt: now(), UpdatedAt: now()}
	for _, task := range []any{normalImage, runningHubImage, normalAudio, doneImage, workflowImage, workflowAudio} {
		var err error
		switch item := task.(type) {
		case model.CanvasImageTask:
			_, err = repository.SaveCanvasImageTask(item)
		case model.CanvasAudioTask:
			_, err = repository.SaveCanvasAudioTask(item)
		}
		if err != nil {
			t.Fatal(err)
		}
	}

	if err := repository.MarkInterruptedCanvasTasks(RunningHubStandardImageEndpoint, now(), message); err != nil {
		t.Fatal(err)
	}

	img, _, _ := repository.GetUserCanvasImageTask("local-test", "img-normal")
	if img.Status != "failed" || img.Error != message {
		t.Fatalf("normal image not interrupted: %+v", img)
	}
	rh, _, _ := repository.GetUserCanvasImageTask("local-test", "img-runninghub")
	if rh.Status != "processing" {
		t.Fatalf("runninghub image should keep processing: %+v", rh)
	}
	audio, _, _ := repository.GetUserCanvasAudioTask("local-test", "audio-normal")
	if audio.Status != "failed" || audio.Error != message {
		t.Fatalf("normal audio not interrupted: %+v", audio)
	}
	done, _, _ := repository.GetUserCanvasImageTask("local-test", "img-done")
	if done.Status != "completed" {
		t.Fatalf("completed image should stay completed: %+v", done)
	}

	workflowImg, _, _ := repository.GetUserCanvasImageTask("local-test", "wf-image-running")
	if workflowImg.Status != "running" {
		t.Fatalf("workflow image should keep running: %+v", workflowImg)
	}
	workflowAud, _, _ := repository.GetUserCanvasAudioTask("local-test", "wf-audio-running")
	if workflowAud.Status != "running" {
		t.Fatalf("workflow audio should keep running: %+v", workflowAud)
	}
	workflowTasks, err := repository.ListDueRunningHubWorkflowTasks("", "", 10)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, item := range workflowTasks {
		found[item.ID] = true
	}
	if !found["wf-image-running"] || !found["wf-audio-running"] {
		t.Fatalf("workflow tasks should remain due after restart, got %+v", workflowTasks)
	}
}
