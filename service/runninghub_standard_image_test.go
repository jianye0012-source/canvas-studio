package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
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
	imageBytes, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH2sAAAAASUVORK5CYII=")
	videoBytes := []byte("\x00\x00\x00\x14ftypmp42\x00\x00\x00\x00mp42")
	var submits, queries int
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer mock-token" {
			t.Error("unexpected authorization")
		}
		switch r.URL.Path {
		case "/local-ai/channels/rh/v1/runninghub/submit":
			w.Header().Set("Content-Type", "application/json")
			submits++
			_ = json.NewEncoder(w).Encode(map[string]any{"taskId": providerID, "status": "RUNNING"})
		case "/local-ai/channels/rh/v1/runninghub/query":
			w.Header().Set("Content-Type", "application/json")
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
		case "/local-ai/channels/rh/v1/runninghub/result":
			var body map[string]string
			_ = json.NewDecoder(r.Body).Decode(&body)
			switch body["taskId"] {
			case videoID:
				w.Header().Set("Content-Type", "video/mp4")
				_, _ = w.Write(videoBytes)
			case providerID:
				w.Header().Set("Content-Type", "image/png")
				_, _ = w.Write(imageBytes)
			default:
				t.Errorf("unexpected result task ID %v", body)
				w.WriteHeader(http.StatusNotFound)
			}
		default:
			t.Errorf("unexpected request path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer gateway.Close()
	config.Cfg.LocalProviderBase, config.Cfg.LocalProviderToken = gateway.URL+"/local-ai/director", "mock-token"
	safeProxyHTTPClient = &http.Client{Transport: runningHubTestTransport(func(request *http.Request) (*http.Response, error) {
		t.Error("result download must use the gateway, not SafeProxyHTTPClient")
		return nil, errors.New("unexpected SafeProxyHTTPClient call")
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

func TestRunningHubResultDownloadPermanentAndTransientErrors(t *testing.T) {
	root := t.TempDir()
	originalConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = originalConfig })
	config.Cfg.LocalToken, config.Cfg.LocalDataDir = "local-test", root
	config.Cfg.StorageDriver, config.Cfg.DatabaseDSN = "sqlite", filepath.Join(root, "workspace.db")
	channel := model.ModelChannel{ID: "rh", Enabled: true, Protocol: RunningHubStandardProtocol, BaseURL: "http://127.0.0.1:1/local-ai/channels/rh", APIKey: "previous-token", Models: []string{runningHubStandardImageModel}}
	settings := model.Settings{}
	settings.Private.Channels = []model.ModelChannel{channel}
	if _, err := repository.SaveSettings(settings, now()); err != nil {
		t.Fatal(err)
	}
	const taskID = "2013508786110730241"
	resultStatus := http.StatusUnprocessableEntity
	resultBody := `{"error":{"message":"RunningHub 结果地址发生跳转，已拒绝下载"}}`
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer mock-token" {
			t.Error("unexpected authorization")
		}
		switch r.URL.Path {
		case "/local-ai/channels/rh/v1/runninghub/query":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"taskId": taskID, "status": "SUCCESS", "results": []map[string]string{{"url": "https://example.com/image.png"}}})
		case "/local-ai/channels/rh/v1/runninghub/result":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(resultStatus)
			_, _ = w.Write([]byte(resultBody))
		default:
			t.Errorf("unexpected request path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer gateway.Close()
	config.Cfg.LocalProviderBase, config.Cfg.LocalProviderToken = gateway.URL+"/local-ai/director", "mock-token"

	input := CanvasImageTaskCreateInput{UserID: "local-test", ClientTaskID: "image-result-errors", Endpoint: RunningHubStandardImageEndpoint, Model: runningHubStandardImageModel, ChannelID: "rh", ContentType: "application/json"}
	task, created, err := CreateCanvasImageTaskOnce(input)
	if err != nil || !created {
		t.Fatalf("could not create image task: %v", err)
	}
	checkpoint, _ := json.Marshal(map[string]string{"taskId": taskID})
	task.Status, task.ResponseBody = "processing", string(checkpoint)
	if _, err := SaveCanvasImageTask(task); err != nil {
		t.Fatal(err)
	}

	if err := pollRunningHubStandardImage(context.Background(), task); err != nil {
		t.Fatalf("permanent image poll should not return error: %v", err)
	}
	failedImage, _, _ := GetUserCanvasImageTask(task.UserID, task.ID)
	if failedImage.Status != "failed" || failedImage.Error != "RunningHub 结果地址发生跳转，已拒绝下载" {
		t.Fatalf("unexpected permanent image result %+v", failedImage)
	}
	video, err := PollRunningHubStandardVideo(context.Background(), model.VideoTask{UserID: task.UserID, UpstreamTaskID: taskID}, channel)
	if err != nil || video.Status != "failed" || video.Error != "RunningHub 结果地址发生跳转，已拒绝下载" {
		t.Fatalf("unexpected permanent video result %+v err %v", video, err)
	}

	resultStatus = http.StatusBadGateway
	resultBody = `{"error":{"message":"无法下载 RunningHub 结果：net::ERR_PROXY_CONNECTION_FAILED"}}`
	task.Status, task.ResponseBody = "processing", string(checkpoint)
	if _, err := SaveCanvasImageTask(task); err != nil {
		t.Fatal(err)
	}
	if err := pollRunningHubStandardImage(context.Background(), task); err == nil || !strings.Contains(err.Error(), "ERR_PROXY_CONNECTION_FAILED") {
		t.Fatalf("expected transient image download error, got %v", err)
	}
	stillProcessing, _, _ := GetUserCanvasImageTask(task.UserID, task.ID)
	if stillProcessing.Status != "processing" {
		t.Fatalf("transient image error should keep task processing, got %s", stillProcessing.Status)
	}
	if _, err := PollRunningHubStandardVideo(context.Background(), model.VideoTask{UserID: task.UserID, UpstreamTaskID: taskID}, channel); err == nil || !strings.Contains(err.Error(), "ERR_PROXY_CONNECTION_FAILED") {
		t.Fatalf("expected transient video download error, got %v", err)
	}
}

func TestRunningHubQueryErrorCodeFailsImmediately(t *testing.T) {
	root := t.TempDir()
	originalConfig := config.Cfg
	t.Cleanup(func() { config.Cfg = originalConfig })
	config.Cfg.LocalToken, config.Cfg.LocalDataDir = "local-test", root
	config.Cfg.StorageDriver, config.Cfg.DatabaseDSN = "sqlite", filepath.Join(root, "workspace.db")
	channel := model.ModelChannel{ID: "rh", Enabled: true, Protocol: RunningHubStandardProtocol, BaseURL: "http://127.0.0.1:1/local-ai/channels/rh", APIKey: "previous-token", Models: []string{runningHubStandardImageModel}}
	settings := model.Settings{}
	settings.Private.Channels = []model.ModelChannel{channel}
	if _, err := repository.SaveSettings(settings, now()); err != nil {
		t.Fatal(err)
	}
	const taskID = "2013508786110730241"
	queryResponse := map[string]any{"taskId": taskID, "status": "", "errorCode": "806", "errorMessage": "APIKEY_USER_NOT_FOUND"}
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer mock-token" {
			t.Error("unexpected authorization")
		}
		if r.URL.Path != "/local-ai/channels/rh/v1/runninghub/query" {
			t.Errorf("unexpected request path %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(queryResponse)
	}))
	defer gateway.Close()
	config.Cfg.LocalProviderBase, config.Cfg.LocalProviderToken = gateway.URL+"/local-ai/director", "mock-token"

	input := CanvasImageTaskCreateInput{UserID: "local-test", ClientTaskID: "image-query-error", Endpoint: RunningHubStandardImageEndpoint, Model: runningHubStandardImageModel, ChannelID: "rh", ContentType: "application/json"}
	task, created, err := CreateCanvasImageTaskOnce(input)
	if err != nil || !created {
		t.Fatalf("could not create image task: %v", err)
	}
	checkpoint, _ := json.Marshal(map[string]string{"taskId": taskID})

	saveProcessing := func() {
		t.Helper()
		task.Status, task.ResponseBody = "processing", string(checkpoint)
		if _, err := SaveCanvasImageTask(task); err != nil {
			t.Fatal(err)
		}
	}

	saveProcessing()
	if err := pollRunningHubStandardImage(context.Background(), task); err != nil {
		t.Fatalf("query errorCode should mark image failed without error: %v", err)
	}
	failedImage, _, _ := GetUserCanvasImageTask(task.UserID, task.ID)
	if failedImage.Status != "failed" || failedImage.Error != "APIKEY_USER_NOT_FOUND" {
		t.Fatalf("unexpected image query failure %+v", failedImage)
	}
	video, err := PollRunningHubStandardVideo(context.Background(), model.VideoTask{UserID: task.UserID, UpstreamTaskID: taskID}, channel)
	if err != nil || video.Status != "failed" || video.Error != "APIKEY_USER_NOT_FOUND" {
		t.Fatalf("unexpected video query failure %+v err %v", video, err)
	}

	for _, code := range []string{"", "0"} {
		queryResponse = map[string]any{"taskId": taskID, "status": "", "errorCode": code, "errorMessage": ""}
		saveProcessing()
		if err := pollRunningHubStandardImage(context.Background(), task); err == nil || !strings.Contains(err.Error(), "未知任务状态") {
			t.Fatalf("errorCode %q should keep unknown status error, got %v", code, err)
		}
		stillProcessing, _, _ := GetUserCanvasImageTask(task.UserID, task.ID)
		if stillProcessing.Status != "processing" {
			t.Fatalf("errorCode %q should keep task processing, got %s", code, stillProcessing.Status)
		}
	}
}
