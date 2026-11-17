package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
	"github.com/tigerowo/infinite-canvas/service"
)

func setupVideoClientTaskTest(t *testing.T) {
	t.Helper()
	original := config.Cfg
	t.Cleanup(func() { config.Cfg = original })
	config.Cfg = config.Config{StorageDriver: "sqlite", DatabaseDSN: ":memory:", AILogDir: t.TempDir()}
}

func callAIVideo(t *testing.T, id string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/videos/"+id, nil)
	request = request.WithContext(service.WithUser(request.Context(), model.AuthUser{ID: "u1"}))
	writer := httptest.NewRecorder()
	AIVideo(writer, request, id)
	return writer
}

func decodeVideoEnvelope(t *testing.T, recorder *httptest.ResponseRecorder) (int, string, map[string]any) {
	t.Helper()
	var body struct {
		Code int            `json:"code"`
		Msg  string         `json:"msg"`
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode video response: %v", err)
	}
	return body.Code, body.Msg, body.Data
}

func TestAIVideoClientTaskSubmittingReturnsQueued(t *testing.T) {
	setupVideoClientTaskTest(t)
	const id = "client_video_task_submitting"
	_, cleanup, err := service.CanvasTaskContext("video", "u1", id)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	code, _, data := decodeVideoEnvelope(t, callAIVideo(t, id))
	if code != 0 || data["status"] != "queued" {
		t.Fatalf("expected queued while submitting, got code=%d data=%v", code, data)
	}
}

func TestAIVideoClientTaskMissingReturnsNotFound(t *testing.T) {
	setupVideoClientTaskTest(t)
	code, msg, _ := decodeVideoEnvelope(t, callAIVideo(t, "client_video_task_missing"))
	if code != 1 || msg != "视频任务不存在，请在服务商处核对任务是否已提交" {
		t.Fatalf("expected not found message, got code=%d msg=%q", code, msg)
	}
}

func TestAIVideoStoppedClientTaskReturnsCancelled(t *testing.T) {
	setupVideoClientTaskTest(t)
	const id = "client_video_task_stopped"
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveVideoTask(model.VideoTask{ID: id, UserID: "u1", Source: "canvas", Status: "cancelled", CreatedAt: stamp, UpdatedAt: stamp, CompletedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	code, _, data := decodeVideoEnvelope(t, callAIVideo(t, id))
	if code != 0 || data["status"] != "cancelled" {
		t.Fatalf("expected cancelled record, got code=%d data=%v", code, data)
	}
}

func TestAIVideoClientTaskRegistrationEndsBeforeRecordWritten(t *testing.T) {
	setupVideoClientTaskTest(t)
	const id = "client_video_task_timing"
	_, cleanup, err := service.CanvasTaskContext("video", "u1", id)
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		code, _, data := decodeVideoEnvelope(t, callAIVideo(t, id))
		if code != 0 || data["status"] != "queued" {
			t.Fatalf("expected queued while registered, got code=%d data=%v", code, data)
		}
	}
	stamp := time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := repository.SaveVideoTask(model.VideoTask{ID: id, UserID: "u1", Source: "canvas", Status: "running", CreatedAt: stamp, UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	cleanup()
	code, _, data := decodeVideoEnvelope(t, callAIVideo(t, id))
	if code != 0 || data["status"] != "running" {
		t.Fatalf("expected real record after handler return, got code=%d data=%v", code, data)
	}
}
