package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tigerowo/infinite-canvas/config"
	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/service"
)

func TestFailAIChannelSelectPassesNoChannelMessage(t *testing.T) {
	recorder := httptest.NewRecorder()
	failAIChannelSelect(recorder, errors.New("没有可用模型渠道"), "AI 接口请求失败")
	if msg := decodeFailMessage(t, recorder); msg != "没有可用模型渠道" {
		t.Fatalf("expected channel message to pass through, got %q", msg)
	}

	recorder = httptest.NewRecorder()
	failAIChannelSelect(recorder, errors.New("database is locked"), "AI 接口请求失败")
	if msg := decodeFailMessage(t, recorder); msg != "AI 接口请求失败" {
		t.Fatalf("expected fallback message, got %q", msg)
	}
}

func TestCopyAIResponseNetworkErrorHasCauseWithoutURL(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "http://127.0.0.1:1/v1/chat/completions?key=SECRET-KEY", nil)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	copyAIResponse(recorder, request, model.ModelChannel{}, aiLogContext{}, nil)
	msg := decodeFailMessage(t, recorder)
	if !strings.HasPrefix(msg, "AI 接口请求失败：") {
		t.Fatalf("expected network cause prefix, got %q", msg)
	}
	lower := strings.ToLower(msg)
	if !strings.Contains(lower, "connect") && !strings.Contains(lower, "refused") {
		t.Fatalf("expected network cause in message, got %q", msg)
	}
	if strings.Contains(msg, "SECRET-KEY") || strings.Contains(msg, "127.0.0.1:1/v1") {
		t.Fatalf("network error leaked URL: %q", msg)
	}
}

func TestCopyAIResponseNetworkErrorLogsWithoutQuery(t *testing.T) {
	original := config.Cfg
	config.Cfg = config.Config{AILogDir: t.TempDir()}
	t.Cleanup(func() { config.Cfg = original })

	var logOutput bytes.Buffer
	originalWriter := log.Writer()
	log.SetOutput(&logOutput)
	t.Cleanup(func() { log.SetOutput(originalWriter) })

	request, err := http.NewRequest(http.MethodPost, "http://127.0.0.1:1/v1/chat/completions?key=SECRET-KEY", nil)
	if err != nil {
		t.Fatal(err)
	}
	copyAIResponse(httptest.NewRecorder(), request, model.ModelChannel{}, aiLogContext{StartedAt: time.Now(), Endpoint: "/chat/completions", Method: http.MethodPost, Model: "test-model", UserID: "u1"}, nil)

	logs, err := service.ListAICallLogs(model.Query{})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range logs.Items {
		if strings.Contains(item.Endpoint+item.Error+item.RequestBody+item.ResponseBody, "SECRET-KEY") || strings.Contains(item.Endpoint+item.Error, "?key=") {
			t.Fatalf("ai call log leaked query: %+v", item)
		}
	}
	if strings.Contains(logOutput.String(), "SECRET-KEY") || strings.Contains(logOutput.String(), "?key=") {
		t.Fatalf("process log leaked query: %s", logOutput.String())
	}
}

func TestTranslationLogEndpointRedacted(t *testing.T) {
	request, err := http.NewRequest(http.MethodPost, "http://127.0.0.1:1/v1/x?api_key=SECRET", nil)
	if err != nil {
		t.Fatal(err)
	}
	context := parameterTranslationLog(aiLogContext{Endpoint: "/images/generations", Channel: model.ModelChannel{}}, &service.ParameterTranslation{Submission: request})
	if strings.Contains(context.Endpoint, "api_key") || strings.Contains(context.Endpoint, "SECRET") {
		t.Fatalf("translation endpoint not redacted: %q", context.Endpoint)
	}
}

func TestGeminiMediaLogStillRedacted(t *testing.T) {
	original := config.Cfg
	config.Cfg = config.Config{AILogDir: t.TempDir()}
	t.Cleanup(func() { config.Cfg = original })

	saveAIProxyLog(aiLogContext{StartedAt: time.Now(), Endpoint: "/images/generations", Method: http.MethodPost, Model: "gemini-model", Channel: model.ModelChannel{Protocol: "gemini"}, UserID: "u1"}, 0, "raw media response", "")
	logs, err := service.ListAICallLogs(model.Query{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range logs.Items {
		if item.Endpoint == "/images/generations" {
			found = true
			if item.ResponseBody != "[redacted Gemini media response]" {
				t.Fatalf("gemini media response not redacted: %q", item.ResponseBody)
			}
		}
	}
	if !found {
		t.Fatal("expected gemini ai call log to be written")
	}
}

func decodeFailMessage(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Msg string `json:"msg"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode fail response: %v", err)
	}
	return body.Msg
}
