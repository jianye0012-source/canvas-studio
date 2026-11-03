package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

const runningHubStandardImageModel = "rhart-image-g-2/image-to-image"

type runningHubTestTransport func(*http.Request) (*http.Response, error)

func (transport runningHubTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestRunningHubImageTaskReusesProviderIDAndSavesResult(t *testing.T) {
	root := t.TempDir()
	originalConfig, originalClient := config.Cfg, safeProxyHTTPClient
	t.Cleanup(func() { config.Cfg, safeProxyHTTPClient = originalConfig, originalClient })
	config.Cfg.LocalToken, config.Cfg.LocalDataDir = "local-test", root
	config.Cfg.StorageDriver, config.Cfg.DatabaseDSN = "sqlite", filepath.Join(root, "workspace.db")
	const providerID = "2013508786110730241"
	const videoID = "2013508786110730242"
	var submits, queries int
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "Bearer mock-token" {
			t.Error("unexpected authorization")
		}
		switch r.URL.Path {
		case "/local-ai/channels/rh/v1/runninghub/submit":
			submits++
			_ = json.NewEncoder(w).Encode(map[string]any{"taskId": providerID, "status": "RUNNING"})
		case "/local-ai/channels/rh/v1/runninghub/query":
			queries++
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["taskId"] == videoID {
				_ = json.NewEncoder(w).Encode(map[string]any{"taskId": videoID, "status": "SUCCESS", "results": []map[string]string{{"url": "https://example.com/video.mp4"}}})
				return
			}
			if body["taskId"] != providerID {
				t.Errorf("wrong query ID %v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"taskId": providerID, "status": "SUCCESS", "results": []map[string]string{{"url": "https://example.com/image.png"}}})
		default:
			t.Errorf("unexpected request path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer gateway.Close()
	config.Cfg.LocalProviderBase, config.Cfg.LocalProviderToken = gateway.URL+"/local-ai/director", "mock-token"
	imageBytes, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH2sAAAAASUVORK5CYII=")
	safeProxyHTTPClient = &http.Client{Transport: runningHubTestTransport(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Authorization") != "" {
			t.Error("download sent the provider token")
		}
		if request.URL.String() == "https://example.com/video.mp4" {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("\x00\x00\x00\x14ftypmp42\x00\x00\x00\x00mp42"))}, nil
		}
		if request.URL.String() != "https://example.com/image.png" {
			t.Error("image download used unexpected URL")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(imageBytes)))}, nil
	})}
	channel := model.ModelChannel{ID: "rh", Enabled: true, Protocol: RunningHubStandardProtocol, BaseURL: "http://127.0.0.1:1/local-ai/channels/rh", APIKey: "previous-token", Models: []string{runningHubStandardImageModel}}
	settings := model.Settings{}
	settings.Private.Channels = []model.ModelChannel{channel}
	if _, err := repository.SaveSettings(settings, now()); err != nil {
		t.Fatal(err)
	}
	input := CanvasImageTaskCreateInput{UserID: "local-test", ClientTaskID: "image-test", Endpoint: RunningHubStandardImageEndpoint, Model: runningHubStandardImageModel, ChannelID: "rh", ContentType: "application/json"}
	task, created, err := CreateCanvasImageTaskOnce(input)
	if err != nil || !created {
		t.Fatalf("could not create image task: %v", err)
	}
	task.Status, task.StartedAt = "processing", now()
	if err := SubmitRunningHubStandardImage(context.Background(), task, channel, []byte("{}")); err != nil {
		t.Fatal(err)
	}
	task, created, err = CreateCanvasImageTaskOnce(input)
	if err != nil || created || runningHubStandardProviderID(task) != providerID {
		t.Fatalf("task checkpoint not reused: %v, %v, %q", err, created, task.ResponseBody)
	}
	input.ClientTaskID = "unknown-submission"
	if _, _, err := CreateCanvasImageTaskOnce(input); err != nil {
		t.Fatal(err)
	}
	if err := resumeRunningHubStandardImageTasks(); err != nil {
		t.Fatal(err)
	}
	unknown, _, _ := GetUserCanvasImageTask(input.UserID, input.ClientTaskID)
	if unknown.Status != "failed" {
		t.Fatalf("unconfirmed submission status %s", unknown.Status)
	}
	pending, err := repository.ListRunningHubStandardImageTasks(RunningHubStandardImageEndpoint)
	if err != nil || len(pending) != 1 {
		t.Fatalf("expected one task to resume, got %d, err %v", len(pending), err)
	}
	if err := pollRunningHubStandardImage(context.Background(), pending[0]); err != nil {
		t.Fatal(err)
	}
	completed, _, _ := GetUserCanvasImageTask(task.UserID, task.ID)
	if completed.Status != "completed" || !strings.HasPrefix(completed.StorageKey, "server:") || submits != 1 || queries != 1 {
		t.Fatalf("incorrect task result %s, submissions %d, queries %d", completed.Status, submits, queries)
	}
	files, _ := os.ReadDir(filepath.Join(root, "assets"))
	if len(files) != 1 {
		t.Fatalf("expected one result image on disk, got %d", len(files))
	}
	video, err := PollRunningHubStandardVideo(context.Background(), model.VideoTask{UserID: task.UserID, UpstreamTaskID: videoID}, channel)
	if err != nil || video.Status != "completed" || !strings.HasPrefix(video.VideoURL, "/api/files/") || submits != 1 || queries != 2 {
		t.Fatalf("unexpected video result %+v, submits %d, queries %d, error %v", video, submits, queries, err)
	}
	response := VideoTaskResponse(model.VideoTask{VideoURL: video.VideoURL})
	if key, _ := response["storageKey"].(string); !strings.HasPrefix(key, "server:") {
		t.Fatalf("local video does not expose the storage key: %+v", response)
	}
	files, _ = os.ReadDir(filepath.Join(root, "assets"))
	if len(files) != 2 {
		t.Fatalf("expected one image and one video on disk, got %d files", len(files))
	}
}
